"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type SocialRoutineRow =
  Database["public"]["Tables"]["app_social_studio_routines"]["Row"];
export type SocialRoutineStepRow =
  Database["public"]["Tables"]["app_social_studio_routine_steps"]["Row"];

export type SocialRoutineWithSteps = SocialRoutineRow & {
  steps: SocialRoutineStepRow[];
};

export type SocialScheduleType = "daily" | "weekly" | "monthly";
export type SocialStepKind = "creation" | "publish" | "generic";

const routinesKey = (teamId: string | undefined) =>
  ["social-studio", "routines", teamId] as const;

/** Every routine in the active team, newest first, with its steps in order. */
export function useSocialRoutines() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: routinesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SocialRoutineWithSteps[]> => {
      const { data, error } = await supabase
        .from("app_social_studio_routines")
        .select(
          `*, steps:app_social_studio_routine_steps (
             id, routine_id, team_id, position, title, platform,
             assignee_team_member_id, due_offset_days, depends_on_step_id, kind
           )`,
        )
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as SocialRoutineWithSteps;
        return {
          ...row,
          steps: [...(row.steps ?? [])].sort(
            (a, b) => a.position - b.position || a.title.localeCompare(b.title),
          ),
        };
      });
    },
  });
}

export interface SocialRoutineInput {
  name: string;
  projectId: string;
  campaignId?: string | null;
  description?: string | null;
  scheduleType: SocialScheduleType;
  intervalValue: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  startsOn: string;
  endsOn?: string | null;
  active?: boolean;
}

export interface SocialRoutineStepInput {
  /** Present when editing an existing step; absent creates one. */
  id?: string;
  title: string;
  platform?: string | null;
  assigneeTeamMemberId?: string | null;
  dueOffsetDays: number;
  /** Index into the step list this one waits on, or null. */
  dependsOnIndex?: number | null;
  kind?: SocialStepKind;
}

/**
 * Creates or updates a routine together with its whole step list.
 *
 * Steps are saved as a SET rather than one at a time because
 * `depends_on_step_id` points between them: saving them piecemeal means a step
 * can briefly reference one that does not exist yet, and a half-saved blueprint
 * would materialise as a half-built task tree on the next cron tick.
 *
 * Dependencies are declared by INDEX from the client (a step it waits on may
 * not have an id yet) and resolved to real ids here, once every row exists.
 */
export function useSaveSocialRoutine() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      /** Absent creates a new routine. */
      id?: string;
      routine: SocialRoutineInput;
      steps: SocialRoutineStepInput[];
    }): Promise<string> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const payload = {
        team_id: teamId,
        project_id: input.routine.projectId,
        campaign_id: input.routine.campaignId ?? null,
        name: input.routine.name,
        description: input.routine.description ?? null,
        schedule_type: input.routine.scheduleType,
        interval_value: input.routine.intervalValue,
        day_of_week: input.routine.dayOfWeek ?? null,
        day_of_month: input.routine.dayOfMonth ?? null,
        starts_on: input.routine.startsOn,
        ends_on: input.routine.endsOn ?? null,
        active: input.routine.active ?? true,
      };

      let routineId = input.id;
      if (routineId) {
        const { data, error } = await supabase
          .from("app_social_studio_routines")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", routineId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        // A zero-row update is not an error to PostgREST, so without this a
        // refused write would read as a save.
        if (!data) throw new Error("That routine could not be updated.");
      } else {
        const { data, error } = await supabase
          .from("app_social_studio_routines")
          .insert({
            ...payload,
            created_by: user?.id ?? null,
            // First occurrence is the start date itself.
            next_run_at: dayjs(input.routine.startsOn).startOf("day").toISOString(),
          })
          .select("id")
          .single();
        if (error) throw error;
        routineId = data.id;
      }

      // Replace the step set wholesale. Simpler than diffing, and the receipts
      // in app_social_studio_routine_tasks keep pointing at the tasks already
      // generated (that FK is ON DELETE SET NULL) so no history is lost.
      const { error: delErr } = await supabase
        .from("app_social_studio_routine_steps")
        .delete()
        .eq("routine_id", routineId);
      if (delErr) throw delErr;

      if (input.steps.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from("app_social_studio_routine_steps")
          .insert(
            input.steps.map((s, index) => ({
              routine_id: routineId as string,
              team_id: teamId,
              position: index,
              title: s.title,
              platform: s.platform ?? null,
              assignee_team_member_id: s.assigneeTeamMemberId ?? null,
              due_offset_days: s.dueOffsetDays,
              kind: s.kind ?? "generic",
            })),
          )
          .select("id, position");
        if (insErr) throw insErr;

        // Now that every step has an id, wire the dependencies by index.
        const byPosition = new Map<number, string>();
        for (const row of inserted ?? []) byPosition.set(row.position, row.id);

        const links = input.steps
          .map((s, index) => ({ s, index }))
          .filter(
            ({ s, index }) =>
              s.dependsOnIndex !== null &&
              s.dependsOnIndex !== undefined &&
              s.dependsOnIndex !== index,
          );

        for (const { s, index } of links) {
          const self = byPosition.get(index);
          const dep = byPosition.get(s.dependsOnIndex as number);
          if (!self || !dep) continue;
          const { error } = await supabase
            .from("app_social_studio_routine_steps")
            .update({ depends_on_step_id: dep })
            .eq("id", self);
          if (error) throw error;
        }
      }

      return routineId as string;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: routinesKey(teamId) }),
  });
}

/** Pause or resume a series without losing its blueprint. */
export function useSetSocialRoutineActive() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }) => {
      const { data, error } = await supabase
        .from("app_social_studio_routines")
        .update({ active: input.active, updated_at: new Date().toISOString() })
        .eq("id", input.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("That routine could not be updated.");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: routinesKey(teamId) }),
  });
}

/**
 * Deletes a routine and its blueprint.
 *
 * Tasks it already generated are LEFT ALONE — they are real work, some of it
 * done, and deleting a schedule is not a request to erase the history it
 * produced. The receipt rows go with the routine (ON DELETE CASCADE), so the
 * tasks simply stop being attributed to a series that no longer exists.
 */
export function useDeleteSocialRoutine() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_social_studio_routines")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: routinesKey(teamId) }),
  });
}

/**
 * The next `count` dates a cadence would fire on.
 *
 * Mirrors `social_studio_next_occurrence()` in migration 20261119000000 so the
 * editor can show what it is about to schedule BEFORE anything is saved. The
 * two must agree; if the SQL changes, this changes with it.
 */
export function previewOccurrences(
  routine: Pick<
    SocialRoutineInput,
    "scheduleType" | "intervalValue" | "dayOfWeek" | "dayOfMonth" | "startsOn" | "endsOn"
  >,
  count = 3,
): string[] {
  const out: string[] = [];
  const interval = Math.max(1, routine.intervalValue);
  let d = dayjs(routine.startsOn).startOf("day");
  const end = routine.endsOn ? dayjs(routine.endsOn).endOf("day") : null;

  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      if (routine.scheduleType === "daily") {
        d = d.add(interval, "day");
      } else if (routine.scheduleType === "weekly") {
        d = d.add(interval, "week");
        if (routine.dayOfWeek !== null && routine.dayOfWeek !== undefined) {
          d = d.add(((routine.dayOfWeek - d.day()) + 7) % 7, "day");
        }
      } else {
        d = d.add(interval, "month");
        if (routine.dayOfMonth !== null && routine.dayOfMonth !== undefined) {
          // Clamp so day 31 still lands in February rather than skipping it.
          d = d.date(Math.min(routine.dayOfMonth, d.daysInMonth()));
        }
      }
    }
    if (end && d.isAfter(end)) break;
    out.push(d.format("YYYY-MM-DD"));
  }
  return out;
}
