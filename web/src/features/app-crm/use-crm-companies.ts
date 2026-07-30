"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { CrmCompany } from "./types";

const companiesKey = (teamId: string | undefined) =>
  ["crm-companies", teamId] as const;

export type CrmCompanyPatch = Partial<
  Omit<CrmCompany, "id" | "team_id" | "created_at" | "updated_at" | "created_by">
>;

/**
 * All the active team's companies, soft-deleted ones included — pages split on
 * `deleted_at` so the "Deleted" view and restore need no second query.
 */
export function useCrmCompanies() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: companiesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmCompany[]> => {
      const { data, error } = await supabase
        .from("app_crm_companies")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCrmCompany() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CrmCompanyPatch & { name: string }) => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_companies")
        .insert({ ...input, team_id: teamId, created_by: user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companiesKey(teamId) });
    },
  });
}

export function useUpdateCrmCompany() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; patch: CrmCompanyPatch }) => {
      const { error } = await supabase
        .from("app_crm_companies")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companiesKey(teamId) });
    },
  });
}

/** Soft delete (`deleted_at = now`) or restore (`deleted_at = null`). */
export function useSetCrmCompanyDeleted() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; deleted: boolean }) => {
      const { error } = await supabase
        .from("app_crm_companies")
        .update({
          deleted_at: input.deleted ? new Date().toISOString() : null,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companiesKey(teamId) });
    },
  });
}

/**
 * Permanently destroys a company. Task/note targets and reminders have no FK
 * onto the record (polymorphic), so they are cleaned up here; people/deals FKs
 * SET NULL. A skipped reminder would keep firing at a row that is gone.
 */
export function useDestroyCrmCompany() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      for (const table of [
        "app_crm_task_targets",
        "app_crm_note_targets",
        "app_crm_reminders",
      ] as const) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("target_type", "company")
          .eq("target_id", id);
        if (error) throw error;
      }
      const { error } = await supabase
        .from("app_crm_companies")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: companiesKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["crm-people", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-deals", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-tasks", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-notes", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-reminders", teamId] });
    },
  });
}
