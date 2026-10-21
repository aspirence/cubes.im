import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/apps/server";
import { authorizeTeam } from "@/lib/email/server";
import { revokeMetaToken } from "@/lib/meta/oauth";
import { metaToken } from "@/lib/meta/store";

export const runtime = "nodejs";

/**
 * Disconnects a Facebook connection: tells Facebook first (best effort — a
 * failure must not block the local wipe), then deletes the row, which takes its
 * token and ad accounts with it. Workflow steps that used those accounts fail
 * with a "connect Facebook" message until a connection exists again.
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

  const service = serviceClient();
  if (!service) return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  const admin = service as unknown as SupabaseClient;

  const { data: row, error } = await admin
    .from("app_meta_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Connection not found." }, { status: 404 });

  const token = await metaToken(admin, connectionId);
  const revokedAtFacebook = token ? await revokeMetaToken(token) : false;

  const { error: deleteError } = await admin
    .from("app_meta_connections")
    .delete()
    .eq("id", connectionId)
    .eq("team_id", teamId);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  return NextResponse.json({ ok: true, revokedAtFacebook });
}
