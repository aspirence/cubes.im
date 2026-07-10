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

/** Query key for the active team's cross-project task list. */
export const allTeamTasksKey = (teamId: string | undefined) =>
  [ALL_TASKS_ROOT, "list", teamId] as const;

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
export function useAllTeamTasks() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: allTeamTasksKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamTaskWithProject[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(ALL_TASKS_SELECT)
        .eq("project.team_id", teamId as string)
        .is("parent_task_id", null)
        .eq("archived", false)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as TeamTaskWithProject[];
    },
  });
}
