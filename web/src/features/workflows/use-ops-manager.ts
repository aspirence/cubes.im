"use client";

import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Agent } from "./use-agents";

/** RPCs / columns newer than the generated database types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** Ops-manager fields added to `agents` by the 20261064 migration. */
export type OpsAgent = Agent & {
  kind: string | null;
  ops_config: OpsConfig | null;
  ops_last_scan_at: string | null;
  ops_next_scan_at: string | null;
};

export interface OpsConfig {
  channel_id?: string | null;
  stalled_days?: number;
  at_risk_days?: number;
  overload_open?: number;
  heavy_revision_count?: number;
  auto_nudge?: boolean;
}

export type OpsInsightKind =
  | "overdue"
  | "at_risk"
  | "stalled"
  | "heavy_revisions"
  | "overloaded"
  | "quality_flag";

export interface OpsInsight {
  id: string;
  team_id: string;
  agent_id: string;
  scan_id: string;
  kind: OpsInsightKind;
  severity: "low" | "med" | "high";
  task_id: string | null;
  project_id: string | null;
  team_member_id: string | null;
  subject_user_id: string | null;
  title: string;
  detail: string | null;
  metric: Record<string, unknown>;
  suggested_ask: string | null;
  status: "open" | "nudged" | "resolved" | "dismissed";
  created_at: string;
  updated_at: string;
}

export interface OpsPulseRow {
  name: string;
  open: number;
  overdue: number;
  completed_7d: number;
  logged_min_7d: number;
}

export interface OpsScanResult {
  scan_id: string;
  generated_at: string;
  counts: Partial<Record<OpsInsightKind, number>>;
  pulse: OpsPulseRow[];
}

const insightsKey = (agentId: string | undefined) =>
  ["ops-insights", agentId] as const;

/** The open + nudged findings for an ops agent (latest scan first). */
export function useOpsInsights(agentId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: insightsKey(agentId),
    enabled: Boolean(agentId),
    queryFn: async (): Promise<OpsInsight[]> => {
      const { data, error } = await loose(supabase)
        .from("ops_insights")
        .select("*")
        .eq("agent_id", agentId as string)
        .in("status", ["open", "nudged"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OpsInsight[];
    },
  });
}

/** Run the deterministic ops scan for an agent; returns the scan summary. */
export function useRunOpsScan() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();

  return useMutation({
    mutationFn: async (input: {
      agentId: string;
      params?: Record<string, unknown>;
    }): Promise<OpsScanResult> => {
      if (!activeTeam?.id) throw new Error("No active team");
      const { data, error } = await loose(supabase).rpc("ops_manager_scan", {
        p_team_id: activeTeam.id,
        p_agent_id: input.agentId,
        p_params: input.params ?? {},
      });
      if (error) throw error;
      return data as OpsScanResult;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: insightsKey(input.agentId) });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** Nudge the assignee for one finding in a chat channel + notify them. */
export function useOpsNudge() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      insightId: string;
      channelId: string;
      agentId: string;
    }): Promise<string> => {
      const { data, error } = await loose(supabase).rpc("ops_nudge", {
        p_insight_id: input.insightId,
        p_channel_id: input.channelId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: insightsKey(input.agentId) });
    },
  });
}

/** Post a formatted delivery digest of the latest scan into a channel. */
export function useOpsPostDigest() {
  const supabase = useMemo(() => createClient(), []);
  return useMutation({
    mutationFn: async (input: {
      agentId: string;
      channelId: string;
    }): Promise<string> => {
      const { data, error } = await loose(supabase).rpc("ops_post_digest", {
        p_agent_id: input.agentId,
        p_channel_id: input.channelId,
      });
      if (error) throw error;
      return data as string;
    },
  });
}

/** Resolve / dismiss / reopen a finding. */
export function useSetInsightStatus() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      insightId: string;
      status: OpsInsight["status"];
      agentId: string;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("ops_set_insight_status", {
        p_insight_id: input.insightId,
        p_status: input.status,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: insightsKey(input.agentId) });
    },
  });
}

/** Create a preconfigured agent from a template (e.g. 'ops_manager'). */
export function useCreateAgentFromTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  return useMutation({
    mutationFn: async (templateKey: string): Promise<string> => {
      if (!activeTeam?.id) throw new Error("No active team");
      const { data, error } = await loose(supabase).rpc(
        "create_agent_from_template",
        { p_team_id: activeTeam.id, p_template_key: templateKey },
      );
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** Update an ops agent's config (channel, thresholds, auto-nudge). */
export function useUpdateOpsConfig() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      agentId: string;
      opsConfig: OpsConfig;
    }): Promise<void> => {
      const { error } = await loose(supabase)
        .from("agents")
        .update({ ops_config: input.opsConfig })
        .eq("id", input.agentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
