"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { HttpHostRow } from "@/app/api/workflows/http-hosts/host-rules";

/**
 * The allowed-hosts list, read and written through /api/workflows/http-hosts
 * rather than straight through PostgREST. The route is where the host is
 * normalised into the exact string the run-time checker compares against, so a
 * direct insert from here would be a second, divergent set of rules for an
 * SSRF control. RLS would still hold, but the entry could be a dead one.
 */

const hostsKey = (teamId: string | undefined) => ["team-http-hosts", teamId] as const;

/** A route error is a sentence meant for the admin; surface it, not "500". */
async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "Something went wrong.");
  }
  return payload as T;
}

/** Whether the current user may change the list — the table's write policy. */
export function useCanManageHttpHosts() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["is-team-admin", teamId] as const,
    enabled: Boolean(teamId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_team_admin", { _team_id: teamId as string });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function useHttpHosts() {
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: hostsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<HttpHostRow[]> => {
      const res = await fetch(`/api/workflows/http-hosts?team_id=${encodeURIComponent(teamId as string)}`);
      const { hosts } = await readJson<{ hosts: HttpHostRow[] }>(res);
      return hosts ?? [];
    },
  });
}

/** Resolves to the host as actually stored, which may differ from what was typed. */
export function useAddHttpHost() {
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { host: string; note?: string }): Promise<string> => {
      if (!teamId) throw new Error("No active workspace.");
      const res = await fetch("/api/workflows/http-hosts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team_id: teamId, ...input }),
      });
      const { host } = await readJson<{ host: string }>(res);
      return host;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hostsKey(teamId) });
    },
  });
}

export function useRemoveHttpHost() {
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (host: string): Promise<void> => {
      if (!teamId) throw new Error("No active workspace.");
      const query = new URLSearchParams({ team_id: teamId, host });
      const res = await fetch(`/api/workflows/http-hosts?${query}`, { method: "DELETE" });
      await readJson<{ removed: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hostsKey(teamId) });
    },
  });
}
