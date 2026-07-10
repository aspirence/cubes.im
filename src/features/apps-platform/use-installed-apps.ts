"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type InstalledApp =
  Database["public"]["Tables"]["installed_apps"]["Row"];

const installedKey = (teamId: string | undefined) =>
  ["installed-apps", teamId] as const;

/** Whether the current user is an admin of the active team (install gate). */
export function useIsTeamAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["is-team-admin", teamId] as const,
    enabled: Boolean(teamId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_team_admin", {
        _team_id: teamId as string,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

/** Lists the active team's installed apps. */
export function useInstalledApps() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: installedKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<InstalledApp[]> => {
      const { data, error } = await supabase
        .from("installed_apps")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Installed/enabled state for a specific first-party app in the active team. */
export function useInstalledApp(appKey: string) {
  const query = useInstalledApps();
  const record = useMemo(
    () => query.data?.find((entry) => entry.app_key === appKey) ?? null,
    [appKey, query.data],
  );
  return {
    ...query,
    record,
    installed: Boolean(record),
    enabled: Boolean(record?.enabled),
  };
}

/** Installs an app for the active team (admin only via RLS). */
export function useInstallApp() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (appKey: string): Promise<InstalledApp> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("installed_apps")
        .insert({ team_id: teamId, app_key: appKey, installed_by: user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: installedKey(teamId) });
    },
  });
}

/** Enables/disables an installed app without uninstalling it. */
export function useToggleApp() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      enabled: boolean;
    }): Promise<void> => {
      const { error } = await supabase
        .from("installed_apps")
        .update({ enabled: input.enabled })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: installedKey(teamId) });
    },
  });
}

/** Uninstalls an app (its `app_<key>_*` data cascades on the app's own FKs). */
export function useUninstallApp() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("installed_apps")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: installedKey(teamId) });
    },
  });
}
