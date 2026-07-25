"use client";

import { useQuery } from "@tanstack/react-query";

/** One owner/workspace row in the company-wide analytics table. */
export interface OwnerRow {
  orgId: string;
  workspace: string;
  ownerEmail: string;
  ownerName: string | null;
  createdAt: string | null;
  workspaces: number;
  members: number;
  guests: number;
  spaces: number;
  projects: number;
  plan: "free" | "cloud";
  paidTeams: number;
  estMonthlyCents: number;
  nextRenewal: string | null;
}

export interface PlatformAnalytics {
  currency: string;
  totals: {
    owners: number;
    users: number;
    workspaces: number;
    members: number;
    guests: number;
    spaces: number;
    projects: number;
    signups7d: number;
    signups30d: number;
    paidWorkspaces: number;
    freeWorkspaces: number;
  };
  revenue: {
    estMrrCents: number;
    nextMonthCents: number;
    deviceCollectedCents: number;
    deviceOrders: number;
  };
  statusBreakdown: {
    active: number;
    paused: number;
    canceled: number;
    cloud: number;
    free: number;
  };
  owners: OwnerRow[];
  recentSignups: { email: string; name: string | null; createdAt: string | null }[];
  recentPayments: { amountCents: number; paidAt: string | null; who: string; provider: string | null }[];
  generatedAt: string;
}

/**
 * Company-wide analytics for the super-admin home dashboard. Served by
 * /api/platform/analytics, which re-verifies platform-admin on every call, so
 * this is safe to enable only when the caller is known to be an admin.
 */
export function usePlatformAnalytics(enabled: boolean) {
  return useQuery({
    queryKey: ["platform-analytics"],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<PlatformAnalytics> => {
      const res = await fetch("/api/platform/analytics");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load analytics (${res.status})`);
      }
      return res.json();
    },
  });
}

/** Full drill-down for one owner/workspace (see /api/platform/owner). */
export interface OwnerDetail {
  currency: string;
  owner: { name: string | null; email: string | null; avatar: string | null; joinedAt: string | null };
  business: {
    workspaceName: string;
    contactNumber: string | null;
    contactNumberSecondary: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    workingHours: number | null;
    subscriptionStatus: string | null;
    trialInProgress: boolean;
    trialExpireDate: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  footprint: {
    workspaces: number;
    members: number;
    guests: number;
    spaces: number;
    projects: number;
    tasks: number;
    tasksDone: number;
    estMonthlyCents: number;
    lastActive: string | null;
  };
  teams: {
    id: string;
    name: string;
    createdAt: string | null;
    members: number;
    guests: number;
    spaces: number;
    projects: number;
    plan: string;
    status: string;
    storageGb: number;
    renewsAt: string | null;
    estMonthlyCents: number;
  }[];
  members: {
    name: string | null;
    email: string | null;
    avatar: string | null;
    role: string | null;
    memberType: string;
    active: boolean;
    teamId: string;
  }[];
  recentProjects: { id: string; name: string; team: string; space: string | null; createdAt: string | null }[];
  recentTasks: { id: string; name: string; done: boolean; updated_at: string | null; project: string }[];
}

/** Drill-down for a single owner. Enabled only when a row is selected. */
export function useOwnerDetail(orgId: string | null) {
  return useQuery({
    queryKey: ["platform-owner", orgId],
    enabled: Boolean(orgId),
    staleTime: 60_000,
    queryFn: async (): Promise<OwnerDetail> => {
      const res = await fetch(`/api/platform/owner?orgId=${encodeURIComponent(orgId!)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load owner (${res.status})`);
      }
      return res.json();
    },
  });
}

/** cents → "$1,234.56" (or the given currency). */
export function money(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
