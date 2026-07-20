"use client";

import { useCallback, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTrack } from "@/features/tracks/use-tracks";
import type { Database } from "@/types/database";

export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
export type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

/** A status lookup embed (project task_status) trimmed for display. */
export interface TaskStatusEmbed {
  id: string;
  name: string;
  category_id: string;
  sort_order: number;
}

/** A priority lookup embed trimmed for display. */
export interface TaskPriorityEmbed {
  id: string;
  name: string;
  color_code: string;
  value: number;
}

/** An assignee joined through team_members -> users for display. */
export interface TaskAssigneeEmbed {
  team_member_id: string;
  team_member: {
    id: string;
    user: {
      id: string;
      name: string;
      avatar_url: string | null;
    } | null;
  } | null;
}

/** A label joined through task_labels -> team_labels for display. */
export interface TaskLabelEmbed {
  label_id: string;
  label: {
    id: string;
    name: string;
    color_code: string;
  } | null;
}

/** A task row annotated with its status/priority/assignees/labels embeds. */
export type TaskWithRelations = Task & {
  status: TaskStatusEmbed | null;
  priority: TaskPriorityEmbed | null;
  assignees: TaskAssigneeEmbed[];
  labels: TaskLabelEmbed[];
  /** PostgREST count aggregate — `[{ count: N }]` (empty when no comments). */
  comments: { count: number }[];
};

export interface UseTasksOptions {
  /** Show only archived tasks. Default (false) hides archived tasks. */
  archived?: boolean;
  /** Include subtasks in the result. Default (false) returns top-level only. */
  includeSubtasks?: boolean;
}

const TASKS_ROOT = "tasks" as const;

/** Query key for a project's task list. Exported so realtime + UI invalidate the same key. */
export const tasksListKey = (
  projectId: string | undefined,
  opts?: UseTasksOptions,
) =>
  [
    TASKS_ROOT,
    "list",
    projectId,
    {
      archived: Boolean(opts?.archived),
      includeSubtasks: Boolean(opts?.includeSubtasks),
    },
  ] as const;

/** Broad key matching every task list/detail query for a project. */
export const tasksRootKey = (projectId: string | undefined) =>
  [TASKS_ROOT, "list", projectId] as const;

const subtasksKey = (parentTaskId: string | undefined) =>
  [TASKS_ROOT, "subtasks", parentTaskId] as const;

/**
 * The FK-embed select string. PostgREST resolves embeds via the named foreign
 * keys; the relational types are awkward against the generated `Database` type,
 * so the raw rows are cast through `unknown` into `TaskWithRelations`.
 */
const TASK_SELECT = `
  *,
  status:task_statuses!tasks_status_id_fk ( id, name, category_id, sort_order ),
  priority:task_priorities!tasks_priority_id_fk ( id, name, color_code, value ),
  assignees:tasks_assignees!tasks_assignees_task_id_fk (
    team_member_id,
    team_member:team_members!tasks_assignees_team_member_id_fk (
      id,
      user:users!team_members_user_id_fk ( id, name, avatar_url )
    )
  ),
  labels:task_labels!task_labels_task_id_fk (
    label_id,
    label:team_labels!task_labels_label_id_fk ( id, name, color_code )
  ),
  comments:task_comments!task_comments_task_id_fk ( count )
`;

/**
 * Lists a project's top-level tasks (parent_task_id IS NULL) with their
 * status/priority/assignees/labels embedded. RLS scopes the result to projects
 * whose team the caller belongs to. Excludes archived tasks by default.
 *
 * Group in the UI by reading `status_id` / `priority_id` off each row.
 */
export function useTasks(
  projectId: string | undefined,
  opts?: UseTasksOptions,
) {
  const supabase = useMemo(() => createClient(), []);
  const activeTrack = useActiveTrack(projectId);

  // Narrowing to a track is a VIEW filter, so it runs in `select` — the fetched
  // list stays whole in the cache and switching tracks is instant (no refetch).
  const filterByTrack = useCallback(
    (rows: TaskWithRelations[]) =>
      activeTrack ? rows.filter((t) => t.track_id === activeTrack) : rows,
    [activeTrack],
  );

  return useQuery({
    queryKey: tasksListKey(projectId, opts),
    enabled: Boolean(projectId),
    select: filterByTrack,
    queryFn: async (): Promise<TaskWithRelations[]> => {
      let q = supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("project_id", projectId as string)
        .eq("archived", Boolean(opts?.archived));
      if (!opts?.includeSubtasks) q = q.is("parent_task_id", null);

      const { data, error } = await q.order("sort_order", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as TaskWithRelations[];
    },
  });
}

/**
 * Lists the subtasks of a parent task (parent_task_id = X) with the same embeds
 * as `useTasks`.
 */
export function useSubtasks(parentTaskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: subtasksKey(parentTaskId),
    enabled: Boolean(parentTaskId),
    queryFn: async (): Promise<TaskWithRelations[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("parent_task_id", parentTaskId as string)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as TaskWithRelations[];
    },
  });
}

export interface CreateTaskInput {
  projectId: string;
  name: string;
  statusId?: string;
  priorityId?: string;
  parentTaskId?: string;
  /** team_member_ids to assign on creation. */
  assignees?: string[];
}

/**
 * Creates a task via the `create_task` RPC (a trigger assigns task_no and, for a
 * Done-category status, sets done/completed_at). Returns the new task id.
 */
export function useCreateTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTaskInput): Promise<string> => {
      const { data, error } = await supabase.rpc("create_task", {
        p_name: input.name,
        p_project_id: input.projectId,
        ...(input.statusId ? { p_status_id: input.statusId } : {}),
        ...(input.priorityId ? { p_priority_id: input.priorityId } : {}),
        ...(input.parentTaskId ? { p_parent_task_id: input.parentTaskId } : {}),
        ...(input.assignees && input.assignees.length > 0
          ? { p_assignees: input.assignees }
          : {}),
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, input) => {
      queryClient.invalidateQueries({
        queryKey: tasksRootKey(input.projectId),
      });
      if (input.parentTaskId) {
        queryClient.invalidateQueries({
          queryKey: subtasksKey(input.parentTaskId),
        });
      }
    },
  });
}

export interface UpdateTaskInput extends TaskUpdate {
  id: string;
}

/**
 * Updates a task row (name/status/priority/dates/sort_order/description/etc.).
 * RLS allows project team members. Moving on the board = patch status_id +
 * sort_order through here.
 */
export function useUpdateTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateTaskInput): Promise<Task> => {
      const { id, ...rest } = input;
      const { data, error } = await supabase
        .from("tasks")
        .update(rest)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({
        queryKey: tasksRootKey(task.project_id),
      });
      if (task.parent_task_id) {
        queryClient.invalidateQueries({
          queryKey: subtasksKey(task.parent_task_id),
        });
      }
    },
  });
}

/** Deletes a task (and, via FK cascade, its assignees/labels/subtasks/comments). */
export function useDeleteTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      // We don't know the project id from just the id, so invalidate broadly.
      queryClient.invalidateQueries({ queryKey: [TASKS_ROOT] });
    },
  });
}

/** One row's new position (and, for the moved card, its new column). */
export interface TaskOrderPatch {
  id: string;
  sort_order: number;
  status_id?: string;
}

export interface ReorderTasksInput {
  projectId: string;
  updates: TaskOrderPatch[];
  /** Snapshot to restore if the server write fails (the caller applied the
   *  optimistic update synchronously, so rollback is its responsibility). */
  rollback?: TaskWithRelations[];
}

/** Applies board-drag `updates` (a `sort_order` renumber + optional `status_id`
 *  on the moved card) to a cached task list. Exported so the board can update
 *  the cache synchronously on drop (avoiding a flash back to the origin). */
export function applyTaskOrder(
  tasks: TaskWithRelations[] | undefined,
  updates: TaskOrderPatch[],
): TaskWithRelations[] {
  const patchById = new Map(updates.map((u) => [u.id, u]));
  return (tasks ?? []).map((t) => {
    const p = patchById.get(t.id);
    if (!p) return t;
    return {
      ...t,
      sort_order: p.sort_order,
      ...(p.status_id ? { status_id: p.status_id } : {}),
    };
  });
}

/**
 * Persists board drag results: integer `sort_order` renumbering plus an
 * optional `status_id` change on the moved card. The caller updates the cache
 * synchronously (so the card lands in place with no flash); this fires the
 * writes, rolls back to `rollback` on error, and refetches to reconcile.
 * `sort_order` is an INTEGER column — pass whole numbers (index-based).
 */
export function useReorderTasks() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ updates }: ReorderTasksInput): Promise<void> => {
      // Each row can get a different sort_order, so a single `.in()` won't do;
      // fire them in parallel.
      const results = await Promise.all(
        updates.map((u) =>
          supabase
            .from("tasks")
            .update({
              sort_order: u.sort_order,
              ...(u.status_id ? { status_id: u.status_id } : {}),
            })
            .eq("id", u.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onError: (_err, input) => {
      if (input.rollback) {
        queryClient.setQueryData(tasksListKey(input.projectId), input.rollback);
      }
    },
    onSettled: (_data, _err, input) => {
      queryClient.invalidateQueries({ queryKey: tasksRootKey(input.projectId) });
    },
  });
}

export interface BulkUpdateTasksInput {
  ids: string[];
  patch: TaskUpdate;
}

/**
 * Applies the same patch to many tasks at once (e.g. bulk status / priority /
 * archive). Uses a single `.in()` update.
 */
export function useBulkUpdateTasks() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BulkUpdateTasksInput): Promise<Task[]> => {
      if (input.ids.length === 0) return [];
      const { data, error } = await supabase
        .from("tasks")
        .update(input.patch)
        .in("id", input.ids)
        .select("*");

      if (error) throw error;
      return data ?? [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TASKS_ROOT] });
    },
  });
}
