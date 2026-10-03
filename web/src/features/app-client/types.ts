/**
 * The Client app's shared vocabulary: row shapes, the meta maps that name and
 * colour every state, and the pure helpers both halves of the app rely on.
 *
 * Two audiences read from here. The agency half (project tab, /apps/client)
 * talks to the `app_client_*` tables through PostgREST with RLS, so it uses the
 * Row interfaces directly. The client half never touches a table: it gets one
 * jsonb blob per screen out of a SECURITY DEFINER RPC, so it goes through the
 * `parse*` functions below, which treat every field as absent-until-proven.
 * That tolerance is deliberate — the backend lands in parallel with this UI,
 * and a missing key must degrade to an honest empty state rather than a crash.
 *
 * No React in this file on purpose: it is the part worth unit-testing.
 */

// ---------------------------------------------------------------------------
// Agency-side rows (app_client_* tables; not in src/types/database.ts yet)
// ---------------------------------------------------------------------------

export type ClientRole = "viewer" | "approver" | "requester" | "manager";
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
  role: ClientRole;
  status: ClientContactStatus;
  last_seen_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string | null;
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

export interface ClientShareRow {
  id: string;
  team_id: string;
  project_id: string;
  kind: ClientShareKind;
  ref_id: string;
  title: string | null;
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
  due_by: string | null;
  created_at: string;
  updated_at: string | null;
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

// ---------------------------------------------------------------------------
// Meta: one place that decides what each state is called and coloured
// ---------------------------------------------------------------------------

export interface Meta {
  label: string;
  icon: string;
  tone: string;
}

export const ROLE_META: Record<ClientRole, Meta & { blurb: string }> = {
  viewer: {
    label: "Viewer",
    icon: "visibility",
    tone: "#6a6d78",
    blurb: "Sees the shared work. Cannot approve or ask.",
  },
  requester: {
    label: "Requester",
    icon: "edit_note",
    tone: "#4a4ad0",
    blurb: "Can raise requests, but approving stays with someone else.",
  },
  approver: {
    label: "Approver",
    icon: "verified",
    tone: "#2f8f5f",
    blurb: "Signs off work. Approving is its own permission, never implied.",
  },
  manager: {
    label: "Manager",
    icon: "shield_person",
    tone: "#b8842a",
    blurb: "Both: raises requests and signs off on behalf of the client.",
  },
};

export const CONTACT_STATUS_META: Record<ClientContactStatus, Meta> = {
  invited: { label: "Invited", icon: "outgoing_mail", tone: "#b8842a" },
  active: { label: "Active", icon: "check_circle", tone: "#2f8f5f" },
  revoked: { label: "Revoked", icon: "block", tone: "#c0453c" },
};

export const SHARE_KIND_META: Record<ClientShareKind, Meta & { plural: string }> = {
  task: { label: "Task", plural: "Tasks", icon: "check_circle", tone: "#4a4ad0" },
  file: { label: "File", plural: "Files", icon: "description", tone: "#2f9c9c" },
  sheet: { label: "Sheet", plural: "Sheets", icon: "table_view", tone: "#1e9e6a" },
  update: { label: "Update", plural: "Updates", icon: "campaign", tone: "#7a5af5" },
};

export const REQUEST_STATUS_META: Record<ClientRequestStatus, Meta> = {
  new: { label: "Waiting on you", icon: "inbox", tone: "#b8842a" },
  accepted: { label: "Accepted", icon: "task_alt", tone: "#2f8f5f" },
  declined: { label: "Declined", icon: "do_not_disturb_on", tone: "#c0453c" },
  done: { label: "Done", icon: "done_all", tone: "#2f8f5f" },
};

/** The same statuses, worded for the person who raised the request. */
export const REQUEST_STATUS_CLIENT_META: Record<ClientRequestStatus, Meta> = {
  new: { label: "With the team", icon: "hourglass_top", tone: "#b8842a" },
  accepted: { label: "In progress", icon: "bolt", tone: "#4a4ad0" },
  declined: { label: "Not taken up", icon: "do_not_disturb_on", tone: "#c0453c" },
  done: { label: "Done", icon: "done_all", tone: "#2f8f5f" },
};

export const APPROVAL_STATE_META: Record<ClientApprovalState, Meta> = {
  pending: { label: "Waiting", icon: "pending", tone: "#b8842a" },
  approved: { label: "Approved", icon: "verified", tone: "#2f8f5f" },
  changes_requested: {
    label: "Changes requested",
    icon: "edit_note",
    tone: "#c0453c",
  },
};

export const APPROVAL_SUBJECT_META: Record<ClientApprovalSubject, Meta> = {
  task: { label: "Task", icon: "check_circle", tone: "#4a4ad0" },
  content_item: { label: "Content", icon: "photo_library", tone: "#7a5af5" },
  video_review: { label: "Video", icon: "movie", tone: "#c0453c" },
  file: { label: "File", icon: "description", tone: "#2f9c9c" },
};

/** Request types the intake form offers. Free text is still accepted. */
export const REQUEST_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "general", label: "General", hint: "Anything that doesn't fit below." },
  { value: "creative", label: "New creative", hint: "A post, a banner, a video." },
  { value: "change", label: "Change to existing work", hint: "A tweak to something live." },
  { value: "campaign", label: "New campaign", hint: "A push with a budget and a date." },
  { value: "report", label: "Report or numbers", hint: "A figure you need explained." },
  { value: "access", label: "Access or accounts", hint: "Someone needs to be added." },
];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately permissive: the DB column is citext and the real check is
 * whether the invitation arrives. This only catches typing accidents.
 */
export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  if (email.length < 6 || email.length > 254) return false;
  return /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(email);
}

/** What to call a contact when they have not told us their name yet. */
export function contactDisplayName(
  contact: Pick<ClientContactRow, "name" | "email">,
): string {
  const name = contact.name?.trim();
  if (name) return name;
  const local = contact.email.split("@")[0] ?? contact.email;
  return local.replace(/[._-]+/g, " ").trim() || contact.email;
}

/** Up to two letters for an avatar tile. */
export function initialsFor(value: string): string {
  const parts = value
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * The per-project defaults a role implies. Approving is its own permission, so
 * only the two roles that name it get `can_approve` — and the agency can still
 * flip either flag per project afterwards.
 */
export function roleGrants(role: ClientRole): {
  can_request: boolean;
  can_approve: boolean;
} {
  switch (role) {
    case "viewer":
      return { can_request: false, can_approve: false };
    case "requester":
      return { can_request: true, can_approve: false };
    case "approver":
      return { can_request: false, can_approve: true };
    case "manager":
      return { can_request: true, can_approve: true };
  }
}

/** "Never opened" beats a blank cell — it is the answer the agency wants. */
export function describeLastSeen(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "Never opened";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "Never opened";
  const mins = Math.floor((now.getTime() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "A month ago" : `${months} months ago`;
}

/** Escapes text destined for a task's HTML description column. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The task an accepted request becomes. `create_task` only takes a name, so the
 * details and the attribution go into the description write that follows — and
 * the attribution line is the point: three weeks later, "who asked for this?"
 * is the question that decides whether it was in scope.
 */
export function requestToTaskDraft(
  request: Pick<ClientRequestRow, "title" | "details" | "request_type">,
  requester: { name: string; email: string } | null,
): { name: string; descriptionHtml: string } {
  const paragraphs: string[] = [];
  const details = request.details?.trim();
  if (details) {
    for (const block of details.split(/\n{2,}/)) {
      const text = block.trim();
      if (text) paragraphs.push(`<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`);
    }
  }
  const type =
    REQUEST_TYPES.find((t) => t.value === request.request_type)?.label ??
    request.request_type;
  const who = requester
    ? `${escapeHtml(requester.name)} (${escapeHtml(requester.email)})`
    : "a client contact";
  paragraphs.push(
    `<p><em>Client request · ${escapeHtml(type)} · raised by ${who}</em></p>`,
  );
  return {
    name: request.title.trim().slice(0, 200) || "Client request",
    descriptionHtml: paragraphs.join(""),
  };
}

/** Counts per status, for the queue's header. */
export function summarizeRequests(
  rows: Pick<ClientRequestRow, "status">[],
): Record<ClientRequestStatus, number> {
  const counts: Record<ClientRequestStatus, number> = {
    new: 0,
    accepted: 0,
    declined: 0,
    done: 0,
  };
  for (const row of rows) {
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

/** Waiting first, then newest — the board is a queue, not an archive. */
export function sortApprovals<
  T extends { state: ClientApprovalState; requested_at: string },
>(rows: T[]): T[] {
  const rank = (state: ClientApprovalState) => (state === "pending" ? 0 : 1);
  return [...rows].sort((a, b) => {
    const byState = rank(a.state) - rank(b.state);
    if (byState !== 0) return byState;
    return (
      new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime()
    );
  });
}

/**
 * Is this error "the Client app's tables/RPCs do not exist yet" rather than a
 * real failure? The backend lands in parallel, and the difference decides
 * whether the UI says "not set up yet" or "something went wrong".
 */
export function isBackendMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  // PGRST202/205: PostgREST cannot find the function/table in its schema cache.
  // 42883/42P01: Postgres itself says the function/relation is undefined.
  if (["PGRST202", "PGRST205", "42883", "42P01"].includes(code)) return true;
  const message = typeof err.message === "string" ? err.message : "";
  return /could not find the (table|function)|schema cache|does not exist/i.test(
    message,
  );
}

// ---------------------------------------------------------------------------
// Client-side payloads: everything below parses the jsonb the portal RPCs
// return (client_session_context, client_portal_projects,
// client_project_overview). Written against the shipped shapes in
// supabase/migrations/20261133000000_app_client.sql, and defensive about every
// field anyway — a rename on that side must degrade to a quieter screen, not a
// crash on a client's phone.
// ---------------------------------------------------------------------------

export interface PortalBrand {
  name: string;
  logoUrl: string | null;
  accent: string;
}

export const DEFAULT_PORTAL_BRAND: PortalBrand = {
  name: "Your team",
  logoUrl: null,
  accent: "#4a4ad0",
};

export interface PortalContact {
  id: string;
  name: string;
  email: string;
  role: ClientRole;
}

export interface PortalSession {
  contact: PortalContact;
  brand: PortalBrand;
  projectCount: number;
}

export interface PortalProjectSummary {
  id: string;
  name: string;
  clientName: string | null;
  color: string | null;
  sharedCount: number;
  pendingApprovals: number;
  openRequests: number;
}

/**
 * What the portal can do with a shared sheet.
 *
 * Only a custom sheet keeps its rows in the database; every other source is a
 * live view of internal data assembled by the app's own adapters, and there is
 * no honest read-only rendering of those for an outsider. The flag travels so
 * the screen can say which it is rather than offering a row that does nothing.
 */
export interface PortalSheetInfo {
  viewable: boolean;
  columns: number;
  rows: number | null;
}

export interface PortalSharedItem {
  /** The SHARE row's id — the only id a client-side link may carry. */
  shareId: string;
  kind: ClientShareKind;
  title: string;
  /** A short, safe line under the title — a status, a size, a date. */
  detail: string | null;
  /** Longer text to render in full (an update's body). */
  body: string | null;
  /** Where "open" goes, when the item has somewhere to go. */
  url: string | null;
  done: boolean;
  createdAt: string | null;
  /** Set on `kind: "sheet"` only. */
  sheet: PortalSheetInfo | null;
}

/** One image or attachment on a post that is out for sign-off. */
export interface PortalApprovalAsset {
  /** Its position on the item — never the file's id. */
  n: number;
  name: string;
  mime: string | null;
  sizeBytes: number | null;
}

/**
 * The thing an approval is actually about.
 *
 * Without it a sign-off is a blind signature: a filename, a version number and
 * two buttons. The payload carries only what someone needs to judge the work —
 * the copy, the artwork, the schedule — and nothing about how it was made.
 */
export type PortalApprovalSubject =
  | {
      kind: "task";
      name: string;
      status: string | null;
      done: boolean;
      endDate: string | null;
    }
  | { kind: "file"; name: string; mime: string | null; sizeBytes: number | null }
  | {
      kind: "content_item";
      title: string;
      body: string | null;
      contentType: string | null;
      scheduledFor: string | null;
      assets: PortalApprovalAsset[];
    }
  | { kind: "video_review"; title: string; revision: number | null };

export interface PortalApproval {
  id: string;
  subjectKind: ClientApprovalSubject;
  version: number;
  title: string;
  note: string | null;
  state: ClientApprovalState;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedByMe: boolean;
  /** The database's own verdict on whether THIS contact may decide it. */
  canDecide: boolean;
  decisionNote: string | null;
  /** Null when the subject was deleted, or in a preview that cannot join it. */
  subject: PortalApprovalSubject | null;
}

export interface PortalRequest {
  id: string;
  title: string;
  details: string | null;
  requestType: string;
  priority: string | null;
  status: ClientRequestStatus;
  createdAt: string | null;
  dueBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Whether it became work — never which task, or whose. */
  accepted: boolean;
}

export interface PortalOverview {
  project: {
    id: string;
    name: string;
    clientName: string | null;
    color: string | null;
  };
  permissions: { canRequest: boolean; canApprove: boolean };
  shares: PortalSharedItem[];
  approvals: PortalApproval[];
  requests: PortalRequest[];
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** First present key wins — the RPCs and this UI were written in parallel. */
function pick(dict: Dict | null, ...keys: string[]): unknown {
  if (!dict) return undefined;
  for (const key of keys) {
    if (dict[key] !== undefined && dict[key] !== null) return dict[key];
  }
  return undefined;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const ROLES: readonly ClientRole[] = ["viewer", "approver", "requester", "manager"];
const REQUEST_STATUSES: readonly ClientRequestStatus[] = [
  "new",
  "accepted",
  "declined",
  "done",
];
const APPROVAL_STATES: readonly ClientApprovalState[] = [
  "pending",
  "approved",
  "changes_requested",
];
const APPROVAL_SUBJECTS: readonly ClientApprovalSubject[] = [
  "task",
  "content_item",
  "video_review",
  "file",
];

/** A hex accent we are willing to paint a whole page with. */
export function safeAccent(value: unknown, fallback = DEFAULT_PORTAL_BRAND.accent): string {
  const raw = str(value);
  if (!raw) return fallback;
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

/** Only http(s) or same-origin URLs are rendered — `javascript:` is not a logo. */
export function safeUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) || raw.startsWith("/") ? raw : null;
}

/** Branding comes off `client_session_context`'s `workspace` object. */
export function parseBrand(raw: unknown): PortalBrand {
  const dict = asDict(raw);
  const brand = asDict(pick(dict, "workspace", "brand", "branding", "team")) ?? dict;
  return {
    name:
      str(pick(brand, "name", "title", "team_name", "workspace_name")) ??
      DEFAULT_PORTAL_BRAND.name,
    logoUrl: safeUrl(pick(brand, "logo_url", "logoUrl", "logo")),
    accent: safeAccent(pick(brand, "accent", "accent_color", "color")),
  };
}

function parseContact(raw: unknown): PortalContact | null {
  const dict = asDict(raw);
  const id = str(pick(dict, "id", "contact_id"));
  const email = str(pick(dict, "email"));
  if (!id || !email) return null;
  return {
    id,
    email,
    name: str(pick(dict, "name")) ?? contactDisplayName({ name: null, email }),
    role: oneOf(pick(dict, "role"), ROLES, "viewer"),
  };
}

/**
 * `{ok: false}` — an expired or revoked session — parses to null, which is the
 * signal every portal page treats as "sign in again".
 */
export function parseSessionContext(raw: unknown): PortalSession | null {
  const dict = asDict(raw);
  if (!dict || pick(dict, "ok") === false) return null;
  const contact = parseContact(pick(dict, "contact") ?? dict);
  if (!contact) return null;
  return {
    contact,
    brand: parseBrand(dict),
    projectCount: num(pick(dict, "project_count")) ?? 0,
  };
}

export function parsePortalProjects(raw: unknown): PortalProjectSummary[] {
  const dict = asDict(raw);
  const list = Array.isArray(raw) ? raw : asArray(pick(dict, "projects", "items"));
  const out: PortalProjectSummary[] = [];
  for (const entry of list) {
    const row = asDict(entry);
    const id = str(pick(row, "id", "project_id"));
    if (!id) continue;
    out.push({
      id,
      name: str(pick(row, "name", "project_name")) ?? "Project",
      clientName: str(pick(row, "client_name")),
      color: str(pick(row, "color_code", "color")),
      sharedCount: num(pick(row, "shared_count")) ?? 0,
      pendingApprovals: num(pick(row, "pending_approvals")) ?? 0,
      openRequests: num(pick(row, "open_requests")) ?? 0,
    });
  }
  return out;
}

/** A file size a client reads, not a byte count. */
export function humanBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** "Due 5 Oct" from a date column, and nothing at all from a bad one. */
function dueLine(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const month = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][date.getUTCMonth()];
  return `Due ${date.getUTCDate()} ${month}`;
}

/**
 * The overview returns one array per kind (tasks, files, sheets, updates)
 * rather than a single share list, because each kind carries different columns.
 * The client's screen wants one list, so they are flattened here — and only the
 * share id travels, never the underlying task or file id.
 */
function flattenShares(dict: Dict): PortalSharedItem[] {
  const out: PortalSharedItem[] = [];

  for (const entry of asArray(pick(dict, "tasks"))) {
    const row = asDict(entry);
    const shareId = str(pick(row, "share_id"));
    if (!shareId) continue;
    const done = bool(pick(row, "done"));
    out.push({
      shareId,
      kind: "task",
      title: str(pick(row, "name")) ?? "Task",
      detail:
        [done ? "Done" : str(pick(row, "status")), dueLine(pick(row, "end_date"))]
          .filter(Boolean)
          .join(" · ") || null,
      body: null,
      url: null,
      done,
      createdAt: null,
      sheet: null,
    });
  }

  for (const entry of asArray(pick(dict, "files"))) {
    const row = asDict(entry);
    const shareId = str(pick(row, "share_id"));
    if (!shareId) continue;
    out.push({
      shareId,
      kind: "file",
      title: str(pick(row, "name")) ?? "File",
      detail: humanBytes(num(pick(row, "size_bytes"))),
      body: null,
      // The signed-URL route takes the SHARE id and re-checks access; a file id
      // would be a guess, and a storage path would be a leak.
      url: `/api/client/portal/files/${shareId}`,
      done: false,
      createdAt: str(pick(row, "created_at")),
      sheet: null,
    });
  }

  for (const entry of asArray(pick(dict, "sheets"))) {
    const row = asDict(entry);
    const shareId = str(pick(row, "share_id"));
    if (!shareId) continue;
    const viewable = bool(pick(row, "viewable"));
    const rows = num(pick(row, "rows"));
    out.push({
      shareId,
      kind: "sheet",
      title: str(pick(row, "name")) ?? "Sheet",
      // Size first when the sheet opens: a client deciding whether to tap
      // wants to know it is 40 rows, not 4,000.
      detail:
        [
          viewable && rows !== null
            ? `${formatCount(rows)} ${rows === 1 ? "row" : "rows"}`
            : null,
          str(pick(row, "description")),
        ]
          .filter(Boolean)
          .join(" · ") || null,
      body: null,
      url: null,
      done: false,
      createdAt: null,
      sheet: { viewable, columns: num(pick(row, "columns")) ?? 0, rows },
    });
  }

  for (const entry of asArray(pick(dict, "updates"))) {
    const row = asDict(entry);
    const shareId = str(pick(row, "share_id"));
    if (!shareId) continue;
    out.push({
      shareId,
      kind: "update",
      title: str(pick(row, "title")) ?? "Update",
      detail: null,
      body: str(pick(row, "body")),
      url: null,
      done: false,
      createdAt: str(pick(row, "created_at")),
      sheet: null,
    });
  }

  return out;
}

/**
 * The subject of an approval, as `client_project_overview` joins it.
 *
 * Unknown shapes collapse to null rather than to a half-drawn card: an
 * approval whose subject was deleted should read as "the item is gone", and
 * the screen handles null for exactly that reason.
 */
function parseApprovalSubject(raw: unknown): PortalApprovalSubject | null {
  const row = asDict(raw);
  if (!row) return null;
  const kind = str(pick(row, "kind"));
  if (kind === "task") {
    const name = str(pick(row, "name"));
    if (!name) return null;
    return {
      kind: "task",
      name,
      status: str(pick(row, "status")),
      done: bool(pick(row, "done")),
      endDate: str(pick(row, "end_date")),
    };
  }
  if (kind === "file") {
    const name = str(pick(row, "name"));
    if (!name) return null;
    return {
      kind: "file",
      name,
      mime: str(pick(row, "mime")),
      sizeBytes: num(pick(row, "size_bytes")),
    };
  }
  if (kind === "content_item") {
    const assets: PortalApprovalAsset[] = [];
    for (const entry of asArray(pick(row, "assets"))) {
      const asset = asDict(entry);
      const n = num(pick(asset, "n"));
      if (n === null) continue;
      assets.push({
        n,
        name: str(pick(asset, "name")) ?? `Attachment ${n}`,
        mime: str(pick(asset, "mime")),
        sizeBytes: num(pick(asset, "size_bytes")),
      });
    }
    return {
      kind: "content_item",
      title: str(pick(row, "title")) ?? "Post",
      body: str(pick(row, "body")),
      contentType: str(pick(row, "content_type")),
      scheduledFor: str(pick(row, "scheduled_for")),
      assets,
    };
  }
  if (kind === "video_review") {
    return {
      kind: "video_review",
      title: str(pick(row, "title")) ?? "Video",
      revision: num(pick(row, "revision")),
    };
  }
  return null;
}

function parseApprovals(raw: unknown): PortalApproval[] {
  const out: PortalApproval[] = [];
  for (const entry of asArray(raw)) {
    const row = asDict(entry);
    const id = str(pick(row, "id"));
    if (!id) continue;
    const state = oneOf(pick(row, "state"), APPROVAL_STATES, "pending");
    out.push({
      id,
      subjectKind: oneOf(pick(row, "subject_kind"), APPROVAL_SUBJECTS, "task"),
      version: num(pick(row, "version")) ?? 1,
      title: str(pick(row, "title")) ?? "Needs your sign-off",
      note: str(pick(row, "note")),
      state,
      requestedAt: str(pick(row, "requested_at")),
      decidedAt: str(pick(row, "decided_at")),
      decidedByMe: bool(pick(row, "decided_by_me")),
      // Trust the database's answer; fall back to "no" rather than offering a
      // button that will be refused.
      canDecide: bool(pick(row, "can_decide"), false),
      decisionNote: str(pick(row, "decision_note")),
      subject: parseApprovalSubject(pick(row, "subject")),
    });
  }
  return out;
}

function parseRequests(raw: unknown): PortalRequest[] {
  const out: PortalRequest[] = [];
  for (const entry of asArray(raw)) {
    const row = asDict(entry);
    const id = str(pick(row, "id"));
    if (!id) continue;
    out.push({
      id,
      title: str(pick(row, "title")) ?? "Request",
      details: str(pick(row, "details")),
      requestType: str(pick(row, "request_type")) ?? "general",
      priority: str(pick(row, "priority")),
      status: oneOf(pick(row, "status"), REQUEST_STATUSES, "new"),
      createdAt: str(pick(row, "created_at")),
      dueBy: str(pick(row, "due_by")),
      decidedAt: str(pick(row, "decided_at")),
      decisionNote: str(pick(row, "decision_note")),
      accepted: bool(pick(row, "accepted")),
    });
  }
  return out;
}

/** `{ok:false}` (not shared, or signed out) parses to null — one dead end. */
export function parseOverview(raw: unknown): PortalOverview | null {
  const dict = asDict(raw);
  if (!dict || pick(dict, "ok") === false) return null;
  const projectDict = asDict(pick(dict, "project"));
  const projectId = str(pick(projectDict, "id"));
  if (!projectId) return null;

  const permissions = asDict(pick(dict, "permissions"));
  return {
    project: {
      id: projectId,
      name: str(pick(projectDict, "name")) ?? "Project",
      clientName: str(pick(projectDict, "client_name")),
      color: str(pick(projectDict, "color_code", "color")),
    },
    permissions: {
      canRequest: bool(pick(permissions, "can_request"), false),
      canApprove: bool(pick(permissions, "can_approve"), false),
    },
    shares: flattenShares(dict),
    approvals: parseApprovals(pick(dict, "approvals")),
    requests: parseRequests(pick(dict, "requests")),
  };
}


// ---------------------------------------------------------------------------
// A shared sheet, read-only
// ---------------------------------------------------------------------------

export interface PortalSheetColumn {
  id: string;
  label: string;
  type: string;
  currency: string | null;
  options: Array<{ value: string; label: string }>;
}

export interface PortalSheetData {
  name: string;
  description: string | null;
  columns: PortalSheetColumn[];
  /** Values keyed by column id — the sheet's own ids, never a database column. */
  rows: Array<Record<string, unknown>>;
  /** Rows in the sheet, which can exceed the page that was fetched. */
  total: number;
}

/** Reads client_sheet_for_share. A sheet with no columns is still a sheet. */
export function parseSheetData(raw: unknown): PortalSheetData | null {
  const dict = asDict(raw);
  if (!dict || pick(dict, "ok") === false) return null;
  const columns: PortalSheetColumn[] = [];
  for (const entry of asArray(pick(dict, "columns"))) {
    const row = asDict(entry);
    const id = str(pick(row, "id"));
    if (!id) continue;
    const options: Array<{ value: string; label: string }> = [];
    for (const optionEntry of asArray(pick(row, "options"))) {
      const option = asDict(optionEntry);
      const value = str(pick(option, "value"));
      if (!value) continue;
      options.push({ value, label: str(pick(option, "label")) ?? value });
    }
    columns.push({
      id,
      label: str(pick(row, "label")) ?? id,
      type: str(pick(row, "type")) ?? "text",
      currency: str(pick(row, "currency")),
      options,
    });
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const entry of asArray(pick(dict, "rows"))) {
    const row = asDict(entry);
    if (row) rows.push(row);
  }
  return {
    name: str(pick(dict, "name")) ?? "Sheet",
    description: str(pick(dict, "description")),
    columns,
    rows,
    total: num(pick(dict, "total")) ?? rows.length,
  };
}

/**
 * One cell, as text.
 *
 * A sheet's values are whatever the agency typed, so this renders the four
 * shapes that actually occur and refuses to guess at the rest: an object would
 * only ever reach a client's screen as `[object Object]` or as JSON nobody
 * asked for, so it renders as nothing at all.
 */
export function sheetCellText(
  value: unknown,
  column?: Pick<PortalSheetColumn, "options"> | null,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-IN") : "";
  }
  if (typeof value === "string") {
    const label = column?.options?.find((option) => option.value === value)?.label;
    return label ?? value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sheetCellText(entry, column))
      .filter(Boolean)
      .join(", ");
  }
  return "";
}


// ---------------------------------------------------------------------------
// Formatting the numbers a client reads
// ---------------------------------------------------------------------------

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-IN");
}
