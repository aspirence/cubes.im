import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/apps/server";
import { MetaGraphError, debugAccounts } from "@/lib/meta/graph";
import {
  META_OAUTH_COOKIE,
  debugMetaToken,
  exchangeMetaCode,
  longLivedMetaToken,
  metaConfigured,
  safeMetaReturnTo,
  verifyMetaState,
} from "@/lib/meta/oauth";
import { saveMetaConnection } from "@/lib/meta/store";

export const runtime = "nodejs";

/**
 * Where Facebook sends the browser back. Every outcome is a redirect to the
 * page that started it, with ?meta=connected or ?meta=error&reason=<code>, so
 * the screen can say what happened.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = await cookies();
  const cookieNonce = store.get(META_OAUTH_COOKIE)?.value ?? "";
  store.delete({ name: META_OAUTH_COOKIE, path: "/api/integrations/meta" });

  const state = verifyMetaState(url.searchParams.get("state") ?? "");
  const returnTo = safeMetaReturnTo(state?.returnTo);
  const base = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const back = (params: Record<string, string>) => {
    const target = new URL(returnTo, base);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    return NextResponse.redirect(target);
  };

  if (!metaConfigured()) return back({ meta: "error", reason: "not_configured" });
  // Cancel in the dialog: error=access_denied (error_reason=user_denied).
  const fbError = url.searchParams.get("error");
  if (fbError) return back({ meta: "error", reason: fbError === "access_denied" ? "access_denied" : "facebook_error" });

  const code = url.searchParams.get("code") ?? "";
  if (!code || !state) return back({ meta: "error", reason: "bad_state" });
  if (!cookieNonce || cookieNonce !== state.nonce) return back({ meta: "error", reason: "state_mismatch" });

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.userId) return back({ meta: "error", reason: "session_changed" });
  // Re-checked at completion: someone demoted mid-flow must not land a connection.
  const { data: isAdmin } = await supabase.rpc("is_team_admin", { _team_id: state.teamId });
  if (!isAdmin) return back({ meta: "error", reason: "forbidden" });

  const exchanged = await exchangeMetaCode(code);
  if (!exchanged.ok) return back({ meta: "error", reason: exchanged.error });
  let token = exchanged.token;

  const first = await debugMetaToken(token);
  if (!first.ok || !first.info.valid) return back({ meta: "error", reason: "invalid_token" });
  let info = first.info;

  // A user token from the classic flow lives about an hour; swap it for the
  // long-lived kind. A Login for Business system-user token never expires.
  if (info.type !== "SYSTEM_USER" && info.expiresAt) {
    const long = await longLivedMetaToken(token);
    if (long.ok) {
      token = long.token;
      const again = await debugMetaToken(token);
      if (again.ok && again.info.valid) info = again.info;
    }
  }

  let me: { id: string; name: string | null };
  let accounts: Awaited<ReturnType<typeof debugAccounts>>["accounts"];
  try {
    const seen = await debugAccounts(token);
    me = seen.user;
    accounts = seen.accounts;
  } catch (err) {
    return back({ meta: "error", reason: err instanceof MetaGraphError && err.tokenInvalid ? "invalid_token" : "facebook_error" });
  }
  if (!accounts.length) return back({ meta: "error", reason: "no_ad_accounts" });

  const admin = serviceClient();
  if (!admin) return back({ meta: "error", reason: "not_configured" });

  const saved = await saveMetaConnection(admin, {
    teamId: state.teamId,
    userId: user.id,
    metaUserId: me.id || info.userId || "unknown",
    metaUserName: me.name,
    tokenKind: info.type === "SYSTEM_USER" ? "system_user" : "user",
    tokenExpiresAt: info.type === "SYSTEM_USER" ? null : info.expiresAt,
    scopes: info.scopes,
    token,
    accounts,
  });
  if (!saved.ok) return back({ meta: "error", reason: saved.error });
  return back({ meta: "connected", accounts: String(accounts.length) });
}
