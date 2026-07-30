"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type TimeAnalyticsRow =
  Database["public"]["Functions"]["time_analytics"]["Returns"][number];

/**
 * Role-scoped per-log time rows for the analytics page. `userId: null` means
 * "everyone" — the SERVER decides what that resolves to: admins/owners get the
 * whole team, everyone else always gets their own logs regardless of inputs.
 */
export function useTimeAnalytics(input: {
  userId: string | null;
  from?: string;
  to?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: [
      "time-analytics",
      teamId,
      input.userId,
      input.from ?? null,
      input.to ?? null,
    ] as const,
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TimeAnalyticsRow[]> => {
      const { data, error } = await supabase.rpc("time_analytics", {
        p_team_id: teamId as string,
        p_user_id: input.userId ?? undefined,
        p_from: input.from,
        p_to: input.to,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
