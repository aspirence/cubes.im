"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { backupCounts, type BackupCounts, type BackupFileV1 } from "./backup-format";
import {
  buildBackup,
  importBackup,
  type ImportProgress,
  type ImportSummary,
} from "./backup-engine";

/**
 * True only when the signed-in user holds the Owner role of the active
 * workspace (stricter than useIsTeamAdmin, which also accepts admins). UI
 * gate only — clear_team_data re-checks is_team_owner server-side.
 */
export function useIsTeamOwner() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: ["is-team-owner", teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_team_owner", {
        _team_id: teamId as string,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

/** Builds the backup for the active workspace and downloads it as JSON. */
export function useExportBackup() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();

  return useMutation({
    mutationFn: async (): Promise<BackupCounts> => {
      if (!activeTeam?.id) throw new Error("No active workspace");
      const file = await buildBackup(supabase, activeTeam.id, activeTeam.name);

      const blob = new Blob([JSON.stringify(file, null, 2)], {
        type: "application/json;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cubes-backup-${slug(activeTeam.name)}-${file.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return backupCounts(file);
    },
  });
}

/** Imports a validated backup file into the active workspace. */
export function useImportBackup() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: BackupFileV1;
      onProgress?: ImportProgress;
    }): Promise<ImportSummary> => {
      if (!activeTeam?.id) throw new Error("No active workspace");
      return importBackup(supabase, activeTeam.id, file, onProgress);
    },
    onSuccess: () => {
      // The import touched projects, folders, labels, and tasks — refetch all.
      queryClient.invalidateQueries();
    },
  });
}

/** Result row counts returned by the clear_team_data RPC. */
export interface ClearSummary {
  projects: number;
  folders: number;
  labels: number;
  clients: number;
  templates: number;
  workflows: number;
  appData: number;
}

/**
 * Wipes the active workspace's work data via the owner-only clear_team_data
 * RPC (the server re-checks is_team_owner and raises otherwise).
 */
export function useClearWorkspaceData() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<ClearSummary> => {
      if (!activeTeam?.id) throw new Error("No active workspace");
      const { data, error } = await supabase.rpc("clear_team_data", {
        p_team_id: activeTeam.id,
      });
      if (error) throw error;
      return data as unknown as ClearSummary;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}
