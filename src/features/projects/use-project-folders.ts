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

export type ProjectFolder =
  Database["public"]["Tables"]["project_folders"]["Row"];

const foldersKey = (teamId: string | undefined) =>
  ["project-folders", teamId] as const;

/**
 * Lists the active team's project folders. Team-scoped via `useActiveTeam()`;
 * RLS lets members read and admins write. Supports `parent_folder_id` nesting
 * (the column is returned so callers can build the tree).
 */
export function useProjectFolders() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: foldersKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ProjectFolder[]> => {
      const { data, error } = await supabase
        .from("project_folders")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CreateFolderInput {
  name: string;
  colorCode?: string;
  parentFolderId?: string | null;
}

/**
 * Creates a project folder in the active team. `created_by` is set to the
 * current auth user (required NOT NULL column).
 */
export function useCreateFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: CreateFolderInput): Promise<ProjectFolder> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("project_folders")
        .insert({
          name: input.name,
          team_id: teamId,
          created_by: user.id,
          ...(input.colorCode ? { color_code: input.colorCode } : {}),
          ...(input.parentFolderId
            ? { parent_folder_id: input.parentFolderId }
            : {}),
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
    },
  });
}

export interface UpdateFolderInput {
  id: string;
  name?: string;
  colorCode?: string;
  parentFolderId?: string | null;
}

/** Updates a project folder's name, colour, and/or parent. */
export function useUpdateFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: UpdateFolderInput): Promise<ProjectFolder> => {
      const patch: Database["public"]["Tables"]["project_folders"]["Update"] =
        {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.colorCode !== undefined) patch.color_code = input.colorCode;
      if (input.parentFolderId !== undefined)
        patch.parent_folder_id = input.parentFolderId;

      const { data, error } = await supabase
        .from("project_folders")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
    },
  });
}

/** Deletes a project folder. Projects in it have folder_id set to null by FK. */
export function useDeleteFolder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("project_folders")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
    },
  });
}
