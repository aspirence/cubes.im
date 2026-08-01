"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { CRM_LABEL_COLOR_DEFAULT, type CrmLabel } from "./types";

const labelsKey = (teamId: string | undefined) =>
  ["crm-labels", teamId] as const;

/** The team's tag vocabulary, in the order Settings put them. */
export function useCrmLabels() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: labelsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmLabel[]> => {
      const { data, error } = await supabase
        .from("app_crm_labels")
        .select("*")
        .eq("team_id", teamId as string)
        .order("position", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Creates a tag and returns the row.
 *
 * Returning it matters: the picker creates a tag mid-gesture ("type a name,
 * hit Create") and has to put it straight onto the lead the user is looking
 * at, which needs the new id before the list refetches.
 */
export function useCreateCrmLabel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      name: string;
      color?: string;
      position?: number;
    }): Promise<CrmLabel> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_labels")
        .insert({
          team_id: teamId,
          name: input.name,
          color: input.color ?? CRM_LABEL_COLOR_DEFAULT,
          position: input.position ?? 0,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: labelsKey(teamId) }),
  });
}

/** Renames or recolours a tag. */
export function useUpdateCrmLabel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: { name?: string; color?: string; position?: number };
    }) => {
      const { data, error } = await supabase
        .from("app_crm_labels")
        .update(input.patch)
        .eq("id", input.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      // Same reasoning as useUpdateCrmDeal: a zero-row update is not an error
      // to PostgREST, so without this a refused write reads as a success.
      if (!data) throw new Error("That tag could not be updated.");
    },
    onSuccess: () => {
      // Deals carry the tag rows inline, so a rename has to reach them too.
      void queryClient.invalidateQueries({ queryKey: ["crm-deals", teamId] });
      return queryClient.invalidateQueries({ queryKey: labelsKey(teamId) });
    },
  });
}

/**
 * Deletes a tag, which un-tags every lead carrying it (the FK cascades).
 *
 * That is the deliberate choice: refusing to delete a tag that is in use
 * strands it forever once it is on a hundred leads, and the caller warns with
 * the count before it gets here.
 */
export function useDeleteCrmLabel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_crm_labels")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["crm-deals", teamId] });
      return queryClient.invalidateQueries({ queryKey: labelsKey(teamId) });
    },
  });
}

/**
 * Puts a tag on a lead or takes it off.
 *
 * One mutation for both directions because the picker's checkbox is one
 * gesture, and because `attached` is what the caller already knows. Tagging an
 * already-tagged lead is a no-op at the database (the pair is the primary key),
 * so a double-click cannot create a duplicate.
 */
export function useSetCrmDealLabel() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      dealId: string;
      labelId: string;
      attached: boolean;
    }) => {
      if (!teamId) throw new Error("No active team");
      if (input.attached) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error } = await supabase.from("app_crm_deal_labels").upsert(
          {
            team_id: teamId,
            deal_id: input.dealId,
            label_id: input.labelId,
            created_by: user?.id ?? null,
          },
          { onConflict: "deal_id,label_id", ignoreDuplicates: true },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("app_crm_deal_labels")
          .delete()
          .eq("deal_id", input.dealId)
          .eq("label_id", input.labelId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["crm-activities", teamId],
      });
      return queryClient.invalidateQueries({ queryKey: ["crm-deals", teamId] });
    },
  });
}
