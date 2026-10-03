import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { TOKEN_RE, appUrl } from "@/lib/client-portal/http";
import { consumeMagicLink } from "@/lib/client-portal/rpc";
import {
  hashIp,
  setClientSessionCookie,
  userAgentOf,
} from "@/lib/client-portal/session";

/**
 * Redeems a magic link: verify → session cookie → redirect into the portal.
 *
 * Single use is enforced in SQL by a conditional UPDATE on used_at, so two
 * simultaneous clicks cannot both mint a session. Unknown, already-used and
 * expired all produce the same redirect to the sign-in page with ?error=link —
 * a person who forwarded the mail learns nothing from the difference.
 *
 * This is a GET with a side effect because it has to be: the thing being
 * clicked is a link in an email client. The 15-minute, single-use design is
 * what makes that acceptable.
 */

export const runtime = "nodejs";

function backToSignIn(reason: string): NextResponse {
  return NextResponse.redirect(`${appUrl()}/portal?error=${reason}`, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) return backToSignIn("link");

  const admin = adminClient();
  if (!admin) return backToSignIn("config");

  let result;
  try {
    result = await consumeMagicLink(
      admin,
      token,
      userAgentOf(request),
      hashIp(request),
    );
  } catch {
    return backToSignIn("link");
  }
  if (!result.ok || !result.session_token) return backToSignIn("link");

  const response = NextResponse.redirect(`${appUrl()}/portal/home`, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
  return setClientSessionCookie(response, result.session_token);
}
