"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/client";
import { browserTimezone } from "@/features/recurring/use-recurring";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type SocialRoutineRow =
  Database["public"]["Tables"]["app_content_studio_routines"]["Row"];
export type SocialRoutineStepRow =
  Database["public"]["Tables"]["app_content_studio_routine_steps"]["Row"];

export type SocialRoutineWithSteps = SocialRoutineRow & {
  steps: SocialRoutineStepRow[];
};

export type SocialScheduleType = "daily" | "weekly" | "monthly";
export type SocialStepKind = "creation" | "publish" | "generic";

const routinesKey = (teamId: string | undefined) =>
  ["content-studio", "routines", teamId] as const;

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
        .from("app_content_studio_routines")
        .select(
          `*, steps:app_content_studio_routine_steps (
             id, routine_id, team_id, position, title, platform,
             assignee_team_member_id, start_offset_days, due_offset_days,
             depends_on_step_id, kind, description, reference_url
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
  /** Assigned to each occurrence's parent task. team_members ids. */
  assigneeTeamMemberIds?: string[];
  /** Labels on each occurrence's parent task. team_labels ids. */
  labelIds?: string[];
}

export interface SocialRoutineStepInput {
  /** Present when editing an existing step; absent creates one. */
  id?: string;
  title: string;
  platform?: string | null;
  assigneeTeamMemberId?: string | null;
  /** Days after the occurrence the subtask starts; null = the day it is due. */
  startOffsetDays?: number | null;
  dueOffsetDays: number;
  /** The subtask's own instructions. */
  description?: string | null;
  /** Lands on the subtask as a reference link. */
  referenceUrl?: string | null;
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
        // The zone the dates above were picked in — the materializer makes the
        // tasks due at local midnight in it (20261126000000, WHOSE DAY).
        timezone: browserTimezone(),
        assignee_team_member_ids: input.routine.assigneeTeamMemberIds ?? [],
        label_ids: input.routine.labelIds ?? [],
      };
      // UTC midnight of the chosen calendar date — see the note on the insert.
      const anchor = `${input.routine.startsOn}T00:00:00.000Z`;

      let routineId = input.id;
      if (routineId) {
        const { data, error } = await supabase
          .from("app_content_studio_routines")
          .update({
            ...payload,
            // `active` is deliberately NOT here. Pause/resume has its own hook;
            // an edit that also wrote active=true silently resumed any paused
            // routine the moment someone corrected a typo in its name.
            //
            // Re-anchor the schedule. A changed start date or cadence used to be
            // ignored until the previously booked date came round, and could
            // even produce a task dated before the new start. Clearing
            // last_run_at makes the materializer re-derive the first date from
            // starts_on; the receipts keep today's occurrence from being made
            // twice if it already exists.
            next_run_at: anchor,
            last_run_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", routineId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        // A zero-row update is not an error to PostgREST, so without this a
        // refused write would read as a save.
        if (!data) throw new Error("That routine could not be updated.");
      } else {
        const { data, error } = await supabase
          .from("app_content_studio_routines")
          .insert({
            ...payload,
            active: input.routine.active ?? true,
            created_by: user?.id ?? null,
            // UTC midnight of the chosen calendar date. NOT dayjs().startOf("day"):
            // that is the browser's local midnight, which for anyone east of UTC
            // is the previous day once Postgres casts it to a date, and it shifted
            // every series a day early. The SQL now derives the first date from
            // starts_on regardless; this keeps the two in agreement.
            next_run_at: anchor,
          })
          .select("id")
          .single();
        if (error) throw error;
        routineId = data.id;
      }

      // Replace the step set wholesale. Simpler than diffing, and the receipts
      // in app_content_studio_routine_tasks keep pointing at the tasks already
      // generated (that FK is ON DELETE SET NULL) so no history is lost.
      const { error: delErr } = await supabase
        .from("app_content_studio_routine_steps")
        .delete()
        .eq("routine_id", routineId);
      if (delErr) throw delErr;

      if (input.steps.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from("app_content_studio_routine_steps")
          .insert(
            input.steps.map((s, index) => ({
              routine_id: routineId as string,
              team_id: teamId,
              position: index,
              title: s.title,
              platform: s.platform ?? null,
              assignee_team_member_id: s.assigneeTeamMemberId ?? null,
              // Only when it differs from the due day: null keeps "same day" a
              // single fact instead of two numbers that can drift apart.
              start_offset_days:
                s.startOffsetDays === null ||
                s.startOffsetDays === undefined ||
                s.startOffsetDays === s.dueOffsetDays
                  ? null
                  : Math.min(s.startOffsetDays, s.dueOffsetDays),
              due_offset_days: s.dueOffsetDays,
              description: s.description?.trim() || null,
              reference_url: s.referenceUrl?.trim() || null,
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
            .from("app_content_studio_routine_steps")
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
        .from("app_content_studio_routines")
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
        .from("app_content_studio_routines")
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
 * Mirrors `content_studio_next_occurrence()` in migration 20261119000000 so the
 * editor can show what it is about to schedule BEFORE anything is saved. The
 * two must agree; if the SQL changes, this changes with it.
 */
/**
 * The TS twin of content_studio_first_occurrence() in migration 20261119000000.
 * Weekly: the first matching weekday on or after `from`. Monthly: that day this
 * month if it has not passed (clamped to the month's length), otherwise next
 * month's. Daily: `from` itself. Keep the two in agreement — the preview is the
 * only thing telling the user what the cron will actually produce.
 */
function alignFirstOccurrence(
  scheduleType: SocialScheduleType,
  dayOfWeek: number,
  dayOfMonth: number,
  from: dayjs.Dayjs,
): dayjs.Dayjs {
  if (scheduleType === "weekly") {
    return from.add(((dayOfWeek - from.day()) + 7) % 7, "day");
  }
  if (scheduleType === "monthly") {
    const thisMonth = Math.min(dayOfMonth, from.daysInMonth());
    if (from.date() <= thisMonth) return from.date(thisMonth);
    const next = from.add(1, "month").startOf("month");
    return next.date(Math.min(dayOfMonth, next.daysInMonth()));
  }
  return from;
}

export function previewOccurrences(
  routine: Pick<
    SocialRoutineInput,
    "scheduleType" | "intervalValue" | "dayOfWeek" | "dayOfMonth" | "startsOn" | "endsOn"
  >,
  count = 3,
): string[] {
  const out: string[] = [];
  const interval = Math.max(1, routine.intervalValue);
  const start = dayjs(routine.startsOn).startOf("day");
  // Same defaults the materializer applies: a weekly routine with no weekday
  // picked runs on the start date's weekday, a monthly one with no day on the
  // start date's day-of-month. Anchoring is what keeps "monthly from Jan 31"
  // from sliding to the 28th forever after February.
  const dayOfWeek = routine.dayOfWeek ?? start.day();
  const dayOfMonth = routine.dayOfMonth ?? start.date();
  // The twin of content_studio_next_occurrence().
  const step = (from: dayjs.Dayjs): dayjs.Dayjs => {
    if (routine.scheduleType === "daily") return from.add(interval, "day");
    if (routine.scheduleType === "weekly") {
      const w = from.add(interval, "week");
      return w.add(((dayOfWeek - w.day()) + 7) % 7, "day");
    }
    const m = from.add(interval, "month");
    // Clamp so day 31 still lands in February rather than skipping it.
    return m.date(Math.min(dayOfMonth, m.daysInMonth()));
  };
  // Mirrors the materializer (20261127000000): a series begins on the first
  // date on its schedule counted FROM starts_on, then walks forward past any
  // day already gone. Starting from today instead lost the phase — "every other
  // day from the 12th" would fire on the 19th rather than the 20th.
  const today = dayjs().startOf("day");
  let d = alignFirstOccurrence(routine.scheduleType, dayOfWeek, dayOfMonth, start);
  while (d.isBefore(today)) d = step(d);
  const end = routine.endsOn ? dayjs(routine.endsOn).endOf("day") : null;

  for (let i = 0; i < count; i += 1) {
    if (i > 0) d = step(d);
    if (end && d.isAfter(end)) break;
    out.push(d.format("YYYY-MM-DD"));
  }
  return out;
}
