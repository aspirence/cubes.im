"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

/** A team row trimmed to the fields the shell needs. */
export type Team = Pick<
  Database["public"]["Tables"]["teams"]["Row"],
  "id" | "name" | "organization_id"
>;

const teamsKey = ["teams"] as const;
const activeTeamKey = ["active-team"] as const;

/**
 * Lists the teams the current user can see. RLS guarantees only the user's own
 * team(s) come back, so no client-side filtering is required.
 */
export function useTeams() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: teamsKey,
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, organization_id")
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Resolves the current user's active team by reading `public.users.active_team`
 * for `auth.uid()` and joining through to the team row.
 */
export function useActiveTeam() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: activeTeamKey,
    queryFn: async (): Promise<Team | null> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) return null;

      // maybeSingle (not single): an orphaned auth user has no profile row yet,
      // which would otherwise throw and wedge the whole shell on "Select team".
      const { data, error } = await supabase
        .from("users")
        .select("active_team")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;

      let activeTeamId = data?.active_team ?? null;

      // Self-heal: accounts created before provisioning existed (or whose public
      // rows were dropped in a schema rebuild) have no profile/org/team. The
      // SECURITY DEFINER provision_my_account() RPC creates the missing profile +
      // organization + team + owner membership and returns the active team id; it
      // no-ops once the user is provisioned.
      if (!activeTeamId) {
        const { data: provisioned, error: provError } =
          await supabase.rpc("provision_my_account");
        if (provError) throw provError;
        activeTeamId = (provisioned as string | null) ?? null;
        if (activeTeamId) {
          // The team list was fetched before the heal — refresh the switcher.
          queryClient.invalidateQueries({ queryKey: teamsKey });
        }
      }

      if (!activeTeamId) return null;

      const { data: team, error: teamError } = await supabase
        .from("teams")
        .select("id, name, organization_id")
        .eq("id", activeTeamId)
        .maybeSingle();

      if (teamError) throw teamError;
      return team ?? null;
    },
  });
}

/**
 * Switches the current user's active team by updating
 * `public.users.active_team` for `auth.uid()`, then invalidates the relevant
 * queries so consumers re-read the new active team.
 */
export function useSetActiveTeam() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (teamId: string): Promise<void> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("users")
        .update({ active_team: teamId })
        .eq("id", user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activeTeamKey });
      queryClient.invalidateQueries({ queryKey: teamsKey });
    },
  });
}

/**
 * Creates a new team in the caller's organization via the `create_team` RPC
 * (SECURITY DEFINER: team + default roles + owner membership). Returns the new
 * team id. Only organization admins/owners are permitted server-side.
 */
export function useCreateTeam() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string): Promise<string> => {
      const { data, error } = await supabase.rpc("create_team", {
        p_name: name,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamsKey });
    },
  });
}
