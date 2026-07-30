"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type AppConnection =
  Database["public"]["Tables"]["app_connections"]["Row"];
export type AppProvider = "webhook" | "slack" | "email" | "whatsapp";

const connectionsKey = (orgId: string | undefined) =>
  ["app-connections", orgId] as const;

/** Whether the current user is an admin of the active organization. */
export function useIsOrgAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const orgId = activeTeam?.organization_id ?? undefined;

  return useQuery({
    queryKey: ["is-org-admin", orgId] as const,
    enabled: Boolean(orgId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_org_admin", {
        _org_id: orgId as string,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

/**
 * Lists the active organization's connections. Scoped to the active team's org;
 * RLS additionally guarantees only org members can read them.
 */
export function useAppConnections() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const orgId = activeTeam?.organization_id ?? undefined;

  return useQuery({
    queryKey: connectionsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<AppConnection[]> => {
      const { data, error } = await supabase
        .from("app_connections")
        .select("*")
        .eq("org_id", orgId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CreateConnectionInput {
  provider: AppProvider;
  name: string;
  /** Non-secret display config (webhook url, slack channel label, etc.). */
  config?: Record<string, string>;
}

/** Creates a connection in the active org (org admin only via RLS). */
export function useCreateConnection() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const orgId = activeTeam?.organization_id ?? undefined;

  return useMutation({
    mutationFn: async (input: CreateConnectionInput): Promise<AppConnection> => {
      if (!orgId) throw new Error("No active organization");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_connections")
        .insert({
          org_id: orgId,
          provider: input.provider,
          name: input.name,
          config: input.config ?? {},
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionsKey(orgId) });
    },
  });
}

export interface UpdateConnectionInput {
  id: string;
  name?: string;
  enabled?: boolean;
  config?: Record<string, string>;
}

/** Updates connection metadata only (name / enabled / config) — never secrets. */
export function useUpdateConnection() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const orgId = activeTeam?.organization_id ?? undefined;

  return useMutation({
    mutationFn: async (input: UpdateConnectionInput): Promise<AppConnection> => {
      const patch: Database["public"]["Tables"]["app_connections"]["Update"] =
        {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      if (input.config !== undefined) patch.config = input.config;

      const { data, error } = await supabase
        .from("app_connections")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionsKey(orgId) });
    },
  });
}

/** Deletes a connection (org admin only via RLS). */
export function useDeleteConnection() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const orgId = activeTeam?.organization_id ?? undefined;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("app_connections")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionsKey(orgId) });
    },
  });
}

export interface SaveSecretsInput {
  id: string;
  /** Only the fields the user typed; blank values leave the stored secret. */
  credentials: Record<string, string>;
}

/** Upserts credentials via the service-role route (org admin enforced there). */
export function useSaveSecrets() {
  return useMutation({
    mutationFn: async (input: SaveSecretsInput): Promise<void> => {
      const res = await fetch(`/api/apps/${input.id}/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentials: input.credentials }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save credentials.");
    },
  });
}

/** Fires a provider-specific test; refreshes the list so the health dot updates. */
export function useTestConnection() {
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const orgId = activeTeam?.organization_id ?? undefined;

  return useMutation({
    mutationFn: async (
      id: string,
    ): Promise<{ ok: boolean; detail: string }> => {
      const res = await fetch(`/api/apps/${id}/test`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Test failed.");
      return { ok: Boolean(json.ok), detail: json.detail ?? "" };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionsKey(orgId) });
    },
  });
}
