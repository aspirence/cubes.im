"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

/** A task due inside the calendar window, with its project + assignees. */
export interface ScheduleTask {
  id: string;
  name: string;
  end_date: string;
  project_id: string;
  project: { id: string; name: string; color_code: string | null } | null;
  assignees: { team_member_id: string }[];
}

const scheduleTasksKey = (
  teamId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) => ["schedule-tasks", teamId, from, to] as const;

/**
 * Tasks with a due date inside [from, to] across the active team's projects
 * (RLS trims to projects the caller can see). Backs the Schedule calendar's
 * task chips; assignees let the member filter narrow to one person's calendar.
 */
export function useScheduleTasks(
  from: string | undefined,
  to: string | undefined,
) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: scheduleTasksKey(teamId, from, to),
    enabled: Boolean(teamId && from && to),
    queryFn: async (): Promise<ScheduleTask[]> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          `id, name, end_date, project_id,
           project:projects!tasks_project_id_fk ( id, name, color_code, team_id ),
           assignees:tasks_assignees!tasks_assignees_task_id_fk ( team_member_id )`,
        )
        .gte("end_date", from as string)
        .lte("end_date", `${to as string}T23:59:59.999Z`)
        .order("end_date", { ascending: true })
        .limit(500);
      if (error) throw error;
      // Trim to the active team (RLS already scopes to visible projects, but a
      // user can belong to several teams; the calendar shows the active one).
      return (data ?? [])
        .filter(
          (t) =>
            (t.project as { team_id?: string } | null)?.team_id === teamId,
        )
        .map((t) => ({
          id: t.id,
          name: t.name,
          end_date: t.end_date as string,
          project_id: t.project_id,
          project: t.project,
          assignees: t.assignees ?? [],
        }));
    },
  });
}
