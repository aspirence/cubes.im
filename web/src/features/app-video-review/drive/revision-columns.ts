/**
 * How a chosen source becomes columns on app_video_review_revisions.
 *
 * Deliberately outside the hooks file and free of React: this is the one place
 * that decides what a Drive revision looks like in the database, the server
 * needs the same answer when it writes one, and a unit test can call it
 * directly instead of standing up a query client to find out.
 */

/**
 * A revision that lives in Google Drive.
 *
 * WHY THE CONNECTION TRAVELS WITH THE FILE: the integration holds the
 * `drive.file` scope, which grants access per file to the consent that picked
 * it. Reading the same file id with another connection's token comes back 404,
 * so "which Google account" is part of the source, not a setting.
 */
export interface DriveRevisionSource {
  connectionId: string;
  fileId: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  durationMs?: number | null;
  thumbnailUrl?: string | null;
}

/** The share link kept in a Drive revision's `url` — see revisionSourceColumns. */
export function driveShareUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * The source columns for a revision insert.
 *
 * `source_kind` is stated rather than inferred because a Drive revision is the
 * one shape you cannot read off the other columns: it keeps a `url` (the share
 * link, for "open in Drive") while its bytes come from the stream route, so
 * "has a url and no storage_path" no longer means "an external link".
 *
 * One spelling only: 20261137000000 retired the duplicate columns two parallel
 * migrations had created for the mime, the duration and the import state.
 */
export function revisionSourceColumns(input: {
  storagePath: string | null;
  url?: string | null;
  drive?: DriveRevisionSource | null;
}): Record<string, unknown> {
  const { drive, storagePath } = input;
  if (storagePath) {
    return { source_kind: "upload", storage_path: storagePath, url: null };
  }
  if (!drive) {
    return { source_kind: "link", storage_path: null, url: input.url ?? null };
  }
  return {
    source_kind: "drive",
    storage_path: null,
    // The ordinary share link is kept so any surface that has not learned about
    // streaming still plays the video, and so "Open in Drive" has a target.
    url: driveShareUrl(drive.fileId),
    drive_file_id: drive.fileId,
    drive_connection_id: drive.connectionId,
    drive_name: drive.name,
    drive_mime: drive.mimeType ?? null,
    drive_size_bytes: drive.sizeBytes ?? null,
    duration_seconds: drive.durationMs != null ? drive.durationMs / 1000 : null,
    drive_thumbnail_url: drive.thumbnailUrl ?? null,
  };
}
