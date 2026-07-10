"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import type { Database } from "@/types/database";

export type TaskReferenceLink =
  Database["public"]["Tables"]["task_reference_links"]["Row"];

const refsKey = (taskId: string | undefined) =>
  ["task-reference-links", taskId] as const;

function deriveDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function useTaskReferenceLinks(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: refsKey(taskId),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskReferenceLink[]> => {
      const { data, error } = await supabase
        .from("task_reference_links")
        .select("*")
        .eq("task_id", taskId as string)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAddTaskReferenceLink() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      url: string;
      title?: string | null;
      previewImage?: string | null;
    }): Promise<TaskReferenceLink> => {
      const { count, error: countError } = await supabase
        .from("task_reference_links")
        .select("id", { count: "exact", head: true })
        .eq("task_id", input.taskId);
      if (countError) throw countError;
      const { data, error } = await supabase
        .from("task_reference_links")
        .insert({
          task_id: input.taskId,
          url: input.url.trim(),
          title: input.title?.trim() || null,
          preview_image: input.previewImage?.trim() || null,
          domain: deriveDomain(input.url.trim()),
          sort_order: count ?? 0,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: refsKey(input.taskId) });
    },
  });
}

export function useUpdateTaskReferenceLink() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      taskId: string;
      patch: Partial<
        Pick<TaskReferenceLink, "url" | "title" | "preview_image" | "sort_order">
      >;
    }): Promise<void> => {
      const patch = {
        ...input.patch,
        ...(input.patch.url ? { domain: deriveDomain(input.patch.url) } : {}),
      };
      const { error } = await supabase
        .from("task_reference_links")
        .update(patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: refsKey(input.taskId) });
    },
  });
}

export function useDeleteTaskReferenceLink() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      taskId: string;
    }): Promise<void> => {
      const { error } = await supabase
        .from("task_reference_links")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: refsKey(input.taskId) });
    },
  });
}

export function useReorderTaskReferenceLinks() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      orderedIds: string[];
    }): Promise<void> => {
      for (const [sortOrder, id] of input.orderedIds.entries()) {
        const { error } = await supabase
          .from("task_reference_links")
          .update({ sort_order: sortOrder })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: refsKey(input.taskId) });
    },
  });
}
