import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side contract for workflow "app" steps. Kept apart from the registry
 * (app-actions.ts) so the per-app action modules can import these types
 * without importing the registry that imports them.
 */
export interface AppActionContext {
  /** Service-role client. Every action scopes its own queries by teamId. */
  admin: SupabaseClient;
  teamId: string;
  runId: string;
  stepKey: string;
  trigger: "schedule" | "manual" | "event";
  /** The member who pressed "Run now"; null for scheduled runs. */
  actorUserId: string | null;
}

export interface AppActionResult {
  ok: boolean;
  /** Lands in the run context under steps.<step_key>; keep it small and member-safe. */
  output: Record<string, unknown>;
  /** Member-safe message (no tokens, no URLs) when ok is false. */
  error?: string;
}

export type AppActionHandler = (
  ctx: AppActionContext,
  params: Record<string, unknown>,
) => Promise<AppActionResult>;
