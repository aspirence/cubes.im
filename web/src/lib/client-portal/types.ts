/**
 * Row and payload shapes for the Client app.
 *
 * These tables are newer than src/types/database.ts, so — per the contract in
 * docs/AUTOMATION_CLIENT.md — nothing here is generated: the server
 * uses adminClient() (untyped) and these interfaces describe what it gets back.
 *
 * Everything a CLIENT receives is shaped in SQL by the client_* RPCs. The
 * payload types below are therefore a faithful description of those functions'
 * jsonb, not a superset the UI is trusted to filter down.
 */

export type ClientContactRole = "viewer" | "approver" | "requester" | "manager";
export type ClientContactStatus = "invited" | "active" | "revoked";
export type ClientShareKind = "task" | "file" | "sheet" | "update";
export type ClientRequestStatus = "new" | "accepted" | "declined" | "done";
export type ClientApprovalState = "pending" | "approved" | "changes_requested";
export type ClientApprovalSubject =
  | "task"
  | "content_item"
  | "video_review"
  | "file";

export interface ClientContactRow {
  id: string;
  team_id: string;
  client_id: string | null;
  email: string;
  name: string | null;
  role: ClientContactRole;
  status: ClientContactStatus;
  last_seen_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientProjectAccessRow {
  contact_id: string;
  project_id: string;
  team_id: string;
  can_request: boolean;
  can_approve: boolean;
  shared_by: string | null;
  created_at: string;
}

export interface ClientRequestRow {
  id: string;
  team_id: string;
  project_id: string;
  contact_id: string | null;
  request_type: string;
  title: string;
  details: string | null;
  priority: "low" | "normal" | "high" | null;
  status: ClientRequestStatus;
  task_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  due_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientApprovalRow {
  id: string;
  team_id: string;
  project_id: string;
  subject_kind: ClientApprovalSubject;
  subject_id: string;
  version: number;
  title: string | null;
  note: string | null;
  state: ClientApprovalState;
  requested_by: string | null;
  requested_at: string;
  decided_by_contact: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

/* ------------------------------------------------- client-facing payloads --- */

/** A failure answer from any client_* RPC. Reasons are deliberately coarse. */
export interface ClientRpcFailure {
  ok: false;
  reason:
    | "unauthenticated"
    | "not_found"
    | "forbidden"
    | "already_decided"
    | "bad_state"
    | "title_required"
    | "version_exists"
    | "bad_subject_kind"
    | "task_mismatch"
    | "invalid";
}

export interface ClientSessionContext {
  ok: true;
  contact: {
    id: string;
    name: string | null;
    email: string;
    role: ClientContactRole;
  };
  workspace: {
    id: string;
    name: string;
    logo_url: string | null;
    accent: string | null;
  };
  project_count: number;
}

export interface ClientProjectSummary {
  id: string;
  name: string;
  color_code: string | null;
  client_name: string | null;
  can_request: boolean;
  can_approve: boolean;
  shared_count: number;
  pending_approvals: number;
  open_requests: number;
}

export interface ClientProjectOverview {
  ok: true;
  project: {
    id: string;
    name: string;
    color_code: string | null;
    client_name: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  permissions: { can_request: boolean; can_approve: boolean };
  tasks: Array<{
    share_id: string;
    task_id: string;
    name: string;
    status: string | null;
    status_color: string | null;
    done: boolean;
    end_date: string | null;
  }>;
  files: Array<{
    share_id: string;
    file_id: string;
    name: string;
    mime: string | null;
    size_bytes: number | null;
    created_at: string;
  }>;
  sheets: Array<{
    share_id: string;
    sheet_id: string;
    name: string;
    description: string | null;
  }>;
  updates: Array<{
    share_id: string;
    update_id: string;
    title: string;
    body: string | null;
    created_at: string;
  }>;
  approvals: Array<{
    id: string;
    subject_kind: ClientApprovalSubject;
    subject_id: string;
    version: number;
    title: string | null;
    note: string | null;
    state: ClientApprovalState;
    requested_at: string;
    decided_at: string | null;
    decision_note: string | null;
    decided_by_me: boolean;
    can_decide: boolean;
  }>;
  requests: Array<{
    id: string;
    title: string;
    details: string | null;
    request_type: string;
    priority: string | null;
    status: ClientRequestStatus;
    due_by: string | null;
    created_at: string;
    decided_at: string | null;
    decision_note: string | null;
    accepted: boolean;
  }>;
}
