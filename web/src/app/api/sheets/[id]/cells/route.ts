import { NextResponse, type NextRequest } from "next/server";
import { writeCell } from "@/lib/sheets/data";
import { archivedResponse, authorizeSheet, ctxFor, errorResponse, readJson } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

/**
 * PATCH /api/sheets/[id]/cells  { key, columnId, value, tz? } → { row }
 *
 * One cell edit from the grid. The value is validated for the column's type
 * and options, refused on read-only cells, written through the source's
 * adapter (or into the sheet's own row data), and the row comes back as it
 * now reads — derived fields included.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  if (auth.access.sheet.archived) return archivedResponse();

  const body = await readJson(request);
  const key = typeof body?.key === "string" ? body.key : "";
  const columnId = typeof body?.columnId === "string" ? body.columnId : "";
  if (!key || !columnId || !body || !("value" in body)) {
    return NextResponse.json({ error: "Send { key, columnId, value }." }, { status: 400 });
  }
  const tz = typeof body.tz === "string" ? body.tz : request.nextUrl.searchParams.get("tz");
  try {
    const row = await writeCell(ctxFor(auth.access, tz), key, columnId, body.value);
    return NextResponse.json({ row });
  } catch (err) {
    return errorResponse(err);
  }
}
