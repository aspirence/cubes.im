import { NextResponse, type NextRequest } from "next/server";
import { SOURCES } from "@/lib/sheets/sources";
import { addRow, deleteRecord } from "@/lib/sheets/data";
import { archivedResponse, authorizeSheet, ctxFor, errorResponse, readJson } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

const MAX_DELETE = 500;

/**
 * POST /api/sheets/[id]/rows  { values?: Record<columnId, unknown>, position?, tz? } → { row }
 *
 * Adds a row: a new custom row, or a new source record (a task, a Content
 * Studio item) when the source can create them.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const { sheet, supabase } = auth.access;
  if (sheet.archived) return archivedResponse();
  if (!SOURCES[sheet.source].canCreate) {
    return NextResponse.json({ error: `Rows can't be added to a “${SOURCES[sheet.source].label}” sheet.` }, { status: 400 });
  }
  // Creating a task from a sheet is creating a task: the same permission as
  // the task list (workspace capability + the project's limited-creation rule).
  if (sheet.source === "tasks" && sheet.project_id) {
    const { data: allowed } = await supabase.rpc("can_create_tasks", { _project_id: sheet.project_id });
    if (!allowed) return NextResponse.json({ error: "You can't create tasks in this project." }, { status: 403 });
  }

  const body = (await readJson(request)) ?? {};
  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values)
    ? (body.values as Record<string, unknown>)
    : {};
  const position = typeof body.position === "number" && Number.isFinite(body.position) ? body.position : undefined;
  const tz = typeof body.tz === "string" ? body.tz : request.nextUrl.searchParams.get("tz");
  try {
    const row = await addRow(ctxFor(auth.access, tz), values, position);
    return NextResponse.json({ row }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/sheets/[id]/rows  { keys: string[] } → { deleted }
 */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const { sheet } = auth.access;
  if (sheet.archived) return archivedResponse();
  if (!SOURCES[sheet.source].canDelete) {
    return NextResponse.json({ error: `Rows can't be deleted from a “${SOURCES[sheet.source].label}” sheet.` }, { status: 400 });
  }
  const body = await readJson(request);
  const keys = Array.isArray(body?.keys) ? (body.keys as unknown[]).filter((k): k is string => typeof k === "string" && k !== "") : [];
  if (keys.length === 0) return NextResponse.json({ error: "Send { keys: [...] }." }, { status: 400 });
  if (keys.length > MAX_DELETE) {
    return NextResponse.json({ error: `Delete at most ${MAX_DELETE} rows at a time.` }, { status: 400 });
  }
  const c = ctxFor(auth.access);
  try {
    let deleted = 0;
    for (const key of new Set(keys)) {
      await deleteRecord(c, key);
      deleted++;
    }
    return NextResponse.json({ deleted });
  } catch (err) {
    return errorResponse(err);
  }
}
