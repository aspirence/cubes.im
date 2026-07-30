"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// organization_domains / workspace_join_requests + their RPCs are newer than the
// generated Database types, so we loosen the client for them (same pattern as
// src/features/billing/use-pricing.ts).
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export type JoinableOrg = {
  org_id: string;
  org_name: string;
  domain: string;
  already_member: boolean;
  pending: boolean;
};

export type JoinRequest = {
  id: string;
  org_id: string;
  requester_user_id: string;
  requester_email: string;
  requester_domain: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  assigned_team_id: string | null;
  assigned_role_id: string | null;
  approver_id: string | null;
  note: string | null;
  decided_at: string | null;
  created_at: string;
  requester: { name: string | null; email: string | null } | null;
};

/** The single verified org matching the current user's email domain (or null). */
export function useJoinableOrg() {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["joinable-org"],
    queryFn: async (): Promise<JoinableOrg | null> => {
      const { data, error } = await loose(supabase).rpc("lookup_joinable_org");
      if (error) throw error;
      const rows = (data ?? []) as JoinableOrg[];
      return rows[0] ?? null;
    },
  });
}

/** Files a pending join request routed to the matched org's admins. */
export function useRequestToJoin() {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await loose(supabase).rpc("request_to_join");
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      // request_to_join() also flips users.setup_completed, which the proxy's
      // onboarding gate reads server-side. <AuthProvider> only reloads its
      // profile on an auth event, so refresh the session before the caller
      // navigates — otherwise the client still believes setup is unfinished.
      // Never fatal: the join already committed server-side, so a refresh
      // hiccup must not surface as "couldn't accept" — the next auth event or
      // reload picks the new profile up anyway.
      try {
        await supabase.auth.refreshSession();
      } catch {
        // ignore
      }
      qc.invalidateQueries({ queryKey: ["joinable-org"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["active-team"] });
    },
  });
}

/** The requester withdraws their own pending request. */
export function useCancelJoinRequest() {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string): Promise<void> => {
      const { error } = await loose(supabase).rpc("cancel_join_request", {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["joinable-org"] }),
  });
}

/** Admin: the org's join requests (default: pending), with requester name/email. */
export function useOrgJoinRequests(
  orgId: string | undefined,
  status: JoinRequest["status"] = "pending",
) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["join-requests", orgId, status],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<JoinRequest[]> => {
      const { data, error } = await loose(supabase)
        .from("workspace_join_requests")
        .select("*, requester:requester_user_id(name,email)")
        .eq("org_id", orgId as string)
        .eq("status", status)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as JoinRequest[];
    },
  });
}

/** Admin: approve (assign workspace + role) or reject a join request. */
export function useDecideJoinRequest() {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      approve: boolean;
      teamId?: string;
      roleId?: string;
      note?: string;
    }): Promise<void> => {
      const { error } = await loose(supabase).rpc("decide_join_request", {
        p_request_id: input.requestId,
        p_approve: input.approve,
        p_team_id: input.teamId ?? null,
        p_role_id: input.roleId ?? null,
        p_note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["join-requests"] });
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
  });
}
