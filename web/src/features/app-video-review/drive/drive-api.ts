/**
 * Browser-side client for the Video Review Drive routes.
 *
 * Every call goes through our own server, never straight to googleapis.com: the
 * access token belongs to the team's stored connection and must not reach the
 * browser except for the Picker, which needs it by design.
 *
 * The routes answer in Drive's own vocabulary (`files`, `durationSeconds`,
 * `isFolder`). This module translates once, here, into the two shapes the UI
 * thinks in — a folder to navigate and a video to attach — so no component has
 * to know that a folder and a video are the same row to Drive.
 */

/** One row as /api/video-review/drive/* reports it. */
interface DriveFileDto {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  isFolder: boolean;
  /** False when the account may view the file but not download its bytes. */
  canDownload: boolean;
  modifiedAt: string | null;
  webViewUrl: string | null;
}

/** A video we could attach to a review. */
export interface DriveVideo {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes. Null for Google-native files, which report no size. */
  sizeBytes: number | null;
  /** Null until Drive has finished processing the upload. */
  durationMs: number | null;
  /** Drive's own thumbnail; short-lived, so it is fetched, never stored. */
  thumbnailUrl: string | null;
  modifiedAt: string | null;
  /**
   * Surfaced because Drive lets an owner share a file for viewing while
   * blocking downloads. Such a file streams as a silent failure if it is only
   * discovered at playback, so the picker refuses it up front instead.
   */
  canDownload: boolean;
}

/** A subfolder, shown as a navigable tile above the videos. */
export interface DriveFolderRef {
  id: string;
  name: string;
}

export interface DriveFolderListing {
  folder: DriveFolderRef;
  folders: DriveFolderRef[];
  videos: DriveVideo[];
  /** Set when Drive paged the listing and there is more to fetch. */
  nextPageToken: string | null;
}

/** What "a Drive link resolved" comes back as — one file, or a folder to browse. */
export type DriveResolved =
  | { kind: "file"; video: DriveVideo }
  | { kind: "folder"; folder: DriveFolderRef };

/**
 * The picked Drive source, carried through the modal and saved with the
 * revision. The connection travels with the file because `drive.file` grants
 * access per connection: the same file id read with another team member's
 * connection comes back 404.
 */
export interface DriveAttachment {
  connectionId: string;
  video: DriveVideo;
}

import { isDriveFolderMime, isDriveVideoMime } from "./drive-links";

function toVideo(file: DriveFileDto): DriveVideo {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    // The routes speak seconds; the player, the comments and every timestamp in
    // this app speak milliseconds. Converting at the boundary keeps the two
    // units from meeting anywhere else.
    durationMs: file.durationSeconds == null ? null : Math.round(file.durationSeconds * 1000),
    thumbnailUrl: file.thumbnailUrl,
    modifiedAt: file.modifiedAt,
    canDownload: file.canDownload !== false,
  };
}

/**
 * A missing route answers with Next's 404 HTML rather than JSON, and a raw
 * "Unexpected token <" would be a mystifying thing to put in front of someone.
 */
const ROUTE_MISSING =
  "The Google Drive browser isn’t available on this server yet. Upload the file, or paste its link, in the meantime.";

/**
 * Distinguishes "the route isn't deployed" from "Drive said no".
 *
 * The difference matters: the first is our problem and the UI can carry on with
 * whatever it already knows, while the second — not a video, downloads blocked,
 * access revoked — is a refusal the user has to see, and papering over it would
 * hand them a review that plays as a black rectangle.
 */
export class DriveRouteUnavailableError extends Error {}

async function driveFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("Couldn’t reach Cubes. Check your connection and try again.");
  }

  const text = await res.text();
  let body: (T & { error?: string; reconnect?: boolean }) | null = null;
  try {
    body = text ? (JSON.parse(text) as T & { error?: string }) : null;
  } catch {
    if (res.status === 404) throw new DriveRouteUnavailableError(ROUTE_MISSING);
    throw new Error(`Google Drive request failed (${res.status}).`);
  }

  if (!res.ok) {
    if (body?.reconnect) {
      throw new Error("Google needs to be reconnected before Drive can be browsed.");
    }
    throw new Error(body?.error || `Google Drive request failed (${res.status}).`);
  }
  return body as T;
}

interface FolderResponse {
  folderId: string;
  folderName: string | null;
  files: DriveFileDto[];
  nextPageToken: string | null;
}

/**
 * Lists one folder, split into the subfolders to navigate and the videos to
 * pick. The route already filters to videos and folders and sorts folders
 * first; the split here is just so the grid can render them differently.
 */
export async function fetchDriveFolder(params: {
  connectionId: string;
  folderId: string;
  /** Fallback name for the breadcrumb when Drive won't report the folder's own. */
  folderName?: string | null;
  pageToken?: string | null;
  signal?: AbortSignal;
}): Promise<DriveFolderListing> {
  const query = new URLSearchParams({
    connectionId: params.connectionId,
    folderId: params.folderId,
  });
  if (params.pageToken) query.set("pageToken", params.pageToken);

  const body = await driveFetch<FolderResponse>(`/api/video-review/drive/folder?${query}`, {
    signal: params.signal,
  });

  const files = body.files ?? [];
  return {
    folder: {
      id: body.folderId ?? params.folderId,
      name: body.folderName || params.folderName || "Folder",
    },
    folders: files.filter((f) => f.isFolder).map((f) => ({ id: f.id, name: f.name })),
    videos: files.filter((f) => !f.isFolder).map(toVideo),
    nextPageToken: body.nextPageToken ?? null,
  };
}

interface FileResponse {
  file: DriveFileDto;
  isVideo: boolean;
}

/**
 * Resolves one Drive id to a file or a folder. Used for a pasted link and for a
 * Picker choice alike, because the Picker's payload carries neither size nor
 * duration — and because an id the user believes is a file can be a folder.
 */
export async function fetchDriveFile(params: {
  connectionId: string;
  fileId: string;
  signal?: AbortSignal;
}): Promise<DriveResolved> {
  const query = new URLSearchParams({
    connectionId: params.connectionId,
    fileId: params.fileId,
  });
  const body = await driveFetch<FileResponse>(`/api/video-review/drive/file?${query}`, {
    signal: params.signal,
  });

  const file = body?.file;
  if (!file?.id) throw new Error("Google Drive didn’t recognise that link.");
  if (file.isFolder || isDriveFolderMime(file.mimeType)) {
    return { kind: "folder", folder: { id: file.id, name: file.name } };
  }

  if (body.isVideo === false && !isDriveVideoMime(file.mimeType)) {
    throw new Error(`“${file.name}” isn’t a video file.`);
  }
  if (file.canDownload === false) {
    // Caught here rather than at playback, where it looks like a broken player:
    // Drive lets an owner share a file for viewing while blocking downloads,
    // and our stream route needs the bytes.
    throw new Error(
      `“${file.name}” is shared without download access, so Cubes can’t play it. Ask the owner to allow downloads, or upload the file instead.`,
    );
  }
  return { kind: "file", video: toVideo(file) };
}
