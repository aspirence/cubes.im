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

export type Client = Database["public"]["Tables"]["clients"]["Row"];

const clientsKey = (teamId: string | undefined) =>
  ["clients", teamId] as const;

/**
 * Lists the active team's clients. Scoped to `useActiveTeam()`; the query stays
 * disabled until an active team id is known. RLS additionally guarantees a
 * caller only sees clients for teams they belong to.
 */
export function useClients() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: clientsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Client[]> => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a client in the active team (admin-only via RLS). */
export function useCreateClient() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: { name: string }): Promise<Client> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("clients")
        .insert({ name: input.name, team_id: teamId })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientsKey(teamId) });
    },
  });
}

/** Renames a client. */
export function useUpdateClient() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
    }): Promise<Client> => {
      const { data, error } = await supabase
        .from("clients")
        .update({ name: input.name })
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientsKey(teamId) });
    },
  });
}

/** Deletes a client. */
export function useDeleteClient() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientsKey(teamId) });
    },
  });
}
