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

export type Workflow = Database["public"]["Tables"]["workflows"]["Row"];
export type WorkflowStep = Database["public"]["Tables"]["workflow_steps"]["Row"];

/** Whether the current user is an admin of the active team (workflow write gate). */
export function useIsTeamAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["is-team-admin", teamId] as const,
    enabled: Boolean(teamId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_team_admin", {
        _team_id: teamId as string,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
}

const workflowsKey = (teamId: string | undefined) =>
  ["workflows", teamId] as const;
const workflowKey = (id: string | undefined) =>
  ["workflow", id] as const;
const stepsKey = (workflowId: string | undefined) =>
  ["workflow-steps", workflowId] as const;

/** Lists the active team's workflows, newest first. */
export function useWorkflows() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: workflowsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Workflow[]> => {
      const { data, error } = await supabase
        .from("workflows")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Loads a single workflow. */
export function useWorkflow(id: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: workflowKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<Workflow> => {
      const { data, error } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", id as string)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

/** Loads a workflow's steps ordered by position. */
export function useWorkflowSteps(workflowId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: stepsKey(workflowId),
    enabled: Boolean(workflowId),
    queryFn: async (): Promise<WorkflowStep[]> => {
      const { data, error } = await supabase
        .from("workflow_steps")
        .select("*")
        .eq("workflow_id", workflowId as string)
        .order("position", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateWorkflow() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
    }): Promise<Workflow> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("workflows")
        .insert({
          team_id: teamId,
          name: input.name,
          description: input.description ?? null,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowsKey(teamId) });
    },
  });
}

export function useUpdateWorkflow() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (
      input: { id: string } & Database["public"]["Tables"]["workflows"]["Update"],
    ): Promise<Workflow> => {
      const { id, ...patch } = input;
      const { data, error } = await supabase
        .from("workflows")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (wf) => {
      queryClient.invalidateQueries({ queryKey: workflowsKey(teamId) });
      queryClient.invalidateQueries({ queryKey: workflowKey(wf.id) });
    },
  });
}

export function useDeleteWorkflow() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("workflows").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowsKey(teamId) });
    },
  });
}

/* ------------------------------------------------------------------ steps -- */

export function useCreateStep() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workflowId: string;
      position: number;
      stepKey: string;
      stepType: string;
      config: Record<string, unknown>;
    }): Promise<WorkflowStep> => {
      const { data, error } = await supabase
        .from("workflow_steps")
        .insert({
          workflow_id: input.workflowId,
          position: input.position,
          step_key: input.stepKey,
          step_type: input.stepType,
          config: input.config as never,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (step) => {
      queryClient.invalidateQueries({ queryKey: stepsKey(step.workflow_id) });
    },
  });
}

export function useUpdateStep() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      workflowId: string;
      config?: Record<string, unknown>;
      position?: number;
      enabled?: boolean;
    }): Promise<WorkflowStep> => {
      const patch: Database["public"]["Tables"]["workflow_steps"]["Update"] = {};
      if (input.config !== undefined) patch.config = input.config as never;
      if (input.position !== undefined) patch.position = input.position;
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      const { data, error } = await supabase
        .from("workflow_steps")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: stepsKey(input.workflowId) });
    },
  });
}

export function useDeleteStep() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      workflowId: string;
    }): Promise<void> => {
      const { error } = await supabase
        .from("workflow_steps")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: stepsKey(input.workflowId) });
    },
  });
}

/** Renumbers steps to a new order (sequential positions, 1-based). */
export function useReorderSteps() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workflowId: string;
      orderedIds: string[];
    }): Promise<void> => {
      // Positions are not unique, so sequential per-row updates are safe.
      for (let i = 0; i < input.orderedIds.length; i++) {
        const { error } = await supabase
          .from("workflow_steps")
          .update({ position: i + 1 })
          .eq("id", input.orderedIds[i]);
        if (error) throw error;
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: stepsKey(input.workflowId) });
    },
  });
}
