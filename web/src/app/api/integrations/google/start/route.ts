import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  OAUTH_COOKIE,
  buildAuthUrl,
  createNonce,
  createPkce,
  googleConfigured,
  safeReturnTo,
  signState,
} from "@/lib/google/oauth";

export const runtime = "nodejs";

/**
 * Begins the Google consent flow for a workspace.
 *
 * GET because it is a top-level browser navigation — the user clicks "Connect
 * Google" and ends up on Google's consent screen. Everything that identifies the
 * attempt travels two ways at once: signed into `state`, and set in a
 * short-lived cookie. The callback requires both to agree, which is what stops a
 * crafted callback URL being replayed into someone else's session.
 */
export async function GET(request: Request) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google is not configured on this server." },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const teamId = url.searchParams.get("teamId") ?? "";
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required." }, { status: 400 });
  }

  // Authorized on the caller's cookie session, never the service role — the
  // house rule for every connector route.
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: isAdmin, error: rpcError } = await supabase.rpc("is_team_admin", {
    _team_id: teamId,
  });
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Only workspace admins can connect Google." },
      { status: 403 },
    );
  }

  const { verifier, challenge } = createPkce();
  const nonce = createNonce();
  const state = signState({
    teamId,
    userId: user.id,
    nonce,
    iat: Date.now(),
    returnTo,
  });

  const store = await cookies();
  store.set(OAUTH_COOKIE, JSON.stringify({ nonce, verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, not Strict. The callback is a top-level GET navigation from
    // accounts.google.com; Strict would drop the cookie and every connect
    // attempt would fail the nonce check.
    sameSite: "lax",
    path: "/api/integrations/google",
    maxAge: 600,
  });

  return NextResponse.redirect(
    buildAuthUrl({ state, codeChallenge: challenge, loginHint: user.email }),
  );
}
