"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type RunningTimer =
  Database["public"]["Functions"]["my_running_timer"]["Returns"][number];

const runningTimerKey = ["my-running-timer"] as const;

/**
 * The caller's running task timer (at most one — start_timer closes out any
 * other task's timer server-side, logging its elapsed time). Refetches on a
 * slow interval as a safety net; mutations invalidate immediately.
 */
export function useMyRunningTimer() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: runningTimerKey,
    queryFn: async (): Promise<RunningTimer | null> => {
      const { data, error } = await supabase.rpc("my_running_timer");
      if (error) throw error;
      return data?.[0] ?? null;
    },
    refetchInterval: 60_000,
  });
}

/** Starts (or re-arms) the caller's timer on a task. Any timer running on a
 *  different task is stopped server-side with its time logged first. */
export function useStartTimer() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("start_timer", {
        p_task_id: taskId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      // start_timer may have closed out a timer on ANOTHER task (logging its
      // time) — refresh task rollups too.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    // Refetch the running timer even when the RPC failed — the server state
    // may have changed out from under the cache.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: runningTimerKey });
    },
  });
}

/** Stops the caller's running timer on a task, logging the elapsed time. */
export function useStopTimer() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("stop_timer", {
        p_task_id: taskId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: runningTimerKey });
    },
  });
}

/** "1:23:45"-style ticking elapsed time for a running timer's start moment. */
export function useElapsed(startedAt: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  if (!startedAt) return "0:00";
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
