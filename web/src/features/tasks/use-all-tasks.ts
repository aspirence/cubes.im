"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type {
  Task,
  TaskPriorityEmbed,
  TaskAssigneeEmbed,
} from "@/features/tasks/use-tasks";

/** The project a team task belongs to, embedded for cross-project display. */
export interface TaskProjectEmbed {
  id: string;
  name: string;
  color_code: string;
  team_id: string;
}

/**
 * A status lookup embed for the all-tasks view. Unlike `useTasks` (which embeds
 * only `category_id`), this pulls the global status category through so the
 * grouped view can colour/label groups without a per-project statuses fetch.
 */
export interface AllTaskStatusEmbed {
  id: string;
  name: string;
  category_id: string;
  sort_order: number;
  category: {
    id: string;
    name: string;
    color_code: string;
    sort_order: number;
    is_todo: boolean;
    is_doing: boolean;
    is_done: boolean;
  } | null;
}

/**
 * A task row annotated with its owning project plus status (with category),
 * priority, and assignees embeds — enough to render the grouped all-tasks list.
 */
export type TeamTaskWithProject = Task & {
  project: TaskProjectEmbed;
  status: AllTaskStatusEmbed | null;
  priority: TaskPriorityEmbed | null;
  assignees: TaskAssigneeEmbed[];
};

const ALL_TASKS_ROOT = "all-team-tasks" as const;

/**
 * Rows per request. This is PostgREST's own ceiling (`db-max-rows`), measured
 * against this project: a plain select of 1534 matching rows comes back with
 * exactly 1000 and a `content-range: 0-999/1534`, and an explicit wider Range
 * header does not change it.
 */
const PAGE_SIZE = 1000;

/**
 * Query key for the active team's cross-project task list.
 *
 * `includeSubtasks` is part of the key because the two populations are
 * different lists, not the same list filtered — caching them together would
 * hand whichever caller asked second the other one's rows. Invalidating the
 * shorter `[root, "list", teamId]` prefix still clears both, which is what the
 * All Tasks page and the notification listener rely on.
 */
export const allTeamTasksKey = (
  teamId: string | undefined,
  includeSubtasks = false,
) => [ALL_TASKS_ROOT, "list", teamId, includeSubtasks] as const;

/**
 * The embed select. The `project:projects!inner(...)` embed is an INNER join so
 * the `.eq('project.team_id', ...)` filter scopes rows to the active team. The
 * status/priority/assignees embeds mirror the FK aliases used by
 * `useTasks` (`TASK_SELECT`) so the resulting shapes line up, with the status
 * category additionally pulled through for client-side grouping.
 */
const ALL_TASKS_SELECT = `
  *,
  project:projects!tasks_project_id_fk!inner ( id, name, color_code, team_id ),
  status:task_statuses!tasks_status_id_fk (
    id, name, category_id, sort_order,
    category:sys_task_status_categories!task_statuses_category_id_fk (
      id, name, color_code, sort_order, is_todo, is_doing, is_done
    )
  ),
  priority:task_priorities!tasks_priority_id_fk ( id, name, color_code, value ),
  assignees:tasks_assignees!tasks_assignees_task_id_fk (
    team_member_id,
    team_member:team_members!tasks_assignees_team_member_id_fk (
      id,
      user:users!team_members_user_id_fk ( id, name, avatar_url )
    )
  )
`;

/**
 * Lists every top-level (parent_task_id IS NULL), non-archived task across the
 * active team's projects, each annotated with its owning project and the
 * status/priority/assignees embeds. RLS already scopes to the caller's team(s);
 * the inner-join `project.team_id` filter additionally pins the result to the
 * active team when the caller belongs to more than one.
 *
 * Group in the UI by reading each row's `status`/`status.category`.
 */
export function useAllTeamTasks(options?: { includeSubtasks?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const includeSubtasks = options?.includeSubtasks ?? false;

  return useQuery({
    queryKey: allTeamTasksKey(teamId, includeSubtasks),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamTaskWithProject[]> => {
      const rows: TeamTaskWithProject[] = [];

      // PostgREST answers at most PAGE_SIZE rows and says nothing about it —
      // no error, no flag, just a short array. Asking for a wider Range does
      // not raise the ceiling; it is the server's limit, not the request's. So
      // every caller has to page, or the dashboard quietly counts a prefix of
      // the team's work and reports it as the whole.
      //
      // `sort_order` alone is not a total order — ties are common — and a
      // page boundary inside a tie can drop or repeat rows. `id` breaks the
      // tie so the sequence is stable across requests.
      for (let from = 0; ; from += PAGE_SIZE) {
        let query = supabase
          .from("tasks")
          .select(ALL_TASKS_SELECT)
          .eq("project.team_id", teamId as string)
          .eq("archived", false);
        // Views that show a task TREE (All Tasks, the chat picker) want parents
        // only — a subtask already appears nested under its parent there, so
        // flattening it in would list the same work twice. Views that COUNT work
        // want every row: a subtask sitting in review is a real item in the
        // queue, and leaving it out is why the Home tiles read lower than the
        // boards do.
        if (!includeSubtasks) query = query.is("parent_task_id", null);

        const { data, error } = await query
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const page = (data ?? []) as unknown as TeamTaskWithProject[];
        rows.push(...page);
        // A short page is the only honest end-of-data signal here.
        if (page.length < PAGE_SIZE) break;
      }

      return rows;
    },
  });
}
