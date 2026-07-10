import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Deletes the currently authenticated user's account.
 *
 * The caller is verified via the SSR server client (cookie session). Deletion
 * itself requires the service-role key, so a separate admin client is created
 * here — this key MUST stay server-side. Deleting the auth.users row cascades
 * to the user's data via FKs.
 */
export async function POST() {
  const supabase = await createServerSupabase();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Account deletion is not configured." },
      { status: 500 },
    );
  }

  const admin = createSupabaseAdmin<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
