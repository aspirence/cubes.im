import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { dodoConfigured, dodoClient } from "@/lib/dodo/client";

/**
 * Live subscription details + recent payments for a team's Billing page. Reads
 * the current state straight from Dodo (status, amount, next billing / trial end,
 * cancel flag) so it's always accurate, plus the customer's recent payments.
 */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!dodoConfigured()) {
    return NextResponse.json({ configured: false, subscribed: false });
  }
  const teamId = request.nextUrl.searchParams.get("teamId");
  if (!teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: isAdmin, error: adminErr } = await supabase.rpc("is_team_admin", { _team_id: teamId });
  // A transient RPC failure must be retryable (503), NOT a definitive "not admin"
  // (403) — otherwise the client's fail-safe logic can't tell them apart and a
  // paying admin could be shown the not-subscribed state.
  if (adminErr) return NextResponse.json({ error: "Auth check failed" }, { status: 503 });
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  ) as unknown as SupabaseClient;
  const { data: subRow } = await db
    .from("team_subscriptions")
    .select("dodo_subscription_id, dodo_customer_id")
    .eq("team_id", teamId)
    .maybeSingle();
  const sub = subRow as { dodo_subscription_id?: string; dodo_customer_id?: string } | null;
  if (!sub?.dodo_subscription_id) {
    return NextResponse.json({ configured: true, subscribed: false });
  }

  try {
    const client = dodoClient();
    const s = await client.subscriptions.retrieve(sub.dodo_subscription_id);

    let payments: {
      id: string;
      created_at: string;
      amount: number;
      currency: string;
      status: string;
      invoice_id: string | null;
      invoice_url: string | null;
    }[] = [];
    // Distinguishes "no payments yet" (empty history) from "we couldn't reach
    // Dodo" (show a retry, not a misleading empty state).
    let paymentsError = false;
    const customerId = sub.dodo_customer_id ?? s.customer?.customer_id;
    if (customerId) {
      try {
        const list = await client.payments.list({ customer_id: customerId });
        const items = (list as { items?: unknown[] }).items ?? [];
        payments = (items as Record<string, unknown>[]).slice(0, 50).map((p) => ({
          id: String(p.payment_id ?? ""),
          created_at: String(p.created_at ?? ""),
          amount: Number(p.total_amount ?? 0), // tax-inclusive total actually charged
          currency: String(p.currency ?? "USD"),
          status: String(p.status ?? ""),
          // Dodo returns a downloadable invoice PDF (the receipt) + its number
          // on every payment — surface both so the buyer can self-serve.
          invoice_id: (p.invoice_id as string | null | undefined) ?? null,
          invoice_url: (p.invoice_url as string | null | undefined) ?? null,
        }));
      } catch {
        paymentsError = true;
      }
    }

    return NextResponse.json({
      configured: true,
      subscribed: true,
      status: s.status,
      amount_cents: s.recurring_pre_tax_amount, // pre-tax; UI labels it as such
      tax_inclusive: (s as { tax_inclusive?: boolean }).tax_inclusive ?? null,
      currency: s.currency,
      next_billing_date: s.next_billing_date,
      previous_billing_date: s.previous_billing_date,
      created_at: s.created_at,
      trial_period_days: s.trial_period_days,
      cancel_at_period_end: s.cancel_at_next_billing_date,
      payments,
      payments_error: paymentsError,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load subscription" },
      { status: 502 },
    );
  }
}
