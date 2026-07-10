import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Browser-side Supabase client.
 *
 * Env is read lazily inside this factory (not at module import time) so the app
 * still builds/renders with placeholder env. Falls back to empty strings to
 * avoid throwing during build; real values come from .env.local at runtime.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  return createBrowserClient<Database>(url, anonKey);
}
