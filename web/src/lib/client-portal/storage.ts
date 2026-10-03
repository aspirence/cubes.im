import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Handing storage bytes to a signed-in client.
 *
 * The `team-files` bucket is gated on is_team_member and a client is not one,
 * so rather than opening a storage policy to outsiders the server validates
 * with the service role and redirects to a short-lived signed URL. The signing
 * key never leaves the server, and a URL copied out of the address bar dies on
 * its own.
 *
 * Shared files and approval attachments both come through here so the two
 * cannot drift apart on bucket parsing, TTL or the download flag.
 */

/** Long enough to open a PDF or a video, short enough that a copied URL dies. */
const SIGNED_TTL = 60 * 60;
const DEFAULT_BUCKET = "team-files";

export interface StoredFile {
  name?: string;
  storage_path?: string;
  allow_download?: boolean;
}

export async function redirectToSignedUrl(
  admin: SupabaseClient,
  file: StoredFile,
): Promise<NextResponse> {
  if (!file.storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A `<bucket>::<path>` prefix targets another bucket, same as the review
  // route's revisions.
  let bucket: string = DEFAULT_BUCKET;
  let path = file.storage_path;
  const sep = path.indexOf("::");
  if (sep > 0) {
    bucket = path.slice(0, sep);
    path = path.slice(sep + 2);
  }

  const { data: signed, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_TTL, {
      // Honour the file's own download flag: a preview-only asset stays inline.
      ...(file.allow_download ? { download: file.name ?? true } : {}),
    });
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
