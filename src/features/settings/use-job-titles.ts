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

export type JobTitle = Database["public"]["Tables"]["job_titles"]["Row"];

const jobTitlesKey = (teamId: string | undefined) =>
  ["job-titles", teamId] as const;

/**
 * Lists the active team's job titles. Scoped to `useActiveTeam()`; RLS allows
 * members to read and admins to write.
 */
export function useJobTitles() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: jobTitlesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<JobTitle[]> => {
      const { data, error } = await supabase
        .from("job_titles")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a job title in the active team. */
export function useCreateJobTitle() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: { name: string }): Promise<JobTitle> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("job_titles")
        .insert({ name: input.name, team_id: teamId })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobTitlesKey(teamId) });
    },
  });
}

/** Renames a job title. */
export function useUpdateJobTitle() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
    }): Promise<JobTitle> => {
      const { data, error } = await supabase
        .from("job_titles")
        .update({ name: input.name })
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobTitlesKey(teamId) });
    },
  });
}

/** Deletes a job title. */
export function useDeleteJobTitle() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("job_titles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobTitlesKey(teamId) });
    },
  });
}
