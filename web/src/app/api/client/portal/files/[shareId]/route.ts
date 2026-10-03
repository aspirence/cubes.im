import { NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { UUID_RE } from "@/lib/client-portal/http";
import { fileForShare } from "@/lib/client-portal/rpc";
import { readClientSessionCookie } from "@/lib/client-portal/session";
import { redirectToSignedUrl } from "@/lib/client-portal/storage";

/**
 * Serves a shared file to a signed-in client.
 *
 * The route takes a SHARE id, not a file id or a path. client_file_for_share
 * resolves it only if this contact has access to the project the share belongs
 * to, so a guessed id from another client's project resolves to nothing.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await ctx.params;
  if (!UUID_RE.test(shareId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = await readClientSessionCookie();
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const admin = createSupabaseAdmin(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const file = await fileForShare(admin, token, shareId);
  if (!file.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return redirectToSignedUrl(admin, file);
}
