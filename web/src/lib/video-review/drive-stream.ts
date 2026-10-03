import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  DriveError,
  contentRange,
  driveAuthForConnection,
  fileMeta,
  parseByteRange,
  rangeHeaderFor,
  rangeLength,
  streamRange,
  unsatisfiedContentRange,
} from "@/lib/google/drive";

/**
 * Turning a Drive-backed revision into bytes a `<video>` element can seek.
 *
 * Shared by the signed-in route (/api/video-review/<videoId>/stream) and the
 * public share route (/api/review/<token>/video), because the only thing that
 * differs between them is HOW the caller was authorised. Everything after that
 * — token, range arithmetic, headers, error wording — must be identical, or a
 * client reviewer would hit bugs the team never sees.
 *
 * Nothing here caches bytes. A review video is watched a handful of times by a
 * handful of people and can be gigabytes; caching it would trade a lot of disk
 * for a little latency. File METADATA is cached, in the revision row, because
 * size and mime are needed on every single seek and never change.
 */

/** The revision fields this module needs, however the caller fetched them. */
export interface DriveRevisionSource {
  revisionId: string;
  driveFileId: string;
  driveConnectionId: string | null;
  mime: string | null;
  sizeBytes: number | null;
}

/**
 * The revision columns a stream needs, as PostgREST hands them back.
 *
 * Two migrations briefly gave these facts two spellings each; 20261137000000
 * retired the duplicates, so this is the only set — `drive_mime`,
 * `drive_size_bytes`, and the ids. They stay optional here because callers
 * select different column subsets.
 */
export interface DriveRevisionRow {
  id: string;
  drive_file_id: string | null;
  drive_connection_id: string | null;
  drive_mime?: string | null;
  drive_size_bytes?: number | string | null;
}

export function driveSourceFromRow(row: DriveRevisionRow | null | undefined): DriveRevisionSource | null {
  if (!row?.drive_file_id) return null;
  const size = row.drive_size_bytes;
  return {
    revisionId: row.id,
    driveFileId: row.drive_file_id,
    driveConnectionId: row.drive_connection_id ?? null,
    mime: row.drive_mime ?? null,
    // bigint arrives from PostgREST as a string, and `Number("")` is 0, so the
    // empty case has to be filtered before conversion.
    sizeBytes: size === null || size === undefined || size === "" ? null : Number(size),
  };
}

/** A DriveError rendered as the response a browser or fetch() should see. */
export function driveErrorResponse(err: unknown): NextResponse {
  if (err instanceof DriveError) {
    // 409 for both "pick it again" and "reconnect": the caller is not wrong and
    // retrying will not help — a person has to act — which is exactly what 409
    // says and what the UI keys off to show its reconnect prompt.
    const status =
      err.kind === "access_lost" || err.kind === "auth"
        ? 409
        : err.kind === "rate_limited"
          ? 429
          : err.kind === "bad_request"
            ? 400
            : 502;
    return NextResponse.json(
      {
        error: err.message,
        // Distinct flags: one means re-pick THIS file, the other means the whole
        // Google connection is dead and an admin must reconnect it.
        pickAgain: err.kind === "access_lost",
        reconnect: err.kind === "auth",
      },
      { status },
    );
  }
  return NextResponse.json({ error: "Could not play this Drive video." }, { status: 502 });
}

/**
 * Fills in size and mime the first time they are needed, and remembers them.
 *
 * Range arithmetic cannot be done without the total length: a 416 for "past the
 * end" is only answerable against a known size, and a `<video>` asks for the
 * tail of the file within milliseconds of loading. One metadata call per
 * revision is the price; after that it is a column read.
 */
async function ensureMeta(
  admin: SupabaseClient<Database>,
  source: DriveRevisionSource,
  credential: Parameters<typeof fileMeta>[0],
): Promise<DriveRevisionSource> {
  if (source.sizeBytes && source.mime) return source;

  const meta = await fileMeta(credential, source.driveFileId);
  const filled: DriveRevisionSource = {
    ...source,
    mime: source.mime ?? meta.mimeType,
    sizeBytes: source.sizeBytes ?? meta.sizeBytes,
  };

  // Best effort: a failed cache write must not fail playback. Both column
  // spellings are written so either branch's reader sees the same file.
  const patch: Record<string, unknown> = {
    drive_mime: filled.mime,
    drive_size_bytes: filled.sizeBytes,
  };
  if (meta.durationSeconds !== null) {
    patch.duration_seconds = meta.durationSeconds;
  }
  if (meta.thumbnailUrl) patch.drive_thumbnail_url = meta.thumbnailUrl;
  await (admin as unknown as SupabaseClient)
    .from("app_video_review_revisions")
    .update(patch)
    .eq("id", source.revisionId);

  return filled;
}

/**
 * The stream itself: Range in, 206 out, bytes piped straight from Drive.
 *
 * The browser's Range is re-issued rather than forwarded verbatim, because the
 * open-ended form a `<video>` sends ("bytes=0-") and the suffix form ("bytes=-64")
 * both have to be resolved against the total before we can promise a
 * Content-Range — and a Content-Range that disagrees with the body is how a
 * player ends up unable to seek.
 */
export async function streamDriveRevision(
  admin: SupabaseClient<Database>,
  row: DriveRevisionSource,
  rangeHeader: string | null,
): Promise<Response> {
  if (!row.driveConnectionId) {
    return NextResponse.json(
      {
        error:
          "This video came from Google Drive, but the workspace's Google connection is gone. " +
          "Reconnect Google, or pick the file again.",
        reconnect: true,
      },
      { status: 409 },
    );
  }

  const credential = driveAuthForConnection(admin, row.driveConnectionId);

  let source: DriveRevisionSource;
  try {
    source = await ensureMeta(admin, row, credential);
  } catch (err) {
    return driveErrorResponse(err);
  }

  const total = source.sizeBytes ?? 0;
  const wanted = parseByteRange(rangeHeader, total);

  if (wanted.kind === "unsatisfiable") {
    // 416 must carry the real size, or the player cannot correct its guess.
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Content-Range": unsatisfiedContentRange(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      },
    });
  }

  const forwarded =
    wanted.kind === "range" ? rangeHeaderFor(wanted.start, wanted.end) : null;

  let upstream: Response;
  try {
    upstream = await streamRange(credential, source.driveFileId, forwarded);
  } catch (err) {
    return driveErrorResponse(err);
  }

  const headers = new Headers({
    "Content-Type": source.mime || upstream.headers.get("content-type") || "video/mp4",
    // Without this the browser will not even try to seek — it decides a source
    // is seekable from this header, before it issues a single Range request.
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    // The bytes are the team's, not something a proxy should ever hold.
    "Content-Disposition": "inline",
  });

  if (wanted.kind === "range") {
    headers.set("Content-Range", contentRange(wanted.start, wanted.end, total));
    headers.set("Content-Length", String(rangeLength(wanted.start, wanted.end)));
  } else {
    const len = upstream.headers.get("content-length") ?? (total ? String(total) : null);
    if (len) headers.set("Content-Length", len);
  }

  // Drive answering 200 to a Range request means it sent the whole file; saying
  // 206 then would be a lie the player would seek against and fail on.
  const status = wanted.kind === "range" && upstream.status === 206 ? 206 : 200;
  if (status === 200 && wanted.kind === "range") {
    headers.delete("Content-Range");
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    else headers.delete("Content-Length");
  }

  return new Response(upstream.body, { status, headers });
}
