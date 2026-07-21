import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`. This runs on
 * every matched request to (1) refresh the Supabase auth session and (2) apply
 * route guards.
 *
 * Guard rules:
 *  - No session + app route                    -> redirect to /login
 *  - Session  + /login|/signup                 -> redirect to /home
 *  - Session  + setup not done + not on /setup -> redirect to /setup
 *  - Session  + setup done     + on /setup     -> redirect to /home
 *
 * Refreshed auth cookies from `updateSession` are copied onto any redirect so
 * the session refresh is never lost.
 */

/** Routes that are always reachable without a session. */
const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  // Public read-only project views (token-gated in the DB, not by session).
  "/share",
  // Public, token-gated client portal (no login — the share token is the gate).
  "/portal",
  // Public, token-gated video review link for clients (no login required).
  "/review",
  // Public marketing pages.
  "/pricing",
  "/features",
  "/product",
  "/manifesto",
  // Public early-access request form (no login required to submit).
  "/early-access",
  // Legal pages.
  "/terms",
  "/privacy",
  "/refunds",
];

/** When a logged-in user hits one of these, send them into the app. */
const AUTH_ONLY_PATHS = ["/login", "/signup"];

function isPublicPath(pathname: string): boolean {
  // /auth/* covers the OAuth / code-exchange callback and related handlers.
  if (pathname === "/auth" || pathname.startsWith("/auth/")) {
    return true;
  }
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Builds a redirect response that preserves the refreshed auth cookies that
 * `updateSession` set on `sessionResponse`.
 */
function redirectPreservingCookies(
  request: NextRequest,
  destination: string,
  sessionResponse: NextResponse,
): NextResponse {
  const redirectResponse = NextResponse.redirect(
    new URL(destination, request.url),
  );
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

/** True when the request targets the onboarding wizard. */
function isSetupPath(pathname: string): boolean {
  return pathname === "/setup" || pathname.startsWith("/setup/");
}

export async function proxy(request: NextRequest) {
  const { response, user, profile } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const onPublicPath = isPublicPath(pathname);
  const onAuthOnlyPath = AUTH_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Root "/" is the public marketing landing page for logged-out visitors;
  // authenticated users are sent straight into the app.
  if (pathname === "/") {
    return user
      ? redirectPreservingCookies(request, "/home", response)
      : response;
  }

  // Authenticated user landing on /login or /signup -> push to the app.
  if (user && onAuthOnlyPath) {
    return redirectPreservingCookies(request, "/home", response);
  }

  // Unauthenticated user requesting an app route -> push to login. For invite
  // links we carry a `next` param so the flow resumes after sign-in.
  if (!user && !onPublicPath) {
    const destination = pathname.startsWith("/invite/")
      ? `/login?next=${encodeURIComponent(pathname + request.nextUrl.search)}`
      : "/login";
    return redirectPreservingCookies(request, destination, response);
  }

  // Onboarding gate (only for authenticated users, never on auth/public paths
  // so we don't trap the OAuth callback or the auth screens).
  if (user && !onPublicPath) {
    const setupCompleted = profile?.setup_completed ?? false;
    const onSetupPath = isSetupPath(pathname);
    // Invite acceptance must work even before the user finishes their own
    // onboarding, so it is exempt from the "go to /setup" redirect.
    const onInvitePath = pathname.startsWith("/invite/");

    // Setup not finished and not already on the wizard -> send to /setup.
    if (!setupCompleted && !onSetupPath && !onInvitePath) {
      return redirectPreservingCookies(request, "/setup", response);
    }

    // Setup finished but still on the wizard -> send into the app.
    if (setupCompleted && onSetupPath) {
      return redirectPreservingCookies(request, "/home", response);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico and common static assets
     * - PWA assets that must be served to everyone, signed in or not, or the
     *   app can't install / the service worker can't register (sw.js,
     *   offline.html, the web manifest).
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|offline.html|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
