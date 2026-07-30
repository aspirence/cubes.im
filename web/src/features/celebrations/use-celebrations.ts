"use client";

import { useCallback, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import { useCelebrationStore } from "@/store/celebration-store";

/** RPCs/tables newer than the generated database.ts types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export type CelebrationTemplate = "burst" | "glow" | "stats";

export interface CelebrationRule {
  id: string;
  team_id: string;
  event_key: string;
  label: string;
  enabled: boolean;
  template: CelebrationTemplate;
}

/**
 * Balance thresholds that earn a milestone celebration. Client-derived and
 * celebration-only: crossing one pays NO cubes in v1 — awarding a
 * client-detected event would be a farming vector (phase 2 is a
 * server-validated claim RPC if milestones should ever pay out).
 */
export const CUBE_MILESTONES = [50, 100, 250, 500, 1000] as const;

const rulesKey = (t: string | undefined) => ["celebration-rules", t] as const;
const balanceKey = (t: string | undefined) => ["my-cube-balance", t] as const;

/** The workspace's celebration rules (any member can read). */
export function useCelebrationRules() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: rulesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CelebrationRule[]> => {
      const { data, error } = await loose(supabase).rpc("list_celebration_rules", {
        p_team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []) as CelebrationRule[];
    },
  });
}

/** Edit a rule's enabled/template (admins/owners — the RPC re-checks). */
export function useSetCelebrationRule() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      eventKey: string;
      enabled: boolean;
      template: CelebrationTemplate;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("set_celebration_rule", {
        p_team_id: teamId,
        p_event_key: input.eventKey,
        p_enabled: input.enabled,
        p_template: input.template,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rulesKey(teamId) });
    },
  });
}

export interface MyCubeStats {
  balance: number;
  /** Ledger rows dated today (viewer-local) — feeds the Stats template. */
  eventsToday: number;
}

/**
 * The viewer's own ledger truth, read fresh. The explicit user_id filter is
 * REQUIRED: the ledger's RLS also lets ADMINS read everyone's rows, so without
 * it an admin would sum the whole team. Read at celebration-resolve time (not
 * from a cached hook) so the number can't race the award that triggered it.
 */
export async function fetchMyCubeStats(
  supabase: ReturnType<typeof createClient>,
  teamId: string,
  userId: string,
): Promise<MyCubeStats> {
  const { data, error } = await loose(supabase)
    .from("cube_events")
    .select("points, created_at")
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw error;
  const rows = (data ?? []) as { points: number; created_at: string }[];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return {
    balance: rows.reduce((s, r) => s + (r.points ?? 0), 0),
    eventsToday: rows.filter((r) => new Date(r.created_at) >= startOfDay).length,
  };
}

/** Hook flavour of the same read (leaderboard-adjacent UI). */
export function useMyCubeStats() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: balanceKey(teamId),
    enabled: Boolean(teamId && user),
    queryFn: () => fetchMyCubeStats(supabase, teamId as string, user!.id),
  });
}

/**
 * The cubes actually credited to `userId` for `taskId`. `fresh` is true only
 * when an award landed near the completion signal — a reopen + re-complete
 * inserts NOTHING (idempotent partial unique index), and a non-assignee
 * completer earns nothing, so celebration copy shows "+N cubes" only when this
 * says fresh. The 30s window tolerates clock skew between client and DB.
 */
export async function fetchTaskAward(
  supabase: ReturnType<typeof createClient>,
  teamId: string,
  taskId: string,
  userId: string,
  signalAt: number,
): Promise<{ points: number; fresh: boolean }> {
  const { data, error } = await loose(supabase)
    .from("cube_events")
    .select("points, created_at")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .eq("source_type", "task")
    .eq("source_id", taskId);
  if (error) throw error;
  const rows = (data ?? []) as { points: number; created_at: string }[];
  const cutoff = signalAt - 30_000;
  const freshRows = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
  return {
    points: freshRows.reduce((s, r) => s + (r.points ?? 0), 0),
    fresh: freshRows.length > 0,
  };
}

/** True when the status change is open → done (the celebratory transition). */
export function isDoneTransition(
  target: { isDone?: boolean | null } | undefined,
  current: { isDone?: boolean | null } | undefined,
): boolean {
  return Boolean(target?.isDone) && !current?.isDone;
}

/**
 * The one-liner for call sites: fire-and-forget "this task just went done".
 * No gating here — the overlay controller applies rules/mute/award lookup.
 */
export function useCelebrateTaskDone() {
  const enqueue = useCelebrationStore((s) => s.enqueue);
  return useCallback(
    (input: { taskId: string; taskName?: string }) => {
      enqueue({
        kind: "task_done",
        taskId: input.taskId,
        taskName: input.taskName,
        at: Date.now(),
      });
    },
    [enqueue],
  );
}
