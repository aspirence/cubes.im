import { NextResponse, type NextRequest } from "next/server";
import { serviceClient } from "@/lib/apps/server";
import { authorizeRevision } from "@/lib/video-review/server";
import { driveSourceFromRow, streamDriveRevision } from "@/lib/video-review/drive-stream";

export const runtime = "nodejs";

/**
 * Streams a Drive-backed revision to the signed-in reviewer page.
 *
 * This route is the whole point of the Drive change. A Drive video used to play
 * in Drive's cross-origin `/preview` iframe, where `currentTime` is unreadable —
 * so no timestamped comment and no drawing could be anchored to a frame. Serving
 * the same bytes from our own origin puts the video back in a `<video>` element
 * the page owns, and the timeline comes back with it.
 *
 * Authorisation is the caller's cookie session through RLS (authorizeRevision):
 * a revision in another workspace, or in a private project the caller cannot
 * see, is a 404 — never a 403, which would confirm it exists.
 *
 * The Google token is used here and never leaves; the browser only ever sees
 * bytes. `?rev=` (or `?revision=`) picks a revision, defaulting to the latest.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await ctx.params;

  // Both spellings are accepted: the player asks with `revision`, the revision
  // list with `rev`, and a stream URL is the kind of thing that ends up
  // hand-written in a bug report. Neither means "the latest" — that is what
  // leaving it off means.
  const params = request.nextUrl.searchParams;
  const auth = await authorizeRevision(videoId, params.get("rev") ?? params.get("revision"));
  if (!auth.ok) return auth.response;

  const source = driveSourceFromRow(auth.value.row as never);
  if (!source) {
    // Uploads already have a signed-URL path and links play directly; sending
    // them here would be a bug in the caller, not a missing file.
    return NextResponse.json(
      { error: "This revision does not come from Google Drive." },
      { status: 404 },
    );
  }

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  }

  // The connection is checked against the VIDEO's team even though a database
  // trigger enforces the same rule on write. Service-role reads bypass RLS, so
  // this is the last place a mismatched row — written before that trigger
  // existed — could otherwise spend another workspace's Google token.
  if (source.driveConnectionId) {
    const { data: connection } = await admin
      .from("app_google_connections")
      .select("id, team_id")
      .eq("id", source.driveConnectionId)
      .maybeSingle();
    if (!connection || connection.team_id !== auth.value.teamId) {
      return NextResponse.json(
        {
          error:
            "This video's Google connection no longer belongs to this workspace. Pick the file again.",
          pickAgain: true,
        },
        { status: 409 },
      );
    }
  }

  return streamDriveRevision(admin, source, request.headers.get("range"));
}
