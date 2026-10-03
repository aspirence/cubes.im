import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { adminClient } from "@/lib/apps/auth";
import { continueRun } from "@/lib/workflows/runner";

/**
 * "Run now", part two. The builder starts a run with start_workflow_run (which
 * runs every in-SQL step and parks on the first app step), then calls this so
 * the app steps execute right away instead of on the next five-minute tick.
 *
 * Authority: the caller's own session must be able to read the run (RLS on
 * workflow_runs = member of the run's team); anything else is a 404, so run
 * ids from other teams are indistinguishable from missing ones. Only then is
 * the service-role runner used.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: run, error } = await supabase
    .from("workflow_runs")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const result = await continueRun(admin, id, user.id);
  return NextResponse.json({ runId: id, ...result });
}
