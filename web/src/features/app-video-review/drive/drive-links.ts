/**
 * Pure helpers for the Google Drive source picker.
 *
 * Kept free of React and of `window` so they can be unit-tested directly and
 * reused by a server route: the link parser in particular runs on both sides —
 * the modal uses it to decide whether a pasted link is worth resolving through
 * Google at all, and the backend uses the same rules so the two never disagree
 * about what "a Drive folder link" means.
 */

export type DriveLink =
  /** A single file — a video we can stream, once Google grants access to it. */
  | { kind: "file"; id: string }
  /** A folder — many files, so the user still has to choose one. */
  | { kind: "folder"; id: string };

/**
 * A Drive id is base64url-ish and long. Matching loosely (rather than on an
 * exact length) keeps us working if Google changes the format again, while
 * still rejecting the short path segments that are really route names.
 */
const ID_RE = /^[A-Za-z0-9_-]{10,}$/;

/**
 * Recognises the Drive link shapes people actually paste, and says whether the
 * link names one file or a whole folder.
 *
 * Returns null for anything that is not a Drive link — including a Drive page
 * with no id in it, such as drive.google.com/drive/my-drive — so the caller can
 * fall through to its ordinary "any URL" handling instead of showing Google
 * guidance for a YouTube link.
 */
export function parseDriveLink(raw: string | null | undefined): DriveLink | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    // Not a URL at all. A bare id is ambiguous between a file and a folder, and
    // guessing wrong sends the user into the wrong browser, so we decline.
    return null;
  }

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (
    host !== "drive.google.com" &&
    host !== "docs.google.com" &&
    host !== "drive.usercontent.google.com"
  ) {
    return null;
  }

  const parts = u.pathname.split("/").filter(Boolean);

  // drive.google.com/drive/folders/<id>, optionally under /drive/u/0/folders/…
  const foldersAt = parts.indexOf("folders");
  if (foldersAt >= 0 && ID_RE.test(parts[foldersAt + 1] ?? "")) {
    return { kind: "folder", id: parts[foldersAt + 1] };
  }

  // drive.google.com/file/d/<id>/view, docs.google.com/document/d/<id>/edit,
  // and the /d/<id> shorthand — all of them put the id after a "d" segment.
  const dAt = parts.indexOf("d");
  if (dAt >= 0 && ID_RE.test(parts[dAt + 1] ?? "")) {
    return { kind: "file", id: parts[dAt + 1] };
  }

  // open?id=, uc?id=, download?id= — the id travels in the query string.
  const queryId = u.searchParams.get("id");
  if (queryId && ID_RE.test(queryId)) {
    // /drive/folders never uses ?id=, but the old ?id= folder links used
    // open?id= with no way to tell them apart, so a query id is a file: the
    // backend corrects us cheaply if Drive says it is a folder.
    return { kind: "file", id: queryId };
  }

  return null;
}

/** True when a Drive mime type is something our <video> element can play. */
export function isDriveVideoMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return mime.startsWith("video/") || mime === "application/vnd.google-apps.video";
}

/** True for the one Drive mime type that means "folder". */
export function isDriveFolderMime(mime: string | null | undefined): boolean {
  return mime === "application/vnd.google-apps.folder";
}

/**
 * Human file size. Drive reports bytes as a string, and reports nothing at all
 * for Google-native files, so a missing size is normal and must not read as an
 * error — it prints as an em dash.
 */
export function formatBytes(bytes: number | string | null | undefined): string {
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  // One decimal below 10 (4.7 GB reads better than 5 GB), none above.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Clock duration from milliseconds: m:ss, or h:mm:ss past an hour. Drive gives
 * durationMillis only once it has finished processing a video, so null is a
 * normal answer for a freshly uploaded file rather than a failure.
 */
export function formatDuration(ms: number | string | null | undefined): string {
  const n = typeof ms === "string" ? Number(ms) : ms;
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  const total = Math.floor(n / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/**
 * The canonical share link for a Drive id, which we keep in the revision's
 * `url` column. It is the fallback source for any surface that has not learned
 * about Drive streaming yet, and the "Open in Drive" target everywhere else.
 */
export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/** Same, for a folder — used by the browser's "Open in Drive" escape hatch. */
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * Filters a folder listing by what the user typed. Client-side on the page of
 * videos we already hold, because a folder is usually small enough that a round
 * trip per keystroke would feel worse than instant local filtering — and every
 * such trip spends the workspace's Drive quota.
 */
export function filterByName<T extends { name: string }>(items: T[], search: string): T[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.name.toLowerCase().includes(needle));
}
