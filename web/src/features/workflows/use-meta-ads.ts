"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

/**
 * Meta Ads (Facebook Ads Manager) connections for workflows — the client half
 * of Workflows → Integrations and of the "Meta Ads: get insights" step picker.
 *
 * Reads go straight to app_meta_connections / app_meta_ad_accounts (members may
 * SELECT both; the token table is invisible to them). Changes go through
 * /api/integrations/meta/*, which check that the caller is a workspace admin
 * and write with the service role.
 *
 * The tables are newer than src/types/database.ts, hence the loose() cast; and
 * a read answers `notReady` instead of throwing while the migration
 * (20261151000000_meta_ads_connections.sql) has not reached the database.
 */

function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export interface MetaConnection {
  id: string;
  meta_user_id: string;
  meta_user_name: string | null;
  token_kind: "user" | "system_user";
  token_expires_at: string | null;
  enabled: boolean;
  revoked_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
}

export interface MetaAdAccountRow {
  id: string;
  connection_id: string;
  external_id: string;
  name: string;
  currency: string | null;
  timezone_name: string | null;
  account_status: number | null;
  business_name: string | null;
  enabled: boolean;
}

export interface MetaIntegration {
  notReady: boolean;
  connections: (MetaConnection & { accounts: MetaAdAccountRow[] })[];
}

const ROOT = "meta-ads";

/** Postgres "no such table" / PostgREST "not in the schema cache". */
function missingTable(error: { code?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200"));
}

export function useMetaIntegration() {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: [ROOT, "integration", teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<MetaIntegration> => {
      const { data: conns, error } = await supabase
        .from("app_meta_connections")
        .select(
          "id, meta_user_id, meta_user_name, token_kind, token_expires_at, enabled, revoked_at, last_test_at, last_test_ok, last_test_error, created_at",
        )
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: true });
      if (missingTable(error)) return { notReady: true, connections: [] };
      if (error) throw error;
      const { data: accounts, error: accError } = await supabase
        .from("app_meta_ad_accounts")
        .select("id, connection_id, external_id, name, currency, timezone_name, account_status, business_name, enabled")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });
      if (accError) throw accError;
      const rows = (accounts ?? []) as MetaAdAccountRow[];
      return {
        notReady: false,
        connections: ((conns ?? []) as MetaConnection[]).map((c) => ({
          ...c,
          accounts: rows.filter((a) => a.connection_id === c.id),
        })),
      };
    },
  });
}

/** Whether "Continue with Facebook" is set up on this server (env), and how. */
export function useMetaStatus() {
  return useQuery({
    queryKey: [ROOT, "status"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ configured: boolean; mode: "business" | "classic"; redirectUri: string | null }> => {
      const res = await fetch("/api/integrations/meta/status");
      if (!res.ok) return { configured: false, mode: "classic", redirectUri: null };
      return res.json();
    },
  });
}

/** The URL that starts the Facebook login for this workspace and comes back to `returnTo`. */
export function metaConnectUrl(teamId: string, returnTo: string): string {
  const qs = new URLSearchParams({ teamId, returnTo });
  return `/api/integrations/meta/start?${qs.toString()}`;
}

async function call(path: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Request failed.");
  return json;
}

export function useMetaMutations() {
  const qc = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id ?? "";
  const refresh = () => qc.invalidateQueries({ queryKey: [ROOT, "integration"] });
  return {
    refreshAccounts: useMutation({
      mutationFn: (connectionId: string) =>
        call("/api/integrations/meta/accounts", "POST", { teamId, connectionId }) as Promise<{ accounts?: number }>,
      onSettled: refresh,
    }),
    setAccountEnabled: useMutation({
      mutationFn: (v: { accountId: string; enabled: boolean }) =>
        call("/api/integrations/meta/accounts", "PATCH", { teamId, ...v }),
      onSettled: refresh,
    }),
    disconnect: useMutation({
      mutationFn: (connectionId: string) => call("/api/integrations/meta/disconnect", "POST", { teamId, connectionId }),
      onSettled: refresh,
    }),
  };
}
