"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type {
  CrmTask,
  CrmTaskWithTargets,
  CrmTargetRef,
} from "./types";

const tasksKey = (teamId: string | undefined) => ["crm-tasks", teamId] as const;

export type CrmTaskPatch = Partial<
  Omit<CrmTask, "id" | "team_id" | "created_at" | "updated_at" | "created_by">
>;

/** All the active team's CRM tasks with their record targets. */
export function useCrmTasks() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: tasksKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmTaskWithTargets[]> => {
      const { data, error } = await supabase
        .from("app_crm_tasks")
        .select("*, targets:app_crm_task_targets ( * )")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CrmTaskWithTargets[];
    },
  });
}

/** Creates a task and links it to the given records (Twenty's taskTargets). */
export function useCreateCrmTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (
      input: CrmTaskPatch & { title: string; targets?: CrmTargetRef[] },
    ) => {
      if (!teamId) throw new Error("No active team");
      const { targets, ...task } = input;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_tasks")
        .insert({ ...task, team_id: teamId, created_by: user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      if (targets && targets.length > 0) {
        const { error: targetsError } = await supabase
          .from("app_crm_task_targets")
          .insert(
            targets.map((t) => ({
              team_id: teamId,
              task_id: data.id,
              target_type: t.type,
              target_id: t.id,
            })),
          );
        if (targetsError) throw targetsError;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tasksKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["crm-activities", teamId] });
    },
  });
}

export function useUpdateCrmTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; patch: CrmTaskPatch }) => {
      const { error } = await supabase
        .from("app_crm_tasks")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tasksKey(teamId) });
    },
  });
}

/** Hard delete — targets cascade with the row. */
export function useDeleteCrmTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_crm_tasks")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tasksKey(teamId) });
    },
  });
}
