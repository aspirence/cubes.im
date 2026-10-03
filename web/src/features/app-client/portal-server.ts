import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/apps/server";
import { readClientSessionCookie } from "@/lib/client-portal/session";
import { isBackendMissing } from "./types";

/**
 * Server-side plumbing for the signed-in client portal pages. Server-only: it
 * reads the session cookie and holds the service-role key, so nothing here may
 * be imported from a "use client" module.
 *
 * Every client read goes through one of the contract's SECURITY DEFINER RPCs
 * with the session token as an argument — the token is the whole
 * authorization, resolved inside the database, and these pages never touch a
 * table through PostgREST. The service-role client is not a shortcut past that:
 * the portal RPCs are granted to `service_role` alone, so it is the only client
 * that may call them at all.
 *
 * The cookie itself is read through the Client backend's own helper rather than
 * a second copy of the name and the flags — one definition, no drift.
 */
export async function portalClient(): Promise<SupabaseClient> {
  const admin = serviceClient();
  if (admin) return admin as unknown as SupabaseClient;
  // No service-role key configured: the SSR client will be refused by the
  // grants, which portalRpc reports as a plain "unavailable" rather than a
  // stack trace on a client's phone.
  return (await createServerSupabase()) as unknown as SupabaseClient;
}

/** The raw session token from the httpOnly cookie, if the browser sent one. */
export async function readPortalToken(): Promise<string | null> {
  const value = await readClientSessionCookie();
  return value && value.length >= 20 ? value : null;
}

export interface PortalRpcResult {
  data: unknown;
  /** The Client backend has not shipped this RPC yet. */
  missing: boolean;
  /** A real failure (not "missing"), already reduced to a safe string. */
  error: string | null;
}

/** Calls a portal RPC, separating "not built yet" from "actually failed". */
export async function portalRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<PortalRpcResult> {
  let supabase: SupabaseClient;
  try {
    supabase = await portalClient();
  } catch {
    return { data: null, missing: false, error: "The portal is unavailable." };
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isBackendMissing(error)) return { data: null, missing: true, error: null };
    // Never surface a database message to a client-side visitor: it can carry
    // table names and row ids that the whole point of this app is to withhold.
    return { data: null, missing: false, error: "The portal could not load that." };
  }
  return { data, missing: false, error: null };
}
