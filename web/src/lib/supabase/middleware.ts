import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { AuthUser } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The minimal slice of the `public.users` profile the proxy guards need.
 * `setup_completed` gates onboarding (see the setup guard in `proxy.ts`).
 */
export interface SessionProfile {
  setup_completed: boolean;
}

/**
 * Result of refreshing the Supabase session in the proxy/middleware layer.
 *
 * `response` carries the (possibly refreshed) auth cookies and must be returned
 * from `proxy` so the browser stays in sync. `user` is the authenticated user
 * (or `null`), used by the route guards in `proxy.ts`.
 *
 * `profile` is the caller's `public.users` row slice (or `null` when there is
 * no authenticated user / no row yet). It is filled additively so the Phase 1
 * auth guard, which only reads `{ response, user }`, keeps working unchanged.
 */
export interface UpdateSessionResult {
  response: NextResponse;
  user: AuthUser | null;
  profile: SessionProfile | null;
}

/**
 * Refreshes the Supabase auth session on every matched request and keeps the
 * auth cookies in sync between the request and the response.
 *
 * Called from the root `proxy.ts` (Next.js 16 renamed `middleware` -> `proxy`).
 * Env is read lazily here so the app builds with placeholder env.
 *
 * Returns the response (with refreshed cookies) plus the resolved user so the
 * caller can apply route guards. When the guard needs to redirect, it must copy
 * the cookies from `response` onto the redirect so the refresh is preserved.
 */
export async function updateSession(
  request: NextRequest,
): Promise<UpdateSessionResult> {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  // Without configured env there is no session to refresh; pass through.
  if (!url || !anonKey) {
    return { response: supabaseResponse, user: null, profile: null };
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser().
  // getUser() revalidates the auth token and refreshes the session cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Load the setup_completed flag so the proxy can gate onboarding. Kept to a
  // single narrow column; only attempted when there is an authenticated user.
  let profile: SessionProfile | null = null;
  if (user) {
    const { data } = await supabase
      .from("users")
      .select("setup_completed")
      .eq("id", user.id)
      .maybeSingle();
    profile = data ? { setup_completed: data.setup_completed } : null;
  }

  return { response: supabaseResponse, user, profile };
}
