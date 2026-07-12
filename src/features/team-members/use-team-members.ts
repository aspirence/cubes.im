"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import type { Database } from "@/types/database";

export type Role = Database["public"]["Tables"]["roles"]["Row"];

/** A team member joined to its user profile and role. The `user` join may be
 * null for an invited-but-not-yet-joined membership row. */
export type TeamMember = {
  id: string;
  team_id: string;
  user_id: string | null;
  role_id: string;
  /** Tier: owner | admin | member | limited | guest (permission model). */
  member_type: string;
  active: boolean | null;
  created_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
  role: Pick<Role, "id" | "name" | "admin_role" | "owner" | "default_role"> | null;
};

const teamMembersKey = (teamId: string | undefined) =>
  ["team-members", teamId] as const;
const rolesKey = (teamId: string | undefined) => ["roles", teamId] as const;

/**
 * Lists the active team's members joined to their user profile (name / email /
 * avatar) and role. Scoped to `useActiveTeam()`; RLS lets members read.
 */
export function useTeamMembers() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: teamMembersKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from("team_members")
        .select(
          `id, team_id, user_id, role_id, member_type, active, created_at,
           user:users!team_members_user_id_fk ( id, name, email, avatar_url ),
           role:roles!team_members_role_id_fk ( id, name, admin_role, owner, default_role )`,
        )
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as TeamMember[];
    },
  });
}

/**
 * Lists the active team's roles (Owner / Admin / Member). Scoped to
 * `useActiveTeam()`.
 */
export function useRoles() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: rolesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Role[]> => {
      const { data, error } = await supabase
        .from("roles")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * True when the signed-in user is an admin or owner of the active team. Used to
 * gate admin-only affordances (e.g. inviting a new member) in the UI; the DB
 * still enforces the real check via RLS.
 */
export function useIsTeamAdmin(): boolean {
  const { user } = useAuth();
  const { data: members } = useTeamMembers();
  return useMemo(() => {
    if (!user || !members) return false;
    const me = members.find((m) => m.user?.id === user.id);
    return Boolean(me?.role?.admin_role || me?.role?.owner);
  }, [user, members]);
}

/** Changes a member's role (admin-only via RLS). */
export function useUpdateMemberRole() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      memberId: string;
      roleId: string;
    }): Promise<void> => {
      const { error } = await supabase
        .from("team_members")
        .update({ role_id: input.roleId })
        .eq("id", input.memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamMembersKey(teamId) });
    },
  });
}

/** Removes a member by deleting their team_members row (admin-only via RLS). */
export function useRemoveMember() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (memberId: string): Promise<void> => {
      const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamMembersKey(teamId) });
    },
  });
}
