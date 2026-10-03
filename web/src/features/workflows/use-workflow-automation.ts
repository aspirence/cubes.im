"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

/**
 * Everything the builder needs from the automation half of the engine:
 * webhook triggers and their capture buffer, stored samples, the per-step
 * tester and run replay.
 *
 * The engine (migration 20261132000000) is being built in parallel with this
 * UI, so every read here has to survive the tables and columns simply not being
 * there yet. A missing relation is a *state* — "the automation migration has
 * not been applied here" — which the panels say out loud, not an error to throw
 * at the user.
 */

// These tables and columns are newer than the generated database types.
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

interface PgError {
  code?: string;
  message?: string;
}

/**
 * Postgres 42P01 (no such table) / 42703 (no such column), plus PostgREST's
 * own schema-cache equivalents, which is what a browser client actually sees
 * when a migration has not been applied.
 */
export function isMissingSchema(err: PgError | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "42703") return true;
  if (err.code === "PGRST204" || err.code === "PGRST205") return true;
  return /does not exist|schema cache|could not find/i.test(err.message ?? "");
}

/** A CHECK violation — what a not-yet-widened trigger_type/step_type looks like. */
export function isCheckViolation(err: PgError | null | undefined): boolean {
  return err?.code === "23514";
}

export interface WorkflowWebhookRow {
  id: string;
  workflow_id: string;
  team_id: string;
  token: string;
  signing_secret: string | null;
  capture_mode: boolean;
  dedupe_path: string | null;
  enabled: boolean;
  last_event_at: string | null;
}

export interface WorkflowWebhookEventRow {
  id: string;
  webhook_id: string;
  headers: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  dedupe_key: string | null;
  run_id: string | null;
  status: string;
  error: string | null;
  received_at: string;
}

const WEBHOOK_COLUMNS =
  "id, workflow_id, team_id, token, signing_secret, capture_mode, dedupe_path, enabled, last_event_at";

export interface AvailabilityState<T> {
  /** False when the automation migration has not been applied here. */
  available: boolean;
  row: T | null;
}

const webhookKey = (workflowId: string | undefined) => ["workflow-webhook", workflowId] as const;
const eventsKey = (webhookId: string | undefined) => ["workflow-webhook-events", webhookId] as const;

/** The workflow's webhook row, or null when it has not been issued a URL yet. */
export function useWorkflowWebhook(workflowId: string | undefined, enabled = true) {
  const supabase = useMemo(() => loose(createClient()), []);
  return useQuery({
    queryKey: webhookKey(workflowId),
    enabled: Boolean(workflowId) && enabled,
    queryFn: async (): Promise<AvailabilityState<WorkflowWebhookRow>> => {
      const { data, error } = await supabase
        .from("workflow_webhooks")
        .select(WEBHOOK_COLUMNS)
        .eq("workflow_id", workflowId as string)
        .maybeSingle();
      if (isMissingSchema(error)) return { available: false, row: null };
      if (error) throw error;
      return { available: true, row: (data as WorkflowWebhookRow | null) ?? null };
    },
  });
}

/** 32 random bytes, base64url — the same shape the contract asks the server for. */
export function newWebhookToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Issues the workflow's webhook URL. Prefers an RPC if the engine ships one
 * (it can generate the token with the database's own randomness); falls back to
 * inserting the row, which RLS still gates on team admin.
 */
export function useEnsureWebhook() {
  const supabase = useMemo(() => loose(createClient()), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  return useMutation({
    mutationFn: async (workflowId: string): Promise<WorkflowWebhookRow> => {
      const rpc = await supabase.rpc("workflow_webhook_ensure", { p_workflow_id: workflowId });
      if (!rpc.error && rpc.data) {
        const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as WorkflowWebhookRow;
        if (row?.token) return row;
      }
      if (!activeTeam?.id) throw new Error("No active team.");
      const { data, error } = await supabase
        .from("workflow_webhooks")
        .insert({ workflow_id: workflowId, team_id: activeTeam.id, token: newWebhookToken() })
        .select(WEBHOOK_COLUMNS)
        .single();
      if (error) throw error;
      return data as WorkflowWebhookRow;
    },
    onSuccess: (_row, workflowId) => {
      queryClient.invalidateQueries({ queryKey: webhookKey(workflowId) });
    },
  });
}

export function useUpdateWebhook() {
  const supabase = useMemo(() => loose(createClient()), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      workflowId: string;
      patch: Partial<Pick<WorkflowWebhookRow, "capture_mode" | "signing_secret" | "enabled" | "dedupe_path" | "token">>;
    }): Promise<WorkflowWebhookRow> => {
      const { data, error } = await supabase
        .from("workflow_webhooks")
        .update(input.patch)
        .eq("id", input.id)
        .select(WEBHOOK_COLUMNS)
        .single();
      if (error) throw error;
      return data as WorkflowWebhookRow;
    },
    onSuccess: (_row, input) => {
      queryClient.invalidateQueries({ queryKey: webhookKey(input.workflowId) });
    },
  });
}

/**
 * The capture buffer: what actually arrived at the URL, newest first. While the
 * panel is in its "waiting for a request…" state this polls, because the row is
 * written by a public route with no session to push an update back.
 */
export function useWebhookEvents(
  webhookId: string | undefined,
  options: { waiting?: boolean; limit?: number } = {},
) {
  const supabase = useMemo(() => loose(createClient()), []);
  const limit = options.limit ?? 10;
  return useQuery({
    queryKey: [...eventsKey(webhookId), limit] as const,
    enabled: Boolean(webhookId),
    queryFn: async (): Promise<AvailabilityState<WorkflowWebhookEventRow[]>> => {
      const { data, error } = await supabase
        .from("workflow_webhook_events")
        .select("id, webhook_id, headers, payload, dedupe_key, run_id, status, error, received_at")
        .eq("webhook_id", webhookId as string)
        .order("received_at", { ascending: false })
        .limit(limit);
      if (isMissingSchema(error)) return { available: false, row: null };
      if (error) throw error;
      return { available: true, row: (data ?? []) as WorkflowWebhookEventRow[] };
    },
    refetchInterval: options.waiting ? 2500 : false,
  });
}

/* ------------------------------------------------------------- samples ---- */

/**
 * Stores the trigger's sample payload. The column arrives with the automation
 * migration, so a missing column is reported as such rather than as a failure
 * the user could have caused.
 */
export function useSaveTriggerSample() {
  const supabase = useMemo(() => loose(createClient()), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { workflowId: string; sample: unknown }): Promise<void> => {
      const { error } = await supabase
        .from("workflows")
        .update({ trigger_sample: input.sample })
        .eq("id", input.workflowId);
      if (isMissingSchema(error))
        throw new Error(
          "Sample data needs migration 20261132000000 (workflows.trigger_sample) — it has not been applied here yet.",
        );
      if (error) throw error;
    },
    onSuccess: (_v, input) => {
      queryClient.invalidateQueries({ queryKey: ["workflow", input.workflowId] });
    },
  });
}

export function useSaveStepSample() {
  const supabase = useMemo(() => loose(createClient()), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      stepId: string;
      workflowId: string;
      sample: unknown;
    }): Promise<void> => {
      const { error } = await supabase
        .from("workflow_steps")
        .update({ sample_output: input.sample })
        .eq("id", input.stepId);
      if (isMissingSchema(error))
        throw new Error(
          "Sample data needs migration 20261132000000 (workflow_steps.sample_output) — it has not been applied here yet.",
        );
      if (error) throw error;
    },
    onSuccess: (_v, input) => {
      queryClient.invalidateQueries({ queryKey: ["workflow-steps", input.workflowId] });
    },
  });
}

/* ------------------------------------------------------- test and replay -- */

export interface StepTestResult {
  ok: boolean;
  /** Exactly what was sent — the step's config with its tokens filled in. */
  request: unknown;
  /** Exactly what came back, which is also what is stored as sample_output. */
  response: unknown;
  error: string | null;
  /** False when the step was only described (create task, notify). */
  executed: boolean;
  /** How long the server said it took, when it says. */
  durationMs: number | null;
}

/** The message shown when a route the engine owner has not deployed is called. */
const NOT_DEPLOYED =
  "This needs the workflow automation routes, which are not deployed on this environment yet.";

async function postJson(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/**
 * Runs one step on its own against the stored samples and shows the exact
 * request and response. The route belongs to the engine owner
 * (POST /api/workflows/steps/[id]/test); until it exists, say so plainly
 * instead of showing "Unexpected token < in JSON".
 */
export function useTestStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { stepId: string; workflowId: string }): Promise<StepTestResult> => {
      const { status, json } = await postJson(`/api/workflows/steps/${input.stepId}/test`, {});
      if (status === 404 || status === 405) throw new Error(NOT_DEPLOYED);
      const body = (json ?? {}) as Record<string, unknown>;
      if (status >= 400) {
        throw new Error(
          typeof body.error === "string" ? body.error : `The step tester answered ${status}.`,
        );
      }
      return {
        ok: body.ok !== false,
        // `input` is the step's config with every token already resolved —
        // literally what the step will send.
        request: body.request ?? body.input ?? null,
        response: body.output ?? body.response ?? body.sample_output ?? null,
        error: typeof body.error === "string" ? body.error : null,
        // Steps that would create a task or notify someone are described, not
        // performed, so the panel can say so instead of implying it happened.
        executed: body.executed !== false,
        durationMs: typeof body.duration_ms === "number" ? body.duration_ms : null,
      };
    },
    onSuccess: (_r, input) => {
      // The route stores sample_output, so the field picker downstream changes.
      queryClient.invalidateQueries({ queryKey: ["workflow-steps", input.workflowId] });
    },
  });
}

/** Starts a new run from a past run's raw trigger payload. */
export function useReplayRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { runId: string; workflowId: string }): Promise<string | null> => {
      const { status, json } = await postJson(`/api/workflows/runs/${input.runId}/replay`, {});
      if (status === 404 || status === 405) throw new Error(NOT_DEPLOYED);
      const body = (json ?? {}) as Record<string, unknown>;
      if (status >= 400)
        throw new Error(typeof body.error === "string" ? body.error : `Replay answered ${status}.`);
      return typeof body.runId === "string" ? body.runId : null;
    },
    onSuccess: (_r, input) => {
      queryClient.invalidateQueries({ queryKey: ["workflow-runs", input.workflowId] });
    },
  });
}
