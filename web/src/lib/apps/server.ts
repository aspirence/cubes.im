import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type AppConnection =
  Database["public"]["Tables"]["app_connections"]["Row"];

/**
 * Service-role Supabase client — the ONLY way to reach app_connection_secrets
 * (that table denies authenticated/anon at both the grant and RLS level) and to
 * write connection health. Server-only; the key must never reach the browser.
 * Returns null when the service-role env is not configured.
 */
export function serviceClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return null;
  return createSupabaseAdmin<Database>(url, key, {
    auth: { persistSession: false },
  });
}

/**
 * Authorizes the caller as an org admin for connection `id`, using the SSR
 * (cookie) session — never the service role, so RLS still scopes what the user
 * can see. On success returns the connection row; on failure returns a ready
 * NextResponse (401 unauthenticated, 404 not found / not an org member, 403 not
 * an admin, 500 on error).
 */
export async function authorizeConnectionAdmin(
  id: string,
): Promise<
  | { ok: true; userId: string; connection: AppConnection }
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

  const { data: connection, error } = await supabase
    .from("app_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }
  // Null means it doesn't exist OR RLS hid it (caller isn't an org member) —
  // 404 either way so we don't disclose existence to outsiders.
  if (!connection) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      ),
    };
  }

  const { data: isAdmin, error: adminErr } = await supabase.rpc(
    "is_org_admin",
    { _org_id: connection.org_id },
  );
  if (adminErr) {
    return {
      ok: false,
      response: NextResponse.json({ error: adminErr.message }, { status: 500 }),
    };
  }
  if (!isAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only organization admins can manage connections." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, userId: user.id, connection };
}
