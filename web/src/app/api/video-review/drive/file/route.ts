import { NextResponse, type NextRequest } from "next/server";
import { serviceClient } from "@/lib/apps/server";
import { driveAuthForConnection, fileMeta } from "@/lib/google/drive";
import { driveErrorResponse } from "@/lib/video-review/drive-stream";
import { authorizeConnection } from "@/lib/video-review/server";

export const runtime = "nodejs";

/**
 * Metadata for a single Drive file.
 *
 * Used when someone pastes a file link rather than browsing: before a revision
 * is created we need to know that the id resolves, that it is a video, that this
 * connection may download it, and how long it is — so the modal can show the
 * real name and duration instead of asking the person to trust a raw id.
 *
 * `canDownload: false` is worth surfacing early. Drive lets an owner share a
 * file for viewing while blocking downloads, and such a file streams as an
 * instant, silent failure if it is only discovered at playback.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const connectionId = params.get("connectionId") ?? "";
  const fileId = params.get("fileId") ?? "";
  if (!connectionId || !fileId) {
    return NextResponse.json({ error: "connectionId and fileId are required." }, { status: 400 });
  }

  const auth = await authorizeConnection(connectionId);
  if (!auth.ok) return auth.response;

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  }

  try {
    const file = await fileMeta(driveAuthForConnection(admin, connectionId), fileId);
    return NextResponse.json(
      { file, isVideo: file.mimeType.startsWith("video/") },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return driveErrorResponse(err);
  }
}
