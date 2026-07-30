"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useProject } from "@/features/projects/use-projects";

/** How a task's human ID renders across the app. */
export interface TaskIdConfig {
  /** Where the prefix comes from. */
  prefixSource: "project_key" | "custom" | "none";
  /** Used when prefixSource === "custom". */
  customPrefix: string;
  /** Placed between prefix and number. */
  separator: string;
  /** Zero-pad the number to this width (0 = no padding). */
  padding: number;
  /** Upper-case the prefix. */
  uppercase: boolean;
}

/** Default reproduces the historical "#12" look, so nothing changes until set. */
export const DEFAULT_TASK_ID_CONFIG: TaskIdConfig = {
  prefixSource: "none",
  customPrefix: "",
  separator: "-",
  padding: 0,
  uppercase: true,
};

/** Renders a task's display id from its project key + number using the config. */
export function formatTaskId(
  projectKey: string | null | undefined,
  taskNo: number | null | undefined,
  cfg: TaskIdConfig,
): string {
  if (taskNo == null) return "";
  const num = cfg.padding > 0 ? String(taskNo).padStart(cfg.padding, "0") : String(taskNo);
  let prefix =
    cfg.prefixSource === "project_key"
      ? projectKey ?? ""
      : cfg.prefixSource === "custom"
        ? cfg.customPrefix ?? ""
        : "";
  if (cfg.uppercase) prefix = prefix.toUpperCase();
  if (!prefix) return `#${num}`;
  return `${prefix}${cfg.separator}${num}`;
}

// team_settings is newer than the generated types; use a relaxed handle for it.
function looseTable(supabase: SupabaseClient) {
  return supabase.from("team_settings");
}

/** The active team's task-ID format (merged with defaults). */
export function useTaskIdConfig() {
  const supabase = useMemo(() => createClient(), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: ["team-settings", "task-id", teamId] as const,
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TaskIdConfig> => {
      const { data, error } = await looseTable(supabase as unknown as SupabaseClient)
        .select("task_id_format")
        .eq("team_id", teamId as string)
        .maybeSingle();
      if (error) throw error;
      const raw = (data?.task_id_format ?? {}) as Partial<TaskIdConfig>;
      return { ...DEFAULT_TASK_ID_CONFIG, ...raw };
    },
  });
}

/** Saves the active team's task-ID format (team admins only, per RLS). */
export function useUpdateTaskIdConfig() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useMutation({
    mutationFn: async (cfg: TaskIdConfig): Promise<void> => {
      if (!teamId) throw new Error("No active team");
      const { error } = await looseTable(supabase as unknown as SupabaseClient).upsert(
        { team_id: teamId, task_id_format: cfg, updated_at: new Date().toISOString() },
        { onConflict: "team_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-settings"] }),
  });
}

/**
 * Returns a formatter `(taskNo) => "PAY2-012"` for one project — it pulls the
 * team config and the project's key (both cached), so any within-project view
 * can render the configured id with a single hook.
 */
export function useTaskIdFormatter(projectId: string | undefined) {
  const { data: cfg } = useTaskIdConfig();
  const { data: project } = useProject(projectId);
  const config = cfg ?? DEFAULT_TASK_ID_CONFIG;
  const key = project?.key ?? null;
  return useCallback(
    (taskNo: number | null | undefined) => formatTaskId(key, taskNo, config),
    [key, config],
  );
}
