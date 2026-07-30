"use client";

import { useMemo } from "react";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import { useIsPlatformAdmin } from "@/features/billing/use-pricing";
import type { DashboardCard } from "./dashboard-types";

/**
 * Who may see which analytics — the single source of truth the gallery, the
 * config drawer, the templates menu, and card rendering all consult.
 *
 * Two layers keep this honest:
 *  1. DATA is scoped server-side by RLS regardless of anything here — a
 *     member's team-tasks query only returns projects they can access, a
 *     limited member's only their assigned tasks. Nothing client-side can
 *     widen that.
 *  2. This layer shapes the OFFER so the UI never promises what the data
 *     can't honestly show: a limited member charting "workload by member"
 *     would render a chart of just themselves labelled as the team — a lie,
 *     not a leak. So team-level analytics aren't offered to them at all.
 *
 * Tiers:
 *  - platform super-admin, owner, admin → user- and team-level analytics.
 *  - member → the same offer; their numbers cover only the spaces/projects
 *    they can access (RLS), which matches what they can see elsewhere.
 *  - limited / guest → user-level only: scope forced to "me", no assignee
 *    grouping or assignee filters, no team presets or templates.
 */
export interface AnalyticsCapabilities {
  /** Resolved tier, for copy ("your analytics cover what you can access"). */
  tier: "super-admin" | "owner" | "admin" | "member" | "limited";
  /** May build cards over the whole team's work. */
  teamScope: boolean;
  /** May group/filter by assignee (identity-revealing dimensions). */
  assigneeDimension: boolean;
  /** Still resolving member type — hold gating steady, don't flash-hide. */
  loading: boolean;
}

export function capabilitiesFor(
  memberType: string | undefined,
  isPlatformAdmin: boolean,
  /** True while the team/member queries are genuinely in flight. */
  resolving = memberType === undefined,
): AnalyticsCapabilities {
  if (isPlatformAdmin) {
    return { tier: "super-admin", teamScope: true, assigneeDimension: true, loading: false };
  }
  switch (memberType) {
    case "owner":
    case "admin":
    case "member":
      return {
        tier: memberType,
        teamScope: true,
        assigneeDimension: true,
        loading: false,
      };
    case "limited":
    case "guest":
      return { tier: "limited", teamScope: false, assigneeDimension: false, loading: false };
    default:
      // A guest can NEVER resolve a member type client-side: is_team_member()
      // excludes guests, so RLS hides their team row and even their own
      // team_members row — the queries RESOLVE with nothing rather than load
      // forever. So "resolved but absent" means guest and gets the clamped
      // tier; only genuinely in-flight queries keep the full-offer UI stable
      // (a normal member shouldn't watch options vanish and reappear).
      return resolving
        ? { tier: "member", teamScope: true, assigneeDimension: true, loading: true }
        : { tier: "limited", teamScope: false, assigneeDimension: false, loading: false };
  }
}

/** The viewer's analytics capabilities in the active workspace. */
export function useAnalyticsCapabilities(): AnalyticsCapabilities {
  const { user } = useAuth();
  const activeTeamQuery = useActiveTeam();
  const membersQuery = useTeamMembers();
  const { data: isPlatformAdmin } = useIsPlatformAdmin();

  return useMemo(() => {
    const memberType = user
      ? (membersQuery.data ?? []).find((m) => m.user?.id === user.id)?.member_type
      : undefined;
    // Resolved = the team query settled AND (no readable team → guest, or the
    // members list settled too). useTeamMembers is enabled only with a team id,
    // so its isPending stays true forever when the team resolves null — treat
    // that combination as resolved-absent, not as loading.
    const teamSettled = !activeTeamQuery.isPending;
    const teamId = activeTeamQuery.data?.id;
    const resolving = !teamSettled || (Boolean(teamId) && membersQuery.isPending);
    return capabilitiesFor(memberType, Boolean(isPlatformAdmin), resolving);
  }, [
    user,
    membersQuery.data,
    membersQuery.isPending,
    activeTeamQuery.isPending,
    activeTeamQuery.data?.id,
    isPlatformAdmin,
  ]);
}

/**
 * Render-time enforcement: clamps a card to what the viewer may see. Gating
 * the gallery/drawer shapes what can be BUILT, but stored layouts, seeded
 * defaults, and layouts built before a role change all reach the renderer —
 * so the renderer itself must hold the line.
 *
 * For a viewer without team scope every card becomes scope "me", and
 * assignee grouping collapses to status (with only their own tasks, an
 * assignee chart is one bar of themselves mislabelled as a comparison).
 */
export function clampCardForViewer(
  card: DashboardCard,
  caps: AnalyticsCapabilities,
): DashboardCard {
  if (caps.teamScope) return card;
  const clamped: DashboardCard = {
    ...card,
    filter: { ...card.filter, scope: "me", assigneeIds: [] },
  };
  if (!caps.assigneeDimension && card.groupBy === "assignee") {
    clamped.groupBy = "status";
  }
  return clamped;
}
