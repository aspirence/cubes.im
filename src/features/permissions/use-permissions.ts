"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

/** Permission RPCs/tables are newer than the generated database types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** The five membership tiers (owner = org owner is separate & single-enforced). */
export type MemberType = "owner" | "admin" | "member" | "limited" | "guest";

export const MEMBER_TYPES: {
  value: MemberType;
  label: string;
  hint: string;
  icon: string;
  tone: string;
}[] = [
  { value: "owner", label: "Owner", hint: "Full control, billing, ownership.", icon: "workspace_premium", tone: "#4a4ad0" },
  { value: "admin", label: "Admin", hint: "Owner-level operations; sets permissions.", icon: "shield_person", tone: "#4a4ad0" },
  { value: "member", label: "Member", hint: "Full internal access (configurable).", icon: "person", tone: "#3a9d6e" },
  { value: "limited", label: "Limited member", hint: "Only projects they're added to.", icon: "person_off", tone: "#c98a20" },
  { value: "guest", label: "Guest", hint: "Client — client portal only.", icon: "handshake", tone: "#8a8d98" },
];

export function memberTypeMeta(t: string) {
  return MEMBER_TYPES.find((m) => m.value === t) ?? MEMBER_TYPES[2];
}

export interface Capability {
  key: string;
  label: string;
  description: string | null;
  category: string;
  sort: number;
  member_allowed: boolean;
  limited_allowed: boolean;
}

const capsKey = (teamId: string | undefined) => ["capabilities", teamId] as const;

/** The effective capability matrix (catalog + this workspace's overrides). */
export function useCapabilities() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: capsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Capability[]> => {
      const { data, error } = await loose(supabase).rpc("list_capabilities", {
        p_team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []) as Capability[];
    },
  });
}

/** Owner/admin toggles one capability for the member or limited tier. */
export function useSetCapability() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      capability: string;
      tier: "member" | "limited";
      allowed: boolean;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("set_capability", {
        p_team_id: teamId,
        p_capability: input.capability,
        p_tier: input.tier,
        p_allowed: input.allowed,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capsKey(teamId) });
    },
  });
}

/** Change a member's tier (owner/admin only; server enforces the guardrails). */
export function useSetMemberType() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      teamMemberId: string;
      memberType: MemberType;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("set_member_type", {
        p_team_member_id: input.teamMemberId,
        p_member_type: input.memberType,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}

/** Transfer workspace ownership to another active member (owner only). */
export function useTransferOwnership() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { teamId: string; toUserId: string }): Promise<void> => {
      const { error } = await loose(supabase).rpc("transfer_team_ownership", {
        p_team_id: input.teamId,
        p_to_user: input.toUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}
