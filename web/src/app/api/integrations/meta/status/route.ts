import { NextResponse } from "next/server";
import { metaConfigured, metaLoginMode } from "@/lib/meta/oauth";

export const runtime = "nodejs";

/**
 * Whether "Continue with Facebook" can work on this server, and which login
 * shape it uses — so the Integrations page can show setup steps instead of a
 * button that fails. Holds nothing secret.
 */
export async function GET() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return NextResponse.json({
    configured: metaConfigured(),
    mode: metaLoginMode(),
    redirectUri: (process.env.META_OAUTH_REDIRECT_URI ?? "").trim() || (appUrl ? `${appUrl}/api/integrations/meta/callback` : null),
  });
}
