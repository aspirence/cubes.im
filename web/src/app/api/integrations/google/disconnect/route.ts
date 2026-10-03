import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/apps/server";
import { authorizeTeam } from "@/lib/email/server";
import { revokeRefreshToken } from "@/lib/google/oauth";

export const runtime = "nodejs";

/**
 * Disconnects a workspace's Google account.
 *
 * Order matters: tell Google first, then forget locally. If we cleared our rows
 * first and the revoke then failed, the grant would stay alive on Google's side
 * with nothing left here pointing at it — an orphaned authorization the user can
 * only find by digging through their Google account settings.
 *
 * The reverse failure is fine and is the one we accept: a failed revoke must not
 * block the local wipe, or a user who already revoked from Google's UI could
 * never clear the dead connection from ours.
 */
export async function POST(request: Request) {
  let body: { teamId?: string; connectionId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const teamId = body.teamId ?? "";
  const connectionId = body.connectionId ?? "";
  if (!teamId || !connectionId) {
    return NextResponse.json(
      { error: "teamId and connectionId are required." },
      { status: 400 },
    );
  }

  const auth = await authorizeTeam(teamId, "admin");
  if (!auth.ok) return auth.response;

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase service role is not configured." },
      { status: 500 },
    );
  }

  // Scope the lookup by team as well as id. connectionId arrives from the
  // client, and service_role bypasses RLS — without this a valid admin of team A
  // could disconnect team B's Google account by guessing a uuid.
  const { data: connection, error: readError } = await admin
    .from("app_google_connections")
    .select("id")
    .eq("id", connectionId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (!connection) {
    // 404 rather than 403, so a wrong id cannot be used to probe which
    // connections exist — the house rule from lib/apps/server.ts.
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const { data: secret } = await admin
    .from("app_google_secrets")
    .select("refresh_token")
    .eq("connection_id", connectionId)
    .maybeSingle();

  let revokedAtGoogle = false;
  if (secret?.refresh_token) {
    revokedAtGoogle = await revokeRefreshToken(secret.refresh_token);
  }

  // Deleting the connection cascades to app_google_secrets, so the tokens go
  // with it. Once sheet syncs exist they hang off the connection too and will
  // cascade the same way, which is deliberate: a disconnected Google account
  // must not leave syncs behind that can never run.
  const { error: deleteError } = await admin
    .from("app_google_connections")
    .delete()
    .eq("id", connectionId)
    .eq("team_id", teamId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  // `revokedAtGoogle: false` is not an error. It usually means the user already
  // revoked access from their Google account page, which is exactly the case
  // where they most need the local disconnect to succeed.
  return NextResponse.json({ ok: true, revokedAtGoogle });
}
