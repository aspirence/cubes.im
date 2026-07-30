"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type TaskTimerRow =
  Database["public"]["Tables"]["task_timers"]["Row"];
export type TaskWorkLogRow =
  Database["public"]["Tables"]["task_work_log"]["Row"];

/** A work-log row joined to the logger (user_id -> users) for display. */
export interface TaskWorkLog extends TaskWorkLogRow {
  user: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
}

/** Result of {@link useTaskWorkLogs}: the logs plus their total seconds. */
export interface TaskWorkLogs {
  logs: TaskWorkLog[];
  /** Sum of `time_spent` (seconds) across all logs. */
  totalSeconds: number;
}

/** Result of {@link useActiveTimer}: the running row (or null) + live elapsed. */
export interface ActiveTimer {
  /** The running `task_timers` row for (task, current user), or null. */
  timer: TaskTimerRow | null;
  /** Live seconds elapsed since `start_time`, ticking every second. 0 if idle. */
  elapsedSeconds: number;
}

const workLogsKey = (taskId: string | undefined) =>
  ["task-work-logs", taskId] as const;
const activeTimerKey = (taskId: string | undefined) =>
  ["task-active-timer", taskId] as const;

const WORK_LOG_SELECT = `
  *,
  user:users!task_work_log_user_id_fk ( id, name, avatar_url )
`;

/**
 * Formats a duration in seconds as a compact `Hh Mm` string (e.g. `2h 5m`).
 * Sub-minute remainders are dropped; `0` renders as `0m`.
 */
export function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/* ---------------------------- work logs ------------------------------- */

/**
 * Lists a task's work-log entries (newest first) joined to the logger's user,
 * and exposes the total logged seconds.
 */
export function useTaskWorkLogs(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: workLogsKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskWorkLogs> => {
      const { data, error } = await supabase
        .from("task_work_log")
        .select(WORK_LOG_SELECT)
        .eq("task_id", taskId as string)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const logs = (data ?? []) as unknown as TaskWorkLog[];
      const totalSeconds = logs.reduce(
        (sum, log) => sum + (log.time_spent ?? 0),
        0,
      );

      return { logs, totalSeconds };
    },
  });
}

/* ----------------------------- active timer --------------------------- */

/**
 * Reads the current user's running timer for `taskId` (if any) and, while one
 * is running, exposes a live `elapsedSeconds` value that ticks every second.
 */
export function useActiveTimer(taskId: string | undefined): ActiveTimer & {
  isLoading: boolean;
} {
  const supabase = useMemo(() => createClient(), []);

  const query = useQuery({
    queryKey: activeTimerKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskTimerRow | null> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return null;

      const { data, error } = await supabase
        .from("task_timers")
        .select("*")
        .eq("task_id", taskId as string)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data ?? null;
    },
  });

  const timer = query.data ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!timer) {
      setElapsedSeconds(0);
      return;
    }

    const startMs = new Date(timer.start_time).getTime();
    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setElapsedSeconds(seconds);
    };

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [timer]);

  return { timer, elapsedSeconds, isLoading: query.isLoading };
}

/* ------------------------------ mutations ----------------------------- */

/**
 * Invalidates every query affected by a time mutation: the task's work logs,
 * its active timer, and the tasks list.
 */
function useInvalidateTime() {
  const queryClient = useQueryClient();
  return (taskId: string) => {
    queryClient.invalidateQueries({ queryKey: workLogsKey(taskId) });
    queryClient.invalidateQueries({ queryKey: activeTimerKey(taskId) });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export interface LogTimeInput {
  taskId: string;
  /** Duration to log, in minutes. */
  minutes: number;
  description?: string;
  isBillable?: boolean;
}

/** Logs a manual time entry against a task via the `log_time` RPC. */
export function useLogTime() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateTime();

  return useMutation({
    mutationFn: async (input: LogTimeInput): Promise<string> => {
      const { data, error } = await supabase.rpc("log_time", {
        p_task_id: input.taskId,
        p_minutes: input.minutes,
        p_description: input.description,
        p_is_billable: input.isBillable,
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => invalidate(input.taskId),
  });
}

export interface StartTimerInput {
  taskId: string;
}

/** Starts the current user's timer for a task via the `start_timer` RPC. */
export function useStartTimer() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateTime();

  return useMutation({
    mutationFn: async (input: StartTimerInput): Promise<string> => {
      const { data, error } = await supabase.rpc("start_timer", {
        p_task_id: input.taskId,
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => invalidate(input.taskId),
  });
}

export interface StopTimerInput {
  taskId: string;
  description?: string;
  isBillable?: boolean;
}

/**
 * Stops the current user's timer for a task via the `stop_timer` RPC; the RPC
 * computes elapsed time, writes a work-log, and clears the timer. Returns the
 * new work-log id.
 */
export function useStopTimer() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateTime();

  return useMutation({
    mutationFn: async (input: StopTimerInput): Promise<string> => {
      const { data, error } = await supabase.rpc("stop_timer", {
        p_task_id: input.taskId,
        p_description: input.description,
        p_is_billable: input.isBillable,
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => invalidate(input.taskId),
  });
}
