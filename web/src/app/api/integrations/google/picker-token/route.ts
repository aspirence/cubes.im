import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/apps/server";
import { authorizeTeam } from "@/lib/email/server";
import { getAccessToken } from "@/lib/google/tokens";

export const runtime = "nodejs";

/**
 * Mints a short-lived Google access token for the Google Picker.
 *
 * WHY THE BROWSER GETS A REAL TOKEN AT ALL, AND WHY IT MUST BE THIS ONE:
 * `drive.file` grants access per file, and the grant attaches to the token that
 * the Picker was opened with. If the browser opened the Picker with some other
 * token — say one minted fresh by a client-side Google Identity flow — the file
 * would be granted to that consent, and the server's later read with ITS token
 * would come back 404. So the Picker has to be handed the access token belonging
 * to the stored connection, which only the server can produce.
 *
 * The token is `drive.file`-scoped and expires within the hour. The refresh
 * token, which is the durable credential, never leaves the server.
 *
 * Admin-gated: anyone who can open the Picker can attach a file to the
 * workspace's Google connection, which is the same authority as connecting it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get("teamId") ?? "";
  const connectionId = url.searchParams.get("connectionId") ?? "";
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

  // Scoped by team as well as id: service_role bypasses RLS, so without this an
  // admin of one workspace could mint a token against another's connection.
  const { data: connection, error } = await admin
    .from("app_google_connections")
    .select("id, enabled, revoked_at")
    .eq("id", connectionId)
    .eq("team_id", teamId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!connection) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }
  if (connection.revoked_at || !connection.enabled) {
    return NextResponse.json(
      { error: "Google access was revoked. Reconnect to choose a sheet.", reconnect: true },
      { status: 409 },
    );
  }

  const token = await getAccessToken(admin, connectionId);
  if (!token.ok) {
    return NextResponse.json(
      { error: token.message, reconnect: token.revoked },
      { status: token.revoked ? 409 : 502 },
    );
  }

  const developerKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
  if (!developerKey || !appId) {
    return NextResponse.json(
      { error: "The Google Picker is not configured on this server." },
      { status: 500 },
    );
  }

  // developerKey and appId are NEXT_PUBLIC_ and so are readable in the bundle
  // anyway; returning them here just keeps the Picker's configuration in one
  // response instead of split across two sources.
  return NextResponse.json({ accessToken: token.token, developerKey, appId });
}
