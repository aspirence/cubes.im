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

/** A row from the `get_my_tasks` RPC: the current user's assigned, not-done tasks. */
export type MyTask = Database["public"]["Functions"]["get_my_tasks"]["Returns"][number];

/** A personal to-do row scoped to the current user. */
export type PersonalTodo = Database["public"]["Tables"]["personal_todo_list"]["Row"];
export type PersonalTodoInsert =
  Database["public"]["Tables"]["personal_todo_list"]["Insert"];
export type PersonalTodoUpdate =
  Database["public"]["Tables"]["personal_todo_list"]["Update"];

const HOME_ROOT = "home" as const;

export const myTasksKey = [HOME_ROOT, "my-tasks"] as const;
const todosKey = [HOME_ROOT, "todos"] as const;
const recentProjectsKey = (teamId: string | undefined) =>
  [HOME_ROOT, "recent-projects", teamId] as const;
const activityFeedKey = (teamId: string | undefined) =>
  [HOME_ROOT, "activity", teamId] as const;

/**
 * The current user's assigned, not-done tasks across all teams via the
 * `get_my_tasks` RPC (returns task_id, name, project_id, project_name,
 * status_name, priority, end_date).
 */
export function useMyTasks() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: myTasksKey,
    queryFn: async (): Promise<MyTask[]> => {
      const { data, error } = await supabase.rpc("get_my_tasks");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Editable fields for the My Tasks rows (get_my_tasks only returns names). */
export interface MyTaskEdit {
  id: string;
  status_id: string | null;
  priority_id: string | null;
  start_date: string | null;
  end_date: string | null;
  task_no: number | null;
}

/**
 * Fetches the editable fields (status_id / priority_id / dates / task_no) for a
 * set of task ids — the My Tasks screen needs these to drive inline status /
 * priority / due-date controls that `get_my_tasks` doesn't expose. RLS lets a
 * project member read the row, and the caller is assigned to each task.
 */
export function useMyTaskEdits(taskIds: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const ids = useMemo(() => [...new Set(taskIds)].sort(), [taskIds]);
  return useQuery({
    queryKey: [HOME_ROOT, "my-task-edits", ids.join(",")] as const,
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, MyTaskEdit>> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status_id, priority_id, start_date, end_date, task_no")
        .in("id", ids);
      if (error) throw error;
      const map: Record<string, MyTaskEdit> = {};
      for (const r of (data ?? []) as MyTaskEdit[]) map[r.id] = r;
      return map;
    },
  });
}

const MY_TASK_STATUS_SELECT = `
  id, project_id, name, sort_order, category_id,
  category:sys_task_status_categories!task_statuses_category_id_fk (
    id, name, color_code, is_todo, is_doing, is_done
  )
`;

export interface MyTaskStatusOption {
  id: string;
  project_id: string;
  name: string;
  sort_order: number | null;
  color: string | null;
  isDone: boolean;
  /** Active stage — tasks here can run a timer. */
  isDoing: boolean;
}

/**
 * Task-status options grouped by project, for every project the My Tasks list
 * spans — so each row's status dropdown shows that project's own statuses with
 * their category colour.
 */
export function useMyTaskStatuses(projectIds: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const ids = useMemo(() => [...new Set(projectIds)].sort(), [projectIds]);
  return useQuery({
    queryKey: [HOME_ROOT, "my-task-statuses", ids.join(",")] as const,
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, MyTaskStatusOption[]>> => {
      const { data, error } = await supabase
        .from("task_statuses")
        .select(MY_TASK_STATUS_SELECT)
        .in("project_id", ids)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        id: string;
        project_id: string;
        name: string;
        sort_order: number | null;
        category: {
          color_code: string | null;
          is_done: boolean | null;
          is_doing: boolean | null;
        } | null;
      }>;
      const map: Record<string, MyTaskStatusOption[]> = {};
      for (const r of rows) {
        (map[r.project_id] ??= []).push({
          id: r.id,
          project_id: r.project_id,
          name: r.name,
          sort_order: r.sort_order,
          color: r.category?.color_code ?? null,
          isDone: Boolean(r.category?.is_done),
          isDoing: Boolean(r.category?.is_doing),
        });
      }
      return map;
    },
  });
}

/**
 * Lists the current user's personal to-do items ordered by `index`. RLS scopes
 * the rows to the caller.
 */
export function usePersonalTodos() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: todosKey,
    queryFn: async (): Promise<PersonalTodo[]> => {
      const { data, error } = await supabase
        .from("personal_todo_list")
        .select("*")
        .order("index", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CreateTodoInput {
  name: string;
  description?: string | null;
  color_code?: string | null;
  index?: number;
}

/** Creates a personal to-do row for the current user. */
export function useCreateTodo() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTodoInput): Promise<PersonalTodo> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const insert: PersonalTodoInsert = {
        user_id: user.id,
        name: input.name,
        description: input.description ?? null,
        color_code: input.color_code ?? null,
        ...(input.index !== undefined ? { index: input.index } : {}),
      };

      const { data, error } = await supabase
        .from("personal_todo_list")
        .insert(insert)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todosKey });
    },
  });
}

export interface UpdateTodoInput extends PersonalTodoUpdate {
  id: string;
}

/** Updates a personal to-do row (name/done/color/index/description). */
export function useUpdateTodo() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateTodoInput): Promise<PersonalTodo> => {
      const { id, ...rest } = input;
      const { data, error } = await supabase
        .from("personal_todo_list")
        .update(rest)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todosKey });
    },
  });
}

/** Deletes a personal to-do row by id. */
export function useDeleteTodo() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("personal_todo_list")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todosKey });
    },
  });
}

/** A recently-updated project for the home dashboard. */
export type RecentProject = Pick<
  Database["public"]["Tables"]["projects"]["Row"],
  "id" | "name" | "color_code" | "updated_at" | "team_id"
>;

const RECENT_PROJECTS_LIMIT = 6;

/**
 * The active team's most recently updated projects (limit 6), ordered by
 * `updated_at` descending. RLS scopes the rows to projects the user can see.
 */
export function useRecentProjects() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: recentProjectsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<RecentProject[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, color_code, updated_at, team_id")
        .eq("team_id", teamId as string)
        .order("updated_at", { ascending: false })
        .limit(RECENT_PROJECTS_LIMIT);

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** A recent task comment annotated with its author and task/project context. */
export interface ActivityFeedItem {
  id: string;
  content: string;
  created_at: string;
  task_id: string;
  task_name: string | null;
  project_id: string | null;
  author: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
}

const ACTIVITY_FEED_LIMIT = 15;

/**
 * Recent task comments across the active team's projects (newest first, ~15),
 * each annotated with the comment author and the parent task name/project.
 * RLS scopes comments to tasks the user can access.
 */
export function useActivityFeed() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: activityFeedKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ActivityFeedItem[]> => {
      const { data, error } = await supabase
        .from("task_comments")
        .select(
          `
          id,
          content,
          created_at,
          task_id,
          author:users!task_comments_created_by_fk ( id, name, avatar_url ),
          task:tasks!task_comments_task_id_fk (
            id,
            name,
            project_id,
            project:projects!tasks_project_id_fk ( id, team_id )
          )
        `,
        )
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_FEED_LIMIT * 3);

      if (error) throw error;

      type Row = {
        id: string;
        content: string;
        created_at: string;
        task_id: string;
        author: { id: string; name: string; avatar_url: string | null } | null;
        task: {
          id: string;
          name: string | null;
          project_id: string | null;
          project: { id: string; team_id: string } | null;
        } | null;
      };

      const rows = (data ?? []) as unknown as Row[];

      return rows
        .filter((r) => r.task?.project?.team_id === teamId)
        .slice(0, ACTIVITY_FEED_LIMIT)
        .map((r) => ({
          id: r.id,
          content: r.content,
          created_at: r.created_at,
          task_id: r.task_id,
          task_name: r.task?.name ?? null,
          project_id: r.task?.project_id ?? null,
          author: r.author,
        }));
    },
  });
}
