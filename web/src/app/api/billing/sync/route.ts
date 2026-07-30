import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  dodoConfigured,
  dodoClient,
  DODO_PRODUCTS,
  billableSeats,
  storageAddonQty,
} from "@/lib/dodo/client";

/**
 * Re-syncs a team's Dodo subscription to its current usage: seat quantity =
 * active non-guest members, storage addon quantity = extra GB. Called either by
 * a team admin (from Billing) or by the members trigger (with the sync secret).
 * A no-op unless the team already has a subscription.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!dodoConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }
  const seatProduct = DODO_PRODUCTS.seat();
  if (!seatProduct) {
    return NextResponse.json({ error: "Seat product not configured." }, { status: 500 });
  }

  let body: { teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const teamId = body.teamId;
  if (!teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });

  // Auth: the members-trigger secret OR a team-admin session.
  const secret = request.headers.get("x-billing-secret");
  const trusted =
    Boolean(process.env.BILLING_SYNC_SECRET) && secret === process.env.BILLING_SYNC_SECRET;
  if (!trusted) {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: isAdmin } = await supabase.rpc("is_team_admin", { _team_id: teamId });
    if (!isAdmin) {
      return NextResponse.json({ error: "Only a team admin can manage billing." }, { status: 403 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const db = createSupabaseAdmin(url, key, {
    auth: { persistSession: false },
  }) as unknown as SupabaseClient;

  const { data: subRow } = await db
    .from("team_subscriptions")
    .select("dodo_subscription_id, storage_gb")
    .eq("team_id", teamId)
    .maybeSingle();
  const sub = subRow as { dodo_subscription_id?: string; storage_gb?: number } | null;
  if (!sub?.dodo_subscription_id) {
    return NextResponse.json({ ok: true, skipped: "no subscription" });
  }

  const { data: members } = await db
    .from("team_members")
    .select("user_id, active, member_type")
    .eq("team_id", teamId);
  const seats = billableSeats(
    (members ?? []) as {
      user_id?: string | null;
      active?: boolean | null;
      member_type?: string | null;
    }[],
  );

  const { data: pricing } = await db
    .from("platform_pricing")
    .select("base_storage_gb")
    .eq("id", true)
    .maybeSingle();
  const baseGb = Number((pricing as { base_storage_gb?: number } | null)?.base_storage_gb ?? 100);
  const storageGb = Math.max(baseGb, Number(sub.storage_gb ?? baseGb));
  const extraGb = Math.max(0, storageGb - baseGb);

  const storageAddon = DODO_PRODUCTS.storageAddon();
  const addonQty = storageAddonQty(extraGb);
  const addons = addonQty > 0 && storageAddon ? [{ addon_id: storageAddon, quantity: addonQty }] : [];

  try {
    await dodoClient().subscriptions.changePlan(sub.dodo_subscription_id, {
      product_id: seatProduct,
      quantity: seats,
      proration_billing_mode: "prorated_immediately",
      addons,
    });
    await db
      .from("team_subscriptions")
      .update({ seats, updated_at: new Date().toISOString() })
      .eq("team_id", teamId);
    return NextResponse.json({ ok: true, seats, extra_gb: extraGb });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 502 },
    );
  }
}
