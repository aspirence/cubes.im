"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type ProjectPhase =
  Database["public"]["Tables"]["project_phases"]["Row"];
export type TaskPhaseRow =
  Database["public"]["Tables"]["task_phase"]["Row"];

const PHASES_ROOT = "project-phases" as const;
const TASK_PHASE_ROOT = "task-phase" as const;

const phasesKey = (projectId: string | undefined) =>
  [PHASES_ROOT, projectId] as const;
const taskPhaseKey = (taskId: string | undefined) =>
  [TASK_PHASE_ROOT, taskId] as const;

/**
 * Lists a project's phases ordered by sort_index. RLS scopes the result to
 * members of the project's team.
 */
export function useProjectPhases(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: phasesKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectPhase[]> => {
      const { data, error } = await supabase
        .from("project_phases")
        .select("*")
        .eq("project_id", projectId as string)
        .order("sort_index", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CreateProjectPhaseInput {
  projectId: string;
  name: string;
  colorCode: string;
  sortIndex?: number;
}

/** Creates a phase in a project. `color_code` must be a hex colour. */
export function useCreateProjectPhase() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: CreateProjectPhaseInput,
    ): Promise<ProjectPhase> => {
      const { data, error } = await supabase
        .from("project_phases")
        .insert({
          project_id: input.projectId,
          name: input.name,
          color_code: input.colorCode,
          ...(input.sortIndex !== undefined
            ? { sort_index: input.sortIndex }
            : {}),
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (phase) => {
      queryClient.invalidateQueries({
        queryKey: phasesKey(phase.project_id),
      });
    },
  });
}

/** Deletes a phase (cascading any task_phase links to it). */
export function useDeleteProjectPhase() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("project_phases")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PHASES_ROOT] });
      // A deleted phase may clear task_phase rows; refresh those too.
      queryClient.invalidateQueries({ queryKey: [TASK_PHASE_ROOT] });
    },
  });
}

/**
 * Reads the phase assigned to a task (task_phase is one row per task). Returns
 * the phase_id, or null when the task has no phase.
 */
export function useTaskPhase(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: taskPhaseKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("task_phase")
        .select("phase_id")
        .eq("task_id", taskId as string)
        .maybeSingle();

      if (error) throw error;
      return data?.phase_id ?? null;
    },
  });
}

export interface SetTaskPhaseInput {
  taskId: string;
  phaseId: string;
}

/**
 * Assigns (or reassigns) a task's phase by upserting the task_phase row keyed on
 * task_id.
 */
export function useSetTaskPhase() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SetTaskPhaseInput): Promise<TaskPhaseRow> => {
      const { data, error } = await supabase
        .from("task_phase")
        .upsert(
          {
            task_id: input.taskId,
            phase_id: input.phaseId,
          },
          { onConflict: "task_id" },
        )
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: taskPhaseKey(row.task_id) });
    },
  });
}

/** Clears a task's phase by deleting its task_phase row. */
export function useClearTaskPhase() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string): Promise<void> => {
      const { error } = await supabase
        .from("task_phase")
        .delete()
        .eq("task_id", taskId);
      if (error) throw error;
    },
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: taskPhaseKey(taskId) });
    },
  });
}
