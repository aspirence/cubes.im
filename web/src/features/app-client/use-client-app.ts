"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import { tasksRootKey } from "@/features/tasks/use-tasks";
import {
  isBackendMissing,
  normalizeEmail,
  roleGrants,
  type ClientApprovalRow,
  type ClientApprovalState,
  type ClientApprovalSubject,
  type ClientContactRow,
  type ClientProjectAccessRow,
  type ClientRequestRow,
  type ClientRole,
  type ClientShareKind,
  type ClientShareRow,
} from "./types";

/**
 * Agency-side data access for the Client app.
 *
 * Everything here runs as the signed-in agency user through PostgREST, so RLS
 * (is_team_member / is_project_team_member) is what decides access — this file
 * adds no authorization of its own. The one exception is sending mail, which
 * needs a service-role sender and therefore goes to /api/client/invite.
 *
 * The app_client_* tables are newer than src/types/database.ts, hence the
 * loose() cast and the local row shapes from docs/AUTOMATION_CLIENT.md.
 * The backend migration lands in parallel with this UI, so every read answers
 * `notReady` instead of throwing when the tables are not there yet.
 */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** Query results carry `notReady` instead of throwing before the migration. */
export interface Loaded<T> {
  rows: T[];
  notReady: boolean;
}

/** The answer every read gives while the Client migration is unapplied. */
function notReadyResult<T>(): Loaded<T> {
  return { rows: [], notReady: true };
}

const CLIENT_ROOT = "app-client";

const keys = {
  contacts: (teamId?: string) => [CLIENT_ROOT, "contacts", teamId] as const,
  access: (teamId?: string, projectId?: string) =>
    [CLIENT_ROOT, "access", teamId, projectId ?? "all"] as const,
  shares: (teamId?: string, projectId?: string) =>
    [CLIENT_ROOT, "shares", teamId, projectId ?? "all"] as const,
  requests: (teamId?: string, projectId?: string) =>
    [CLIENT_ROOT, "requests", teamId, projectId ?? "all"] as const,
  approvals: (teamId?: string, projectId?: string) =>
    [CLIENT_ROOT, "approvals", teamId, projectId ?? "all"] as const,
};

/** Drop every cached Client-app read — after any write. */
function invalidateClientApp(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: [CLIENT_ROOT] });
}

/* ───────────────────────────── Reads ───────────────────────────── */

/** Every client contact in the workspace (the /apps/client hub lists these). */
export function useClientContacts() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: keys.contacts(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Loaded<ClientContactRow>> => {
      const { data, error } = await loose(supabase)
        .from("app_client_contacts")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) {
        if (isBackendMissing(error)) return notReadyResult();
        throw error;
      }
      return { rows: (data ?? []) as ClientContactRow[], notReady: false };
    },
  });
}

/** Per-project access grants. Without a project id, the whole workspace's. */
export function useClientProjectAccess(projectId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: keys.access(teamId, projectId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Loaded<ClientProjectAccessRow>> => {
      let q = loose(supabase)
        .from("app_client_project_access")
        .select("*")
        .eq("team_id", teamId as string);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (isBackendMissing(error)) return notReadyResult();
        throw error;
      }
      return { rows: (data ?? []) as ClientProjectAccessRow[], notReady: false };
    },
  });
}

/** The opt-in list of what a client may see. Never "the whole project". */
export function useClientShares(projectId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: keys.shares(teamId, projectId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Loaded<ClientShareRow>> => {
      let q = loose(supabase)
        .from("app_client_shares")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (isBackendMissing(error)) return notReadyResult();
        throw error;
      }
      return { rows: (data ?? []) as ClientShareRow[], notReady: false };
    },
  });
}

/** The intake queue. Polled while embedded so a new request shows up. */
export function useClientRequests(projectId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: keys.requests(teamId, projectId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Loaded<ClientRequestRow>> => {
      let q = loose(supabase)
        .from("app_client_requests")
        .select("*")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (isBackendMissing(error)) return notReadyResult();
        throw error;
      }
      return { rows: (data ?? []) as ClientRequestRow[], notReady: false };
    },
  });
}

export function useClientApprovals(projectId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: keys.approvals(teamId, projectId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Loaded<ClientApprovalRow>> => {
      let q = loose(supabase)
        .from("app_client_approvals")
        .select("*")
        .eq("team_id", teamId as string)
        .order("requested_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (isBackendMissing(error)) return notReadyResult();
        throw error;
      }
      return { rows: (data ?? []) as ClientApprovalRow[], notReady: false };
    },
  });
}

/** A row that can be shared or sent for approval, reduced to what a picker needs. */
export interface ShareCandidate {
  id: string;
  title: string;
  detail: string | null;
  /**
   * Where a sheet's rows come from. Only "custom" keeps them in the database,
   * and only those can be opened in the portal — the share modal says so
   * before an agency shares a row the client cannot read.
   */
  source?: string | null;
}

/**
 * Sheets belong to another app in this build, so they are read loosely and
 * optionally: a workspace without the Sheets migration simply offers nothing
 * of that kind to share, rather than failing.
 */
export function useShareableSheets(projectId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: [CLIENT_ROOT, "sheets", teamId, projectId ?? "all"],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Loaded<ShareCandidate>> => {
      let q = loose(supabase)
        .from("app_sheets")
        .select("id, name, source, project_id")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (isBackendMissing(error)) return notReadyResult();
        throw error;
      }
      const rows = (data ?? []) as { id: string; name: string; source?: string | null }[];
      return {
        rows: rows.map((row) => ({
          id: row.id,
          title: row.name,
          detail: row.source ?? null,
          source: row.source ?? null,
        })),
        notReady: false,
      };
    },
  });
}

/** Content Studio items, for "ask the client to approve this post". */
export function useShareableContentItems(projectId?: string) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: [CLIENT_ROOT, "content-items", teamId, projectId ?? "all"],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Loaded<ShareCandidate>> => {
      let q = loose(supabase)
        .from("app_content_studio_items")
        .select("id, title, status, content_type, project_id")
        .eq("team_id", teamId as string)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (isBackendMissing(error)) return notReadyResult();
        throw error;
      }
      const rows = (data ?? []) as {
        id: string;
        title: string | null;
        status?: string | null;
        content_type?: string | null;
      }[];
      return {
        rows: rows.map((row) => ({
          id: row.id,
          title: row.title ?? "Untitled content",
          detail: [row.content_type, row.status].filter(Boolean).join(" · ") || null,
        })),
        notReady: false,
      };
    },
  });
}
/* ───────────────────────────── Writes ─────────────────────────────
 *
 * Anything that sends mail, mints a sign-in link, creates a task or revokes a
 * session goes through /api/client/** — those routes own the service-role key,
 * the email templates and the revoke cascade, and re-implementing any of that
 * here would mean two behaviours to keep in step. What stays on PostgREST is
 * the share list, which is a plain RLS-gated table with no side effects.
 */

/** The dispatcher's own verdict on one email, never rounded up to "sent". */
export interface MailVerdict {
  status: "sent" | "failed" | "skipped" | "unknown";
  reason?: string;
  /** Present only when nothing was sent: the single-use link, to hand over. */
  link?: string;
}

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** One fetch wrapper, so every route call fails the same recognisable way. */
async function callApi<T>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach the server." };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const dict = (payload ?? {}) as { error?: string };
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error:
        dict.error ??
        (response.status === 404
          ? "The client backend is not set up yet."
          : "That did not work."),
    };
  }
  return { ok: true, status: response.status, data: (payload ?? null) as T, error: null };
}

/** Reads the honest email verdict out of a contacts/invite response. */
function mailVerdictOf(payload: {
  email?: { status?: string; reason?: string };
  link?: string;
} | null): MailVerdict {
  const status = payload?.email?.status;
  return {
    status:
      status === "sent" || status === "failed" || status === "skipped"
        ? status
        : "unknown",
    reason: payload?.email?.reason,
    link: payload?.link,
  };
}

export interface InviteContactInput {
  email: string;
  name?: string | null;
  role: ClientRole;
  clientId?: string | null;
  /** Grant access to this project as part of the invite. */
  projectId?: string;
  /** false when the agency wants the link to copy rather than an email. */
  sendEmail?: boolean;
}

export interface InviteContactResult {
  contactId: string;
  mail: MailVerdict;
}

/**
 * Creates (or re-points) a contact, grants the project, and asks for the
 * invitation email — one route call, because an identity without a project is
 * access to nothing and the two must not be able to drift apart.
 *
 * The returned verdict is what the UI must believe: "sent" only when the
 * dispatcher said so, and the copyable link when it did not.
 */
export function useInviteClientContact() {
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: InviteContactInput): Promise<InviteContactResult> => {
      if (!teamId) throw new Error("No active workspace.");
      const grants = roleGrants(input.role);
      const result = await callApi<{
        contactId?: string;
        email?: { status?: string; reason?: string };
        link?: string;
      }>("/api/client/contacts", "POST", {
        teamId,
        email: normalizeEmail(input.email),
        name: input.name?.trim() || null,
        role: input.role,
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
        canRequest: grants.can_request,
        canApprove: grants.can_approve,
        sendEmail: input.sendEmail !== false,
      });
      if (!result.ok || !result.data?.contactId) {
        throw new Error(result.error ?? "Could not add that contact.");
      }
      return {
        contactId: result.data.contactId,
        mail: mailVerdictOf(result.data),
      };
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/**
 * Role, name, revoke and reinstate. Revoking goes through the route because a
 * trigger there deletes every session and unused link — the promise the whole
 * feature rests on, and not one to reimplement in a browser.
 */
export function useUpdateClientContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      action?: "update" | "revoke" | "reinstate";
      role?: ClientRole;
      name?: string | null;
    }): Promise<{ sessionsLeft?: number }> => {
      const result = await callApi<{ sessionsLeft?: number }>(
        `/api/client/contacts/${input.id}`,
        "PATCH",
        {
          action: input.action ?? "update",
          ...(input.role ? { role: input.role } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
        },
      );
      if (!result.ok) throw new Error(result.error ?? "Could not change that.");
      return result.data ?? {};
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/** Grant, adjust or drop one contact's access to one project. */
export function useSetClientProjectAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contactId: string;
      projectId: string;
      grant: boolean;
      canRequest?: boolean;
      canApprove?: boolean;
    }): Promise<void> => {
      const result = await callApi(
        `/api/client/contacts/${input.contactId}`,
        "PATCH",
        input.grant
          ? {
              action: "update",
              projectId: input.projectId,
              canRequest: input.canRequest ?? true,
              canApprove: input.canApprove ?? false,
            }
          : { action: "unshare", projectId: input.projectId },
      );
      if (!result.ok) throw new Error(result.error ?? "Could not change access.");
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/** A fresh sign-in link for a contact who lost theirs (or never got one). */
export function useSendClientInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contactId: string;
      projectId?: string;
    }): Promise<MailVerdict> => {
      const result = await callApi<{
        email?: { status?: string; reason?: string };
        link?: string;
      }>(`/api/client/contacts/${input.contactId}`, "PATCH", {
        action: "resend",
        projectId: input.projectId ?? null,
      });
      if (!result.ok) throw new Error(result.error ?? "Could not send a link.");
      return mailVerdictOf(result.data);
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}
/** Adds one item to what the client can see. Opt-in, one row at a time. */
export function useShareWithClient() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { profile } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      kind: ClientShareKind;
      refId: string;
      title: string | null;
    }): Promise<void> => {
      if (!teamId) throw new Error("No active workspace.");
      const { error } = await loose(supabase)
        .from("app_client_shares")
        .upsert(
          {
            team_id: teamId,
            project_id: input.projectId,
            kind: input.kind,
            ref_id: input.refId,
            title: input.title,
            shared_by: profile?.id ?? null,
          },
          { onConflict: "project_id,kind,ref_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

export function useUnshareFromClient() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await loose(supabase)
        .from("app_client_shares")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/**
 * Asks the client to sign off on something.
 *
 * The version is chosen in SQL (round 3 is its own record, and round 2's
 * decision survives), and the route emails exactly the contacts who may decide
 * — which is not necessarily everyone with access, because approving is its own
 * permission. The per-recipient verdicts come back so the UI can say who was
 * actually written to.
 */
export function useRequestClientApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      subjectKind: ClientApprovalSubject;
      subjectId: string;
      title: string | null;
      note: string | null;
      version?: number;
    }): Promise<{
      approvalId?: string;
      version?: number;
      notified: { contactId: string; status: string; reason?: string }[];
    }> => {
      const result = await callApi<{
        approvalId?: string;
        version?: number;
        notified?: { contactId: string; status: string; reason?: string }[];
      }>("/api/client/approvals", "POST", {
        projectId: input.projectId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        title: input.title,
        note: input.note,
        ...(input.version ? { version: input.version } : {}),
      });
      if (!result.ok) {
        throw new Error(result.error ?? "Could not send that for approval.");
      }
      return {
        approvalId: result.data?.approvalId,
        version: result.data?.version,
        notified: result.data?.notified ?? [],
      };
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/** Withdraws a pending approval. RLS allows project members to delete it. */
export function useDeleteClientApproval() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await loose(supabase)
        .from("app_client_approvals")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/**
 * Accept → a real task.
 *
 * The route creates it through the ordinary `create_task` RPC as the signed-in
 * agency user, so the project's own task-creation rules apply exactly as they
 * do for a "New task" button, and only then links it back to the request. That
 * ordering is why a request can never point at a task that was never made.
 */
export function useAcceptClientRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      /** The request's project, so its task lists can be refreshed. */
      projectId: string;
      priorityId?: string | null;
      statusId?: string | null;
      assignees?: string[];
      note?: string | null;
      copyDetails?: boolean;
    }): Promise<{ taskId: string }> => {
      const result = await callApi<{ taskId?: string }>(
        `/api/client/requests/${input.id}/accept`,
        "POST",
        {
          priorityId: input.priorityId ?? null,
          statusId: input.statusId ?? null,
          assignees: input.assignees ?? [],
          note: input.note ?? null,
          copyDetails: input.copyDetails !== false,
        },
      );
      if (!result.ok || !result.data?.taskId) {
        throw new Error(result.error ?? "Could not accept that request.");
      }
      return { taskId: result.data.taskId };
    },
    onSuccess: (_result, input) => {
      invalidateClientApp(queryClient);
      // The task was created by a route, not by useCreateTask, so nothing else
      // knows the project's task list just changed — the board, the list and
      // this app's own pickers would all keep showing the stale set.
      queryClient.invalidateQueries({ queryKey: tasksRootKey(input.projectId) });
    },
  });
}

/** Declining, with the reason the client will read. The note is required. */
export function useDeclineClientRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; note: string }): Promise<void> => {
      const result = await callApi(
        `/api/client/requests/${input.id}/decline`,
        "POST",
        { note: input.note },
      );
      if (!result.ok) throw new Error(result.error ?? "Could not decline that.");
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/**
 * Closing out an accepted request. A plain status write: there is no decision
 * to record and nobody new to email, and RLS already limits it to the project's
 * own team.
 */
export function useMarkRequestDone() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await loose(supabase)
        .from("app_client_requests")
        .update({ status: "done" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateClientApp(queryClient),
  });
}

/** Where a client signs in. Shown next to every invite, ready to copy. */
export function portalSignInUrl(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/portal`;
}

/** Approvals keyed by subject, so a task row can show its own state. */
export function approvalsBySubject(
  rows: ClientApprovalRow[],
): Map<string, ClientApprovalRow[]> {
  const map = new Map<string, ClientApprovalRow[]>();
  for (const row of rows) {
    const key = `${row.subject_kind}:${row.subject_id}`;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.version - a.version);
  }
  return map;
}

/** The next version number to ask sign-off on for a subject. */
export function nextApprovalVersion(
  rows: ClientApprovalRow[],
  subjectKind: ClientApprovalSubject,
  subjectId: string,
): number {
  let max = 0;
  for (const row of rows) {
    if (row.subject_kind === subjectKind && row.subject_id === subjectId) {
      max = Math.max(max, row.version);
    }
  }
  return max + 1;
}

/** Client-side states used by both approval and request decisions. */
export type { ClientApprovalState };
