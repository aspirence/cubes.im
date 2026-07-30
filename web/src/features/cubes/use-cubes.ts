"use client";

import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

/** RPCs newer than the generated database.ts types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export interface CubeRule {
  id: string;
  team_id: string;
  event_key: string;
  label: string;
  points: number;
  enabled: boolean;
}

export interface CubeLeaderRow {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  member_type: string;
  cubes: number;
  events_count: number;
  last_event: string | null;
}

const rulesKey = (t: string | undefined) => ["cube-rules", t] as const;
const boardKey = (t: string | undefined) => ["cube-leaderboard", t] as const;

/** The workspace's point rules (any member can read). */
export function useCubeRules() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: rulesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CubeRule[]> => {
      const { data, error } = await loose(supabase).rpc("list_cube_rules", {
        p_team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []) as CubeRule[];
    },
  });
}

/** Edit a rule's points / enabled (admins/owners). */
export function useSetCubeRule() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      eventKey: string;
      points: number;
      enabled: boolean;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("set_cube_rule", {
        p_team_id: teamId,
        p_event_key: input.eventKey,
        p_points: Math.round(input.points),
        p_enabled: input.enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rulesKey(teamId) });
      queryClient.invalidateQueries({ queryKey: boardKey(teamId) });
    },
  });
}

/** Per-member cube totals, highest first. */
export function useCubeLeaderboard() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: boardKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CubeLeaderRow[]> => {
      const { data, error } = await loose(supabase).rpc("cube_leaderboard", {
        p_team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []) as CubeLeaderRow[];
    },
  });
}

/** Manually award or deduct cubes for a member (admins/owners). */
export function useAwardCubesManual() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      points: number;
      reason: string;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("award_cubes_manual", {
        p_team_id: teamId,
        p_user_id: input.userId,
        p_points: Math.round(input.points),
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardKey(teamId) });
    },
  });
}
