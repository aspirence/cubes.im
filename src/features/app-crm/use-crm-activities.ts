"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { CrmActivity, CrmTargetType } from "./types";

/**
 * One record's timeline (created / updated / stage_changed / deleted /
 * restored / note_added / task_added), newest first. Trigger-written.
 */
export function useCrmRecordActivities(
  targetType: CrmTargetType | undefined,
  targetId: string | undefined,
) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["crm-activities", teamId, targetType, targetId] as const,
    enabled: Boolean(teamId && targetType && targetId),
    queryFn: async (): Promise<CrmActivity[]> => {
      const { data, error } = await supabase
        .from("app_crm_activities")
        .select("*")
        .eq("team_id", teamId as string)
        .eq("target_type", targetType as string)
        .eq("target_id", targetId as string)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The team-wide recent activity feed (dashboard). */
export function useCrmRecentActivities(limit = 30) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: ["crm-activities", teamId, "recent", limit] as const,
    enabled: Boolean(teamId),
    queryFn: async (): Promise<CrmActivity[]> => {
      const { data, error } = await supabase
        .from("app_crm_activities")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
  });
}
