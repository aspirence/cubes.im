"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type TaskRecurringSchedule =
  Database["public"]["Tables"]["task_recurring_schedules"]["Row"];

/** The recurrence cadence stored in `schedule_type`. */
export type RecurringScheduleType = "daily" | "weekly" | "monthly";

const RECURRING_ROOT = "task-recurring" as const;

const recurringKey = (taskId: string | undefined) =>
  [RECURRING_ROOT, taskId] as const;

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

export interface SetTaskRecurringInput {
  taskId: string;
  scheduleType: RecurringScheduleType;
  intervalValue?: number;
  /** 0-6 (weekly). */
  dayOfWeek?: number | null;
  /** 1-31 (monthly). */
  dayOfMonth?: number | null;
  active?: boolean;
  /** ISO timestamp; defaults to now() when omitted. */
  nextRunAt?: string;
}

/**
 * Sets a task's recurring schedule (one row per task, keyed on `task_id`).
 *
 * The schema has no unique constraint on `task_id`, so a PostgREST `upsert`
 * with `onConflict: "task_id"` is unsupported. Instead this reads any existing
 * row for the task and updates it, or inserts a fresh row. `next_run_at`
 * defaults to the current time when not provided.
 */
export function useSetTaskRecurring() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: SetTaskRecurringInput,
    ): Promise<TaskRecurringSchedule> => {
      const values = {
        task_id: input.taskId,
        schedule_type: input.scheduleType,
        interval_value: input.intervalValue ?? 1,
        day_of_week: input.dayOfWeek ?? null,
        day_of_month: input.dayOfMonth ?? null,
        active: input.active ?? true,
        next_run_at: input.nextRunAt ?? new Date().toISOString(),
      };

      const { data: existing, error: readError } = await supabase
        .from("task_recurring_schedules")
        .select("id")
        .eq("task_id", input.taskId)
        .maybeSingle();

      if (readError) throw readError;

      if (existing) {
        const { data, error } = await supabase
          .from("task_recurring_schedules")
          .update(values)
          .eq("id", existing.id)
          .select("*")
          .single();

        if (error) throw error;
        return data;
      }

      const { data, error } = await supabase
        .from("task_recurring_schedules")
        .insert(values)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: recurringKey(input.taskId) });
    },
  });
}

/** Removes a task's recurring schedule. */
export function useRemoveTaskRecurring() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string): Promise<void> => {
      const { error } = await supabase
        .from("task_recurring_schedules")
        .delete()
        .eq("task_id", taskId);
      if (error) throw error;
    },
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: recurringKey(taskId) });
    },
  });
}
