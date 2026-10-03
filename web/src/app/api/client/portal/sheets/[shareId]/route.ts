import { NextResponse, type NextRequest } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { UUID_RE } from "@/lib/client-portal/http";
import { sheetForShare } from "@/lib/client-portal/rpc";
import { readClientSessionCookie } from "@/lib/client-portal/session";

/**
 * A shared sheet, read-only, a page at a time.
 *
 * Like every other client read this takes the SHARE id and the session cookie
 * and lets client_sheet_for_share do the deciding: the contact must have
 * access to the share's project, the sheet must belong to the share's team,
 * and only the columns the sheet itself declares are projected out of each
 * row — a sheet's stored jsonb can hold keys from a deleted column or a Google
 * sync, and none of those was ever put in front of a client.
 *
 * A sheet whose rows are a live view of internal data (tasks, ad insights)
 * answers `not_viewable`, which the portal says out loud rather than drawing an
 * empty grid.
 */

export const runtime = "nodejs";

/** One screenful plus room to scroll; the RPC clamps anything sillier. */
const DEFAULT_LIMIT = 200;

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await ctx.params;
  if (!UUID_RE.test(shareId)) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const token = await readClientSessionCookie();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const limit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  const offset = Number(params.get("offset") ?? 0);

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  let result;
  try {
    result = await sheetForShare(
      admin,
      token,
      shareId,
      Number.isFinite(limit) ? limit : DEFAULT_LIMIT,
      Number.isFinite(offset) ? offset : 0,
    );
  } catch {
    // The database message can name tables and ids; the client gets a shrug.
    return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 502 });
  }

  if (!result.ok) {
    const status =
      result.reason === "unauthenticated"
        ? 401
        : result.reason === "not_viewable"
          ? 409
          : 404;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
