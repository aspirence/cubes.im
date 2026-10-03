import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { UUID_RE } from "@/lib/client-portal/http";
import { approvalFile } from "@/lib/client-portal/rpc";
import { readClientSessionCookie } from "@/lib/client-portal/session";
import { redirectToSignedUrl } from "@/lib/client-portal/storage";

/**
 * The work an approval is about, as bytes: the file itself when a file is out
 * for sign-off, or `?asset=2` for the second image on a post.
 *
 * Nothing here is addressed by file id. client_approval_file re-derives what
 * may be served from the approval's own subject and refuses unless this
 * contact has access to the approval's project — so an asset number is not a
 * guess worth making, and an approval id from another client's project
 * resolves to nothing at all.
 */

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = request.nextUrl.searchParams.get("asset");
  let asset: number | null = null;
  if (raw !== null) {
    asset = Number(raw);
    if (!Number.isInteger(asset) || asset < 1 || asset > 100) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
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

  const file = await approvalFile(admin, token, id, asset);
  if (!file.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return redirectToSignedUrl(admin, file);
}
