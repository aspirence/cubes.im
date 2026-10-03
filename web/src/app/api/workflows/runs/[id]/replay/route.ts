import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { adminClient, authorizeTeamRequest } from "@/lib/apps/auth";
import { continueRun } from "@/lib/workflows/runner";

/**
 * Replay: start the same workflow again with exactly the payload the failed
 * run received. This is why workflow_runs.trigger_payload exists as its own
 * column — trigger_snapshot carries the engine's metadata, but a replay has
 * to resend the body that arrived, byte for byte, or it is a different run
 * with the same name.
 *
 * The new run records `replay_of`, so the history can show the chain instead
 * of two unrelated rows.
 *
 * Authority: the caller's own session must be able to read the run (RLS on
 * workflow_runs = member of the run's team), else 404; and replaying is an
 * admin action, because it re-executes everything the original did.
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
    .select("id, team_id, workflow_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const original = run as { id: string; team_id: string; workflow_id: string; status: string };

  const auth = await authorizeTeamRequest(
    original.team_id,
    "admin",
    "Only workspace admins can replay a run.",
  );
  if (!auth.ok) return auth.response;

  if (original.status === "running" || original.status.startsWith("waiting")) {
    return NextResponse.json(
      { error: "This run has not finished yet — wait for it before replaying." },
      { status: 409 },
    );
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  // trigger_payload is not in the generated types and is not readable through
  // the caller's client anyway, so it is fetched with the service role, scoped
  // by the team the caller was just authorized for.
  const { data: full, error: fullErr } = await admin
    .from("workflow_runs")
    .select("trigger_payload, trigger_snapshot")
    .eq("id", id)
    .eq("team_id", original.team_id)
    .maybeSingle();
  if (fullErr) {
    return NextResponse.json({ error: fullErr.message }, { status: 500 });
  }
  const source = (full ?? {}) as {
    trigger_payload: Record<string, unknown> | null;
    trigger_snapshot: Record<string, unknown> | null;
  };

  const { data: newRunId, error: startErr } = await admin.rpc("wf_start_run", {
    p_workflow_id: original.workflow_id,
    p_trigger: {
      ...(source.trigger_snapshot ?? {}),
      replayed_from: id,
      replayed_at: new Date().toISOString(),
      replayed_by: user.id,
    },
    p_payload: source.trigger_payload,
    p_replay_of: id,
  });
  if (startErr || !newRunId) {
    return NextResponse.json(
      { error: startErr?.message ?? "The run could not be replayed." },
      { status: 500 },
    );
  }

  const result = await continueRun(admin, newRunId as string, user.id);
  return NextResponse.json({ runId: newRunId, replayOf: id, ...result });
}
