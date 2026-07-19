import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/apps/server";

/**
 * Shared plumbing for the email-engine routes (/api/apps/resend/*,
 * /api/email/send). The engine's tables are newer than the generated database
 * types (the use-email hooks carry the same caveat), so the service client is
 * exposed through a loose cast rather than regenerating types.
 */

/** Service-role client, untyped — the email tables aren't in Database yet. */
export function emailServiceClient(): SupabaseClient | null {
  const admin = serviceClient();
  return admin ? (admin as unknown as SupabaseClient) : null;
}

/**
 * Authorizes the caller against a team using the SSR (cookie) session — RLS
 * RPCs do the real check. `role: "admin"` gates on is_team_admin (key/config
 * management), `role: "member"` on is_team_member (the send path).
 */
export async function authorizeTeam(
  teamId: string,
  role: "admin" | "member",
): Promise<
  | { ok: true; userId: string; accessToken: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const fn = role === "admin" ? "is_team_admin" : "is_team_member";
  const { data: allowed, error } = await supabase.rpc(fn, { _team_id: teamId });
  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            role === "admin"
              ? "Only workspace admins can manage the email sender."
              : "You are not a member of this workspace.",
        },
        { status: 403 },
      ),
    };
  }
  // For forwarding the caller's identity to the send-email edge function.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { ok: true, userId: user.id, accessToken: session?.access_token ?? "" };
}

/**
 * Authorizes the caller for platform-scope email. `admin: true` requires a
 * platform admin (sender/key management + tests); otherwise any signed-in
 * user qualifies — the self-address-only rule for non-admin dispatches is
 * enforced by the send path itself.
 */
export async function authorizePlatform(admin: boolean): Promise<
  | {
      ok: true;
      userId: string;
      email: string;
      isPlatformAdmin: boolean;
      accessToken: string;
    }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: isPlatformAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }
  if (admin && !isPlatformAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only platform admins can manage the platform sender." },
        { status: 403 },
      ),
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    ok: true,
    userId: user.id,
    email: (user.email ?? "").toLowerCase(),
    isPlatformAdmin: Boolean(isPlatformAdmin),
    accessToken: session?.access_token ?? "",
  };
}
