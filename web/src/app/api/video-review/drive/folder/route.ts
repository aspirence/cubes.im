import { NextResponse, type NextRequest } from "next/server";
import { serviceClient } from "@/lib/apps/server";
import { driveAuthForConnection, fileMeta, listFolder } from "@/lib/google/drive";
import { driveErrorResponse } from "@/lib/video-review/drive-stream";
import { authorizeConnection } from "@/lib/video-review/server";

export const runtime = "nodejs";

/**
 * Lists one Drive folder, so a pasted folder link becomes something to browse
 * instead of the dead end it is today.
 *
 * A folder link resolves to `unsupported` in media-source.ts and the person is
 * told to go back to Drive, find the file, and copy a second link. That is the
 * most common way a client sends work. With this route the app can show what is
 * in the folder and let them pick the cut directly.
 *
 * ORDER: folders first (they are navigation, not content), then videos, then
 * everything else — Drive's own `orderBy=folder,name` gets the first split, and
 * the video/other split is applied here because Drive cannot sort by mime.
 *
 * The response carries names, thumbnails and durations. It never carries the
 * access token, and the thumbnail links Drive returns are short-lived and
 * already scoped to the file.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const connectionId = params.get("connectionId") ?? "";
  const folderId = params.get("folderId") ?? "";
  if (!connectionId || !folderId) {
    return NextResponse.json(
      { error: "connectionId and folderId are required." },
      { status: 400 },
    );
  }

  const auth = await authorizeConnection(connectionId);
  if (!auth.ok) return auth.response;

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  }

  const credential = driveAuthForConnection(admin, connectionId);

  try {
    const page = await listFolder(credential, folderId, {
      pageToken: params.get("pageToken"),
      // Default to videos + sub-folders: this picker exists to choose a video,
      // and a folder of 400 PNGs with three cuts in it is not a useful list.
      videoOnly: params.get("all") !== "1",
      pageSize: Number(params.get("pageSize") ?? 100),
    });

    const rank = (isFolder: boolean, mime: string) =>
      isFolder ? 0 : mime.startsWith("video/") ? 1 : 2;
    const files = [...page.files].sort(
      (a, b) => rank(a.isFolder, a.mimeType) - rank(b.isFolder, b.mimeType),
    );

    // The folder's own name, for a breadcrumb. Only on the first page: it cannot
    // change between pages, and asking again would double every request.
    let folderName: string | null = null;
    if (!params.get("pageToken")) {
      try {
        folderName = (await fileMeta(credential, folderId)).name;
      } catch {
        // A listable folder whose metadata read fails is still listable; a
        // missing breadcrumb is not worth failing the whole response over.
        folderName = null;
      }
    }

    return NextResponse.json(
      { folderId, folderName, files, nextPageToken: page.nextPageToken },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return driveErrorResponse(err);
  }
}
