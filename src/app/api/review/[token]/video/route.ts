import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Streams a shared review video's bytes to the public review page.
 *
 * The `video-review` bucket is private, so instead of opening a storage policy
 * to `anon`, this route validates the share token with the service role, signs
 * a short-lived URL for the requested revision, and 302-redirects to it. The
 * browser follows the redirect (and re-requests on seek), so range playback
 * keeps working while the signing key never leaves the server.
 */

const BUCKET = "video-review";
const SIGNED_TTL = 60 * 60 * 4; // 4h — a comfortable review session.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // The share tables are newer than the generated types.
  const db = admin as unknown as SupabaseClient;

  // Resolve the (active) share -> its video.
  const { data: share } = await db
    .from("app_video_review_shares")
    .select("video_id, active")
    .eq("token", token)
    .maybeSingle();
  if (!share || !share.active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Which revision? ?rev=N, else the video's latest.
  const revParam = request.nextUrl.searchParams.get("rev");
  let revision = revParam ? Number(revParam) : NaN;
  if (!Number.isFinite(revision)) {
    const { data: video } = await db
      .from("app_video_review_videos")
      .select("latest_revision")
      .eq("id", share.video_id)
      .maybeSingle();
    revision = video?.latest_revision ?? 1;
  }

  const { data: rev } = await db
    .from("app_video_review_revisions")
    .select("storage_path, url")
    .eq("video_id", share.video_id)
    .eq("revision", revision)
    .maybeSingle();
  if (!rev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // External-URL revisions redirect straight through.
  if (!rev.storage_path) {
    if (!rev.url) {
      return NextResponse.json({ error: "No source" }, { status: 404 });
    }
    return NextResponse.redirect(rev.url, 302);
  }

  // Uploaded object — a `<bucket>::<path>` prefix targets another bucket.
  let bucket: string = BUCKET;
  let path = rev.storage_path;
  const sep = path.indexOf("::");
  if (sep > 0) {
    bucket = path.slice(0, sep);
    path = path.slice(sep + 2);
  }

  const { data: signed, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_TTL);
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }

  // Never let a stale signed URL get cached by the browser/CDN.
  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
