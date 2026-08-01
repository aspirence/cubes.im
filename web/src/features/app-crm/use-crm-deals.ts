"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type {
  CrmDeal,
  CrmDealWithRefs,
  CrmLeadStatus,
  CrmLeadTier,
} from "./types";

const dealsKey = (teamId: string | undefined) => ["crm-deals", teamId] as const;

/**
 * Everything a deal write may carry. `amount`/`currency_code` are omitted on
 * purpose: deals no longer track money, so the columns stay in the table
 * (nullable / defaulted) but nothing may write to them again.
 *
 * `status` and `tier` are re-added narrowed to their fixed vocabularies (both
 * DB columns are plain text behind check constraints); `campaign_id` rides
 * along from the row type. Three axes, deliberately: `stage_id` is the board,
 * `status` is how the lead is doing, `tier` is what it is worth. `tier` stays
 * nullable — ungraded is a real state, not a missing one.
 */
export type CrmDealPatch = Partial<
  Omit<
    CrmDeal,
    | "id"
    | "team_id"
    | "created_at"
    | "updated_at"
    | "created_by"
    | "amount"
    | "currency_code"
    | "status"
    | "tier"
  >
> & { status?: CrmLeadStatus; tier?: CrmLeadTier | null };

/** All the active team's deals (soft-deleted included), board-ordered. */
export function useCrmDeals() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: dealsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmDealWithRefs[]> => {
      const { data, error } = await supabase
        .from("app_crm_deals")
        .select(
          `*, company:app_crm_companies ( id, name ),
              contact:app_crm_people ( id, first_name, last_name )`,
        )
        .eq("team_id", teamId as string)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CrmDealWithRefs[];
    },
  });
}

export function useCreateCrmDeal() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CrmDealPatch & { name: string }) => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_deals")
        .insert({ ...input, team_id: teamId, created_by: user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealsKey(teamId) });
    },
  });
}

/**
 * Writes a patch and **proves** it landed: PostgREST does not error when an
 * update matches zero rows (a wrong id, or a row RLS hides), so without
 * selecting the row back a rejected write resolves as a success and the caller
 * shows a value the database never took. `onSuccess` returns the invalidation
 * so `mutateAsync` only settles once the list has refetched — the inline
 * editors rely on that to release their optimistic hold without a flash.
 */
export function useUpdateCrmDeal() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; patch: CrmDealPatch }) => {
      const { data, error } = await supabase
        .from("app_crm_deals")
        .update(input.patch)
        .eq("id", input.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("That deal could not be updated.");
    },
    onSuccess: () => {
      // The timeline is trigger-written, so every update adds a row to it.
      // Not awaited: the drawer's Timeline tab can catch up on its own.
      void queryClient.invalidateQueries({
        queryKey: ["crm-activities", teamId],
      });
      return queryClient.invalidateQueries({ queryKey: dealsKey(teamId) });
    },
  });
}

/**
 * Kanban drop: writes stage + fractional position with an optimistic cache
 * update so the card doesn't snap back while the write is in flight.
 */
export function useMoveCrmDeal() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      stage_id: string | null;
      position: number;
    }) => {
      const { error } = await supabase
        .from("app_crm_deals")
        .update({ stage_id: input.stage_id, position: input.position })
        .eq("id", input.id);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: dealsKey(teamId) });
      const previous = queryClient.getQueryData<CrmDealWithRefs[]>(
        dealsKey(teamId),
      );
      queryClient.setQueryData<CrmDealWithRefs[]>(dealsKey(teamId), (old) =>
        (old ?? [])
          .map((d) =>
            d.id === input.id
              ? { ...d, stage_id: input.stage_id, position: input.position }
              : d,
          )
          .sort((a, b) => a.position - b.position),
      );
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(dealsKey(teamId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dealsKey(teamId) });
    },
  });
}

/** Soft delete / restore. */
export function useSetCrmDealDeleted() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; deleted: boolean }) => {
      const { error } = await supabase
        .from("app_crm_deals")
        .update({
          deleted_at: input.deleted ? new Date().toISOString() : null,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealsKey(teamId) });
    },
  });
}

/**
 * Permanent destroy + polymorphic target cleanup. Task targets, note targets
 * AND reminders all point at the record by `(target_type, target_id)` with no
 * FK, so nothing cascades — an uncleaned reminder would keep firing a
 * notification at a row that no longer exists.
 */
export function useDestroyCrmDeal() {
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
          .eq("target_type", "deal")
          .eq("target_id", id);
        if (error) throw error;
      }
      const { error } = await supabase
        .from("app_crm_deals")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealsKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["crm-tasks", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-notes", teamId] });
      queryClient.invalidateQueries({ queryKey: ["crm-reminders", teamId] });
    },
  });
}
