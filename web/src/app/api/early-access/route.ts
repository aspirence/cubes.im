import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Early-access → paid device order.
 *
 * POST creates a pending request (server-side, service role) and returns a pay
 * URL. GET (?req=<id>) returns a small, non-sensitive summary for the pay /
 * confirmation screens. The public can't insert directly (RLS locks it), so all
 * requests flow through here.
 *
 * When Dodo test keys are set (DODO_PAYMENTS_API_KEY + DODO_DEVICE_PRODUCT_ID)
 * this route will instead open a Dodo hosted checkout and the webhook will mark
 * the request paid. Until then it routes to the built-in test checkout.
 */
export const runtime = "nodejs";

const DEVICE_PRICE_CENTS = 10000; // $100.00
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return null;
  return createSupabaseAdmin<Database>(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot — a filled hidden field means a bot; pretend success, store nothing.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ payUrl: "/early-access" });
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const company = String(body.company ?? "").trim() || null;
  const team_size = String(body.team_size ?? "").trim() || null;
  const note = String(body.note ?? "").trim() || null;

  if (name.length < 1 || name.length > 120) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }
  if (note && note.length > 2000) {
    return NextResponse.json({ error: "That note is a bit long." }, { status: 400 });
  }

  const db = adminClient();
  if (!db) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const { data, error } = await db
    .from("early_access_requests")
    .insert({
      name,
      email,
      company,
      team_size,
      note,
      amount_cents: DEVICE_PRICE_CENTS,
      payment_status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Could not start your order — please try again." },
      { status: 500 },
    );
  }

  // TODO(dodo): when DODO_PAYMENTS_API_KEY + DODO_DEVICE_PRODUCT_ID are set,
  // create a Dodo checkout for $100 with metadata.request_id = data.id and a
  // return_url of /early-access/pay?req=<id>&paid=1, then return its hosted URL.
  return NextResponse.json({ id: data.id, payUrl: `/early-access/pay?req=${data.id}` });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("req");
  if (!id) return NextResponse.json({ error: "Missing req." }, { status: 400 });

  const db = adminClient();
  if (!db) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });

  const { data, error } = await db
    .from("early_access_requests")
    .select("name, email, payment_status, amount_cents")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    firstName: data.name.split(" ")[0] ?? "",
    email: data.email,
    paymentStatus: data.payment_status,
    amountCents: data.amount_cents,
  });
}
