import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { DriveError, driveAuthForConnection, fileMeta, streamRange } from "@/lib/google/drive";

/**
 * The optional "keep a copy in Cubes" for a Drive-backed revision.
 *
 * Streaming from Drive is the default and needs none of this. A copy is worth
 * making when the review will outlive the editor's Drive: files get moved into
 * another folder, un-shared when a freelancer is offboarded, or replaced in
 * place with a new cut — and a review whose bytes vanish takes its timestamps'
 * meaning with it. Importing pins the exact cut that was commented on.
 *
 * The copy is a STREAM, never a buffer. A review video is routinely several
 * gigabytes; reading one into memory to hand it to the storage client would take
 * the whole server down with it. The bytes go from Drive's response body
 * straight into an upload request and are never all present at once.
 */

const BUCKET = "video-review";

/**
 * A bucket with no `file_size_limit` is capped by the PROJECT's global storage
 * limit instead, which is not readable from here. Guessing one (Supabase's own
 * default is 50 MB) would refuse nearly every real review video before trying,
 * so an unset bucket limit means "do not pre-refuse" and a too-large file is
 * caught by Storage's own answer to the upload.
 */
type BucketLimit = number | null;

export type ImportOutcome =
  | { ok: true; storagePath: string; alreadyImported: boolean }
  | { ok: false; message: string; retriable: boolean };

/** Drive names are arbitrary text; a storage key is not. */
function safeName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "video").slice(0, 80);
}

/** Bytes a bucket will accept. Storage may report a number or a "50MB" string. */
function parseLimit(limit: number | string | null | undefined): BucketLimit {
  if (limit === null || limit === undefined || limit === "") return null;
  if (typeof limit === "number") return limit > 0 ? limit : null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?b)?\s*$/i.exec(limit);
  if (!m) return null;
  const scale = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] ?? "b").toLowerCase()] ?? 1;
  return Math.round(Number(m[1]) * scale);
}

function human(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Stored where members can read it, so it carries no URL and no token. */
function sanitize(err: unknown): string {
  if (err instanceof DriveError) return err.message;
  if (err instanceof Error && err.message && err.message.length < 300) {
    return err.message.replace(/https?:\/\/\S+/g, "a link");
  }
  return "The copy from Google Drive failed. Try again.";
}

/** The revision fields the copy needs, across both column spellings. */
interface ImportRow {
  id: string;
  video_id: string;
  revision: number;
  drive_file_id: string | null;
  drive_connection_id: string | null;
  drive_size_bytes: number | string | null;
  drive_name: string | null;
  import_status: string | null;
  imported_storage_path: string | null;
}

async function fail(
  admin: SupabaseClient,
  revisionId: string,
  message: string,
  retriable: boolean,
): Promise<ImportOutcome> {
  await admin
    .from("app_video_review_revisions")
    .update({
      import_status: "error",
      import_error: message.slice(0, 1000),
    })
    .eq("id", revisionId);
  return { ok: false, message, retriable };
}

/**
 * Copies one revision's Drive file into the `video-review` bucket.
 *
 * Idempotent in two layers. A revision already imported returns its existing
 * path untouched. A revision whose import is mid-flight is not restarted: the
 * claim below is a conditional UPDATE, so two callers racing produce exactly one
 * winner and the loser reports "already running" instead of uploading the same
 * gigabytes twice.
 */
export async function importDriveRevision(
  admin: SupabaseClient<Database>,
  revisionId: string,
): Promise<ImportOutcome> {
  const db = admin as unknown as SupabaseClient;

  const { data } = await db
    .from("app_video_review_revisions")
    .select(
      "id, video_id, revision, drive_file_id, drive_connection_id, drive_size_bytes, " +
        "drive_name, import_status, imported_storage_path",
    )
    .eq("id", revisionId)
    .maybeSingle();
  // The Drive columns are newer than the generated database types, so the row
  // is named here rather than inferred.
  const row = (data ?? null) as ImportRow | null;

  if (!row) return { ok: false, message: "That revision no longer exists.", retriable: false };
  if (!row.drive_file_id) {
    return { ok: false, message: "This revision does not come from Google Drive.", retriable: false };
  }
  if (row.import_status === "done" && row.imported_storage_path) {
    return { ok: true, storagePath: row.imported_storage_path, alreadyImported: true };
  }
  if (!row.drive_connection_id) {
    return fail(db, revisionId, "The workspace's Google connection is gone. Reconnect Google and try again.", false);
  }

  const { data: videoRow } = await db
    .from("app_video_review_videos")
    .select("id, team_id")
    .eq("id", row.video_id)
    .maybeSingle();
  const video = (videoRow ?? null) as { id: string; team_id: string } | null;
  if (!video) return { ok: false, message: "That video no longer exists.", retriable: false };

  // Claim the work. `.select()` makes the update report what it actually
  // changed, which is how the loser of a race learns it lost.
  const { data: claimed } = await db
    .from("app_video_review_revisions")
    .update({ import_status: "running", import_error: null })
    .eq("id", revisionId)
    .in("import_status", ["none", "queued", "error"])
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { ok: false, message: "A copy of this video is already being made.", retriable: false };
  }

  const credential = driveAuthForConnection(admin, row.drive_connection_id);

  try {
    const meta = await fileMeta(credential, row.drive_file_id);
    if (meta.isFolder) {
      return fail(db, revisionId, "That Drive item is a folder, not a video.", false);
    }
    if (!meta.canDownload) {
      return fail(
        db,
        revisionId,
        "Google Drive will not let us download this file — its owner has disabled downloads.",
        false,
      );
    }

    // Refuse before spending bandwidth, not after: the upload would be rejected
    // at the end anyway, and a 3 GB round trip to learn that is unkind.
    const { data: bucket } = await admin.storage.getBucket(BUCKET);
    const limit = parseLimit(
      (bucket as unknown as { file_size_limit?: number | string | null } | null)?.file_size_limit,
    );
    const size = meta.sizeBytes ?? Number(row.drive_size_bytes ?? 0);
    if (size && limit !== null && size > limit) {
      return fail(
        db,
        revisionId,
        `This video is ${human(size)}, over the ${human(limit)} limit for imported copies. ` +
          "It will keep streaming from Google Drive instead.",
        false,
      );
    }

    const name = safeName(row.drive_name || meta.name);
    const path = `${video.team_id}/${row.video_id}/drive-v${row.revision}-${name}`;

    const upstream = await streamRange(credential, row.drive_file_id, null);
    if (!upstream.body) {
      return fail(db, revisionId, "Google Drive returned no data for this file.", true);
    }

    // Uploaded through Storage's REST endpoint rather than supabase-js, because
    // only a raw fetch can send a ReadableStream body (`duplex: "half"`). The
    // js client would want the whole file in memory first.
    const storageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
        "Content-Type": meta.mimeType || "video/mp4",
        // Re-importing after a failure must overwrite the half-written object.
        "x-upsert": "true",
        ...(size ? { "Content-Length": String(size) } : {}),
      },
      body: upstream.body,
      // Node's fetch refuses a stream body without this; it is the caller
      // promising to finish sending before it reads the response.
      duplex: "half",
    };
    const uploaded = await fetch(storageUrl, init);

    if (!uploaded.ok) {
      const detail = await uploaded.text().catch(() => "");
      // 413 is the project-level size cap we could not read up front. Say so in
      // the words a person can act on, rather than echoing Storage's JSON.
      const message =
        uploaded.status === 413
          ? `This video is ${human(size)} — too large to copy into Cubes storage. ` +
            "It will keep streaming from Google Drive instead."
          : `Cubes storage rejected the copy (${uploaded.status}). ${detail.slice(0, 120)}`.trim();
      return fail(db, revisionId, message, uploaded.status >= 500);
    }

    await db
      .from("app_video_review_revisions")
      .update({
        import_status: "done",
        import_error: null,
        imported_storage_path: path,
        imported_at: new Date().toISOString(),
      })
      .eq("id", revisionId);

    return { ok: true, storagePath: path, alreadyImported: false };
  } catch (err) {
    const retriable = err instanceof DriveError && (err.kind === "server" || err.kind === "rate_limited" || err.kind === "network");
    return fail(db, revisionId, sanitize(err), retriable);
  }
}
