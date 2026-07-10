"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type NotificationSettings =
  Database["public"]["Tables"]["notification_settings"]["Row"];

/** The user-editable subset of a notification_settings row. */
export type NotificationSettingsInput = {
  email_notifications_enabled?: boolean;
  popup_notifications_enabled?: boolean;
  daily_digest_enabled?: boolean;
  /**
   * Opt-out list of notification categories the user has muted (e.g.
   * "comment", "mention"). Empty = every category is delivered. Enforced
   * server-side in the `create_notification` RPC.
   */
  muted_types?: string[];
};

const notificationSettingsKey = (
  userId: string | undefined,
  teamId: string | undefined,
) => ["notification-settings", userId, teamId] as const;

/**
 * Reads the current user's notification settings for the active team. Returns
 * `null` when no row exists yet (the user has never saved settings); the UI can
 * treat that as defaults. Scoped to (auth user, active team) and user-private
 * via RLS.
 */
export function useNotificationSettings() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: notificationSettingsKey(undefined, teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<NotificationSettings | null> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return null;

      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .eq("user_id", user.id)
        .eq("team_id", teamId as string)
        .maybeSingle();

      if (error) throw error;
      return data ?? null;
    },
  });
}

/**
 * Upserts the current user's notification settings for the active team. Uses
 * the (user_id, team_id) unique constraint as the conflict target so a single
 * call both creates and updates.
 */
export function useUpdateNotificationSettings() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (
      input: NotificationSettingsInput,
    ): Promise<NotificationSettings> => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("notification_settings")
        .upsert(
          {
            user_id: user.id,
            team_id: teamId,
            ...input,
          },
          { onConflict: "user_id,team_id" },
        )
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    // Seed the cache with the row the upsert just returned rather than kicking
    // off a background refetch. A refetch leaves a stale window: the mutation
    // settles (re-enabling the toggles) before the refetched row lands, so a
    // read-modify-write on an array field — e.g. muting a second category right
    // after the first — would recompute from the stale `muted_types` and
    // silently clobber the earlier change. setQueryData makes the fresh row
    // authoritative synchronously and drops the extra round-trip.
    onSuccess: (data) => {
      queryClient.setQueryData(
        notificationSettingsKey(undefined, teamId),
        data,
      );
    },
  });
}
