"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { tasksRootKey } from "@/features/tasks/use-tasks";
import type { Database } from "@/types/database";
import type { RecurrenceDraft, RecurringScheduleType } from "./recurrence";

export type TaskRecurringSchedule =
  Database["public"]["Tables"]["task_recurring_schedules"]["Row"];

const RECURRING_ROOT = "task-recurring" as const;

/** The IANA zone the pickers work in; UTC if the runtime cannot say. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const recurringKey = (taskId: string | undefined) =>
  [RECURRING_ROOT, taskId] as const;
const originKey = (taskId: string | undefined) =>
  [RECURRING_ROOT, "origin", taskId] as const;

/**
 * Reads the recurring schedule for a single task, or `null` when the task has
 * no schedule configured.
 */
export function useTaskRecurring(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: recurringKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskRecurringSchedule | null> => {
      const { data, error } = await supabase
        .from("task_recurring_schedules")
        .select("*")
        .eq("task_id", taskId as string)
        .maybeSingle();

      if (error) throw error;
      return data ?? null;
    },
  });
}

/** A stored schedule → the draft the pickers edit. */
export function toRecurrenceDraft(row: TaskRecurringSchedule): RecurrenceDraft {
  return {
    scheduleType: row.schedule_type as RecurringScheduleType,
    intervalValue: row.interval_value,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    endsOn: row.ends_on,
  };
}

export interface SetTaskRecurringInput extends RecurrenceDraft {
  taskId: string;
  /** YYYY-MM-DD — the source task's own day, which the series counts from. */
  startsOn: string;
  /** When given, the project's task lists refetch so their "repeats" marker updates. */
  projectId?: string;
}

/**
 * Sets a task's recurring schedule — one row per task, upserted on `task_id`.
 *
 * `next_run_at` is written as null on every save: that tells the hourly job to
 * work the next copy out from `starts_on` afresh, so editing a cadence restarts
 * the arithmetic instead of firing a copy within the hour.
 *
 * `timezone` is the browser's IANA zone. Task dates are instants; the zone is
 * what lets the job read them as the calendar days the user sees (and shift
 * copies by those days, DST and all) so each copy lands on the day the
 * preview promised. See WHOSE DAY in migration 20261126000000.
 */
export function useSetTaskRecurring() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: SetTaskRecurringInput,
    ): Promise<TaskRecurringSchedule> => {
      const { data, error } = await supabase
        .from("task_recurring_schedules")
        .upsert(
          {
            task_id: input.taskId,
            schedule_type: input.scheduleType,
            interval_value: Math.max(1, input.intervalValue),
            day_of_week: input.scheduleType === "weekly" ? input.dayOfWeek : null,
            day_of_month: input.scheduleType === "monthly" ? input.dayOfMonth : null,
            starts_on: input.startsOn,
            timezone: browserTimezone(),
            ends_on: input.endsOn,
            active: true,
            next_run_at: null,
          },
          { onConflict: "task_id" },
        )
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: recurringKey(input.taskId) });
      if (input.projectId) {
        queryClient.invalidateQueries({ queryKey: tasksRootKey(input.projectId) });
      }
    },
  });
}

export interface RemoveTaskRecurringInput {
  taskId: string;
  projectId?: string;
}

/**
 * Stops a task repeating.
 *
 * The row is kept and switched off rather than deleted: task_recurring_occurrences
 * cascades from it, and those receipts are both the "Copy of #N" link every copy
 * shows and the guard that stops a second copy being made for a day that already
 * has one. Deleting the schedule took them with it, so stopping and restarting
 * on the same day made a duplicate and orphaned the copies already out there.
 * Repeating again upserts this same row back to active, cadence and all.
 */
export function useRemoveTaskRecurring() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RemoveTaskRecurringInput): Promise<void> => {
      const { error } = await supabase
        .from("task_recurring_schedules")
        .update({ active: false, next_run_at: null })
        .eq("task_id", input.taskId);
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: recurringKey(input.taskId) });
      if (input.projectId) {
        queryClient.invalidateQueries({ queryKey: tasksRootKey(input.projectId) });
      }
    },
  });
}

/** For a task the job made: the day it was made for and the task it copies. */
export interface TaskRecurringOrigin {
  occurrenceDate: string;
  sourceTaskId: string;
  sourceName: string;
  sourceTaskNo: number | null;
  /** False once the series has ended or been stopped. */
  active: boolean;
}

/**
 * Reads where a task came from, or `null` for a task nobody's schedule made.
 * The receipt row is written by the materializer only (see migration
 * 20261126000000), so its presence is proof, not a hint.
 */
export function useTaskRecurringOrigin(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: originKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskRecurringOrigin | null> => {
      const { data, error } = await supabase
        .from("task_recurring_occurrences")
        .select(
          `occurrence_date,
           schedule:task_recurring_schedules!task_recurring_occurrences_schedule_id_fk (
             active,
             task:tasks!task_recurring_schedules_task_id_fk ( id, name, task_no )
           )`,
        )
        .eq("task_id", taskId as string)
        .maybeSingle();

      if (error) throw error;
      // The embed shape is awkward against the generated types (see
      // TASK_SELECT in use-tasks.ts for the same move).
      const row = data as unknown as {
        occurrence_date: string;
        schedule: {
          active: boolean;
          task: { id: string; name: string; task_no: number | null } | null;
        } | null;
      } | null;
      if (!row?.schedule?.task) return null;
      return {
        occurrenceDate: row.occurrence_date,
        sourceTaskId: row.schedule.task.id,
        sourceName: row.schedule.task.name,
        sourceTaskNo: row.schedule.task.task_no,
        active: row.schedule.active,
      };
    },
  });
}
