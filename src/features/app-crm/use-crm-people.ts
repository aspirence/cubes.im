"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { CrmPerson, CrmPersonWithCompany } from "./types";

const peopleKey = (teamId: string | undefined) =>
  ["crm-people", teamId] as const;

export type CrmPersonPatch = Partial<
  Omit<CrmPerson, "id" | "team_id" | "created_at" | "updated_at" | "created_by">
>;

/** All the active team's people (soft-deleted included), with their company. */
export function useCrmPeople() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: peopleKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmPersonWithCompany[]> => {
      const { data, error } = await supabase
        .from("app_crm_people")
        .select("*, company:app_crm_companies ( id, name )")
        .eq("team_id", teamId as string)
        .order("first_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CrmPersonWithCompany[];
    },
  });
}

export function useCreateCrmPerson() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CrmPersonPatch & { first_name: string }) => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_people")
        .insert({ ...input, team_id: teamId, created_by: user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: peopleKey(teamId) });
    },
  });
}

export function useUpdateCrmPerson() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; patch: CrmPersonPatch }) => {
      const { error } = await supabase
        .from("app_crm_people")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: peopleKey(teamId) });
    },
  });
}

/** Soft delete / restore. */
export function useSetCrmPersonDeleted() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; deleted: boolean }) => {
      const { error } = await supabase
        .from("app_crm_people")
        .update({
          deleted_at: input.deleted ? new Date().toISOString() : null,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: peopleKey(teamId) });
    },
  });
}

/** Permanent destroy + polymorphic target cleanup (deals contact SET NULL). */
export function useDestroyCrmPerson() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      for (const table of [
        "app_crm_task_targets",
        "app_crm_note_targets",
      ] as const) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("target_type", "person")
          .eq("target_id", id);
        if (error) throw error;
      }
      const { error } = await supabase
        .from("app_crm_people")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: peopleKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["crm-deals", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-tasks", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-notes", teamId] });
    },
  });
}
