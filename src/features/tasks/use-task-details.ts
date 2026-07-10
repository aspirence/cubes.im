"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type TasksAssigneeRow =
  Database["public"]["Tables"]["tasks_assignees"]["Row"];
export type TaskCommentRow =
  Database["public"]["Tables"]["task_comments"]["Row"];

/** An assignee joined through team_members -> users for display. */
export interface TaskAssignee {
  team_member_id: string;
  team_member: {
    id: string;
    user: {
      id: string;
      name: string;
      email: string;
      avatar_url: string | null;
    } | null;
  } | null;
}

/** A label join row joined to the team_label for display. */
export interface TaskLabel {
  label_id: string;
  label: {
    id: string;
    name: string;
    color_code: string;
  } | null;
}

/** A comment joined to its author (created_by -> users). */
export interface TaskComment extends TaskCommentRow {
  author: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
}

const assigneesKey = (taskId: string | undefined) =>
  ["task-assignees", taskId] as const;
const labelsKey = (taskId: string | undefined) =>
  ["task-labels", taskId] as const;
const commentsKey = (taskId: string | undefined) =>
  ["task-comments", taskId] as const;

const ASSIGNEE_SELECT = `
  team_member_id,
  team_member:team_members!tasks_assignees_team_member_id_fk (
    id,
    user:users!team_members_user_id_fk ( id, name, email, avatar_url )
  )
`;

const LABEL_SELECT = `
  label_id,
  label:team_labels!task_labels_label_id_fk ( id, name, color_code )
`;

const COMMENT_SELECT = `
  *,
  author:users!task_comments_created_by_fk ( id, name, avatar_url )
`;

/* ----------------------------- assignees ------------------------------ */

/** Lists a task's assignees joined to team_members -> users. */
export function useTaskAssignees(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: assigneesKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskAssignee[]> => {
      const { data, error } = await supabase
        .from("tasks_assignees")
        .select(ASSIGNEE_SELECT)
        .eq("task_id", taskId as string);

      if (error) throw error;
      return (data ?? []) as unknown as TaskAssignee[];
    },
  });
}

export interface SetTaskAssigneesInput {
  taskId: string;
  /** Desired full set of team_member_ids for the task. */
  teamMemberIds: string[];
}

/**
 * Reconciles a task's assignees to exactly `teamMemberIds` by diffing against
 * the current rows: inserts the additions, deletes the removals.
 */
export function useSetTaskAssignees() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SetTaskAssigneesInput): Promise<void> => {
      const { data: current, error: readError } = await supabase
        .from("tasks_assignees")
        .select("team_member_id")
        .eq("task_id", input.taskId);
      if (readError) throw readError;

      const currentIds = new Set(
        (current ?? []).map((r) => r.team_member_id),
      );
      const desiredIds = new Set(input.teamMemberIds);

      const toAdd = input.teamMemberIds.filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

      if (toAdd.length > 0) {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;

        const { error: insertError } = await supabase
          .from("tasks_assignees")
          .insert(
            toAdd.map((teamMemberId) => ({
              task_id: input.taskId,
              team_member_id: teamMemberId,
              assigned_by: user?.id ?? null,
            })),
          );
        if (insertError) throw insertError;
      }

      if (toRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from("tasks_assignees")
          .delete()
          .eq("task_id", input.taskId)
          .in("team_member_id", toRemove);
        if (deleteError) throw deleteError;
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: assigneesKey(input.taskId) });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/* ------------------------------- labels ------------------------------- */

/** Lists a task's labels joined to the team_labels row. */
export function useTaskLabels(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: labelsKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskLabel[]> => {
      const { data, error } = await supabase
        .from("task_labels")
        .select(LABEL_SELECT)
        .eq("task_id", taskId as string);

      if (error) throw error;
      return (data ?? []) as unknown as TaskLabel[];
    },
  });
}

export interface SetTaskLabelsInput {
  taskId: string;
  /** Desired full set of team_label ids for the task. */
  labelIds: string[];
}

/**
 * Reconciles a task's labels to exactly `labelIds` by diffing against the
 * current rows: inserts the additions, deletes the removals.
 */
export function useSetTaskLabels() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SetTaskLabelsInput): Promise<void> => {
      const { data: current, error: readError } = await supabase
        .from("task_labels")
        .select("label_id")
        .eq("task_id", input.taskId);
      if (readError) throw readError;

      const currentIds = new Set((current ?? []).map((r) => r.label_id));
      const desiredIds = new Set(input.labelIds);

      const toAdd = input.labelIds.filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

      if (toAdd.length > 0) {
        const { error: insertError } = await supabase
          .from("task_labels")
          .insert(
            toAdd.map((labelId) => ({
              task_id: input.taskId,
              label_id: labelId,
            })),
          );
        if (insertError) throw insertError;
      }

      if (toRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from("task_labels")
          .delete()
          .eq("task_id", input.taskId)
          .in("label_id", toRemove);
        if (deleteError) throw deleteError;
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: labelsKey(input.taskId) });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/* ------------------------------ comments ------------------------------ */

/** Lists a task's comments (oldest first) joined to their author. */
export function useTaskComments(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: commentsKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskComment[]> => {
      const { data, error } = await supabase
        .from("task_comments")
        .select(COMMENT_SELECT)
        .eq("task_id", taskId as string)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as TaskComment[];
    },
  });
}

export interface AddTaskCommentInput {
  taskId: string;
  content: string;
  /** user ids @mentioned in the comment; a DB trigger notifies them */
  mentions?: string[];
}

/**
 * Adds a comment to a task. `created_by` is set to the current user; RLS scopes
 * writes to project team members.
 */
export function useAddTaskComment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: AddTaskCommentInput,
    ): Promise<TaskCommentRow> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("task_comments")
        .insert({
          task_id: input.taskId,
          content: input.content,
          created_by: user.id,
          mentions: input.mentions ?? [],
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: commentsKey(input.taskId) });
    },
  });
}
