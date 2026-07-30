"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import { useActiveTeam } from "@/features/teams/use-teams";

/**
 * Personal MCP access tokens (App Center → MCP). The raw token is generated
 * client-side, shown once, and only its SHA-256 hash is stored — matching
 * what the /api/mcp route verifies against.
 */

export interface McpTokenRow {
  id: string;
  name: string;
  team_id: string;
  team_name: string | null;
  revoked: boolean;
  last_used_at: string | null;
  created_at: string;
}

const tokensKey = ["mcp-tokens"] as const;

export function useMcpTokens() {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: tokensKey,
    queryFn: async (): Promise<McpTokenRow[]> => {
      const { data, error } = await supabase
        .from("mcp_tokens")
        .select("id, name, team_id, revoked, last_used_at, created_at, team:teams ( name )")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        team_id: t.team_id,
        team_name: (t.team as { name: string } | null)?.name ?? null,
        revoked: t.revoked,
        last_used_at: t.last_used_at,
        created_at: t.created_at,
      }));
    },
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `cubes_mcp_${hex}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates a token bound to the ACTIVE workspace; resolves with the raw token. */
export function useCreateMcpToken() {
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const { data: activeTeam } = useActiveTeam();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string): Promise<string> => {
      if (!profile?.id || !activeTeam?.id) throw new Error("No active workspace.");
      const token = randomToken();
      const { error } = await supabase.from("mcp_tokens").insert({
        user_id: profile.id,
        team_id: activeTeam.id,
        name: name.trim() || "Claude",
        token_hash: await sha256Hex(token),
      });
      if (error) throw error;
      return token;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  });
}

export function useRevokeMcpToken() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("mcp_tokens")
        .update({ revoked: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  });
}

export function useDeleteMcpToken() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("mcp_tokens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  });
}
