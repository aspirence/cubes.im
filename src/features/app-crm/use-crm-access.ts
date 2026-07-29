"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { CrmAdmin } from "./types";

/** A CRM access grant joined to the granted user's profile. */
export type CrmAdminWithUser = CrmAdmin & {
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
};

const isCrmAdminKey = (teamId: string | undefined) =>
  ["is-crm-admin", teamId] as const;
const crmAdminsKey = (teamId: string | undefined) =>
  ["crm-admins", teamId] as const;

/**
 * Whether the current user can use the CRM in the active team: the team owner,
 * or a member the owner granted access to (app_crm_admins). This is the page
 * gate; RLS enforces the same rule on every app_crm_* table.
 */
export function useIsCrmAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: isCrmAdminKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_crm_admin", {
        _team_id: teamId as string,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

/** Lists the access grants for the active team (visible to CRM admins). */
export function useCrmAdmins() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: crmAdminsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmAdminWithUser[]> => {
      const { data, error } = await supabase
        .from("app_crm_admins")
        .select(
          "*, user:users!app_crm_admins_user_id_fk ( id, name, email, avatar_url )",
        )
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CrmAdminWithUser[];
    },
  });
}

/** Grants CRM access to a team member (team OWNER only via RLS). */
export function useGrantCrmAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (userId: string): Promise<void> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("app_crm_admins").insert({
        team_id: teamId,
        user_id: userId,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: crmAdminsKey(teamId) });
      queryClient.invalidateQueries({ queryKey: isCrmAdminKey(teamId) });
    },
  });
}

/** Revokes a CRM access grant (team OWNER only via RLS). */
export function useRevokeCrmAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (grantId: string): Promise<void> => {
      const { error } = await supabase
        .from("app_crm_admins")
        .delete()
        .eq("id", grantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: crmAdminsKey(teamId) });
      queryClient.invalidateQueries({ queryKey: isCrmAdminKey(teamId) });
    },
  });
}
