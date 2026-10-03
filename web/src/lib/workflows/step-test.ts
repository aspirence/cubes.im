import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorText } from "@/lib/apps/auth";
import { interpolate, interpolateDeep } from "./interpolate";
import { runHttpStep, type HttpStepConfig, type HttpStepDeps } from "./http-step";
import type { AppActionResult } from "./app-action-types";

/**
 * "Test this step" — the thing that makes a field picker possible.
 *
 * You cannot map `{{steps.lookup.email}}` until you have seen what `lookup`
 * actually returns, which is why every product in this space forces a test run
 * before it will show you a field tree. So: build the context this step would
 * see (the trigger sample plus every earlier step's stored sample), run THAT
 * step alone, store the result in workflow_steps.sample_output, and hand the
 * exact payload back to the builder.
 *
 * Side effects are real, deliberately: a test that pretends is a test that
 * lies about what the step will do. The one exception is an `action` step —
 * create_task and notify_user need a run to act as, and creating a real task
 * every time someone clicks Test would be a poor trade — so those report what
 * they WOULD do, with the tokens already resolved.
 */

export interface StepTestOutcome {
  ok: boolean;
  stepKey: string;
  stepType: string;
  /** The config with every token resolved — what the step will really send. */
  input: unknown;
  output: Record<string, unknown>;
  /** True when the step ran for real; false when it was only described. */
  executed: boolean;
  error?: string;
  /** The context the step was tested against, for the builder's field tree. */
  context: Record<string, unknown>;
}

interface StepRow {
  id: string;
  workflow_id: string;
  position: number;
  step_key: string;
  step_type: string;
  config: Record<string, unknown> | null;
  parent_step_id: string | null;
  branch_key: string | null;
  sample_output: Record<string, unknown> | null;
}

export interface StepTestDeps {
  http?: HttpStepDeps;
  /** Defaults to the real app-action registry. */
  dispatch?: (
    key: string,
    ctx: {
      admin: SupabaseClient;
      teamId: string;
      runId: string;
      stepKey: string;
      trigger: "schedule" | "manual" | "event";
      actorUserId: string | null;
    },
    params: Record<string, unknown>,
  ) => Promise<AppActionResult>;
}

/**
 * The context a step would see: `trigger` from the workflow's stored sample
 * (or the one the caller just pasted), `steps.<key>` from each earlier step's
 * sample, and `_routes` so a step inside a branch tests as if its router had
 * picked that branch.
 */
export function buildTestContext(
  triggerSample: unknown,
  earlier: StepRow[],
  step: StepRow,
): Record<string, unknown> {
  const steps: Record<string, unknown> = {};
  const routes: Record<string, unknown> = {};
  for (const prior of earlier) {
    if (prior.sample_output && typeof prior.sample_output === "object") {
      steps[prior.step_key] = prior.sample_output;
      const route = (prior.sample_output as Record<string, unknown>).route;
      if (prior.step_type === "router" && typeof route === "string") routes[prior.step_key] = route;
    }
  }
  // A step under a router has only one branch worth testing: its own.
  if (step.parent_step_id && step.branch_key) {
    const parent = earlier.find((s) => s.id === step.parent_step_id);
    if (parent) routes[parent.step_key] = step.branch_key;
  }
  return {
    trigger: triggerSample && typeof triggerSample === "object" ? triggerSample : {},
    steps,
    _routes: routes,
  };
}

const defaultDispatch: NonNullable<StepTestDeps["dispatch"]> = async (key, ctx, params) => {
  const { runAppAction } = await import("./app-actions");
  return runAppAction(key, ctx, params);
};

/**
 * Runs one step in isolation. `sample` overrides the workflow's stored trigger
 * sample for this test only. Never throws: a failure comes back as
 * `{ ok: false, error }` with member-safe text, exactly like a real step run.
 */
export async function testWorkflowStep(
  admin: SupabaseClient,
  stepId: string,
  options: { teamId: string; actorUserId: string | null; sample?: unknown } & StepTestDeps,
): Promise<StepTestOutcome | { notFound: true }> {
  const { data: stepRow, error: stepErr } = await admin
    .from("workflow_steps")
    .select("id, workflow_id, position, step_key, step_type, config, parent_step_id, branch_key, sample_output")
    .eq("id", stepId)
    .maybeSingle();
  if (stepErr) throw new Error(stepErr.message);
  const step = stepRow as StepRow | null;
  if (!step) return { notFound: true };

  const { data: workflowRow, error: wfErr } = await admin
    .from("workflows")
    .select("id, team_id, trigger_sample, trigger_type, trigger_config")
    .eq("id", step.workflow_id)
    .eq("team_id", options.teamId)
    .maybeSingle();
  if (wfErr) throw new Error(wfErr.message);
  const workflow = workflowRow as {
    id: string;
    team_id: string;
    trigger_sample: unknown;
    trigger_type: string;
    trigger_config: Record<string, unknown> | null;
  } | null;
  // Service role bypasses RLS, so the team the caller was authorized for is
  // checked here rather than assumed: a step id from another workspace is
  // indistinguishable from one that does not exist.
  if (!workflow) return { notFound: true };

  const { data: earlierRows, error: earlierErr } = await admin
    .from("workflow_steps")
    .select("id, workflow_id, position, step_key, step_type, config, parent_step_id, branch_key, sample_output")
    .eq("workflow_id", step.workflow_id)
    .lt("position", step.position)
    .order("position", { ascending: true });
  if (earlierErr) throw new Error(earlierErr.message);

  // A schedule has no payload of its own, so its sample is the one fact it
  // carries: when it fired.
  const fallbackSample =
    workflow.trigger_type === "schedule" ? { fired_at: new Date().toISOString() } : {};
  const triggerSample =
    options.sample !== undefined && options.sample !== null
      ? options.sample
      : (workflow.trigger_sample ?? fallbackSample);

  const context = buildTestContext(triggerSample, (earlierRows ?? []) as StepRow[], step);
  const config = (step.config ?? {}) as Record<string, unknown>;
  const resolved = interpolateDeep(config, context);

  const outcome: StepTestOutcome = {
    ok: false,
    stepKey: step.step_key,
    stepType: step.step_type,
    input: resolved,
    output: {},
    executed: false,
    context,
  };

  try {
    switch (step.step_type) {
      case "http": {
        const result = await runHttpStep(
          admin,
          options.teamId,
          resolved as HttpStepConfig,
          options.http ?? {},
        );
        outcome.executed = true;
        outcome.ok = result.ok;
        outcome.output = result.output ?? {};
        if (!result.ok) outcome.error = result.error;
        break;
      }
      case "app": {
        const dispatch = options.dispatch ?? defaultDispatch;
        const action = typeof config.action === "string" ? config.action : "";
        const params =
          (resolved as Record<string, unknown>).params &&
          typeof (resolved as Record<string, unknown>).params === "object"
            ? ((resolved as Record<string, unknown>).params as Record<string, unknown>)
            : {};
        const result = await dispatch(
          action,
          {
            admin,
            teamId: options.teamId,
            // There is no run: the step is being tried on its own. Handlers
            // use runId only for logging, never as a foreign key.
            runId: "00000000-0000-0000-0000-000000000000",
            stepKey: step.step_key,
            trigger: "manual",
            actorUserId: options.actorUserId,
          },
          params,
        );
        outcome.executed = true;
        outcome.ok = result.ok;
        outcome.output = result.output ?? {};
        if (!result.ok) outcome.error = result.error;
        break;
      }
      case "condition": {
        const { data, error } = await admin.rpc("wf_eval_condition", {
          _context: context,
          _cfg: config,
        });
        if (error) throw new Error(error.message);
        const mode = typeof config.mode === "string" ? config.mode : "stop";
        outcome.executed = true;
        outcome.ok = true;
        outcome.output = {
          passed: Boolean(data),
          ...(data ? {} : { skipped: mode === "filter" }),
          mode,
        };
        break;
      }
      case "router": {
        const routes = Array.isArray(config.routes) ? (config.routes as Record<string, unknown>[]) : [];
        let hit: string | null = null;
        for (const route of routes) {
          const key = typeof route.key === "string" ? route.key : "";
          if (!key || key === "fallback") continue;
          const { data, error } = await admin.rpc("wf_match_rules", {
            _context: context,
            _match: typeof route.match === "string" ? route.match : "all",
            _rules: Array.isArray(route.rules) ? route.rules : [],
          });
          if (error) throw new Error(error.message);
          if (data) {
            hit = key;
            break;
          }
        }
        if (!hit && routes.some((r) => r.key === "fallback")) hit = "fallback";
        outcome.executed = true;
        outcome.ok = true;
        outcome.output = { route: hit, matched: hit !== null };
        break;
      }
      case "delay": {
        const { data, error } = await admin.rpc("wf_delay_until", { _context: context, _cfg: config });
        if (error) throw new Error(error.message);
        outcome.executed = true;
        outcome.ok = true;
        outcome.output = {
          resume_at: data,
          waited_seconds: Math.max(
            0,
            Math.round((new Date(String(data)).getTime() - Date.now()) / 1000),
          ),
        };
        break;
      }
      case "format": {
        const { data, error } = await admin.rpc("wf_format_value", {
          _op: typeof config.op === "string" ? config.op : "trim",
          _value: interpolate(typeof config.value === "string" ? config.value : "", context),
          _cfg: config,
        });
        if (error) throw new Error(error.message);
        outcome.executed = true;
        outcome.ok = true;
        outcome.output = { value: data as unknown } as Record<string, unknown>;
        break;
      }
      case "agent": {
        const { data: agentRow, error: agentErr } = await admin
          .from("agents")
          .select("id, skills")
          .eq("id", String(config.agent_id ?? ""))
          .eq("team_id", options.teamId)
          .maybeSingle();
        if (agentErr) throw new Error(agentErr.message);
        if (!agentRow) throw new Error("That agent is not in this workspace.");
        const { data: team } = await admin
          .from("teams")
          .select("organization_id")
          .eq("id", options.teamId)
          .maybeSingle();
        const orgId = (team as { organization_id: string } | null)?.organization_id ?? null;
        const output: Record<string, unknown> = {};
        for (const skill of ((agentRow as { skills: Record<string, unknown>[] }).skills ?? [])) {
          const key = String(skill.skill ?? "");
          if (!key) continue;
          const { data, error } = await admin.rpc("wf_run_skill", {
            p_skill: key,
            p_team_id: options.teamId,
            p_org_id: orgId,
            p_params: skill.params ?? {},
          });
          if (error) throw new Error(error.message);
          output[key] = data;
        }
        outcome.executed = true;
        outcome.ok = true;
        outcome.output = output;
        break;
      }
      case "action": {
        // Described, not performed — see the note at the top of this file.
        outcome.executed = false;
        outcome.ok = true;
        outcome.output = {
          would: resolved,
          note: "Create task and Notify run as part of a real run, so this shows the resolved values instead of doing it.",
        };
        break;
      }
      default:
        outcome.ok = false;
        outcome.error = `A "${step.step_type}" step cannot be tested on its own.`;
    }
  } catch (err) {
    outcome.ok = false;
    outcome.error = safeErrorText(err, "The step could not be tested.");
  }

  // The sample is what the field picker is built from, so only a real result
  // is worth storing; a failed test must not wipe the last good sample.
  if (outcome.ok) {
    const { error } = await admin
      .from("workflow_steps")
      .update({ sample_output: outcome.output })
      .eq("id", step.id);
    if (error) throw new Error(error.message);
  }

  return outcome;
}
