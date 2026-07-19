"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database, Json } from "@/types/database";

export type StatusTemplate =
  Database["public"]["Tables"]["status_templates"]["Row"];

/** One entry in a status template's `statuses` JSONB array. `category` is one of
 * the four stage keys (not_started / active / done / closed). */
export interface StatusTemplateStatus {
  name: string;
  category: string;
}

const statusTemplatesKey = (teamId: string | undefined) =>
  ["status-templates", teamId] as const;

/** Best-effort parse of the `statuses` JSONB into the editor's shape. */
export function readStatusTemplateStatuses(
  value: Json,
): StatusTemplateStatus[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const rec = entry as Record<string, Json | undefined>;
    if (typeof rec.name !== "string" || rec.name.length === 0) return [];
    return [
      {
        name: rec.name,
        category: typeof rec.category === "string" ? rec.category : "not_started",
      },
    ];
  });
}

/** Lists the active team's status templates. Members read; admins write. */
export function useStatusTemplates() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: statusTemplatesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<StatusTemplate[]> => {
      const { data, error } = await supabase
        .from("status_templates")
        .select("*")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a status template for the active team (admin-only via RLS). */
export function useCreateStatusTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      name: string;
      statuses: StatusTemplateStatus[];
    }): Promise<StatusTemplate> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("status_templates")
        .insert({
          team_id: teamId,
          name: input.name,
          statuses: input.statuses as unknown as Json,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusTemplatesKey(teamId) });
    },
  });
}

/** Updates a status template's name/statuses (admin-only via RLS). */
export function useUpdateStatusTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      statuses: StatusTemplateStatus[];
    }): Promise<void> => {
      // RLS filters non-admin updates to 0 rows without erroring — force a
      // representation and assert a row actually changed.
      const { data, error } = await supabase
        .from("status_templates")
        .update({
          name: input.name,
          statuses: input.statuses as unknown as Json,
        })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusTemplatesKey(teamId) });
    },
  });
}

/** Deletes a status template (admin-only via RLS). */
export function useDeleteStatusTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      // Same 0-row guard as update: a non-admin delete is a silent no-op.
      const { data, error } = await supabase
        .from("status_templates")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusTemplatesKey(teamId) });
    },
  });
}
