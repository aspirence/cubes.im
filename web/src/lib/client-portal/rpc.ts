import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientProjectOverview,
  ClientProjectSummary,
  ClientRpcFailure,
  ClientSessionContext,
} from "./types";

/**
 * Thin wrappers over the client_* SECURITY DEFINER functions.
 *
 * Every one of them takes the raw cookie value and resolves it to exactly one
 * contact inside Postgres. None of them is executable by `anon` or
 * `authenticated`, so these wrappers only ever work with a service-role client
 * — which is the point: the client's browser never talks to PostgREST, it talks
 * to /api/client/**, and the filtering happens one layer below that.
 */

export interface MagicLinkTarget {
  contact_id: string;
  team_id: string;
  team_name: string;
  email: string;
  name: string | null;
  token: string;
  expires_at: string;
}

/** One row per workspace this address is a live contact in (at most 5). */
export async function issueMagicLinks(
  admin: SupabaseClient,
  email: string,
): Promise<MagicLinkTarget[]> {
  const { data, error } = await admin.rpc("client_issue_magic_links", {
    p_email: email,
  });
  if (error) throw new Error(error.message);
  return (data as MagicLinkTarget[] | null) ?? [];
}

export interface ConsumeResult {
  ok: boolean;
  reason?: string;
  session_token?: string;
  contact_id?: string;
  team_id?: string;
  expires_at?: string;
}

export async function consumeMagicLink(
  admin: SupabaseClient,
  token: string,
  userAgent: string | null,
  ipHash: string | null,
): Promise<ConsumeResult> {
  const { data, error } = await admin.rpc("client_consume_magic_link", {
    p_token: token,
    p_user_agent: userAgent,
    p_ip_hash: ipHash,
  });
  if (error) throw new Error(error.message);
  return (data as ConsumeResult | null) ?? { ok: false, reason: "invalid" };
}

export async function endClientSession(
  admin: SupabaseClient,
  token: string,
): Promise<void> {
  const { error } = await admin.rpc("client_end_session", { p_token: token });
  if (error) throw new Error(error.message);
}

export async function sessionContext(
  admin: SupabaseClient,
  token: string,
): Promise<ClientSessionContext | ClientRpcFailure> {
  const { data, error } = await admin.rpc("client_session_context", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data as ClientSessionContext | ClientRpcFailure | null) ?? {
    ok: false,
    reason: "unauthenticated",
  };
}

export async function portalProjects(
  admin: SupabaseClient,
  token: string,
): Promise<
  { ok: true; projects: ClientProjectSummary[] } | ClientRpcFailure
> {
  const { data, error } = await admin.rpc("client_portal_projects", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (
    (data as { ok: true; projects: ClientProjectSummary[] } | ClientRpcFailure | null) ?? {
      ok: false,
      reason: "unauthenticated",
    }
  );
}

export async function projectOverview(
  admin: SupabaseClient,
  token: string,
  projectId: string,
): Promise<ClientProjectOverview | ClientRpcFailure> {
  const { data, error } = await admin.rpc("client_project_overview", {
    p_token: token,
    p_project_id: projectId,
  });
  if (error) throw new Error(error.message);
  return (data as ClientProjectOverview | ClientRpcFailure | null) ?? {
    ok: false,
    reason: "unauthenticated",
  };
}

export interface SubmitRequestResult {
  ok: boolean;
  reason?: string;
  request_id?: string;
  title?: string;
  project_name?: string;
  /** Who on the agency side to email — resolved in SQL, never by the browser. */
  notify?: Array<{ email: string; name: string | null }>;
}

export async function submitRequest(
  admin: SupabaseClient,
  token: string,
  input: {
    projectId: string;
    title: string;
    details?: string | null;
    priority?: string | null;
    requestType?: string | null;
    dueBy?: string | null;
  },
): Promise<SubmitRequestResult> {
  const { data, error } = await admin.rpc("client_submit_request", {
    p_token: token,
    p_project_id: input.projectId,
    p_title: input.title,
    p_details: input.details ?? null,
    p_priority: input.priority ?? "normal",
    p_request_type: input.requestType ?? "general",
    p_due_by: input.dueBy ?? null,
  });
  if (error) throw new Error(error.message);
  return (data as SubmitRequestResult | null) ?? { ok: false, reason: "invalid" };
}

export interface DecideApprovalResult {
  ok: boolean;
  reason?: string;
  approval_id?: string;
  state?: string;
  decided_at?: string;
  decided_by?: { contact_id: string; name: string | null; email: string };
}

export async function decideApproval(
  admin: SupabaseClient,
  token: string,
  approvalId: string,
  state: "approved" | "changes_requested",
  note: string | null,
): Promise<DecideApprovalResult> {
  const { data, error } = await admin.rpc("client_decide_approval", {
    p_token: token,
    p_approval_id: approvalId,
    p_state: state,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return (data as DecideApprovalResult | null) ?? { ok: false, reason: "invalid" };
}

export interface SharedFileResult {
  ok: boolean;
  reason?: string;
  name?: string;
  mime?: string | null;
  storage_path?: string;
  allow_download?: boolean;
}

export async function fileForShare(
  admin: SupabaseClient,
  token: string,
  shareId: string,
): Promise<SharedFileResult> {
  const { data, error } = await admin.rpc("client_file_for_share", {
    p_token: token,
    p_share_id: shareId,
  });
  if (error) throw new Error(error.message);
  return (data as SharedFileResult | null) ?? { ok: false, reason: "not_found" };
}

/**
 * The file behind an approval: the subject itself when it is a file, or the
 * nth attachment when a post is being signed off.
 *
 * The caller names an APPROVAL, never a file — what may be served is derived
 * in SQL from that approval's own subject, so an asset number is not something
 * worth guessing.
 */
export async function approvalFile(
  admin: SupabaseClient,
  token: string,
  approvalId: string,
  asset: number | null,
): Promise<SharedFileResult> {
  const { data, error } = await admin.rpc("client_approval_file", {
    p_token: token,
    p_approval_id: approvalId,
    p_asset: asset,
  });
  if (error) throw new Error(error.message);
  return (data as SharedFileResult | null) ?? { ok: false, reason: "not_found" };
}

/** One column of a shared sheet, as the portal is allowed to see it. */
export interface SharedSheetColumn {
  id: string;
  label: string;
  type: string;
  currency?: string | null;
  options?: Array<{ value?: string; label?: string; color?: string }>;
}

export interface SharedSheetResult {
  ok: boolean;
  /** 'not_viewable' means the sheet is a live view of the team's own data. */
  reason?: string;
  name?: string;
  description?: string | null;
  columns?: SharedSheetColumn[];
  rows?: Array<Record<string, unknown>>;
  total?: number;
  offset?: number;
  limit?: number;
}

export async function sheetForShare(
  admin: SupabaseClient,
  token: string,
  shareId: string,
  limit: number,
  offset: number,
): Promise<SharedSheetResult> {
  const { data, error } = await admin.rpc("client_sheet_for_share", {
    p_token: token,
    p_share_id: shareId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  return (data as SharedSheetResult | null) ?? { ok: false, reason: "not_found" };
}
