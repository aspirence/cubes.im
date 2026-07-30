import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { dodoConfigured, dodoClient } from "@/lib/dodo/client";

/**
 * Auth-gated invoice/receipt PDF for a single payment. Streams Dodo's invoice
 * PDF (the receipt) back to the buyer without exposing the Dodo API key, and
 * only after confirming the payment belongs to the caller's own team. The
 * billing UI links here as a guaranteed in-app download (the direct invoice_url
 * from Dodo can expire or be host-gated).
 *
 *   GET /api/billing/invoice?teamId=<uuid>&paymentId=<id>  ->  application/pdf
 */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!dodoConfigured()) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 404 });
  }
  const teamId = request.nextUrl.searchParams.get("teamId");
  const paymentId = request.nextUrl.searchParams.get("paymentId");
  if (!teamId || !paymentId) {
    return NextResponse.json({ error: "Missing teamId or paymentId" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: isAdmin, error: adminErr } = await supabase.rpc("is_team_admin", { _team_id: teamId });
  if (adminErr) return NextResponse.json({ error: "Auth check failed" }, { status: 503 });
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  ) as unknown as SupabaseClient;
  const { data: subRow } = await db
    .from("team_subscriptions")
    .select("dodo_customer_id")
    .eq("team_id", teamId)
    .maybeSingle();
  const customerId = (subRow as { dodo_customer_id?: string } | null)?.dodo_customer_id;
  if (!customerId) {
    return NextResponse.json({ error: "No billing customer for this team." }, { status: 404 });
  }

  try {
    const client = dodoClient();
    // Ownership check: the payment must belong to THIS team's Dodo customer.
    const list = await client.payments.list({ customer_id: customerId });
    const items = (list as unknown as { items?: Record<string, unknown>[] }).items ?? [];
    const owned = items.some((p) => String(p.payment_id ?? "") === paymentId);
    if (!owned) {
      return NextResponse.json({ error: "Invoice not found for this team." }, { status: 404 });
    }

    // Dodo returns the invoice PDF (which is the receipt) as a fetch Response.
    const pdfRes = (await client.invoices.payments.retrieve(paymentId)) as unknown as Response;
    const blob = await pdfRes.blob();
    return new Response(blob, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="cubes-invoice-${paymentId}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't fetch the invoice." },
      { status: 502 },
    );
  }
}
