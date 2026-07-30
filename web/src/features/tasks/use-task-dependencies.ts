"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type TaskDependencyRow =
  Database["public"]["Tables"]["task_dependencies"]["Row"];

/** The relation a dependency expresses, from the depending task's point of view. */
export type DependencyRelationType = "blocked_by" | "blocks";

/** A dependency joined to the task it depends on (depends_on_task_id -> tasks). */
export type TaskDependency = TaskDependencyRow & {
  depends_on_task: {
    id: string;
    name: string;
    task_no: number | null;
  } | null;
};

const DEPS_ROOT = "task-dependencies" as const;

const depsKey = (taskId: string | undefined) => [DEPS_ROOT, taskId] as const;

/**
 * The FK-embed select string. PostgREST resolves the depended-on task via the
 * named foreign key; relational types are awkward against the generated
 * `Database` type, so rows are cast through `unknown` into `TaskDependency`.
 */
const DEP_SELECT = `
  *,
  depends_on_task:tasks!task_dependencies_depends_on_task_id_fk ( id, name, task_no )
`;

/**
 * Lists a task's dependencies, each joined to the task it depends on. RLS scopes
 * the result via the task's project membership.
 */
export function useTaskDependencies(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: depsKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskDependency[]> => {
      const { data, error } = await supabase
        .from("task_dependencies")
        .select(DEP_SELECT)
        .eq("task_id", taskId as string)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as TaskDependency[];
    },
  });
}

export interface AddDependencyInput {
  taskId: string;
  dependsOnTaskId: string;
  relationType: DependencyRelationType;
}

/**
 * Adds a dependency to a task. A UNIQUE(task_id, depends_on_task_id) constraint
 * prevents duplicates and a CHECK rejects self-dependencies. RLS scopes writes
 * via task membership.
 */
export function useAddDependency() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: AddDependencyInput,
    ): Promise<TaskDependencyRow> => {
      const { data, error } = await supabase
        .from("task_dependencies")
        .insert({
          task_id: input.taskId,
          depends_on_task_id: input.dependsOnTaskId,
          relation_type: input.relationType,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (dep) => {
      queryClient.invalidateQueries({ queryKey: depsKey(dep.task_id) });
    },
  });
}

/** Removes a dependency by its id. Invalidates broadly (task id is not known). */
export function useRemoveDependency() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("task_dependencies")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DEPS_ROOT] });
    },
  });
}
