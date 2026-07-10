"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type Organization =
  Database["public"]["Tables"]["organizations"]["Row"];

export type AdminOverview =
  Database["public"]["Functions"]["admin_org_overview"]["Returns"][number];
export type AdminTeam =
  Database["public"]["Functions"]["admin_list_teams"]["Returns"][number];
export type AdminUser =
  Database["public"]["Functions"]["admin_list_users"]["Returns"][number];
export type AdminProject =
  Database["public"]["Functions"]["admin_list_projects"]["Returns"][number];

/** The user's organization plus whether they own it. */
export type UserOrg = {
  org: Organization;
  isOwner: boolean;
};

const userOrgKey = (teamId: string | undefined) =>
  ["admin", "user-org", teamId] as const;
const overviewKey = (orgId: string | undefined) =>
  ["admin", "overview", orgId] as const;
const adminTeamsKey = (orgId: string | undefined) =>
  ["admin", "teams", orgId] as const;
const adminUsersKey = (orgId: string | undefined) =>
  ["admin", "users", orgId] as const;
const adminProjectsKey = (orgId: string | undefined) =>
  ["admin", "projects", orgId] as const;

/**
 * Resolves the current user's organization by joining
 * `useActiveTeam() -> teams.organization_id -> organizations`. Also exposes
 * `isOwner = org.user_id === auth.uid()`. Disabled until an active team is
 * known; RLS scopes the organizations read to teams the caller belongs to.
 */
export function useUserOrg() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: userOrgKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<UserOrg | null> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return null;

      const { data: team, error: teamError } = await supabase
        .from("teams")
        .select("organization_id")
        .eq("id", teamId as string)
        .maybeSingle();
      if (teamError) throw teamError;

      const orgId = team?.organization_id;
      if (!orgId) return null;

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", orgId)
        .maybeSingle();
      if (orgError) throw orgError;
      if (!org) return null;

      return { org, isOwner: org.user_id === user.id };
    },
  });
}

/**
 * Org-wide overview metrics via the `admin_org_overview` RPC. Disabled until the
 * org is resolved. The RPC RAISEs 'forbidden' for non-admins; that surfaces as
 * the query's error state (it is not swallowed, but it does not crash render).
 */
export function useAdminOverview() {
  const supabase = useMemo(() => createClient(), []);
  const { data: userOrg } = useUserOrg();
  const orgId = userOrg?.org.id;

  return useQuery({
    queryKey: overviewKey(orgId),
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async (): Promise<AdminOverview | null> => {
      const { data, error } = await supabase.rpc("admin_org_overview", {
        p_org_id: orgId as string,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

/** Teams in the org via `admin_list_teams`. Disabled until org resolved. */
export function useAdminTeams() {
  const supabase = useMemo(() => createClient(), []);
  const { data: userOrg } = useUserOrg();
  const orgId = userOrg?.org.id;

  return useQuery({
    queryKey: adminTeamsKey(orgId),
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async (): Promise<AdminTeam[]> => {
      const { data, error } = await supabase.rpc("admin_list_teams", {
        p_org_id: orgId as string,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Users in the org via `admin_list_users`. Disabled until org resolved. */
export function useAdminUsers() {
  const supabase = useMemo(() => createClient(), []);
  const { data: userOrg } = useUserOrg();
  const orgId = userOrg?.org.id;

  return useQuery({
    queryKey: adminUsersKey(orgId),
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async (): Promise<AdminUser[]> => {
      const { data, error } = await supabase.rpc("admin_list_users", {
        p_org_id: orgId as string,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Projects in the org via `admin_list_projects`. Disabled until org resolved. */
export function useAdminProjects() {
  const supabase = useMemo(() => createClient(), []);
  const { data: userOrg } = useUserOrg();
  const orgId = userOrg?.org.id;

  return useQuery({
    queryKey: adminProjectsKey(orgId),
    enabled: Boolean(orgId),
    retry: false,
    queryFn: async (): Promise<AdminProject[]> => {
      const { data, error } = await supabase.rpc("admin_list_projects", {
        p_org_id: orgId as string,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
