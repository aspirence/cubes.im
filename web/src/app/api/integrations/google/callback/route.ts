import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/apps/server";
import {
  OAUTH_COOKIE,
  exchangeCode,
  googleConfigured,
  readIdentityFromIdToken,
  safeReturnTo,
  verifyState,
} from "@/lib/google/oauth";

export const runtime = "nodejs";

/**
 * Where Google sends the browser back after consent.
 *
 * This route answers with a redirect rather than JSON in every outcome,
 * including failure — the user is looking at a browser tab, not reading a
 * response body. Failures come back as `?google=error&reason=<code>` so the
 * settings screen can say something specific instead of "something went wrong".
 */
function back(returnTo: string, params: Record<string, string>) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const target = new URL(returnTo, base);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = await cookies();

  // Read and immediately clear the flow cookie — it is single-use, and leaving a
  // live verifier behind would let a stolen code be replayed.
  const raw = store.get(OAUTH_COOKIE)?.value ?? "";
  store.delete({ name: OAUTH_COOKIE, path: "/api/integrations/google" });

  const stateRaw = url.searchParams.get("state") ?? "";
  const state = verifyState(stateRaw);
  // With no verifiable state there is no trustworthy returnTo either, so this is
  // the one case that cannot bounce the user back where they started.
  const returnTo = safeReturnTo(state?.returnTo);

  if (!googleConfigured()) return back(returnTo, { google: "error", reason: "not_configured" });

  // The user pressed Cancel, or Google refused the scopes.
  const googleError = url.searchParams.get("error");
  if (googleError) {
    return back(returnTo, { google: "error", reason: googleError });
  }

  const code = url.searchParams.get("code") ?? "";
  if (!code || !state) {
    return back(returnTo, { google: "error", reason: "bad_state" });
  }

  let cookieNonce = "";
  let verifier = "";
  try {
    const parsed = JSON.parse(raw) as { nonce?: string; verifier?: string };
    cookieNonce = parsed.nonce ?? "";
    verifier = parsed.verifier ?? "";
  } catch {
    /* handled below */
  }
  // The double-submit check. A signed state on its own is close to a bearer
  // token; requiring it to match a cookie set in the browser that started the
  // flow is what actually binds the two together.
  if (!cookieNonce || !verifier || cookieNonce !== state.nonce) {
    return back(returnTo, { google: "error", reason: "state_mismatch" });
  }

  // The session must still be the same person who began the flow.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.userId) {
    return back(returnTo, { google: "error", reason: "session_changed" });
  }

  // Re-check admin rights at completion. Someone demoted mid-flow must not land
  // a connection, and this costs one RPC.
  const { data: isAdmin } = await supabase.rpc("is_team_admin", {
    _team_id: state.teamId,
  });
  if (!isAdmin) return back(returnTo, { google: "error", reason: "forbidden" });

  const exchanged = await exchangeCode(code, verifier);
  if (!exchanged.ok) {
    return back(returnTo, { google: "error", reason: exchanged.error });
  }
  const { tokens } = exchanged;

  // No refresh token means background sync can never run. It is what happens
  // when prompt=consent is missing and the user had already granted before, so
  // treat it as a hard failure rather than storing a connection that will look
  // healthy for an hour and then stop.
  if (!tokens.refreshToken) {
    return back(returnTo, { google: "error", reason: "no_refresh_token" });
  }

  const identity = readIdentityFromIdToken(tokens.idToken);
  if (!identity) {
    return back(returnTo, { google: "error", reason: "no_identity" });
  }

  // service_role from here: app_google_secrets denies authenticated at both the
  // grant and the RLS level, and app_google_connections is SELECT-only for
  // members by design.
  const admin = serviceClient();
  if (!admin) return back(returnTo, { google: "error", reason: "not_configured" });

  const { data: connection, error: upsertError } = await admin
    .from("app_google_connections")
    .upsert(
      {
        team_id: state.teamId,
        google_sub: identity.sub,
        google_account_email: identity.email,
        scopes: tokens.scope,
        enabled: true,
        has_refresh_token: true,
        revoked_at: null,
        last_test_at: new Date().toISOString(),
        last_test_ok: true,
        last_test_error: null,
        connected_by: user.id,
      },
      // Reconnecting the same Google account updates the existing row instead of
      // accumulating rows that each hold a refresh token competing for Google's
      // per-client grant limit.
      { onConflict: "team_id,google_sub" },
    )
    .select("id")
    .single();

  if (upsertError || !connection) {
    return back(returnTo, { google: "error", reason: "save_failed" });
  }

  const expiresAt = new Date(
    Date.now() + Math.max(0, tokens.expiresInSeconds - 60) * 1000,
  ).toISOString();

  const { error: secretError } = await admin.from("app_google_secrets").upsert(
    {
      connection_id: connection.id,
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      access_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id" },
  );

  if (secretError) {
    // The connection row would otherwise claim a token that was never stored,
    // and every later refresh would fail for a reason nobody could see.
    await admin
      .from("app_google_connections")
      .update({ has_refresh_token: false, last_test_ok: false })
      .eq("id", connection.id);
    return back(returnTo, { google: "error", reason: "save_failed" });
  }

  return back(returnTo, { google: "connected" });
}
