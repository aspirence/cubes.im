"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

/**
 * Member availability, bridged from the HR module (approved leave + org
 * holidays) via privacy-preserving SECURITY DEFINER RPCs — see the
 * capacity_availability migration. PM surfaces only ever see the day, the
 * kind and a display label; leave reasons/balances stay HR-scoped.
 */

/** One unavailable day. `team_member_id`/`user_id` are null for org holidays. */
export interface AvailabilityRow {
  team_member_id: string | null;
  user_id: string | null;
  /** ISO date (yyyy-mm-dd). */
  day: string;
  kind: "leave" | "holiday";
  /** Leave type name or holiday name. */
  label: string | null;
}

/** Fast lookups derived from the raw per-day rows. */
export interface AvailabilityIndex {
  /** team_member_id -> (yyyy-mm-dd -> leave type label). */
  leaveByMember: Map<string, Map<string, string>>;
  /** yyyy-mm-dd -> holiday name. */
  holidays: Map<string, string>;
}

const AVAILABILITY_ROOT = "member-availability" as const;

/**
 * The RPCs reject windows over 400 days. Clamp `to` so a very long user-picked
 * range degrades to "first ~13 months covered" instead of a guaranteed error
 * that would silently suppress the leave warnings.
 */
function clampWindowEnd(
  from: string | undefined,
  to: string | undefined,
): string | undefined {
  if (!from || !to) return to;
  const max = dayjs(from).add(400, "day");
  return dayjs(to).isAfter(max, "day") ? max.format("YYYY-MM-DD") : to;
}

const teamAvailabilityKey = (
  teamId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) => [AVAILABILITY_ROOT, "team", teamId, from, to] as const;

const projectAvailabilityKey = (
  projectId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) => [AVAILABILITY_ROOT, "project", projectId, from, to] as const;

export function buildAvailabilityIndex(
  rows: AvailabilityRow[] | undefined,
): AvailabilityIndex {
  const leaveByMember = new Map<string, Map<string, string>>();
  const holidays = new Map<string, string>();
  for (const row of rows ?? []) {
    if (row.kind === "holiday") {
      holidays.set(row.day, row.label ?? "Holiday");
    } else if (row.team_member_id) {
      let days = leaveByMember.get(row.team_member_id);
      if (!days) {
        days = new Map<string, string>();
        leaveByMember.set(row.team_member_id, days);
      }
      days.set(row.day, row.label ?? "Leave");
    }
  }
  return { leaveByMember, holidays };
}

/**
 * Formats a set of ISO days as a compact human range list, collapsing
 * consecutive runs: ["2026-07-10","2026-07-11","2026-07-14"] -> "Jul 10–11, Jul 14".
 */
export function formatLeaveDays(days: string[]): string {
  const sorted = [...days].sort();
  const parts: string[] = [];
  let runStart: string | null = null;
  let prev: string | null = null;

  const flush = () => {
    if (!runStart || !prev) return;
    parts.push(
      runStart === prev
        ? dayjs(runStart).format("MMM D")
        : `${dayjs(runStart).format("MMM D")}–${dayjs(prev).format(
            dayjs(runStart).month() === dayjs(prev).month() ? "D" : "MMM D",
          )}`,
    );
  };

  for (const d of sorted) {
    if (prev && dayjs(d).diff(dayjs(prev), "day") === 1) {
      prev = d;
      continue;
    }
    flush();
    runStart = d;
    prev = d;
  }
  flush();
  return parts.join(", ");
}

/**
 * Availability for the active team over an inclusive [from, to] window
 * (ISO dates). Disabled until the team and both dates are known.
 */
export function useTeamAvailability(
  from: string | undefined,
  to: string | undefined,
) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const clampedTo = clampWindowEnd(from, to);

  return useQuery({
    queryKey: teamAvailabilityKey(teamId, from, clampedTo),
    enabled: Boolean(teamId && from && clampedTo && from <= clampedTo),
    queryFn: async (): Promise<AvailabilityRow[]> => {
      const { data, error } = await supabase.rpc(
        "get_team_member_availability",
        {
          p_team_id: teamId as string,
          p_from: from as string,
          p_to: clampedTo as string,
        },
      );
      if (error) throw error;
      return (data ?? []) as AvailabilityRow[];
    },
  });
}

/**
 * Availability for a project's team over an inclusive [from, to] window
 * (ISO dates) — used by project-scoped surfaces like the task drawer, which
 * know the project but not the team.
 */
export function useProjectAvailability(
  projectId: string | undefined,
  from: string | undefined,
  to: string | undefined,
) {
  const supabase = useMemo(() => createClient(), []);
  const clampedTo = clampWindowEnd(from, to);

  return useQuery({
    queryKey: projectAvailabilityKey(projectId, from, clampedTo),
    enabled: Boolean(projectId && from && clampedTo && from <= clampedTo),
    queryFn: async (): Promise<AvailabilityRow[]> => {
      const { data, error } = await supabase.rpc(
        "get_project_member_availability",
        {
          p_project_id: projectId as string,
          p_from: from as string,
          p_to: clampedTo as string,
        },
      );
      if (error) throw error;
      return (data ?? []) as AvailabilityRow[];
    },
  });
}
