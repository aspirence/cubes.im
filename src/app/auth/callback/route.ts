import { NextResponse, type NextRequest, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWelcomeEmailSafely } from "@/lib/email/welcome";

/**
 * Auth callback route handler.
 *
 * Handles email-link flows (signup confirmation, password recovery). Supabase
 * redirects the browser here with a `?code=...`
 * query param; we exchange that code for a session, persisting the auth
 * cookies via the server Supabase client (which writes through `next/headers`
 * cookies()). On success we redirect to `next` (defaulting to /home); on
 * failure we redirect to /login with an error flag.
 *
 * Route handlers CAN set cookies (unlike Server Components), so the server
 * client's setAll is effective here.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/home";

  // Only allow same-origin relative redirects to avoid open-redirects.
  const redirectPath = next.startsWith("/") ? next : "/home";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Signup-confirmation landings get their welcome email here. Runs after
      // the redirect is sent (never delays login) and dedupes server-side, so
      // recovery/re-login landings are a cheap no-op.
      const session = data?.session;
      if (session?.user?.email) {
        const user = session.user;
        after(() =>
          sendWelcomeEmailSafely({
            userId: user.id,
            email: user.email ?? "",
            name: (user.user_metadata?.name as string | undefined) ?? null,
            accessToken: session.access_token,
          }),
        );
      }
      return NextResponse.redirect(`${origin}${redirectPath}`);
    }
  }

  // No code, or the exchange failed.
  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
