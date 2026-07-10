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
  });
}

/**
 * Runs a workflow now via start_workflow_run (executes synchronously in the DB
 * and returns the run id). Zero AI tokens — deterministic skills + templates.
 */
export function useRunNow() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (workflowId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("start_workflow_run", {
        p_workflow_id: workflowId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_runId, workflowId) => {
      queryClient.invalidateQueries({ queryKey: runsKey(workflowId) });
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}
