import { NextResponse, type NextRequest } from "next/server";
import { syncSheetLink } from "@/lib/sheets/google-sync";
import { authorizeSheet } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

/**
 * POST /api/sheets/[id]/google/sync → SyncCounts & { status, error? }
 *
 * "Sync now". 200 when it ran, 409 when another run holds the sheet right now,
 * 502 when it failed (the message is also on the link and in the run log).
 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const { sheet, admin, userId, isLimited } = auth.access;
  if (isLimited) {
    return NextResponse.json({ error: "Limited members can't sync sheets with Google Sheets." }, { status: 403 });
  }
  const out = await syncSheetLink(admin, { teamId: sheet.team_id, sheetId: sheet.id, trigger: "manual", actorUserId: userId });
  const status = out.status === "ok" ? 200 : out.status === "busy" ? 409 : 502;
  return NextResponse.json(out, { status });
}
