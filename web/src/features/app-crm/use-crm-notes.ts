"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type {
  CrmNote,
  CrmNoteWithTargets,
  CrmTargetRef,
} from "./types";

const notesKey = (teamId: string | undefined) => ["crm-notes", teamId] as const;

export type CrmNotePatch = Partial<
  Omit<CrmNote, "id" | "team_id" | "created_at" | "updated_at" | "created_by">
>;

/** All the active team's CRM notes with their record targets. */
export function useCrmNotes() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: notesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmNoteWithTargets[]> => {
      const { data, error } = await supabase
        .from("app_crm_notes")
        .select("*, targets:app_crm_note_targets ( * )")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CrmNoteWithTargets[];
    },
  });
}

/** Creates a note and links it to the given records (Twenty's noteTargets). */
export function useCreateCrmNote() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (
      input: CrmNotePatch & { title: string; targets?: CrmTargetRef[] },
    ) => {
      if (!teamId) throw new Error("No active team");
      const { targets, ...note } = input;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_crm_notes")
        .insert({ ...note, team_id: teamId, created_by: user?.id ?? null })
        .select("*")
        .single();
      if (error) throw error;
      if (targets && targets.length > 0) {
        const { error: targetsError } = await supabase
          .from("app_crm_note_targets")
          .insert(
            targets.map((t) => ({
              team_id: teamId,
              note_id: data.id,
              target_type: t.type,
              target_id: t.id,
            })),
          );
        if (targetsError) throw targetsError;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesKey(teamId) });
      queryClient.invalidateQueries({ queryKey: ["crm-activities", teamId] });
    },
  });
}

export function useUpdateCrmNote() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: { id: string; patch: CrmNotePatch }) => {
      const { error } = await supabase
        .from("app_crm_notes")
        .update(input.patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesKey(teamId) });
    },
  });
}

/** Hard delete — targets cascade with the row. */
export function useDeleteCrmNote() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("app_crm_notes")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesKey(teamId) });
    },
  });
}
