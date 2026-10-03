"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

/**
 * Pickers for workflow app-step params: the team's sheets (sheets.sync) and
 * the CRM's stages and campaigns (crm.create_deal, crm.update_deal). The
 * tables belong to apps that may not be installed — or, on an environment
 * whose migrations lag, may not exist yet — so a missing table is a normal
 * state ("install the app"), not an error.
 */

// The Sheets / CRM tables are newer than the generated types.
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** PostgREST's "no such table": 42P01 from Postgres, PGRST205 from the schema cache. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? "");
}

export interface PickerState<T> {
  /** False when the app's table does not exist here. */
  available: boolean;
  rows: T[];
}

export interface SheetOption {
  id: string;
  name: string;
  project_id: string | null;
  /** Null when the Google links table is unavailable. */
  linked: boolean | null;
}

/** The active team's non-archived sheets, marked with whether each has a Google link. */
export function useWorkflowSheetOptions(enabled = true) {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["workflow-sheet-options", teamId] as const,
    enabled: Boolean(teamId) && enabled,
    queryFn: async (): Promise<PickerState<SheetOption>> => {
      const { data, error } = await supabase
        .from("app_sheets")
        .select("id, name, project_id")
        .eq("team_id", teamId as string)
        .eq("archived", false)
        .order("name", { ascending: true });
      if (isMissingTable(error)) return { available: false, rows: [] };
      if (error) throw error;
      const sheets = (data ?? []) as { id: string; name: string; project_id: string | null }[];

      let linkedIds: Set<string> | null = null;
      if (sheets.length) {
        const links = await supabase
          .from("app_sheet_google_links")
          .select("sheet_id")
          .in("sheet_id", sheets.map((s) => s.id));
        if (!links.error) {
          linkedIds = new Set(((links.data ?? []) as { sheet_id: string }[]).map((l) => l.sheet_id));
        }
      }
      return {
        available: true,
        rows: sheets.map((s) => ({ ...s, linked: linkedIds ? linkedIds.has(s.id) : null })),
      };
    },
  });
}

export interface CrmStageOption {
  id: string;
  name: string;
  position: number;
}

/**
 * The CRM board's stages. The CRM is admin-only (is_crm_admin), so a member
 * who is not a CRM admin gets an empty list rather than an error — the
 * picker then offers a name box, and crm.create_deal matches a name when the
 * step runs.
 */
export function useWorkflowCrmStageOptions(enabled = true) {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["workflow-crm-stage-options", teamId] as const,
    enabled: Boolean(teamId) && enabled,
    queryFn: async (): Promise<PickerState<CrmStageOption>> => {
      const { data, error } = await supabase
        .from("app_crm_stages")
        .select("id, name, position")
        .eq("team_id", teamId as string)
        .order("position", { ascending: true });
      if (isMissingTable(error)) return { available: false, rows: [] };
      if (error) throw error;
      return { available: true, rows: (data ?? []) as CrmStageOption[] };
    },
  });
}

export interface CrmCampaignOption {
  id: string;
  name: string;
  channel: string | null;
  status: string;
}

/** The team's CRM campaigns (lead sources with a spend ledger), same visibility rule as the stages. */
export function useWorkflowCrmCampaignOptions(enabled = true) {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["workflow-crm-campaign-options", teamId] as const,
    enabled: Boolean(teamId) && enabled,
    queryFn: async (): Promise<PickerState<CrmCampaignOption>> => {
      const { data, error } = await supabase
        .from("app_crm_campaigns")
        .select("id, name, channel, status")
        .eq("team_id", teamId as string)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (isMissingTable(error)) return { available: false, rows: [] };
      if (error) throw error;
      return { available: true, rows: (data ?? []) as CrmCampaignOption[] };
    },
  });
}
