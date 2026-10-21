import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  META_OAUTH_COOKIE,
  buildMetaAuthUrl,
  createMetaNonce,
  metaConfigured,
  safeMetaReturnTo,
  signMetaState,
} from "@/lib/meta/oauth";

export const runtime = "nodejs";

/**
 * Begins "Continue with Facebook" for a workspace (Workflows → Integrations).
 * A top-level navigation: the admin clicks the button and lands in Facebook's
 * dialog. The attempt is identified twice — signed into `state` and in a
 * short-lived cookie — and the callback requires both to agree.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get("teamId") ?? "";
  const returnTo = safeMetaReturnTo(url.searchParams.get("returnTo"));
  const back = (reason: string) => {
    const target = new URL(returnTo, url.origin);
    target.searchParams.set("meta", "error");
    target.searchParams.set("reason", reason);
    return NextResponse.redirect(target);
  };

  if (!metaConfigured()) return back("not_configured");
  if (!teamId) return back("bad_request");

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  const { data: isAdmin } = await supabase.rpc("is_team_admin", { _team_id: teamId });
  if (!isAdmin) return back("forbidden");

  const nonce = createMetaNonce();
  const state = signMetaState({ teamId, userId: user.id, nonce, iat: Date.now(), returnTo });
  const store = await cookies();
  store.set(META_OAUTH_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the callback is a top-level GET navigation from facebook.com.
    sameSite: "lax",
    path: "/api/integrations/meta",
    maxAge: 600,
  });
  return NextResponse.redirect(buildMetaAuthUrl(state));
}
