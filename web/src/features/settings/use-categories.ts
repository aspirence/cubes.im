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

export type ProjectCategory =
  Database["public"]["Tables"]["project_categories"]["Row"];

const categoriesKey = (teamId: string | undefined) =>
  ["project-categories", teamId] as const;

/**
 * Lists the active team's project categories. Scoped to `useActiveTeam()`. RLS
 * lets members read and admins write.
 */
export function useProjectCategories() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: categoriesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ProjectCategory[]> => {
      const { data, error } = await supabase
        .from("project_categories")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Creates a project category in the active team. `created_by` is set to the
 * current auth user (required NOT NULL column).
 */
export function useCreateCategory() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      name: string;
      color_code?: string;
    }): Promise<ProjectCategory> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("project_categories")
        .insert({
          name: input.name,
          ...(input.color_code ? { color_code: input.color_code } : {}),
          team_id: teamId,
          created_by: user.id,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKey(teamId) });
    },
  });
}

/** Updates a category's name and/or colour. */
export function useUpdateCategory() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      color_code?: string;
    }): Promise<ProjectCategory> => {
      const { id, ...rest } = input;
      const { data, error } = await supabase
        .from("project_categories")
        .update(rest)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKey(teamId) });
    },
  });
}

/** Deletes a project category. */
export function useDeleteCategory() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("project_categories")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesKey(teamId) });
    },
  });
}
