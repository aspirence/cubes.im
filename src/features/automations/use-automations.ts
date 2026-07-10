"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/types/database";

/**
 * Project-scoped "when X then Y" automation rules. Rules are stored in the
 * `automations` table and fired by DB triggers on tasks / tasks_assignees —
 * see the automations_engine migration. The client only does rule CRUD; all
 * execution happens in Postgres.
 */

export type Automation = Database["public"]["Tables"]["automations"]["Row"];
export type AutomationRun =
  Database["public"]["Tables"]["automation_runs"]["Row"];

export type AutomationTriggerType =
  | "task_created"
  | "status_changed"
  | "priority_changed"
  | "task_completed"
  | "assignee_added";

export type AutomationActionType =
  | "set_status"
  | "set_priority"
  | "assign_member"
  | "add_label"
  | "notify_member"
  | "add_comment";

const AUTOMATIONS_ROOT = "automations" as const;

const projectAutomationsKey = (projectId: string | undefined) =>
  [AUTOMATIONS_ROOT, "project", projectId] as const;

const automationRunsKey = (automationId: string | undefined) =>
  [AUTOMATIONS_ROOT, "runs", automationId] as const;

/** Lists a project's automation rules (RLS: any project team member). */
export function useProjectAutomations(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: projectAutomationsKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Automation[]> => {
      const { data, error } = await supabase
        .from("automations")
        .select("*")
        .eq("project_id", projectId as string)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Most recent runs for one rule — the debugging trail behind run_count. */
export function useAutomationRuns(automationId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: automationRunsKey(automationId),
    enabled: Boolean(automationId),
    queryFn: async (): Promise<AutomationRun[]> => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("*")
        .eq("automation_id", automationId as string)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CreateAutomationInput {
  projectId: string;
  name: string;
  triggerType: AutomationTriggerType;
  triggerConfig?: Json;
  actionType: AutomationActionType;
  actionConfig?: Json;
}

/** Creates a rule (RLS: project team admins / project owner). */
export function useCreateAutomation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateAutomationInput): Promise<Automation> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const { data, error } = await supabase
        .from("automations")
        .insert({
          project_id: input.projectId,
          name: input.name,
          trigger_type: input.triggerType,
          trigger_config: input.triggerConfig ?? {},
          action_type: input.actionType,
          action_config: input.actionConfig ?? {},
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({
        queryKey: projectAutomationsKey(created.project_id),
      });
    },
  });
}

export interface UpdateAutomationInput {
  id: string;
  projectId: string;
  name?: string;
  enabled?: boolean;
  triggerType?: AutomationTriggerType;
  triggerConfig?: Json;
  actionType?: AutomationActionType;
  actionConfig?: Json;
}

/** Updates a rule's definition or toggles it. */
export function useUpdateAutomation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateAutomationInput): Promise<Automation> => {
      const { data, error } = await supabase
        .from("automations")
        .update({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.triggerType !== undefined
            ? { trigger_type: input.triggerType }
            : {}),
          ...(input.triggerConfig !== undefined
            ? { trigger_config: input.triggerConfig }
            : {}),
          ...(input.actionType !== undefined
            ? { action_type: input.actionType }
            : {}),
          ...(input.actionConfig !== undefined
            ? { action_config: input.actionConfig }
            : {}),
        })
        .eq("id", input.id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: projectAutomationsKey(input.projectId),
      });
    },
  });
}

/** Deletes a rule (runs cascade). */
export function useDeleteAutomation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
    }): Promise<void> => {
      const { error } = await supabase
        .from("automations")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: projectAutomationsKey(input.projectId),
      });
    },
  });
}
