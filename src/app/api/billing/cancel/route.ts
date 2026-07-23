import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { dodoConfigured, dodoClient } from "@/lib/dodo/client";

/**
 * Cancels a team's subscription at the end of the current billing period (so
 * access continues until it's paid through), or resumes a scheduled
 * cancellation with { resume: true }. Team admins only.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!dodoConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 400 });

  let body: { teamId?: string; resume?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const teamId = body.teamId;
  if (!teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  const resume = Boolean(body.resume);

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
    .select("dodo_subscription_id")
    .eq("team_id", teamId)
    .maybeSingle();
  const subId = (subRow as { dodo_subscription_id?: string } | null)?.dodo_subscription_id;
  if (!subId) return NextResponse.json({ error: "No active subscription." }, { status: 400 });

  try {
    await dodoClient().subscriptions.update(subId, {
      cancel_at_next_billing_date: !resume,
    });
    await db
      .from("team_subscriptions")
      .update({ cancel_at_period_end: !resume, updated_at: new Date().toISOString() })
      .eq("team_id", teamId);
    return NextResponse.json({ ok: true, cancel_at_period_end: !resume });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't update the subscription" },
      { status: 502 },
    );
  }
}
