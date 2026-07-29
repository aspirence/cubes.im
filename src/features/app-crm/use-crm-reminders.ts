"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { CrmReminder, CrmTargetType } from "./types";

const remindersKey = (teamId: string | undefined) =>
  ["crm-reminders", teamId] as const;

/** Record-scoped list; shares the prefix above so one invalidate covers both. */
const recordRemindersKey = (
  teamId: string | undefined,
  targetType: CrmTargetType | undefined,
  targetId: string | undefined,
) => ["crm-reminders", teamId, targetType, targetId] as const;

/**
 * What the client may write. `notified_at` is deliberately absent — only the
 * `crm_fire_due_reminders()` sweep stamps it, and writing it from here would
 * silently swallow the notification.
 */
export type CrmReminderInput = {
  target_type: CrmTargetType;
  target_id: string;
  /** ISO timestamp — `dayjs(...).toISOString()`. */
  remind_at: string;
  note?: string | null;
  /** Who gets reminded. Defaults to the signed-in user. */
  user_id?: string;
};

/** Every reminder in the active team, soonest first. Pages filter `done_at`. */
export function useCrmReminders() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: remindersKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmReminder[]> => {
      const { data, error } = await supabase
        .from("app_crm_reminders")
        .select("*")
        .eq("team_id", teamId as string)
        .order("remind_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** One record's reminders (polymorphic target, no FK — like task targets). */
export function useRecordReminders(
  targetType: CrmTargetType | undefined,
  targetId: string | undefined,
) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: recordRemindersKey(teamId, targetType, targetId),
    enabled: Boolean(teamId && targetType && targetId),
    queryFn: async (): Promise<CrmReminder[]> => {
      const { data, error } = await supabase
        .from("app_crm_reminders")
        .select("*")
        .eq("team_id", teamId as string)
        .eq("target_type", targetType as string)
        .eq("target_id", targetId as string)
        .order("remind_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** "Remind me about this record at this time" — defaults the who to me. */
export function useCreateCrmReminder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CrmReminderInput) => {
      if (!teamId) throw new Error("No active team");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = input.user_id ?? user?.id;
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("app_crm_reminders")
        .insert({
          ...input,
          user_id: userId,
          team_id: teamId,
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: remindersKey(teamId) });
    },
  });
}

/**
 * Reschedule — "push this to Friday" without retyping the note.
 *
 * `notified_at` is cleared alongside the new time, and that reset is the whole
 * point of doing this in one hook: `crm_fire_due_reminders()` skips anything
 * already stamped, so moving a fired reminder forward without clearing it would
 * silently never fire again.
 */
export function useUpdateCrmReminder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      /** ISO timestamp — `dayjs(...).toISOString()`. */
      remind_at: string;
      note?: string | null;
    }) => {
      const { error } = await supabase
        .from("app_crm_reminders")
        .update({
          remind_at: input.remind_at,
          ...(input.note === undefined ? {} : { note: input.note }),
          notified_at: null,
          done_at: null,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: remindersKey(teamId) });
    },
  });
}

/** Dismiss — stamps `done_at`, which also stops an unfired sweep. */
export function useCompleteCrmReminder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_crm_reminders")
        .update({ done_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: remindersKey(teamId) });
    },
  });
}

/** Hard delete — reminders have no soft-delete column. */
export function useDeleteCrmReminder() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_crm_reminders")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: remindersKey(teamId) });
    },
  });
}
