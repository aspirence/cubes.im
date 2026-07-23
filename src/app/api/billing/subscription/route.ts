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
  const { data: isAdmin } = await supabase.rpc("is_team_admin", { _team_id: teamId });
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

    let payments: { id: string; created_at: string; amount: number; currency: string; status: string }[] = [];
    const customerId = sub.dodo_customer_id ?? s.customer?.customer_id;
    if (customerId) {
      try {
        const list = await client.payments.list({ customer_id: customerId });
        const items = (list as { items?: unknown[] }).items ?? [];
        payments = (items as Record<string, unknown>[]).slice(0, 12).map((p) => ({
          id: String(p.payment_id ?? ""),
          created_at: String(p.created_at ?? ""),
          amount: Number(p.total_amount ?? 0),
          currency: String(p.currency ?? "USD"),
          status: String(p.status ?? ""),
        }));
      } catch {
        /* payment history is best-effort */
      }
    }

    return NextResponse.json({
      configured: true,
      subscribed: true,
      status: s.status,
      amount_cents: s.recurring_pre_tax_amount,
      currency: s.currency,
      next_billing_date: s.next_billing_date,
      previous_billing_date: s.previous_billing_date,
      created_at: s.created_at,
      trial_period_days: s.trial_period_days,
      cancel_at_period_end: s.cancel_at_next_billing_date,
      payments,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't load subscription" },
      { status: 502 },
    );
  }
}
