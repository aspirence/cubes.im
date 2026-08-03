"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveTeam } from "@/features/teams/use-teams";
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

const ownedTaskIdsKey = (teamId: string | undefined) =>
  ["social-studio", "owned-task-ids", teamId] as const;

/**
 * The tasks Social Studio actually owns.
 *
 * Being in a project that has Social Studio added does NOT make a task social —
 * a marketing project holds logo work and numerology copy too, and putting all
 * of it on the posting calendar buries the posting. A task is social when this
 * app put it there:
 *
 *   * a routine generated it, or
 *   * a post points at it (the task picker on the post form).
 *
 * That also gives an obvious way to adopt an existing task: link it to a post.
 */
export function useSocialOwnedTaskIds() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: ownedTaskIdsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Set<string>> => {
      const ids = new Set<string>();

      const { data: postRows, error: postErr } = await supabase
        .from("app_social_studio_posts")
        .select("task_id")
        .eq("team_id", teamId as string)
        .not("task_id", "is", null);
      if (postErr) throw postErr;
      for (const r of postRows ?? []) if (r.task_id) ids.add(r.task_id);

      // Routines are a later migration than the calendar. Until it lands the
      // table is simply absent, which is not a state worth breaking the whole
      // calendar over — the post-linked half still answers the question.
      const { data: routineRows, error: routineErr } = await supabase
        .from("app_social_studio_routine_tasks")
        .select("task_id")
        .eq("team_id", teamId as string);
      if (!routineErr) {
        for (const r of routineRows ?? []) ids.add(r.task_id);
      }

      return ids;
    },
  });
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
