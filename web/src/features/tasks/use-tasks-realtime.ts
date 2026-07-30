"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { tasksRootKey } from "./use-tasks";

/**
 * Subscribes to Supabase Realtime postgres_changes on the `tasks` table filtered
 * by `project_id`, invalidating the project's task list queries on any change so
 * every open list/board re-reads. Cleans up the channel on unmount or when the
 * project id changes.
 *
 * Mount this once per project workspace (e.g. in the project page shell).
 */
export function useTasksRealtime(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`tasks:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: tasksRootKey(projectId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, projectId]);
}
