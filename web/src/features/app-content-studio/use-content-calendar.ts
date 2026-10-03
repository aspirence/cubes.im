"use client";

import { useMemo } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  ["content-studio", "owned-task-ids", teamId] as const;

/**
 * The tasks Content Studio actually owns.
 *
 * Being in a project that has Content Studio added does NOT make a task social —
 * a marketing project holds logo work and numerology copy too, and putting all
 * of it on the posting calendar buries the posting. A task is social when this
 * app put it there:
 *
 *   * a routine generated it,
 *   * a post points at it (the task picker on the post form), or
 *   * someone created it from Content Studio's own "New task" (or, later,
 *     adopted it from the All-tasks scope) — the receipt table
 *     app_content_studio_tasks, migration 20261149000000.
 *
 * That also gives two obvious ways to adopt an existing task: link it to a
 * post, or (follow-up) add it from the calendar.
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
        .from("app_content_studio_items")
        .select("task_id")
        .eq("team_id", teamId as string)
        .not("task_id", "is", null);
      if (postErr) throw postErr;
      for (const r of postRows ?? []) if (r.task_id) ids.add(r.task_id);

      // Routines are a later migration than the calendar. Until it lands the
      // table is simply absent, which is not a state worth breaking the whole
      // calendar over — the post-linked half still answers the question.
      const { data: routineRows, error: routineErr } = await supabase
        .from("app_content_studio_routine_tasks")
        .select("task_id")
        .eq("team_id", teamId as string);
      if (!routineErr) {
        for (const r of routineRows ?? []) ids.add(r.task_id);
      }

      // Hand-made receipts (migration 20261149000000). Same tolerance as above:
      // prod renders the calendar before the migration lands there.
      const { data: ownRows, error: ownErr } = await supabase
        .from("app_content_studio_tasks")
        .select("task_id")
        .eq("team_id", teamId as string);
      if (!ownErr) {
        for (const r of ownRows ?? []) ids.add(r.task_id);
      }

      return ids;
    },
  });
}

/**
 * Files the receipt that makes a task Content Studio's. Idempotent: the table
 * is keyed by task_id and the upsert is ON CONFLICT DO NOTHING, so a retry or a
 * later "adopt" of an already-owned task is a no-op, and no UPDATE grant is
 * needed. Invalidates the owned-ids set and the calendar's task window so the
 * chip appears without a reload (useCreateTask only invalidates the tasks
 * list, which this calendar does not read).
 */
export function useAdoptContentTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: { taskId: string; source: "created" | "adopted" }) => {
      if (!teamId) throw new Error("No active team.");
      const { error } = await supabase
        .from("app_content_studio_tasks")
        .upsert(
          { task_id: input.taskId, team_id: teamId, source: input.source },
          { onConflict: "task_id", ignoreDuplicates: true },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ownedTaskIdsKey(teamId) });
    },
    // The task exists whether or not the receipt was written, and the
    // calendar's window is cached (the modal's own invalidations touch only
    // the tasks lists), so the window refetches on failure too — otherwise
    // "switch to All tasks" would show nothing until a reload.
    onSettled: () => {
      // A prefix of calendarTasksKey: every month window refetches.
      queryClient.invalidateQueries({ queryKey: ["content-studio", "calendar-tasks"] });
    },
  });
}

const calendarTasksKey = (
  projectIds: string[],
  from: string | undefined,
  to: string | undefined,
) => ["content-studio", "calendar-tasks", [...projectIds].sort(), from, to] as const;

/**
 * Tasks due inside [from, to] across the projects Content Studio is activated
 * for.
 *
 * "Which tasks are social" is answered by the app's own activation scope
 * (`useAppActivatedProjects("content_studio")` in features/apps-platform/
 * app-scope.ts) rather than by a flag on the task — the team already decides
 * that when they add Content Studio to a project, and a second place to say it
 * would only be a second place to get it wrong.
 *
 * Filtered on `end_date` because that is the date every other calendar in the
 * product puts a task on (see features/schedule/use-schedule-tasks.ts) — a task
 * that showed up on a different day here than on /schedule would be worse than
 * not showing it at all. The window is the grid's own LOCAL instants, so a task
 * due at local midnight on the grid's first day (stored the evening before in
 * UTC for a team east of Greenwich) is fetched and lands on that cell.
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
        .gte("end_date", dayjs(from as string).startOf("day").toISOString())
        .lte("end_date", dayjs(to as string).endOf("day").toISOString())
        .order("end_date", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as SocialCalendarTask[];
    },
  });
}

/**
 * Day key a calendar cell is bucketed under. LOCAL day, like the grid and like
 * /schedule — slicing the ISO string took the UTC date, which put a task due
 * at IST midnight (stored 18:30Z the evening before) on the previous cell.
 */
export function dayKey(value: string): string {
  return dayjs(value).format("YYYY-MM-DD");
}
