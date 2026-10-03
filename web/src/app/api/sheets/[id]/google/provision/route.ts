import { NextResponse, type NextRequest } from "next/server";
import { ensureSheetWatch } from "@/lib/google/sheet-watch";
import { provisionSheetGoogle } from "@/lib/sheets/google-provision";
import { archivedResponse, authorizeSheet, errorResponse, readJson } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

/**
 * POST — give this sheet a Google Sheet.
 *
 *   { connectionId?, timeZone? } → { status, link, shareError?, reason?, watch? }
 *
 * Called in three places, all the same operation:
 *   - straight after a sheet is created (the client does it, so the new sheet
 *     opens onto a real spreadsheet rather than a "set this up" screen);
 *   - by the "Create the Google Sheet" button on a sheet that has none — which
 *     is how every sheet that predates this feature gets one, one at a time,
 *     when someone actually opens it;
 *   - by "Try again" after a failure.
 *
 * It is idempotent by design: a sheet that already has a ready link gets that
 * link back untouched, so a double click, a retry after a timeout and a stale
 * tab all cost nothing. That is also why it takes no spreadsheet id — picking
 * an existing file from Drive is a different decision with a different consent
 * step, and it stays on POST /api/sheets/[id]/google with mode "existing".
 *
 * A limited member cannot provision: the Google file carries the whole sheet,
 * and they are shown only their own rows here.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const { access } = auth;
  if (access.sheet.archived) return archivedResponse();
  if (access.isLimited) {
    return NextResponse.json({ error: "Limited members can't set up Google Sheets for a sheet." }, { status: 403 });
  }

  const body = (await readJson(request)) ?? {};
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : null;
  const timeZone = typeof body.timeZone === "string" ? body.timeZone : null;

  try {
    const out = await provisionSheetGoogle(access.admin, {
      sheet: access.sheet,
      userId: access.userId,
      connectionId,
      timeZone,
    });
    if (out.status === "ready") {
      // Every sheet now gets its Google Sheet through this route, so this is
      // where most watches are born. ensureSheetWatch is idempotent — an
      // already-ready link answers "already" without a Drive call — which is
      // what makes it safe on the retry and double-click paths this route is
      // built for. It cannot fail the provision: the sheet works either way,
      // it just falls back to the timer, and `watch` says so.
      const watch = await ensureSheetWatch(access.admin, out.link.id);
      return NextResponse.json({ status: "ready", link: out.link, shareError: out.shareError, watch });
    }
    // "pending" is not an error — the sheet exists and is usable, it just has
    // no Google account behind it yet — so it answers 200 with the reason and
    // lets the UI offer the connect button. "failed" is a 502: Google was asked
    // and said no.
    return NextResponse.json(
      { status: out.status, link: out.link, reason: out.reason },
      { status: out.status === "pending" ? 200 : 502 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
