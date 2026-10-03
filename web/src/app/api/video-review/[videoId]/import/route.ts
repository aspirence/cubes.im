import { NextResponse, type NextRequest } from "next/server";
import { serviceClient } from "@/lib/apps/server";
import { authorizeRevision } from "@/lib/video-review/server";
import { importDriveRevision } from "@/lib/video-review/drive-import";

export const runtime = "nodejs";

/**
 * Starts (or reports on) the copy of a Drive revision into Cubes storage.
 *
 * Streaming from Drive already works without this; importing is for reviews that
 * must outlive the editor's Drive folder — a file that gets moved, un-shared or
 * replaced takes a whole comment thread's meaning with it.
 *
 * Returns 202 and lets the copy run on, rather than holding the request open for
 * a multi-gigabyte transfer: no browser, proxy or platform would keep that
 * socket alive, and a client that gave up mid-way would leave the row stuck in
 * 'running' with no one watching. The caller polls the revision's import_status
 * instead. `?wait=1` blocks until the copy finishes — for tests and small files,
 * never for the UI.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await ctx.params;
  const params = request.nextUrl.searchParams;

  // `revision` is accepted alongside `rev` for the same reason the stream route
  // accepts both: the two callers in the app spell it differently.
  const auth = await authorizeRevision(videoId, params.get("rev") ?? params.get("revision"));
  if (!auth.ok) return auth.response;

  const row = auth.value.row as { id: string; drive_file_id?: string | null };
  if (!row.drive_file_id) {
    return NextResponse.json(
      { error: "This revision does not come from Google Drive." },
      { status: 404 },
    );
  }

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  }

  if (params.get("wait") === "1") {
    const outcome = await importDriveRevision(admin, row.id);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 409 });
  }

  // Deliberately not awaited: the response goes out now and the copy continues.
  // The catch is what keeps a failed copy from becoming an unhandled rejection
  // that takes the process with it — importDriveRevision already records the
  // failure on the row.
  void importDriveRevision(admin, row.id).catch(() => {});

  return NextResponse.json({ status: "queued", revision: auth.value.revision }, { status: 202 });
}
