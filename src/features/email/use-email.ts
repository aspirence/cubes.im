"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";

/**
 * The email-engine tables (20261071000000_email_engine) are newer than the
 * generated database types and must not be regenerated here.
 */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** A globally-toggleable send scenario. Owned by super-admins, readable by all. */
export interface EmailTrigger {
  event_key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A workspace's Resend sender. Deliberately has no `api_key`: the key lives in
 * the service-role-only app_resend_secrets table and is never exposed to the
 * browser. `has_key` is the only signal the UI gets that a key is stored.
 */
export interface ResendConnection {
  team_id: string;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
  enabled: boolean;
  has_key: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EmailStatus = "sent" | "failed" | "skipped";

export interface EmailLogEntry {
  id: string;
  team_id: string;
  event_key: string;
  to_email: string;
  subject: string;
  status: EmailStatus;
  detail: string | null;
  created_by: string | null;
  created_at: string;
}

const triggersKey = ["email-triggers"] as const;
const connectionKey = (teamId: string | undefined) =>
  ["resend-connection", teamId] as const;
const logKey = (teamId: string | undefined) => ["email-log", teamId] as const;

/** How many log rows the workspace app page shows. */
const LOG_PAGE = 50;

/* -------------------------------------------------------------------------- */
/* Global triggers (super-admin)                                              */
/* -------------------------------------------------------------------------- */

/** Every send scenario, grouped-ready (category, then label). */
export function useEmailTriggers() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: triggersKey,
    queryFn: async (): Promise<EmailTrigger[]> => {
      const { data, error } = await loose(supabase)
        .from("platform_email_triggers")
        .select("*")
        .order("category", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmailTrigger[];
    },
  });
}

/**
 * Flips a scenario platform-wide. RLS (is_platform_admin) is the real gate —
 * the super-admin check on the page is cosmetic.
 */
export function useSetEmailTrigger() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      eventKey: string;
      enabled: boolean;
    }): Promise<void> => {
      const { error } = await loose(supabase)
        .from("platform_email_triggers")
        .update({
          enabled: input.enabled,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("event_key", input.eventKey);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: triggersKey });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Per-workspace Resend connection                                            */
/* -------------------------------------------------------------------------- */

/** The workspace's sender row, or null when the app was never configured. */
export function useResendConnection(teamId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: connectionKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ResendConnection | null> => {
      const { data, error } = await loose(supabase)
        .from("app_resend_connections")
        .select("*")
        .eq("team_id", teamId as string)
        .maybeSingle();
      if (error) throw error;
      return (data as ResendConnection | null) ?? null;
    },
  });
}

export interface SaveResendConnectionInput {
  teamId: string;
  from_email: string;
  from_name?: string | null;
  reply_to?: string | null;
  enabled: boolean;
}

/**
 * Upserts the workspace's sender settings.
 *
 * The payload is built column-by-column on purpose: `has_key` is a mirror of the
 * service-role secrets table and must only ever be written by the secret route.
 * Spreading caller input into the upsert would let a stale `has_key: true` from
 * a fetched row re-assert itself after the key was removed, and would show
 * "Connected" for a workspace with no credential.
 */
export function useSaveResendConnection() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: SaveResendConnectionInput): Promise<void> => {
      // Preserve the original creator: an upsert writes every column it is
      // given, so blindly sending the current user would rewrite created_by on
      // each save.
      const { data: existing, error: readError } = await loose(supabase)
        .from("app_resend_connections")
        .select("created_by")
        .eq("team_id", input.teamId)
        .maybeSingle();
      if (readError) throw readError;

      const { error } = await loose(supabase)
        .from("app_resend_connections")
        .upsert(
          {
            team_id: input.teamId,
            from_email: input.from_email.trim().toLowerCase(),
            from_name: input.from_name?.trim() || null,
            reply_to: input.reply_to?.trim().toLowerCase() || null,
            enabled: input.enabled,
            created_by:
              (existing as { created_by: string | null } | null)?.created_by ??
              user?.id ??
              null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "team_id" },
        );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: connectionKey(variables.teamId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The API key — service-role routes only, never Supabase-from-the-browser     */
/* -------------------------------------------------------------------------- */

/**
 * Stores the workspace's Resend API key. The key is POSTed to a service-role
 * route and never touches app_resend_connections, so it can't be read back by
 * anyone (including the admin who typed it). Also flips `has_key` server-side.
 */
export function useSaveResendKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      teamId: string;
      apiKey: string;
    }): Promise<void> => {
      const res = await fetch("/api/apps/resend/secret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: input.teamId, apiKey: input.apiKey }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't save the API key.");
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: connectionKey(variables.teamId),
      });
    },
  });
}

/** Deletes the stored key and clears `has_key`. Sending stops immediately. */
export function useDeleteResendKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { teamId: string }): Promise<void> => {
      const res = await fetch("/api/apps/resend/secret", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: input.teamId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't remove the API key.");
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: connectionKey(variables.teamId),
      });
    },
  });
}

/**
 * Sends a real test message. The route returns a sanitised `reason` only — it is
 * safe to render, unlike a raw provider error. Refreshes the connection so the
 * last_test_* health columns update, and the log so the attempt appears.
 */
export function useTestResend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      teamId: string;
      to: string;
    }): Promise<{ ok: boolean; reason?: string }> => {
      const res = await fetch("/api/apps/resend/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamId: input.teamId, to: input.to }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "The test couldn't run.");
      return { ok: Boolean(json.ok), reason: json.reason };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: connectionKey(variables.teamId),
      });
      queryClient.invalidateQueries({ queryKey: logKey(variables.teamId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Delivery history                                                           */
/* -------------------------------------------------------------------------- */

/** Recent delivery attempts. Admin-only by RLS — recipients are PII. */
export function useEmailLog(teamId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: logKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<EmailLogEntry[]> => {
      const { data, error } = await loose(supabase)
        .from("email_log")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false })
        .limit(LOG_PAGE);
      if (error) throw error;
      return (data ?? []) as EmailLogEntry[];
    },
  });
}
