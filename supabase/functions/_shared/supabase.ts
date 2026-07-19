// Shared Supabase client factories for edge functions. SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected into the edge
// runtime automatically — no function secrets needed.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2";

export type { SupabaseClient };

/** Service-role client — bypasses RLS; for secrets, logs and health writes. */
export function adminClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Caller-scoped client — carries the request's Authorization header so RLS
 * helpers (is_team_member/is_team_admin) evaluate as the actual user.
 */
export function userClient(authHeader: string): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}
