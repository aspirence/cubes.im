"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type WorkflowRun = Database["public"]["Tables"]["workflow_runs"]["Row"];
export type WorkflowStepRun =
  Database["public"]["Tables"]["workflow_step_runs"]["Row"];

const runsKey = (workflowId: string | undefined) =>
  ["workflow-runs", workflowId] as const;
const runKey = (runId: string | undefined) =>
  ["workflow-run", runId] as const;

/** Lists a workflow's runs, newest first. */
export function useWorkflowRuns(workflowId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: runsKey(workflowId),
    enabled: Boolean(workflowId),
    queryFn: async (): Promise<WorkflowRun[]> => {
      const { data, error } = await supabase
        .from("workflow_runs")
        .select("*")
        .eq("workflow_id", workflowId as string)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    // A run parked on an app step or a delay finishes on the server a little
    // later (the next runner tick at worst), so keep the list fresh while one
    // is open.
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (r) => r.status === "running" || r.status === "waiting_app" || r.status === "waiting_delay",
      )
        ? 5000
        : false,
  });
}

/** Loads a run with its per-step timeline. */
export function useWorkflowRun(runId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: runKey(runId),
    enabled: Boolean(runId),
    queryFn: async (): Promise<{
      run: WorkflowRun;
      stepRuns: WorkflowStepRun[];
    }> => {
      const [{ data: run, error: runErr }, { data: steps, error: stepsErr }] =
        await Promise.all([
          supabase
            .from("workflow_runs")
            .select("*")
            .eq("id", runId as string)
            .single(),
          supabase
            .from("workflow_step_runs")
            .select("*")
            .eq("run_id", runId as string)
            .order("started_at", { ascending: true }),
        ]);
      if (runErr) throw runErr;
      if (stepsErr) throw stepsErr;
      return { run, stepRuns: steps ?? [] };
    },
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === "running" || status === "waiting_app" || status === "waiting_delay"
        ? 4000
        : false;
    },
  });
}

/**
 * Runs a workflow now. start_workflow_run executes every in-database step
 * synchronously and parks the run on its first app step (a Sheets sync, a CRM
 * step…); the follow-up POST to /continue executes those app steps on the
 * server straight away. If that call fails the run is not lost — the runner's
 * next tick picks up any parked run — so it never fails the mutation.
 * Resolves with the run id and its status after the app steps ran.
 */
export function useRunNow() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      workflowId: string,
    ): Promise<{ runId: string; status: string | null }> => {
      const { data, error } = await supabase.rpc("start_workflow_run", {
        p_workflow_id: workflowId,
      });
      if (error) throw error;
      const runId = data as string;
      try {
        const res = await fetch(`/api/workflows/runs/${runId}/continue`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as { status?: string | null };
        return { runId, status: res.ok ? (body.status ?? null) : null };
      } catch {
        return { runId, status: null };
      }
    },
    onSuccess: ({ runId }, workflowId) => {
      queryClient.invalidateQueries({ queryKey: runsKey(workflowId) });
      queryClient.invalidateQueries({ queryKey: runKey(runId) });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}
