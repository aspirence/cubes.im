import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  dodoConfigured,
  dodoClient,
  DODO_PRODUCTS,
  billableSeats,
  storageAddonQty,
  appOrigin,
} from "@/lib/dodo/client";

/**
 * Creates a Dodo checkout for a team's subscription: one recurring seat product
 * (quantity = active seats) plus, when needed, the per-GB extra-storage add-on.
 * Only a team admin can start it; the real charge is confirmed later by the
 * Dodo webhook, never here.
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

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { teamId?: string; storageGb?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const teamId = body.teamId;
  if (!teamId) {
    return NextResponse.json({ error: "Missing teamId" }, { status: 400 });
  }

  // Must be a team admin (RLS-safe RPC keyed to the caller's session).
  const { data: isAdmin } = await supabase.rpc("is_team_admin", { _team_id: teamId });
  if (!isAdmin) {
    return NextResponse.json({ error: "Only a team admin can manage billing." }, { status: 403 });
  }

  // Billable seats = active, non-guest members.
  const { data: members } = await supabase
    .from("team_members")
    .select("user_id, active, member_type")
    .eq("team_id", teamId);
  const seats = billableSeats(members ?? []);

  // Extra storage above the included allotment (platform_pricing is newer than
  // the generated types).
  const { data: pricing } = await (supabase as unknown as SupabaseClient)
    .from("platform_pricing")
    .select("base_storage_gb")
    .eq("id", true)
    .maybeSingle();
  const baseGb = Number((pricing as { base_storage_gb?: number } | null)?.base_storage_gb ?? 100);
  const storageGb = Math.max(baseGb, Math.round(body.storageGb ?? baseGb));
  const extraGb = Math.max(0, storageGb - baseGb);

  // Storage rides along as an ADDON on the seat product (one subscription with a
  // main product + addon, so both quantities can be updated together later).
  // Sold in blocks (Dodo min-price), so quantity = blocks that cover extraGb.
  const storageAddon = DODO_PRODUCTS.storageAddon();
  const addonQty = storageAddonQty(extraGb);
  const addons =
    addonQty > 0 && storageAddon ? [{ addon_id: storageAddon, quantity: addonQty }] : undefined;

  const trialDays = Number(process.env.DODO_TRIAL_DAYS ?? 7) || 0;

  try {
    const session = await dodoClient().checkoutSessions.create({
      product_cart: [{ product_id: seatProduct, quantity: seats, addons }],
      customer: { email: user.email ?? "", name: (user.user_metadata?.name as string) ?? "" },
      subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
      metadata: {
        team_id: teamId,
        kind: "team_subscription",
        storage_gb: String(storageGb),
        seats: String(seats),
      },
      return_url: `${appOrigin()}/admin-center/billing?checkout=success`,
    });
    return NextResponse.json({ checkout_url: session.checkout_url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 502 },
    );
  }
}
