"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHrAccess } from "@/features/hr/use-hr";
import type { Database, Json } from "@/types/database";
import type { AttendanceWebhookConfig } from "@/lib/attendance-webhook/config";

export type AttendanceWebhookRow =
  Database["public"]["Tables"]["attendance_webhooks"]["Row"];
export type AttendanceWebhookEventRow =
  Database["public"]["Tables"]["attendance_webhook_events"]["Row"];

/** Returned once by create/rotate; the raw credentials are never stored. */
export interface MintedWebhookCredentials {
  webhook: AttendanceWebhookRow;
  token: string;
  signingSecret: string;
}

const ROOT = "attendance-webhooks" as const;

const webhooksKey = (orgId: string | undefined) => [ROOT, orgId] as const;
const eventsKey = (webhookId: string | undefined) =>
  [ROOT, "events", webhookId] as const;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

/** Lists the org's attendance webhooks (RLS: HR admins only). */
export function useAttendanceWebhooks() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, isHrAdmin } = useHrAccess();

  return useQuery({
    queryKey: webhooksKey(orgId),
    enabled: Boolean(orgId) && isHrAdmin,
    queryFn: async (): Promise<AttendanceWebhookRow[]> => {
      const { data, error } = await supabase
        .from("attendance_webhooks")
        .select("*")
        .eq("org_id", orgId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Mints a webhook via the management route. The response carries the raw
 * token + signing secret exactly once — surface them immediately.
 */
export function useCreateAttendanceWebhook() {
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      config?: Partial<AttendanceWebhookConfig>;
    }): Promise<MintedWebhookCredentials> => {
      if (!orgId) throw new Error("No organization");
      const res = await fetch("/api/attendance-webhooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, name: input.name, config: input.config }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to create the webhook."));
      }
      return (await res.json()) as MintedWebhookCredentials;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhooksKey(orgId) });
    },
  });
}

/** Updates name / config / enabled directly (RLS: HR admins only). */
export function useUpdateAttendanceWebhook() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<
        Pick<AttendanceWebhookRow, "name" | "enabled"> & {
          config: AttendanceWebhookConfig;
        }
      >;
    }): Promise<AttendanceWebhookRow> => {
      const { config, ...rest } = input.patch;
      const patch: Database["public"]["Tables"]["attendance_webhooks"]["Update"] =
        { ...rest, ...(config ? { config: config as unknown as Json } : {}) };
      const { data, error } = await supabase
        .from("attendance_webhooks")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhooksKey(orgId) });
    },
  });
}

/** Deletes a webhook (cascade removes its secret + delivery log). */
export function useDeleteAttendanceWebhook() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("attendance_webhooks")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhooksKey(orgId) });
    },
  });
}

/** Rotates the token + signing secret; old credentials die immediately. */
export function useRotateAttendanceWebhook() {
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      id: string,
    ): Promise<Omit<MintedWebhookCredentials, "webhook">> => {
      const res = await fetch(`/api/attendance-webhooks/${id}/rotate`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to rotate credentials."));
      }
      return (await res.json()) as Omit<MintedWebhookCredentials, "webhook">;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhooksKey(orgId) });
    },
  });
}

/** Recent deliveries for one webhook, newest first (RLS: HR admins only). */
export function useAttendanceWebhookEvents(webhookId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: eventsKey(webhookId),
    enabled: Boolean(webhookId),
    queryFn: async (): Promise<AttendanceWebhookEventRow[]> => {
      const { data, error } = await supabase
        .from("attendance_webhook_events")
        .select("*")
        .eq("webhook_id", webhookId as string)
        .order("received_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}
