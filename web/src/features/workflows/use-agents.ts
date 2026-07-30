"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  deriveSkillsFromAgentConfig,
  readAgentConfig,
  serializeAgentConfig,
} from "@/features/workflows/agent-config";
import type { Database, Json } from "@/types/database";

export type Agent = Database["public"]["Tables"]["agents"]["Row"];
export interface AgentSkill {
  skill: string;
  params?: Record<string, unknown>;
}
export interface UploadedAgentMascot {
  path: string;
  url: string;
}
export interface RunAgentInput {
  agentId: string;
  prompt?: string;
  trainingTaskId?: string | null;
}
export interface RunAgentResult {
  answer: string;
  model: string;
  prompt: string;
  usedMentions: string[];
  trainingTask: {
    id: string;
    title: string;
    instruction: string;
  } | null;
}

const agentsKey = (teamId: string | undefined) => ["agents", teamId] as const;
const AGENT_MASCOTS_BUCKET = "avatars" as const;

function fileExtension(fileName: string, fallback = "png"): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return fallback;
  return fileName.slice(dot + 1).toLowerCase();
}

/** Lists the active team's agents. */
export function useAgents() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: agentsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Agent[]> => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface AgentInput {
  name: string;
  emoji?: string | null;
  description?: string | null;
  skills?: AgentSkill[];
  dataScope?: Json;
}

export function useCreateAgent() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: AgentInput): Promise<Agent> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const config = readAgentConfig(input.dataScope);
      const skills = input.skills ?? deriveSkillsFromAgentConfig(config);
      const { data, error } = await supabase
        .from("agents")
        .insert({
          team_id: teamId,
          name: input.name,
          emoji: input.emoji ?? null,
          description: input.description ?? null,
          skills: skills as never,
          data_scope: input.dataScope ?? serializeAgentConfig(config),
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKey(teamId) });
    },
  });
}

export function useUpdateAgent() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (
      input: { id: string } & Partial<AgentInput>,
    ): Promise<Agent> => {
      const patch: Database["public"]["Tables"]["agents"]["Update"] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.emoji !== undefined) patch.emoji = input.emoji;
      if (input.description !== undefined) patch.description = input.description;
      if (input.dataScope !== undefined) {
        patch.data_scope = input.dataScope;
        if (input.skills === undefined) {
          patch.skills = deriveSkillsFromAgentConfig(
            readAgentConfig(input.dataScope),
          ) as never;
        }
      }
      if (input.skills !== undefined) patch.skills = input.skills as never;
      const { data, error } = await supabase
        .from("agents")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKey(teamId) });
    },
  });
}

export function useUploadAgentMascot() {
  const supabase = useMemo(() => createClient(), []);

  return useMutation({
    mutationFn: async (file: File): Promise<UploadedAgentMascot> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const ext = fileExtension(file.name);
      const path = `${user.id}/agent-mascots/${Date.now()}-${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AGENT_MASCOTS_BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
        });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(AGENT_MASCOTS_BUCKET).getPublicUrl(path);

      return { path, url: publicUrl };
    },
  });
}

async function postJson<T>(url: string, input: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload as T;
}

export function useRunAgent() {
  return useMutation({
    mutationFn: async (input: RunAgentInput): Promise<RunAgentResult> =>
      postJson<RunAgentResult>("/api/workflows/agents/run", input),
  });
}

export function useDeleteAgent() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("agents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKey(teamId) });
    },
  });
}

/** Activate / pause an agent (agents.is_active, added by 20261066). */
export function useToggleAgentActive() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }): Promise<void> => {
      const { error } = await (supabase as unknown as {
        from: (t: string) => {
          update: (v: Record<string, unknown>) => {
            eq: (c: string, v: string) => Promise<{ error: unknown }>;
          };
        };
      })
        .from("agents")
        .update({ is_active: input.active })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsKey(teamId) });
    },
  });
}
