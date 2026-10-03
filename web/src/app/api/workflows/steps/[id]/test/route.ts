import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { adminClient, authorizeTeamRequest } from "@/lib/apps/auth";
import { testWorkflowStep } from "@/lib/workflows/step-test";

/**
 * "Test this step": runs one step on its own against the trigger sample plus
 * the earlier steps' samples, stores the result as that step's sample_output
 * and hands the exact payload back so the builder can draw a field tree from
 * it.
 *
 * Authority: the caller's own session must be able to read the step (RLS on
 * workflow_steps = member of the workflow's team); anything else is a 404, so
 * a step id from another workspace is indistinguishable from a missing one.
 * On top of that the caller must be a workspace ADMIN, because a test really
 * runs the step — it syncs, it posts, it spends someone's API quota — and
 * editing workflows is already admin-only. Only then is the service-role
 * runner used.
 *
 * Body (all optional): { "sample": { ... } } to test against a payload the
 * person just pasted instead of the stored trigger sample.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read through the caller's own RLS first: this is what decides whether the
  // step exists as far as they are concerned.
  const { data: step, error: stepErr } = await supabase
    .from("workflow_steps")
    .select("id, workflow_id")
    .eq("id", id)
    .maybeSingle();
  if (stepErr) {
    return NextResponse.json({ error: stepErr.message }, { status: 500 });
  }
  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const { data: workflow, error: wfErr } = await supabase
    .from("workflows")
    .select("id, team_id")
    .eq("id", (step as { workflow_id: string }).workflow_id)
    .maybeSingle();
  if (wfErr) {
    return NextResponse.json({ error: wfErr.message }, { status: 500 });
  }
  if (!workflow) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }
  const teamId = (workflow as { team_id: string }).team_id;

  const auth = await authorizeTeamRequest(
    teamId,
    "admin",
    "Only workspace admins can test a workflow step.",
  );
  if (!auth.ok) return auth.response;

  let sample: unknown;
  try {
    const body = (await request.json()) as { sample?: unknown } | null;
    sample = body?.sample;
  } catch {
    sample = undefined;
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  try {
    const outcome = await testWorkflowStep(admin, id, {
      teamId,
      actorUserId: user.id,
      ...(sample === undefined ? {} : { sample }),
    });
    if ("notFound" in outcome) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The step could not be tested." },
      { status: 500 },
    );
  }
}
