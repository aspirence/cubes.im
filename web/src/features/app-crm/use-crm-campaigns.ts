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
  CrmCampaign,
  CrmCampaignSpend,
  CrmCampaignStatus,
} from "./types";

const campaignsKey = (teamId: string | undefined) =>
  ["crm-campaigns", teamId] as const;

/** `campaignId` undefined = every spend row in the team (list totals). */
const spendKey = (teamId: string | undefined, campaignId: string | undefined) =>
  ["crm-campaign-spend", teamId, campaignId ?? "all"] as const;

/** Prefix that invalidates both the per-campaign and the team-wide spend lists. */
const spendRootKey = (teamId: string | undefined) =>
  ["crm-campaign-spend", teamId] as const;

export type CrmCampaignPatch = Partial<
  Omit<
    CrmCampaign,
    "id" | "team_id" | "created_at" | "updated_at" | "created_by" | "status"
  >
> & { status?: CrmCampaignStatus };

/** One day's spend on one campaign. Re-entering a day overwrites it. */
export type CrmCampaignSpendInput = {
  campaign_id: string;
  /** `YYYY-MM-DD` — the unique day key, so pass a formatted date, not an ISO ts. */
  spend_on: string;
  amount: number;
  note?: string | null;
};

/**
 * All the active team's campaigns, soft-deleted ones included — pages split on
 * `deleted_at` so the "Deleted" view and restore need no second query.
 */
export function useCrmCampaigns() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: campaignsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmCampaign[]> => {
      const { data, error } = await supabase
        .from("app_crm_campaigns")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateCrmCampaign() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CrmCampaignPatch & { name: string }) => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_campaigns")
        .insert({ ...input, team_id: teamId, created_by: user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignsKey(teamId) });
    },
  });
}

export function useUpdateCrmCampaign() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; patch: CrmCampaignPatch }) => {
      const { error } = await supabase
        .from("app_crm_campaigns")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignsKey(teamId) });
    },
  });
}

/** Soft delete (`deleted_at = now`) or restore (`deleted_at = null`). */
export function useSetCrmCampaignDeleted() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; deleted: boolean }) => {
      const { error } = await supabase
        .from("app_crm_campaigns")
        .update({
          deleted_at: input.deleted ? new Date().toISOString() : null,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignsKey(teamId) });
    },
  });
}

/**
 * Permanently destroys a campaign. Its daily spend cascades with the row and
 * attached deals keep their history with `campaign_id` SET NULL, so the deal
 * list is refreshed too.
 */
export function useDestroyCrmCampaign() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_crm_campaigns")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: campaignsKey(teamId) });
      queryClient.invalidateQueries({ queryKey: spendRootKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["crm-deals", teamId] });
    },
  });
}

/**
 * Daily spend rows, newest day first. Pass a `campaignId` for one campaign's
 * ledger, or omit it for every row in the team (cost-per-lead across the list).
 */
export function useCrmCampaignSpend(campaignId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: spendKey(teamId, campaignId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmCampaignSpend[]> => {
      let query = supabase
        .from("app_crm_campaign_spend")
        .select("*")
        .eq("team_id", teamId as string);
      if (campaignId) query = query.eq("campaign_id", campaignId);
      const { data, error } = await query.order("spend_on", {
        ascending: false,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Writes one day of spend. `(campaign_id, spend_on)` is unique, so re-entering
 * a day updates that day instead of stacking a second row.
 */
export function useUpsertCampaignSpend() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CrmCampaignSpendInput) => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_campaign_spend")
        .upsert(
          {
            ...input,
            team_id: teamId,
            created_by: user?.id ?? null,
            // A figure someone typed is an ACTUAL, so it also promotes a day
            // the nightly budget sweep had filled in with an estimate.
            source: "manual",
          },
          { onConflict: "campaign_id,spend_on" },
        )
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spendRootKey(teamId) });
    },
  });
}

export function useDeleteCampaignSpend() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_crm_campaign_spend")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: spendRootKey(teamId) });
    },
  });
}
