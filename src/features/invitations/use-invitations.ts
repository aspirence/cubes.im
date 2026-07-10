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

export type EmailInvitation =
  Database["public"]["Tables"]["email_invitations"]["Row"];

const invitationsKey = (teamId: string | undefined) =>
  ["invitations", teamId] as const;

/**
 * Lists the active team's outstanding email invitations. Scoped to
 * `useActiveTeam()`; RLS lets team members (and the invited email) read.
 */
export function useInvitations() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: invitationsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<EmailInvitation[]> => {
      const { data, error } = await supabase
        .from("email_invitations")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Creates an email invitation for the active team (admin-only via RLS). The
 * `roleId` is optional; when omitted the invitee gets the team's default Member
 * role on acceptance.
 */
export function useInviteMember() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      email: string;
      name: string;
      roleId?: string | null;
    }): Promise<EmailInvitation> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("email_invitations")
        .insert({
          email: input.email,
          name: input.name,
          team_id: teamId,
          role_id: input.roleId ?? null,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationsKey(teamId) });
    },
  });
}

/**
 * Accepts an invitation by id via the accept_invitation RPC. The RPC verifies
 * the invite email matches the caller, inserts the team membership, and deletes
 * the invitation. Returns the joined team id. Invalidates teams + invitations +
 * team-members so the UI reflects the new membership.
 */
export function useAcceptInvitation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("accept_invitation", {
        p_invitation_id: invitationId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["active-team"] });
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    },
  });
}
