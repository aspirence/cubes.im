import { NextResponse, type NextRequest } from "next/server";
import { buildSheetData } from "@/lib/sheets/data";
import { authorizeSheet, ctxFor, errorResponse } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

/**
 * GET /api/sheets/[id]/data?tz=Asia/Kolkata → SheetData (+ `notices`).
 *
 * The grid's read: every row with its values keyed by column id (source
 * fields and the sheet's own columns merged), the dynamic options resolved in
 * the sheet's scope, and which cells this caller may not edit. `tz` is the
 * browser's zone, so "a day" (task start / due) is the viewer's day.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  try {
    const data = await buildSheetData(ctxFor(auth.access, request.nextUrl.searchParams.get("tz")));
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
