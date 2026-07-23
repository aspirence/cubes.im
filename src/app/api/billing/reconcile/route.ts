import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { dodoConfigured, dodoClient } from "@/lib/dodo/client";

/**
 * Syncs a team's subscription from Dodo into our DB right after checkout — a
 * belt-and-suspenders alongside the webhook, so the Billing page reflects a new
 * subscription immediately (even if the webhook is delayed). The subscription's
 * metadata.team_id must match the caller's team.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!dodoConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 400 });

  let body: { teamId?: string; subscriptionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { teamId, subscriptionId } = body;
  if (!teamId || !subscriptionId) {
    return NextResponse.json({ error: "Missing teamId or subscriptionId" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: isAdmin } = await supabase.rpc("is_team_admin", { _team_id: teamId });
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const s = await dodoClient().subscriptions.retrieve(subscriptionId);
    const meta = (s.metadata ?? {}) as Record<string, string>;
    // Only attach a subscription that was created for THIS team.
    if (meta.team_id && meta.team_id !== teamId) {
      return NextResponse.json({ error: "Subscription belongs to another team" }, { status: 403 });
    }

    const db = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      { auth: { persistSession: false } },
    ) as unknown as SupabaseClient;

    const status =
      s.status === "active" || s.status === "pending"
        ? "active"
        : s.status === "on_hold"
          ? "paused"
          : "canceled";
    const patch: Record<string, unknown> = {
      team_id: teamId,
      dodo_subscription_id: subscriptionId,
      dodo_customer_id: s.customer?.customer_id ?? null,
      current_period_end: s.next_billing_date ?? null,
      cancel_at_period_end: Boolean(s.cancel_at_next_billing_date),
      status,
      updated_at: new Date().toISOString(),
    };
    if (meta.storage_gb) patch.storage_gb = Number(meta.storage_gb);
    if (meta.seats) patch.seats = Number(meta.seats);
    await db.from("team_subscriptions").upsert(patch, { onConflict: "team_id" });

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reconcile failed" },
      { status: 502 },
    );
  }
}
