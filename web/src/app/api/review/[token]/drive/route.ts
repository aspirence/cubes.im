import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { driveSourceFromRow, streamDriveRevision } from "@/lib/video-review/drive-stream";

export const runtime = "nodejs";

/**
 * The public twin of /api/video-review/<videoId>/stream: Drive bytes for a
 * client reviewing through a share link.
 *
 * Modelled on /api/review/<token>/video, which does the same job for uploaded
 * revisions — the share token is validated with the service role and nothing
 * else about the caller is known or needed. A client reviewer has no Cubes
 * account, so this is the only way they can ever see a Drive video with a
 * working timeline; without it they would be back in the `/preview` iframe,
 * unable to leave a timestamped comment on the one surface where timestamped
 * comments matter most.
 *
 * What must never happen here: the workspace's Google token, connection id or
 * Drive file id reaching the response. The client gets video bytes and nothing
 * that could be replayed against Google.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!UUID_RE.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const admin = createSupabaseAdmin<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  // The share and Drive columns are newer than the generated types.
  const db = admin as unknown as SupabaseClient;

  const { data: share } = await db
    .from("app_video_review_shares")
    .select("video_id, active")
    .eq("token", token)
    .maybeSingle();
  if (!share || !share.active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const revParam =
    request.nextUrl.searchParams.get("rev") ?? request.nextUrl.searchParams.get("revision");
  let revision = revParam ? Number(revParam) : NaN;
  if (!Number.isFinite(revision)) {
    const { data: video } = await db
      .from("app_video_review_videos")
      .select("latest_revision")
      .eq("id", share.video_id)
      .maybeSingle();
    revision = video?.latest_revision ?? 1;
  }

  const { data: row } = await db
    .from("app_video_review_revisions")
    .select("*")
    .eq("video_id", share.video_id)
    .eq("revision", revision)
    .maybeSingle();

  const source = driveSourceFromRow(row as never);
  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return streamDriveRevision(admin, source, request.headers.get("range"));
}
