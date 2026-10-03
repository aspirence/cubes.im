import { NextResponse, type NextRequest } from "next/server";
import { authorizeSheet, errorResponse } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

/** GET /api/sheets/[id]/google/runs → { runs } — the last 20 sync runs, newest first. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const { admin, sheet } = auth.access;
  const { data: link } = await admin
    .from("app_sheet_google_links")
    .select("id")
    .eq("sheet_id", sheet.id)
    .eq("team_id", sheet.team_id)
    .maybeSingle();
  if (!link) return NextResponse.json({ runs: [] });
  const { data, error } = await admin
    .from("app_sheet_sync_runs")
    .select("id, trigger, status, started_at, finished_at, counts, error")
    .eq("link_id", (link as { id: string }).id)
    .eq("team_id", sheet.team_id)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) return errorResponse(new Error(error.message));
  return NextResponse.json({ runs: data ?? [] });
}
