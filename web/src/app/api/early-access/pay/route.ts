import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Built-in TEST checkout — marks an early-access order paid without a real
 * charge, so the flow is exercisable before Dodo test keys are issued.
 *
 * As soon as Dodo is configured this endpoint is disabled: the real charge is
 * confirmed server-to-server by the Dodo webhook, never by the browser.
 */
export const runtime = "nodejs";

function dodoConfigured() {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY && process.env.DODO_DEVICE_PRODUCT_ID);
}

export async function POST(req: NextRequest) {
  if (dodoConfigured()) {
    return NextResponse.json({ error: "Use the live checkout." }, { status: 400 });
  }

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });

  const db = createSupabaseAdmin<Database>(url, key, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("early_access_requests")
    .update({
      payment_status: "paid",
      provider: "test",
      provider_payment_id: `test_${Date.now()}`,
      paid_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("payment_status", "pending")
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Payment failed." }, { status: 500 });
  // Already-paid or unknown id → still report ok so the UI can show confirmation.
  return NextResponse.json({ ok: true, alreadyPaid: !data });
}
