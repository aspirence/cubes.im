"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

/** Space visibility, added by the 20261061 space-privacy migration. */
export type SpaceVisibility = "team" | "private";

/**
 * A Space (legacy: project_folders row). `visibility` is newer than the
 * generated types, so it's intersected in here.
 */
export type ProjectFolder =
  Database["public"]["Tables"]["project_folders"]["Row"] & {
    visibility: SpaceVisibility;
  };

/** RPCs / columns newer than the generated `database.ts` types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

const foldersKey = (teamId: string | undefined) =>
  ["project-folders", teamId] as const;

const spaceMembersKey = (folderId: string | undefined) =>
  ["space-members", folderId] as const;

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
      return (data ?? []) as ProjectFolder[];
    },
  });
}

export interface CreateFolderInput {
  name: string;
  colorCode?: string;
  parentFolderId?: string | null;
}

export interface CreateSpaceInput {
  name: string;
  colorCode?: string;
  parentFolderId?: string | null;
  visibility?: SpaceVisibility;
  /** Team-member ids to seed a private Space with (the creator is auto-added). */
  memberIds?: string[];
}

/**
 * Creates a Space via the `create_space` RPC (admin-only, SECURITY DEFINER).
 * Unlike a raw insert it also sets initial visibility and — for a private
 * Space — enrolls the chosen members plus the creator in one transaction.
 */
export function useCreateSpace() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: CreateSpaceInput): Promise<string> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await loose(supabase).rpc("create_space", {
        p_team_id: teamId,
        p_name: input.name,
        p_visibility: input.visibility ?? "team",
        p_parent_folder_id: input.parentFolderId ?? null,
        p_color_code: input.colorCode ?? null,
        p_member_ids: input.memberIds ?? [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
    },
  });
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
      return data as ProjectFolder;
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
      return data as ProjectFolder;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Space membership (private-space access control).                           */
/* -------------------------------------------------------------------------- */

export interface SpaceMember {
  id: string;
  folder_id: string;
  team_member_id: string;
  role: "member" | "admin";
  team_member: {
    id: string;
    user: {
      id: string;
      name: string;
      email: string;
      avatar_url: string | null;
    } | null;
  } | null;
}

/** Lists the members explicitly on a Space. RLS returns rows only for Spaces
 *  the caller can access. */
export function useSpaceMembers(folderId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: spaceMembersKey(folderId),
    enabled: Boolean(folderId),
    queryFn: async (): Promise<SpaceMember[]> => {
      const { data, error } = await loose(supabase)
        .from("space_members")
        .select(
          "id, folder_id, team_member_id, role, team_member:team_members!space_members_team_member_fk(id, user:users(id, name, email, avatar_url))",
        )
        .eq("folder_id", folderId as string);
      if (error) throw error;
      return (data ?? []) as unknown as SpaceMember[];
    },
  });
}

/** Toggles a Space between 'team' (shared) and 'private'. */
export function useSetSpaceVisibility() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      folderId: string;
      visibility: SpaceVisibility;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("set_space_visibility", {
        p_folder_id: input.folderId,
        p_visibility: input.visibility,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
      queryClient.invalidateQueries({
        queryKey: spaceMembersKey(input.folderId),
      });
      // Project visibility cascades from Space privacy — refresh the tree.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** Adds (or re-roles) a team member on a Space. */
export function useAddSpaceMember() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      folderId: string;
      teamMemberId: string;
      role?: "member" | "admin";
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("add_space_member", {
        p_folder_id: input.folderId,
        p_team_member_id: input.teamMemberId,
        p_role: input.role ?? "member",
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: spaceMembersKey(input.folderId),
      });
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** Removes a team member from a Space. */
export function useRemoveSpaceMember() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      folderId: string;
      teamMemberId: string;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("remove_space_member", {
        p_folder_id: input.folderId,
        p_team_member_id: input.teamMemberId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: spaceMembersKey(input.folderId),
      });
      queryClient.invalidateQueries({ queryKey: foldersKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
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
