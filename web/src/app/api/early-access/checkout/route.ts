import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  dodoConfigured,
  dodoClient,
  DODO_PRODUCTS,
  appOrigin,
} from "@/lib/dodo/client";

/**
 * Creates a Dodo one-time checkout for an early-access order. Unauthenticated
 * (early access is pre-signup); the order is looked up by id with the service
 * role. Payment is confirmed by the Dodo webhook, not the browser.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!dodoConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }
  const product = DODO_PRODUCTS.earlyAccess();
  if (!product) {
    return NextResponse.json({ error: "Early-access product not configured." }, { status: 500 });
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  const admin = createSupabaseAdmin<Database>(url, key, { auth: { persistSession: false } });

  const { data: req } = await admin
    .from("early_access_requests")
    .select("id, name, email, payment_status")
    .eq("id", body.id)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (req.payment_status === "paid") {
    return NextResponse.json({ alreadyPaid: true });
  }

  try {
    const session = await dodoClient().checkoutSessions.create({
      product_cart: [{ product_id: product, quantity: 1 }],
      customer: { email: req.email, name: req.name },
      metadata: { early_access_id: req.id, kind: "early_access" },
      return_url: `${appOrigin()}/early-access/pay?req=${req.id}&paid=1`,
    });
    return NextResponse.json({ checkout_url: session.checkout_url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 502 },
    );
  }
}
