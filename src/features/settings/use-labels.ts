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

export type TeamLabel = Database["public"]["Tables"]["team_labels"]["Row"];

const labelsKey = (teamId: string | undefined) =>
  ["team-labels", teamId] as const;

/**
 * Lists the active team's labels. Scoped to `useActiveTeam()`. RLS lets any
 * team member read AND write labels.
 */
export function useTeamLabels() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: labelsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamLabel[]> => {
      const { data, error } = await supabase
        .from("team_labels")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a label in the active team. `color_code` must be a hex colour. */
export function useCreateLabel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      name: string;
      color_code: string;
    }): Promise<TeamLabel> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("team_labels")
        .insert({
          name: input.name,
          color_code: input.color_code,
          team_id: teamId,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelsKey(teamId) });
    },
  });
}

/** Updates a label's name and/or colour. */
export function useUpdateLabel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      color_code?: string;
    }): Promise<TeamLabel> => {
      const { id, ...rest } = input;
      const { data, error } = await supabase
        .from("team_labels")
        .update(rest)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelsKey(teamId) });
    },
  });
}

/** Deletes a label. */
export function useDeleteLabel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("team_labels")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: labelsKey(teamId) });
    },
  });
}
