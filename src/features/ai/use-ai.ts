"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Client hooks for the AI feature routes (/api/ai/*). These are thin fetch
 * wrappers — all data access and RLS enforcement happens server-side in the
 * route handlers.
 */

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  if (!data) {
    throw new Error("Empty response");
  }
  return data;
}

export interface AiCreateTaskResult {
  task: { id: string; name: string; taskNo: number | null };
  applied: {
    status: string | null;
    priority: string | null;
    assignee: string | null;
    startDate: string | null;
    endDate: string | null;
  };
  /** Set when the task was created but a secondary step failed. */
  warning?: string;
}

/** Natural-language task creation — invalidates the project's task queries. */
export function useAiCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      prompt: string;
    }): Promise<AiCreateTaskResult> =>
      postJson<AiCreateTaskResult>("/api/ai/task", input),
    onSuccess: () => {
      // Tasks queries are rooted on "tasks" (see use-tasks.ts).
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export interface AiSubtaskSuggestion {
  name: string;
  description: string | null;
}

/** Suggests subtasks for a task. Read-only — creation stays with the caller. */
export function useAiBreakdown() {
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
    }): Promise<{ subtasks: AiSubtaskSuggestion[] }> =>
      postJson<{ subtasks: AiSubtaskSuggestion[] }>(
        "/api/ai/breakdown",
        input,
      ),
  });
}

export interface AiStandupResult {
  summary: string;
  stats: { completed: number; overdue: number; dueSoon: number; days: number };
}

/** Generates a standup summary for a project window. */
export function useAiStandup() {
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      days?: number;
    }): Promise<AiStandupResult> =>
      postJson<AiStandupResult>("/api/ai/standup", input),
  });
}
