"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { useActiveTeam } from "@/features/teams/use-teams";

type Fn = Database["public"]["Functions"];

/** Single-row team summary returned by `report_team_overview`. */
export type TeamOverview = Fn["report_team_overview"]["Returns"][number];
/** Per-project rollup row returned by `report_projects`. */
export type ReportProject = Fn["report_projects"]["Returns"][number];
/** Per-member rollup row returned by `report_members`. */
export type ReportMember = Fn["report_members"]["Returns"][number];
/** A single logged-time row returned by `report_time_logs`. */
export type ReportTimeLog = Fn["report_time_logs"]["Returns"][number];

const teamOverviewKey = (teamId: string | undefined) =>
  ["report-team-overview", teamId] as const;
const projectsKey = (teamId: string | undefined) =>
  ["report-projects", teamId] as const;
const membersKey = (teamId: string | undefined) =>
  ["report-members", teamId] as const;
const timeLogsKey = (
  teamId: string | undefined,
  from?: string,
  to?: string,
) => ["report-time-logs", teamId, from ?? null, to ?? null] as const;

/**
 * Team-wide summary metrics for the active team (`report_team_overview`).
 * Returns the single summary row or null. Disabled until the team is known.
 */
export function useTeamOverview() {
  const supabase = useMemo(() => createClient(), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;

  return useQuery({
    queryKey: teamOverviewKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamOverview | null> => {
      const { data, error } = await supabase.rpc("report_team_overview", {
        p_team_id: teamId as string,
      });

      if (error) throw error;
      return (data as TeamOverview[] | null)?.[0] ?? null;
    },
  });
}

/**
 * Per-project completion + logged-time rollups for the active team
 * (`report_projects`). Disabled until the team is known.
 */
export function useReportProjects() {
  const supabase = useMemo(() => createClient(), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;

  return useQuery({
    queryKey: projectsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ReportProject[]> => {
      const { data, error } = await supabase.rpc("report_projects", {
        p_team_id: teamId as string,
      });

      if (error) throw error;
      return (data as ReportProject[] | null) ?? [];
    },
  });
}

/**
 * Per-member assignment + logged-time rollups for the active team
 * (`report_members`). Disabled until the team is known.
 */
export function useReportMembers() {
  const supabase = useMemo(() => createClient(), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;

  return useQuery({
    queryKey: membersKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ReportMember[]> => {
      const { data, error } = await supabase.rpc("report_members", {
        p_team_id: teamId as string,
      });

      if (error) throw error;
      return (data as ReportMember[] | null) ?? [];
    },
  });
}

/**
 * Logged-time entries for the active team, optionally bounded by the date range
 * `from`..`to` (`report_time_logs`). Disabled until the team is known.
 */
export function useReportTimeLogs(from?: string, to?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;

  return useQuery({
    queryKey: timeLogsKey(teamId, from, to),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ReportTimeLog[]> => {
      const { data, error } = await supabase.rpc("report_time_logs", {
        p_team_id: teamId as string,
        p_from: from,
        p_to: to,
      });

      if (error) throw error;
      return (data as ReportTimeLog[] | null) ?? [];
    },
  });
}
