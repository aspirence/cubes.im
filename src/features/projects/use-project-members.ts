"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type ProjectMemberRow =
  Database["public"]["Tables"]["project_members"]["Row"];

/** A project member joined through team_members -> users for display. */
export interface ProjectMember extends ProjectMemberRow {
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

const membersKey = (projectId: string | undefined) =>
  ["project-members", projectId] as const;

/**
 * The FK-embed select for a project member joined to its team_member and the
 * underlying user (name/email/avatar). The relational shape is awkward against
 * the generated types, so the result is cast through `unknown`.
 */
const MEMBER_SELECT = `
  *,
  team_member:team_members!project_members_team_member_id_fk (
    id,
    user:users!team_members_user_id_fk ( id, name, email, avatar_url )
  )
`;

/**
 * Lists a project's members joined to team_members -> users (name/email/avatar).
 * RLS scopes the result to projects whose team the caller belongs to.
 */
export function useProjectMembers(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: membersKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectMember[]> => {
      const { data, error } = await supabase
        .from("project_members")
        .select(MEMBER_SELECT)
        .eq("project_id", projectId as string)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as ProjectMember[];
    },
  });
}

/** True when the caller can manage project-scoped review folders/views. */
export function useIsProjectAdmin(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: ["project-admin", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_project_team_admin", {
        _project_id: projectId as string,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export interface AddProjectMemberInput {
  projectId: string;
  teamMemberId: string;
}

/**
 * Adds a team member to a project. The (project_id, team_member_id) unique
 * constraint prevents duplicates; `default_view` falls back to its DB default.
 */
export function useAddProjectMember() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: AddProjectMemberInput,
    ): Promise<ProjectMemberRow> => {
      const { data, error } = await supabase
        .from("project_members")
        .insert({
          project_id: input.projectId,
          team_member_id: input.teamMemberId,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: membersKey(input.projectId),
      });
    },
  });
}

/** Removes a project member by its project_members.id. */
export function useRemoveProjectMember() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectMemberId: string): Promise<void> => {
      const { error } = await supabase
        .from("project_members")
        .delete()
        .eq("id", projectMemberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-members"] });
    },
  });
}
