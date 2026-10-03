import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/apps/server";

/**
 * Shared route plumbing for the Sheets, Marketing and runner routes.
 *
 * House rules (same as the Google / email connector routes): authorize on the
 * cookie session first, THEN use service_role; always scope service-role
 * lookups by team as well as id, because service_role bypasses RLS; answer 404
 * rather than 403 for an id outside the caller's team.
 */

/** Service-role client, untyped — the app tables are newer than the generated types. */
export function adminClient(): SupabaseClient | null {
  const admin = serviceClient();
  return admin ? (admin as unknown as SupabaseClient) : null;
}

export type AuthResult =
  | { ok: true; userId: string; supabase: SupabaseClient }
  | { ok: false; response: NextResponse };

/**
 * The caller's cookie session, checked against a team. `role: "admin"` gates on
 * is_team_admin, `role: "member"` on is_team_member. The returned `supabase` is
 * the caller's own RLS-scoped client, for checks that must run as them (e.g.
 * is_project_team_member).
 */
export async function authorizeTeamRequest(
  teamId: string,
  role: "admin" | "member",
  forbiddenMessage?: string,
): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const fn = role === "admin" ? "is_team_admin" : "is_team_member";
  const { data: allowed, error } = await supabase.rpc(fn, { _team_id: teamId });
  if (error) {
    return { ok: false, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            forbiddenMessage ??
            (role === "admin"
              ? "Only workspace admins can do this."
              : "You are not a member of this workspace."),
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId: user.id, supabase: supabase as unknown as SupabaseClient };
}

/** Is the caller (by their own session) a member of this project's team? */
export async function callerCanAccessProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_project_team_member", { _project_id: projectId });
  return !error && Boolean(data);
}

/**
 * Constant-time check of a shared-secret header against an env var. False when
 * the env var is unset, so an unconfigured deployment never accepts a blank
 * header as valid.
 */
export function secretMatches(provided: string | null, envName: string): boolean {
  const expected = process.env[envName] ?? "";
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Error text safe to store where members can read it: no tokens, no URLs. */
export function safeErrorText(err: unknown, fallback = "Something went wrong."): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : fallback;
  return raw
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/(access_token|token|key|secret)=[^&\s]+/gi, "$1=[redacted]")
    .replace(/EAA[A-Za-z0-9]{20,}/g, "[token]")
    .slice(0, 900);
}
