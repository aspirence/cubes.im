import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { dodoConfigured, dodoClient } from "@/lib/dodo/client";

/**
 * Returns a Dodo customer-portal link so a team admin can manage their payment
 * method, invoices and cancellation for an existing subscription.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!dodoConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.teamId) return NextResponse.json({ error: "Missing teamId" }, { status: 400 });

  const { data: isAdmin } = await supabase.rpc("is_team_admin", { _team_id: body.teamId });
  if (!isAdmin) {
    return NextResponse.json({ error: "Only a team admin can manage billing." }, { status: 403 });
  }

  const { data: sub } = await (supabase as unknown as SupabaseClient)
    .from("team_subscriptions")
    .select("dodo_customer_id")
    .eq("team_id", body.teamId)
    .maybeSingle();
  const customerId = (sub as { dodo_customer_id?: string } | null)?.dodo_customer_id;
  if (!customerId) {
    return NextResponse.json({ error: "No active subscription yet." }, { status: 400 });
  }

  try {
    const portal = await dodoClient().customers.customerPortal.create(customerId);
    return NextResponse.json({ url: portal.link });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't open the billing portal" },
      { status: 502 },
    );
  }
}
