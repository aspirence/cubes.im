"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import type { Database } from "@/types/database";

/** email_invitations.member_type is newer than the generated types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export type EmailInvitation =
  Database["public"]["Tables"]["email_invitations"]["Row"] & {
    /** Tier the invitee joins as: admin | member | limited | guest. */
    member_type?: string | null;
  };

/** A pending invitation addressed to the current user, with the team name
 *  (via the my_pending_invitations SECURITY DEFINER RPC — teams RLS hides the
 *  name from non-members, which the invitee still is). */
export interface MyPendingInvitation {
  id: string;
  team_id: string;
  email: string;
  name: string;
  member_type: string;
  created_at: string;
  team_name: string;
}

const invitationsKey = (teamId: string | undefined) =>
  ["invitations", teamId] as const;

/**
 * Lists the active team's outstanding email invitations. Scoped to
 * `useActiveTeam()`; RLS lets team members (and the invited email) read.
 */
export function useInvitations() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: invitationsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<EmailInvitation[]> => {
      const { data, error } = await supabase
        .from("email_invitations")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Creates an email invitation for the active team (admin-only via RLS). The
 * invitee joins as `memberType` (admin | member | limited | guest — never
 * owner) when they accept; defaults to member.
 */
export function useInviteMember() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: {
      email: string;
      name: string;
      memberType?: string;
    }): Promise<EmailInvitation> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await loose(supabase)
        .from("email_invitations")
        .insert({
          email: input.email,
          name: input.name,
          team_id: teamId,
          member_type: input.memberType ?? "member",
        })
        .select("*")
        .single();

      if (error) throw error;
      return data as EmailInvitation;
    },
    onSuccess: (invitation) => {
      // The invitation EMAIL rides along fire-and-forget: creating the row
      // must never fail because mail didn't go out (it can be re-sent from
      // the People page).
      void fetch("/api/email/invitation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId: invitation.id }),
      }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: invitationsKey(teamId) });
    },
  });
}

/** Re-sends the invitation email for a pending invitation. */
export function useResendInvitationEmail() {
  return useMutation({
    mutationFn: async (
      invitationId: string,
    ): Promise<{ ok: boolean; status?: string; reason?: string }> => {
      const res = await fetch("/api/email/invitation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        reason?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Couldn't send the invitation email.");
      return { ok: Boolean(json.ok), status: json.status, reason: json.reason };
    },
  });
}

/** Cancels (deletes) a pending invitation by id — admin-gated via RLS. */
export function useCancelInvitation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (invitationId: string): Promise<void> => {
      const { error } = await supabase
        .from("email_invitations")
        .delete()
        .eq("id", invitationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationsKey(teamId) });
    },
  });
}

/**
 * Lists pending invitations addressed to the CURRENT user's email, across every
 * team (RLS's `email = my email` predicate allows this cross-team read). Used by
 * the onboarding "Join a workspace" step to surface "you've been invited" offers.
 */
export function useMyPendingInvitations() {
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const email = profile?.email ?? undefined;

  return useQuery({
    // "v2": the row shape changed (PostgREST embed → my_pending_invitations
    // RPC with team_name) — the key bump keeps stale-shaped cache entries from
    // ever rendering.
    queryKey: ["my-invitations", "v2", email],
    enabled: Boolean(email),
    queryFn: async (): Promise<MyPendingInvitation[]> => {
      const { data, error } = await supabase.rpc("my_pending_invitations");
      if (error) throw error;
      return (data ?? []) as MyPendingInvitation[];
    },
  });
}

/**
 * Accepts an invitation by id via the accept_invitation RPC. The RPC verifies
 * the invite email matches the caller, inserts the team membership, and deletes
 * the invitation. Returns the joined team id. Invalidates teams + invitations +
 * team-members so the UI reflects the new membership.
 */
export function useAcceptInvitation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("accept_invitation", {
        p_invitation_id: invitationId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["active-team"] });
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      // The onboarding chooser's "you've been invited" list — without this it
      // keeps showing (and letting the user re-click) a consumed invitation.
      queryClient.invalidateQueries({ queryKey: ["my-invitations"] });
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    },
  });
}
