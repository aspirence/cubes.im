"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { tasksRootKey } from "@/features/tasks/use-tasks";
import type { Database, Json } from "@/types/database";

/** task_templates.deliverable_type is newer than the generated types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export type TaskTemplate =
  Database["public"]["Tables"]["task_templates"]["Row"] & {
    /** Deliverable this template produces: null | 'video' | 'text'. */
    deliverable_type?: string | null;
  };
export type ProjectTemplate =
  Database["public"]["Tables"]["project_templates"]["Row"];

/** A single task entry inside a task template's `tasks` JSONB array. */
export interface TaskTemplateItem {
  name: string;
  priority?: string;
  description?: string;
}

/** A subtask "step" inside a template's `steps` JSONB array. */
export interface TaskTemplateStep {
  name: string;
  priority?: string;
}

/** The shape of a project template's `template` JSONB document. */
export interface ProjectTemplateDocument {
  phases: Array<{ name: string; color: string }>;
  statuses: Array<{ name: string; category: string }>;
  tasks: Array<{ name: string; status: string; priority: string }>;
  /** Default views (registry keys) to add to a project created from this template. */
  views?: string[];
}

const TASK_TEMPLATES_ROOT = "task-templates" as const;
const PROJECT_TEMPLATES_ROOT = "project-templates" as const;

const taskTemplatesKey = (teamId: string | undefined) =>
  [TASK_TEMPLATES_ROOT, teamId] as const;
const projectTemplatesKey = (teamId: string | undefined) =>
  [PROJECT_TEMPLATES_ROOT, teamId] as const;

/** Lists the active team's task templates. Scoped to `useActiveTeam()`. */
export function useTaskTemplates() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: taskTemplatesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TaskTemplate[]> => {
      const { data, error } = await supabase
        .from("task_templates")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Lists the active team's project templates. Scoped to `useActiveTeam()`. */
export function useProjectTemplates() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: projectTemplatesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ProjectTemplate[]> => {
      const { data, error } = await supabase
        .from("project_templates")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface CreateTaskTemplateInput {
  name: string;
  /** Blueprint fields that prefill a task created from this template. */
  description?: string;
  priority?: string;
  /** Deliverable the template sets on the task: 'status' | 'video' | null. */
  deliverableType?: string | null;
  /** Due date offset (days from creation) applied to created tasks. */
  dueOffsetDays?: number | null;
  /** Subtask steps created under the task. */
  steps?: TaskTemplateStep[];
  /** Legacy bulk-apply list (apply_task_template). */
  tasks?: TaskTemplateItem[];
}

/** Creates a task template for the active team. `tasks` is stored as JSONB. */
export function useCreateTaskTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (
      input: CreateTaskTemplateInput,
    ): Promise<TaskTemplate> => {
      if (!teamId) throw new Error("No active team");

      const { data, error } = await loose(supabase)
        .from("task_templates")
        .insert({
          team_id: teamId,
          name: input.name,
          description: input.description ?? null,
          priority: input.priority ?? null,
          deliverable_type: input.deliverableType ?? null,
        due_offset_days: input.dueOffsetDays ?? null,
          steps: (input.steps ?? []) as unknown as Json,
          tasks: (input.tasks ?? []) as unknown as Json,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data as TaskTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskTemplatesKey(teamId) });
    },
  });
}

export interface UpdateTaskTemplateInput {
  id: string;
  name?: string;
  description?: string | null;
  priority?: string | null;
  deliverableType?: string | null;
  steps?: TaskTemplateStep[];
  tasks?: TaskTemplateItem[];
}

/** Updates a task template's blueprint fields and/or JSONB arrays. */
export function useUpdateTaskTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (
      input: UpdateTaskTemplateInput,
    ): Promise<TaskTemplate> => {
      const { id, name, description, priority, deliverableType, steps, tasks } = input;
      const { data, error } = await loose(supabase)
        .from("task_templates")
        .update({
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(deliverableType !== undefined ? { deliverable_type: deliverableType } : {}),
          ...(steps !== undefined ? { steps: steps as unknown as Json } : {}),
          ...(tasks !== undefined
            ? { tasks: tasks as unknown as Json }
            : {}),
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return data as TaskTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskTemplatesKey(teamId) });
    },
  });
}

/** Deletes a task template. */
export function useDeleteTaskTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("task_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskTemplatesKey(teamId) });
    },
  });
}

export interface CreateProjectTemplateInput {
  name: string;
  template: ProjectTemplateDocument;
}

/** Creates a project template for the active team. `template` is stored as JSONB. */
export function useCreateProjectTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (
      input: CreateProjectTemplateInput,
    ): Promise<ProjectTemplate> => {
      if (!teamId) throw new Error("No active team");

      const { data, error } = await supabase
        .from("project_templates")
        .insert({
          team_id: teamId,
          name: input.name,
          template: input.template as unknown as Json,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Prime the list cache with the new row so callers that immediately read
      // it (e.g. the New-project modal auto-selecting a just-created template
      // and applying its Default views on submit) see it before the refetch
      // lands — otherwise the option shows a bare id and its views are dropped.
      queryClient.setQueryData<ProjectTemplate[]>(
        projectTemplatesKey(teamId),
        (old) => {
          if (!old) return old;
          if (old.some((t) => t.id === data.id)) return old;
          return [...old, data].sort((a, b) => a.name.localeCompare(b.name));
        },
      );
      queryClient.invalidateQueries({
        queryKey: projectTemplatesKey(teamId),
      });
    },
  });
}

/** Deletes a project template. */
export function useDeleteProjectTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("project_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: projectTemplatesKey(teamId),
      });
    },
  });
}

export interface ApplyTaskTemplateInput {
  projectId: string;
  templateId: string;
}

/**
 * Applies a task template to a project via the `apply_task_template` RPC,
 * returning the number of tasks created. Invalidates the project's tasks.
 */
export function useApplyTaskTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ApplyTaskTemplateInput): Promise<number> => {
      const { data, error } = await supabase.rpc("apply_task_template", {
        p_project_id: input.projectId,
        p_template_id: input.templateId,
      });

      if (error) throw error;
      return data as number;
    },
    onSuccess: (_count, input) => {
      queryClient.invalidateQueries({
        queryKey: tasksRootKey(input.projectId),
      });
    },
  });
}

export interface CreateProjectFromTemplateInput {
  templateId: string;
  name: string;
}

/**
 * Creates a new project from a project template via the
 * `create_project_from_template` RPC, returning the new project id. Invalidates
 * the projects list.
 */
export function useCreateProjectFromTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (
      input: CreateProjectFromTemplateInput,
    ): Promise<string> => {
      if (!teamId) throw new Error("No active team");

      const { data, error } = await supabase.rpc(
        "create_project_from_template",
        {
          p_team_id: teamId,
          p_template_id: input.templateId,
          p_name: input.name,
        },
      );

      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Task creation from a template (parent + subtask steps) + per-project default */
/* -------------------------------------------------------------------------- */

export interface CreateTaskWithTemplateInput {
  projectId: string;
  name: string;
  templateId?: string | null;
  description?: string | null;
  priorityId?: string | null;
  statusId?: string | null;
  assignees?: string[] | null;
}

/**
 * Creates a task (and, when a template is chosen, its subtask steps) via the
 * `create_task_with_template` RPC. Reuses create_task's membership gating.
 */
export function useCreateTaskWithTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTaskWithTemplateInput): Promise<string> => {
      const { data, error } = await supabase.rpc("create_task_with_template", {
        p_project_id: input.projectId,
        p_name: input.name,
        ...(input.templateId ? { p_template_id: input.templateId } : {}),
        ...(input.description ? { p_description: input.description } : {}),
        ...(input.priorityId ? { p_priority_id: input.priorityId } : {}),
        ...(input.statusId ? { p_status_id: input.statusId } : {}),
        ...(input.assignees && input.assignees.length
          ? { p_assignees: input.assignees }
          : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, input) => {
      queryClient.invalidateQueries({ queryKey: tasksRootKey(input.projectId) });
      queryClient.invalidateQueries({ queryKey: ["all-tasks"] });
    },
  });
}

/** Sets (or clears) a project's default task template. Project admin via RLS. */
export function useSetProjectDefaultTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      templateId: string | null;
    }): Promise<void> => {
      const { error } = await supabase
        .from("projects")
        .update({ default_task_template_id: input.templateId })
        .eq("id", input.projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/**
 * Saves an existing project as a project template (captures its phases,
 * statuses, and top-level tasks) via create_project_template_from_project.
 */
export function useSaveProjectAsTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      name: string;
    }): Promise<string> => {
      const { data, error } = await supabase.rpc(
        "create_project_template_from_project",
        { p_project_id: input.projectId, p_name: input.name },
      );
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectTemplatesKey(teamId) });
    },
  });
}
