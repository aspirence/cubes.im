"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type ActivityLogRow =
  Database["public"]["Tables"]["task_activity_logs"]["Row"];

/** A task activity log row with the embedded actor (the user who acted). */
export type TaskActivity = ActivityLogRow & {
  user: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
};

/** Build a human sentence describing one activity entry (shared by the task
 * drawer and the project Activity feed). */
export function describeActivity(entry: {
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
}): string {
  const from = entry.old_value?.trim();
  const to = entry.new_value?.trim();
  const field = entry.field?.trim();

  switch (entry.action) {
    case "created":
      return "created this task";
    case "completed":
      return "marked this task complete";
    case "assigned":
      return to ? `was assigned to ${to}` : "was assigned";
    case "unassigned":
      return to ? `unassigned ${to}` : "removed an assignee";
    case "renamed":
      return from && to
        ? `renamed it from “${from}” to “${to}”`
        : to
          ? `renamed it to “${to}”`
          : "renamed it";
    case "status_changed":
      return from && to
        ? `changed status from ${from} to ${to}`
        : to
          ? `changed status to ${to}`
          : "changed the status";
    case "priority_changed":
      return from && to
        ? `changed priority from ${from} to ${to}`
        : to
          ? `changed priority to ${to}`
          : "changed the priority";
    default: {
      const label = field ?? entry.action.replace(/_/g, " ");
      if (from && to) return `changed ${label} from ${from} to ${to}`;
      if (to) return `changed ${label} to ${to}`;
      return `updated ${label}`;
    }
  }
}

/** Material glyph + tint for an activity action, for the feed's leading icon. */
export function activityGlyph(action: string): { icon: string; color: string } {
  switch (action) {
    case "created":
      return { icon: "add_circle", color: "#3d7de0" };
    case "completed":
      return { icon: "check_circle", color: "#2f8f5f" };
    case "assigned":
    case "unassigned":
      return { icon: "person", color: "#7c6cf0" };
    case "status_changed":
      return { icon: "swap_horiz", color: "#c98a1b" };
    case "priority_changed":
      return { icon: "flag", color: "#c0453c" };
    case "renamed":
      return { icon: "edit", color: "#6a6d78" };
    default:
      return { icon: "bolt", color: "#6a6d78" };
  }
}

const taskActivityKey = (taskId: string | undefined) =>
  ["activity", "task", taskId] as const;

const projectActivityKey = (projectId: string | undefined) =>
  ["activity", "project", projectId] as const;

/** A project activity row: a log entry with actor + the task it happened on. */
export type ProjectActivity = ActivityLogRow & {
  user: { id: string; name: string; avatar_url: string | null } | null;
  task: { id: string; name: string; task_no: number | null } | null;
};

/**
 * Lists the activity log for an ENTIRE project (every task), newest first, with
 * the actor and the task embedded. Project members can read all rows (see the
 * 20261036 policy). Capped so a busy project's feed stays snappy.
 */
export function useProjectActivity(projectId: string | undefined, limit = 150) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: [...projectActivityKey(projectId), limit] as const,
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectActivity[]> => {
      const { data, error } = await supabase
        .from("task_activity_logs")
        .select(
          "id, task_id, project_id, action, field, old_value, new_value, created_at, user_id, user:users(id, name, avatar_url), task:tasks(id, name, task_no)",
        )
        .eq("project_id", projectId as string)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as ProjectActivity[];
    },
  });
}

/**
 * Lists the activity log for a task, newest first, embedding the actor
 * (name/avatar). Disabled until `taskId` is provided. RLS scopes rows to task
 * members.
 */
export function useTaskActivity(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: taskActivityKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskActivity[]> => {
      const { data, error } = await supabase
        .from("task_activity_logs")
        .select(
          "id, task_id, project_id, action, field, old_value, new_value, created_at, user_id, user:users(id, name, avatar_url)",
        )
        .eq("task_id", taskId as string)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as TaskActivity[];
    },
  });
}
