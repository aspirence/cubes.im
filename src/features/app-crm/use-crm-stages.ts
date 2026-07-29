"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { CrmStage } from "./types";

const stagesKey = (teamId: string | undefined) =>
  ["crm-stages", teamId] as const;

/** The active team's pipeline stages, in board order. Seeded on install. */
export function useCrmStages() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: stagesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmStage[]> => {
      const { data, error } = await supabase
        .from("app_crm_stages")
        .select("*")
        .eq("team_id", teamId as string)
        .order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Adds a stage at the end of the pipeline. */
export function useCreateCrmStage() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      name: string;
      color: string;
      position: number;
    }): Promise<CrmStage> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("app_crm_stages")
        .insert({ team_id: teamId, ...input })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stagesKey(teamId) });
    },
  });
}

/** Renames / recolors / repositions a stage. */
export function useUpdateCrmStage() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Pick<CrmStage, "name" | "color" | "position">>;
    }): Promise<void> => {
      const { error } = await supabase
        .from("app_crm_stages")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stagesKey(teamId) });
    },
  });
}

/** Deletes a stage; its deals fall back to "No stage" (FK SET NULL). */
export function useDeleteCrmStage() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("app_crm_stages")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stagesKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["crm-deals", teamId] });
    },
  });
}
