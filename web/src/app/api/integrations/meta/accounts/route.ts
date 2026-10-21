import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/apps/server";
import { authorizeTeam } from "@/lib/email/server";
import { MetaGraphError, debugAccounts } from "@/lib/meta/graph";
import { markMetaConnection, metaToken, syncMetaAccounts } from "@/lib/meta/store";

export const runtime = "nodejs";

function service(): SupabaseClient | null {
  const s = serviceClient();
  return s ? (s as unknown as SupabaseClient) : null;
}

/**
 * POST { teamId, connectionId } — re-reads which ad accounts the connection can
 * see (accounts added in Business Manager since; also proves the token still
 * works). Admin only.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { teamId?: string; connectionId?: string };
  const teamId = body.teamId ?? "";
  const connectionId = body.connectionId ?? "";
  if (!teamId || !connectionId) {
    return NextResponse.json({ error: "teamId and connectionId are required." }, { status: 400 });
  }
  const auth = await authorizeTeam(teamId, "admin");
  if (!auth.ok) return auth.response;
  const admin = service();
  if (!admin) return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });

  const { data: row } = await admin
    .from("app_meta_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Connection not found." }, { status: 404 });

  const token = await metaToken(admin, connectionId);
  if (!token) return NextResponse.json({ error: "This connection has no token — connect Facebook again." }, { status: 409 });
  try {
    const { accounts } = await debugAccounts(token);
    const synced = await syncMetaAccounts(admin, teamId, connectionId, accounts);
    if (!synced.ok) return NextResponse.json({ error: "Could not save the ad accounts." }, { status: 500 });
    await markMetaConnection(admin, connectionId, { ok: true });
    return NextResponse.json({ ok: true, accounts: accounts.length });
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : "Could not reach Facebook.";
    await markMetaConnection(admin, connectionId, {
      ok: false,
      error: message,
      revoked: err instanceof MetaGraphError && err.tokenInvalid,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** PATCH { teamId, accountId, enabled } — switches one ad account on or off for workflows. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { teamId?: string; accountId?: string; enabled?: unknown };
  const teamId = body.teamId ?? "";
  const accountId = body.accountId ?? "";
  if (!teamId || !accountId || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "teamId, accountId and enabled are required." }, { status: 400 });
  }
  const auth = await authorizeTeam(teamId, "admin");
  if (!auth.ok) return auth.response;
  const admin = service();
  if (!admin) return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  const { data, error } = await admin
    .from("app_meta_ad_accounts")
    .update({ enabled: body.enabled })
    .eq("id", accountId)
    .eq("team_id", teamId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ad account not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
