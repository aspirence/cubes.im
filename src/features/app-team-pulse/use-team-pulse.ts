"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useInstalledApp } from "@/features/apps-platform/use-installed-apps";
import type { Database, Json } from "@/types/database";

export type PulseRow =
  Database["public"]["Functions"]["team_pulse"]["Returns"][number];

const pulseKey = (teamId: string | undefined) => ["team-pulse", teamId] as const;

/** The live dashboard rows — polls so the screen stays current on its own. */
export function useTeamPulse(enabled: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: pulseKey(teamId),
    enabled: Boolean(teamId) && enabled,
    refetchInterval: 15_000,
    queryFn: async (): Promise<PulseRow[]> => {
      const { data, error } = await supabase.rpc("team_pulse", {
        p_team_id: teamId as string,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface TeamPulseConfig {
  /** Limited members keep ONE task In Progress at a time. Default on. */
  singleActive: boolean;
  /** Timer auto-starts/stops as tasks enter/leave the Active stage. Default on. */
  autoTimer: boolean;
  /** Show the running-timer widget in everyone's sidebar. Default on. */
  showTimerWidget: boolean;
}

/** Reads the app's toggles out of installed_apps.config (absent = ON). */
export function readTeamPulseConfig(config: Json | undefined): TeamPulseConfig {
  const rec =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, Json | undefined>)
      : {};
  const on = (v: Json | undefined) =>
    String(v ?? "true").toLowerCase() !== "false";
  return {
    singleActive: on(rec.single_active),
    autoTimer: on(rec.auto_timer),
    showTimerWidget: on(rec.show_timer_widget),
  };
}

/** Writes one toggle back into installed_apps.config (admin via RLS). */
export function useSetTeamPulseConfig() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const { record } = useInstalledApp("team_pulse");

  return useMutation({
    mutationFn: async (patch: Partial<TeamPulseConfig>): Promise<void> => {
      if (!record) throw new Error("Team Pulse is not installed");
      const existing =
        record.config && typeof record.config === "object" && !Array.isArray(record.config)
          ? (record.config as Record<string, Json>)
          : {};
      const next: Record<string, Json> = { ...existing };
      if (patch.singleActive !== undefined)
        next.single_active = patch.singleActive ? "true" : "false";
      if (patch.autoTimer !== undefined)
        next.auto_timer = patch.autoTimer ? "true" : "false";
      if (patch.showTimerWidget !== undefined)
        next.show_timer_widget = patch.showTimerWidget ? "true" : "false";
      const { error } = await supabase
        .from("installed_apps")
        .update({ config: next })
        .eq("id", record.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installed-apps", teamId] });
    },
  });
}

/** "2h 15m" / "45m" / "0m" from seconds. */
export function formatTracked(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Whether the sidebar's running-timer widget should render for this user.
 *
 * The switch lives on the Team Pulse app, so it only applies once an admin has
 * installed it — a workspace without Team Pulse keeps the widget, which is the
 * behaviour that shipped before the setting existed.
 */
export function useShowTimerWidget(): boolean {
  const { record, installed, enabled } = useInstalledApp("team_pulse");
  if (!installed || !enabled) return true;
  return readTeamPulseConfig(record?.config).showTimerWidget;
}
