"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import type { Database } from "@/types/database";

/** A per-user notification row (read flag, message, type, url, task/project ids). */
export type Notification =
  Database["public"]["Tables"]["user_notifications"]["Row"];

const NOTIFICATIONS_ROOT = "notifications" as const;
const notificationsKey = [NOTIFICATIONS_ROOT, "list"] as const;
const notificationCountsKey = [NOTIFICATIONS_ROOT, "counts"] as const;

const NOTIFICATIONS_LIMIT = 50;

/**
 * Notification types that demand a response (a task was assigned, someone
 * commented, you were @mentioned). These power the "Action Needed" tab: no
 * bulk mark-all there — each is handled one by one. Everything else is
 * "General" (info & friends) and can be bulk-cleared.
 */
export const ACTION_NOTIFICATION_TYPES = [
  "mention",
  "assignment",
  "comment",
] as const;

export function isActionNotification(type: string): boolean {
  return (ACTION_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

export interface NotificationsResult {
  items: Notification[];
  unreadCount: number;
}

/**
 * Lists the current user's notifications (newest first, limit 50, excluding
 * snoozed) along with the unread count. RLS scopes the rows to the caller.
 */
export function useNotifications() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: notificationsKey,
    queryFn: async (): Promise<NotificationsResult> => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("user_notifications")
        .select("*")
        // Hide snoozed notifications until their remind_at passes.
        .or(`remind_at.is.null,remind_at.lte.${nowIso}`)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_LIMIT);

      if (error) throw error;

      const items = data ?? [];
      const unreadCount = items.reduce(
        (count, n) => (n.read ? count : count + 1),
        0,
      );

      return { items, unreadCount };
    },
  });
}

export interface UnreadNotificationCounts {
  /** Unread action-type notifications (mention/assignment/comment) — the
   *  "needs a response" number shown red on the closed bell. */
  action: number;
  /** Unread general notifications. */
  general: number;
}

/**
 * Exact unread counts split into action vs general, independent of the list's
 * page limit — these drive the badges shown while the sidebar is closed.
 */
export function useUnreadNotificationCounts() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: notificationCountsKey,
    queryFn: async (): Promise<UnreadNotificationCounts> => {
      const types = [...ACTION_NOTIFICATION_TYPES];
      const nowIso = new Date().toISOString();
      const notSnoozed = `remind_at.is.null,remind_at.lte.${nowIso}`;
      const [action, general] = await Promise.all([
        supabase
          .from("user_notifications")
          .select("id", { count: "exact", head: true })
          .eq("read", false)
          .or(notSnoozed)
          .in("type", types),
        supabase
          .from("user_notifications")
          .select("id", { count: "exact", head: true })
          .eq("read", false)
          .or(notSnoozed)
          .not("type", "in", `(${types.join(",")})`),
      ]);
      if (action.error) throw action.error;
      if (general.error) throw general.error;
      return { action: action.count ?? 0, general: general.count ?? 0 };
    },
  });
}

/** Marks a single notification as read by id. */
export function useMarkNotificationRead() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("user_notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_ROOT] });
    },
  });
}

/** Flips a notification back to unread (the "mark as unread" row action). */
export function useMarkNotificationUnread() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("user_notifications")
        .update({ read: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_ROOT] });
    },
  });
}

/**
 * Snoozes a notification until `until` (an ISO string) — it disappears from the
 * list and counts, and re-surfaces once that time passes. Pass null to un-snooze.
 */
export function useSnoozeNotification() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      until: string | null;
    }): Promise<void> => {
      const { error } = await supabase
        .from("user_notifications")
        .update({ remind_at: input.until })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_ROOT] });
    },
  });
}

/** Marks all of the current user's unread notifications as read. */
export function useMarkAllNotificationsRead() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await supabase
        .from("user_notifications")
        .update({ read: true })
        .eq("read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_ROOT] });
    },
  });
}

/**
 * Marks unread notifications of the given types as read — lets "Mark all read"
 * in the General tab clear ONLY general noise while action items stay put.
 */
export function useMarkNotificationsReadByTypes() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      types: string[];
      /** true = mark types NOT in the list (i.e. "everything except…"). */
      invert?: boolean;
    }): Promise<void> => {
      let query = supabase
        .from("user_notifications")
        .update({ read: true })
        .eq("read", false);
      query = input.invert
        ? query.not("type", "in", `(${input.types.join(",")})`)
        : query.in("type", input.types);
      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_ROOT] });
    },
  });
}

/**
 * Subscribes to Realtime INSERTs on `user_notifications` for the current user
 * and invalidates the notifications query so the bell updates live. Manages the
 * channel inside an effect with cleanup on unmount / user change.
 */
export function useNotificationsRealtime() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const channelIdRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      // This hook mounts in more than one surface (e.g. bell + inbox pane), so
      // the topic must be unique per hook instance. Reusing the exact same
      // channel name causes Supabase Realtime to hand back the already-
      // subscribed channel, and `.on()` after `.subscribe()` throws.
      .channel(`notifications:${userId}:${channelIdRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_ROOT] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, userId]);
}
