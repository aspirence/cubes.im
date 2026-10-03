import {
  humanBytes,
  roleGrants,
  type ClientApprovalRow,
  type ClientContactRow,
  type ClientRequestRow,
  type ClientShareRow,
  type PortalOverview,
  type PortalSharedItem,
  type PortalSheetInfo,
} from "./types";

/**
 * "Preview as client" without pretending to be one.
 *
 * The honest way to answer "what does my client see?" is to render the client's
 * own screen, so this maps the agency's rows into exactly the shape
 * `client_project_overview` returns and hands it to the same component. What it
 * cannot do is prove the SQL: the real payload is filtered in the database, and
 * this one is assembled from rows the agency can already read. So the preview
 * shows the shape and the wording, and a stray item here means the SHARE list
 * is wrong, not that the client's filtering is.
 *
 * File links stay absent: a signed URL is minted per client session and there
 * is none here.
 */
export function buildPreviewOverview(input: {
  project: {
    id: string;
    name: string;
    clientName?: string | null;
    color?: string | null;
  };
  contact: ClientContactRow | null;
  shares: ClientShareRow[];
  approvals: ClientApprovalRow[];
  requests: ClientRequestRow[];
  /** Access flags for the previewed contact on this project, when granted. */
  access?: { can_request: boolean; can_approve: boolean } | null;
  /** Titles and sizes the agency already has, keyed by share ref id. */
  detailFor?: (share: ClientShareRow) => {
    detail?: string | null;
    sizeBytes?: number | null;
    /** An update's text, which the client reads in full on their screen. */
    body?: string | null;
    /** Whether the portal can open this sheet, for `kind: "sheet"` rows. */
    sheet?: PortalSheetInfo | null;
  };
}): PortalOverview {
  const grants = input.contact
    ? (input.access ?? roleGrants(input.contact.role))
    : { can_request: true, can_approve: true };
  // Approving is the role OR the per-project flag, exactly as the RPC computes
  // it — a preview that disagreed with the real screen would be worse than none.
  const canApprove =
    grants.can_approve ||
    input.contact?.role === "approver" ||
    input.contact?.role === "manager";

  const shares: PortalSharedItem[] = input.shares.map((row) => {
    const extra = input.detailFor?.(row) ?? {};
    return {
      shareId: row.id,
      kind: row.kind,
      title: row.title ?? "Shared item",
      detail: extra.detail ?? humanBytes(extra.sizeBytes ?? null),
      // An update is a project comment the agency picked out, and the client
      // reads the whole of it — a preview showing only the 90-character
      // title told the agency their client sees less than they do.
      body: extra.body ?? null,
      url: null,
      done: false,
      createdAt: row.created_at,
      sheet: extra.sheet ?? null,
    };
  });

  return {
    project: {
      id: input.project.id,
      name: input.project.name,
      clientName: input.project.clientName ?? null,
      color: input.project.color ?? null,
    },
    permissions: {
      canRequest: grants.can_request,
      canApprove,
    },
    shares,
    approvals: input.approvals.map((row) => ({
      id: row.id,
      subjectKind: row.subject_kind,
      version: row.version,
      title: row.title ?? "Needs your sign-off",
      note: row.note,
      state: row.state,
      requestedAt: row.requested_at,
      decidedAt: row.decided_at,
      decidedByMe: false,
      // Inert in a preview: the agency is not the one who decides.
      canDecide: false,
      decisionNote: row.decision_note,
      // The subject is joined inside client_project_overview and there is no
      // session here to join it with. The card says so in as many words rather
      // than drawing a card that looks emptier than the client's.
      subject: null,
    })),
    requests: input.requests.map((row) => ({
      id: row.id,
      title: row.title,
      details: row.details,
      requestType: row.request_type,
      priority: row.priority,
      status: row.status,
      createdAt: row.created_at,
      dueBy: row.due_by,
      decidedAt: row.decided_at,
      decisionNote: null,
      accepted: row.task_id !== null,
    })),
  };
}

/**
 * The requests a preview should show: only the previewed contact's own, because
 * a client never sees what another contact at their company asked for. With no
 * contact chosen, the preview is "a client in general" and shows none.
 */
export function previewRequestsFor(
  requests: ClientRequestRow[],
  contactId: string | null,
): ClientRequestRow[] {
  if (!contactId) return [];
  return requests.filter((row) => row.contact_id === contactId);
}
