"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type TaskStatus = Database["public"]["Tables"]["task_statuses"]["Row"];
export type TaskPriority =
  Database["public"]["Tables"]["task_priorities"]["Row"];
export type TaskStatusCategory =
  Database["public"]["Tables"]["sys_task_status_categories"]["Row"];

/** A project task status annotated with its (global) category. */
export type TaskStatusWithCategory = TaskStatus & {
  category: TaskStatusCategory | null;
};

const STATUSES_ROOT = "task-statuses" as const;

const statusesKey = (projectId: string | undefined) =>
  [STATUSES_ROOT, projectId] as const;
const prioritiesKey = ["task-priorities"] as const;
const categoriesKey = ["sys-task-status-categories"] as const;

const STATUS_SELECT = `
  *,
  category:sys_task_status_categories!task_statuses_category_id_fk (
    id, name, color_code, sort_order, is_todo, is_doing, is_done
  )
`;

/**
 * Lists a project's task statuses ordered by sort_order, each annotated with its
 * (global) status category (is_todo / is_doing / is_done). RLS scopes the result
 * to projects whose team the caller belongs to. Every project auto-gets To Do /
 * Doing / Done via a DB trigger.
 */
export function useTaskStatuses(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: statusesKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<TaskStatusWithCategory[]> => {
      const { data, error } = await supabase
        .from("task_statuses")
        .select(STATUS_SELECT)
        .eq("project_id", projectId as string)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as TaskStatusWithCategory[];
    },
  });
}

export interface CreateTaskStatusInput {
  projectId: string;
  name: string;
  categoryId: string;
  sortOrder?: number;
}

/**
 * Creates a project task status. The team id is resolved from the active team
 * (statuses are scoped per project + team).
 */
export function useCreateTaskStatus() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (
      input: CreateTaskStatusInput,
    ): Promise<TaskStatus> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("task_statuses")
        .insert({
          name: input.name,
          category_id: input.categoryId,
          project_id: input.projectId,
          team_id: teamId,
          ...(input.sortOrder !== undefined
            ? { sort_order: input.sortOrder }
            : {}),
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (status) => {
      queryClient.invalidateQueries({
        queryKey: statusesKey(status.project_id),
      });
    },
  });
}

export interface UpdateTaskStatusInput {
  id: string;
  name?: string;
  categoryId?: string;
  sortOrder?: number;
}

/** Updates a project task status (rename / re-categorize / reorder). */
export function useUpdateTaskStatus() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: UpdateTaskStatusInput,
    ): Promise<TaskStatus> => {
      const patch: Database["public"]["Tables"]["task_statuses"]["Update"] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.categoryId !== undefined) patch.category_id = input.categoryId;
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

      const { data, error } = await supabase
        .from("task_statuses")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (status) => {
      queryClient.invalidateQueries({
        queryKey: statusesKey(status.project_id),
      });
    },
  });
}

/** Deletes a project task status. */
export function useDeleteTaskStatus() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("task_statuses")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [STATUSES_ROOT] });
    },
  });
}

/** Lists the global task priority lookups ordered by `value` (Low/Medium/High). */
export function useTaskPriorities() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: prioritiesKey,
    queryFn: async (): Promise<TaskPriority[]> => {
      const { data, error } = await supabase
        .from("task_priorities")
        .select("*")
        .order("value", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 60,
  });
}

/** Lists the global task status categories ordered by sort_order (To Do/Doing/Done). */
export function useTaskStatusCategories() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: categoriesKey,
    queryFn: async (): Promise<TaskStatusCategory[]> => {
      const { data, error } = await supabase
        .from("sys_task_status_categories")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 60,
  });
}
