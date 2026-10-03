import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppActionContext, AppActionResult } from "./app-action-types";
import { interpolateDeep } from "./interpolate";
import { runHttpStep, type HttpStepConfig, type HttpStepDeps } from "./http-step";

/**
 * The Node half of the workflow engine. SQL (advance_workflow_run) runs every
 * step it can on its own and parks a run in 'waiting_app' when it reaches an
 * app step, because those call Google over HTTP. This module:
 *
 *  - tick(): what POST /api/runner/tick does every five minutes — start the
 *    schedule-triggered workflows that are due, dispatch the events on the bus,
 *    wake the runs whose delay is over, execute parked app and http steps, let
 *    Sheets run its due Google syncs, and sweep expired history;
 *  - continueRun(): what "Run now" calls right after start_workflow_run, so the
 *    member sees app steps finish immediately instead of up to five minutes
 *    later.
 *
 * Every parked step is claimed through wf_claim_app_runs, which leases the run,
 * so a tick and a "Run now" (or two ticks) never execute the same step twice.
 * The claim also hands over the run context, because an app or http step's
 * params are interpolated here — SQL steps get that for free from
 * wf_interpolate, and a step executed in Node must not be the odd one out.
 * The action dispatcher is injectable so tests can drive the whole loop with a
 * fake instead of real Google calls.
 */

export type AppActionDispatcher = (
  key: string,
  ctx: AppActionContext,
  params: Record<string, unknown> | null | undefined,
) => Promise<AppActionResult>;

export interface RunnerDeps {
  /** Defaults to the real registry (runAppAction). */
  dispatch?: AppActionDispatcher;
  /** Injected by the http-step tests (a mock server, a fake resolver). */
  http?: HttpStepDeps;
  /** Sheets' due Google syncs; the tick route passes processDueSheetLinks. */
  processSheetLinks?: (admin: SupabaseClient) => Promise<number>;
  /** Parked runs handled per tick. */
  maxRuns?: number;
  /** App steps executed per run per call — a guard against a runaway chain. */
  maxStepsPerRun?: number;
  /** Stop picking up new runs after this many ms, so a tick ends in time. */
  budgetMs?: number;
}

interface ClaimedStep {
  run_id: string;
  step_run_id: string;
  team_id: string;
  workflow_id: string;
  step_key: string;
  /** 'app' or 'http' — both park in 'waiting_app', only Node can run either. */
  step_type: string | null;
  config: Record<string, unknown> | null;
  /** The run context, so the step's params can be interpolated against it. */
  context: Record<string, unknown> | null;
  attempt: number | null;
  trigger_kind: string | null;
}

export interface TickResult {
  /** Runs started by due schedules. */
  scheduled: number;
  /** Runs started by events on the bus. */
  events: number;
  /** Runs woken from a delay step. */
  resumed: number;
  /** App steps executed (success or error). */
  appSteps: number;
  /** Parked runs picked up. */
  runs: number;
  /** Google sheet links synced, or null when that part was skipped / failed. */
  sheetLinks: number | null;
  /** Expired runs and consumed events deleted by the retention sweep. */
  swept: number;
  errors: string[];
}

/**
 * The real registry, loaded lazily: it pulls in every app's server code
 * (Google), which a caller that injects its own dispatcher never needs.
 */
const defaultDispatch: AppActionDispatcher = async (key, ctx, params) => {
  const { runAppAction } = await import("./app-actions");
  return runAppAction(key, ctx, params);
};

function triggerOf(value: string | null): AppActionContext["trigger"] {
  // AppActionContext.trigger is a shared contract type with no 'webhook' arm;
  // a webhook run is an outside-world trigger like an event, so it reports as
  // one rather than pretending a person pressed Run now.
  if (value === "webhook") return "event";
  return value === "schedule" || value === "event" ? value : "manual";
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

async function claimOne(admin: SupabaseClient, runId: string | null): Promise<ClaimedStep | null> {
  const { data, error } = await admin.rpc("wf_claim_app_runs", {
    p_limit: 1,
    p_run_id: runId,
  });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = (data ?? []) as ClaimedStep[];
  return rows[0] ?? null;
}

/**
 * Executes one claimed step and hands the result back to SQL. Returns the
 * run's status afterwards ('waiting_app' when it parked on the next app step).
 *
 * Both kinds of parked step arrive here: 'app' (a registered action) and
 * 'http' (an arbitrary outbound request). Either way the step's config is
 * interpolated against the run context first — SQL steps have always had
 * {{steps.x.y}} resolved for them, and a step executed in Node has to do the
 * same or a mapped parameter would be sent as its literal token.
 */
async function executeStep(
  admin: SupabaseClient,
  step: ClaimedStep,
  actorUserId: string | null,
  deps: RunnerDeps,
): Promise<string | null> {
  const dispatch = deps.dispatch ?? defaultDispatch;
  const context = step.context ?? {};
  const config = step.config ?? {};

  let result: AppActionResult;
  try {
    if (step.step_type === "http") {
      result = await runHttpStep(
        admin,
        step.team_id,
        interpolateDeep(config, context) as HttpStepConfig,
        deps.http ?? {},
      );
    } else {
      const action = typeof config.action === "string" ? config.action : "";
      const rawParams =
        config.params && typeof config.params === "object" && !Array.isArray(config.params)
          ? (config.params as Record<string, unknown>)
          : {};
      result = await dispatch(
        action,
        {
          admin,
          teamId: step.team_id,
          runId: step.run_id,
          stepKey: step.step_key,
          trigger: triggerOf(step.trigger_kind),
          actorUserId,
        },
        interpolateDeep(rawParams, context),
      );
    }
  } catch (err) {
    // runAppAction never throws, but an injected dispatcher might.
    result = { ok: false, output: {}, error: messageOf(err) || "The app step failed." };
  }

  const { data, error } = await admin.rpc("wf_resume_app_step", {
    p_run_id: step.run_id,
    p_step_run_id: step.step_run_id,
    p_output: result.output ?? {},
    p_error: result.ok ? null : result.error || "The app step failed.",
  });
  // If the hand-back itself fails the lease simply runs out and a later tick
  // retries the step — better a repeated sync than a run stuck forever.
  if (error) throw new Error(`resume failed: ${error.message}`);
  return (data as string | null) ?? null;
}

/**
 * Executes a run's parked app steps one after another until it finishes,
 * errors, or parks on something the runner cannot do.
 */
async function driveRun(
  admin: SupabaseClient,
  first: ClaimedStep,
  actorUserId: string | null,
  deps: RunnerDeps,
  maxSteps: number,
): Promise<number> {
  let step: ClaimedStep | null = first;
  let executed = 0;
  while (step && executed < maxSteps) {
    const status = await executeStep(admin, step, actorUserId, deps);
    executed++;
    if (status !== "waiting_app") break;
    // Still 'waiting_app' means either the next app step, or the same step
    // waiting out a retry backoff — in which case the claim returns nothing
    // and this run is left for a later tick, exactly as intended.
    step = await claimOne(admin, first.run_id);
  }
  return executed;
}

/**
 * "Run now": executes the app steps of one run the caller just started. The
 * caller has already been checked as a member of the run's team.
 */
export async function continueRun(
  admin: SupabaseClient,
  runId: string,
  actorUserId: string | null,
  deps: RunnerDeps = {},
): Promise<{ status: string | null; steps: number; error?: string }> {
  let steps = 0;
  let failure: string | undefined;
  try {
    const first = await claimOne(admin, runId);
    if (first) steps = await driveRun(admin, first, actorUserId, deps, deps.maxStepsPerRun ?? 20);
  } catch (err) {
    failure = messageOf(err);
  }
  const { data } = await admin.from("workflow_runs").select("status").eq("id", runId).maybeSingle();
  return {
    status: (data as { status: string } | null)?.status ?? null,
    steps,
    ...(failure ? { error: failure } : {}),
  };
}

/**
 * One runner pass: due schedules, events on the bus, runs whose delay is over,
 * parked app/http steps, sheet syncs, then the retention sweep.
 *
 * The order matters. Schedules, events and delays all START or RESUME runs in
 * SQL, and each of those runs stops at its first app step — so the parked-step
 * loop has to come after them, or the work they created would sit until the
 * next tick five minutes later. The sweep goes last because deleting expired
 * history must never eat into the budget for actual work.
 */
export async function tick(admin: SupabaseClient, deps: RunnerDeps = {}): Promise<TickResult> {
  const maxRuns = deps.maxRuns ?? 10;
  const maxSteps = deps.maxStepsPerRun ?? 20;
  const deadline = Date.now() + (deps.budgetMs ?? 240_000);
  const result: TickResult = {
    scheduled: 0,
    events: 0,
    resumed: 0,
    appSteps: 0,
    runs: 0,
    sheetLinks: null,
    swept: 0,
    errors: [],
  };

  // 1. Schedules. The sweep itself runs every in-SQL step of each new run and
  //    parks the ones that reach an app step, which step 4 then picks up.
  const { data: started, error: claimErr } = await admin.rpc("workflows_claim_due", { p_limit: 20 });
  if (claimErr) result.errors.push(`schedules: ${claimErr.message}`);
  else result.scheduled = Array.isArray(started) ? started.length : 0;

  // 2. Events. One run per (event, workflow), guaranteed exactly once by the
  //    unique key on workflow_event_deliveries rather than by this loop.
  const { data: fired, error: eventErr } = await admin.rpc("wf_dispatch_events", { p_limit: 50 });
  if (eventErr) result.errors.push(`events: ${eventErr.message}`);
  else result.events = Array.isArray(fired) ? fired.length : 0;

  // 3. Delays whose time has come. The five-minute tick is the resolution of
  //    a delay step, which is why the builder's shortest wait is a minute and
  //    the UI says "about".
  const { data: woken, error: resumeErr } = await admin.rpc("wf_claim_resumable", { p_limit: 20 });
  if (resumeErr) result.errors.push(`delays: ${resumeErr.message}`);
  else result.resumed = Array.isArray(woken) ? woken.length : 0;

  // 4. Parked app/http steps, oldest run first, one run at a time. Claiming
  //    one at a time (not a batch) means a run is only leased while it is
  //    actually being worked on.
  while (result.runs < maxRuns && Date.now() < deadline) {
    let claimed: ClaimedStep | null;
    try {
      claimed = await claimOne(admin, null);
    } catch (err) {
      result.errors.push(messageOf(err));
      break;
    }
    if (!claimed) break;
    result.runs++;
    try {
      result.appSteps += await driveRun(admin, claimed, null, deps, maxSteps);
    } catch (err) {
      result.errors.push(`run ${claimed.run_id}: ${messageOf(err)}`);
    }
  }

  // 5. Google Sheets auto-sync rides the same tick rather than a cron job of
  //    its own. A failure there must not hide the workflow results above.
  if (deps.processSheetLinks) {
    try {
      result.sheetLinks = await deps.processSheetLinks(admin);
    } catch (err) {
      result.errors.push(`sheets: ${messageOf(err)}`);
    }
  }

  // 6. Retention. Runs past expires_at, consumed events and the webhook
  //    capture buffer, in one bounded batch — history that nobody will read
  //    is still rows somebody pays for.
  const { data: swept, error: sweepErr } = await admin.rpc("wf_sweep_runs", { p_limit: 500 });
  if (sweepErr) result.errors.push(`sweep: ${sweepErr.message}`);
  else result.swept = typeof swept === "number" ? swept : 0;

  return result;
}
