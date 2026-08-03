"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** A task landing inside the calendar window, with what a day cell needs. */
export interface SocialCalendarTask {
  id: string;
  name: string;
  task_no: number | null;
  end_date: string;
  start_date: string | null;
  done: boolean;
  parent_task_id: string | null;
  project_id: string;
  project: { id: string; name: string; color_code: string | null } | null;
  status: { id: string; name: string } | null;
  assignees: { team_member_id: string }[];
}

const calendarTasksKey = (
  projectIds: string[],
  from: string | undefined,
  to: string | undefined,
) => ["social-studio", "calendar-tasks", [...projectIds].sort(), from, to] as const;

/**
 * Tasks due inside [from, to] across the projects Social Studio is activated
 * for.
 *
 * "Which tasks are social" is answered by the app's own activation scope
 * (`useAppActivatedProjects("social_studio")` in features/apps-platform/
 * app-scope.ts) rather than by a flag on the task — the team already decides
 * that when they add Social Studio to a project, and a second place to say it
 * would only be a second place to get it wrong.
 *
 * Filtered on `end_date` because that is the date every other calendar in the
 * product puts a task on (see features/schedule/use-schedule-tasks.ts) — a task
 * that showed up on a different day here than on /schedule would be worse than
 * not showing it at all.
 */
export function useSocialCalendarTasks(
  projectIds: string[],
  from: string | undefined,
  to: string | undefined,
) {
  const supabase = useMemo(() => createClient(), []);
  // Sorted + joined so a re-ordered array doesn't refetch, and so the key is
  // stable across renders.
  const key = useMemo(
    () => calendarTasksKey(projectIds, from, to),
    [projectIds, from, to],
  );

  return useQuery({
    queryKey: key,
    // No projects activated means no query to run — and an empty `in()` filter
    // would ask PostgREST for "in ()", which is a syntax error rather than an
    // empty result.
    enabled: Boolean(from && to) && projectIds.length > 0,
    queryFn: async (): Promise<SocialCalendarTask[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          `id, name, task_no, end_date, start_date, done, parent_task_id, project_id,
           project:projects!tasks_project_id_fk ( id, name, color_code ),
           status:task_statuses!tasks_status_id_fk ( id, name ),
           assignees:tasks_assignees!tasks_assignees_task_id_fk ( team_member_id )`,
        )
        .in("project_id", projectIds)
        .eq("archived", false)
        .not("end_date", "is", null)
        .gte("end_date", from as string)
        .lte("end_date", `${to as string}T23:59:59.999Z`)
        .order("end_date", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as SocialCalendarTask[];
    },
  });
}

/** Day key a calendar cell is bucketed under. Local time, like the grid. */
export function dayKey(value: string): string {
  return value.slice(0, 10);
}
