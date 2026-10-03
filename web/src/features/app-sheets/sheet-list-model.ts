/**
 * Sheets list — what a card or a list row SAYS, decided without React.
 *
 * Pure (type-only imports, no dayjs, no antd) so a node suite can hold the
 * wording to account: the Google state is the most important fact on the list,
 * and a card that says "Synced" about a sheet whose last sync failed is worse
 * than a card that says nothing.
 */
import type { ColumnType, ProvisionStatus, SelectOption, SheetSource } from "@/lib/sheets/types";

/* ------------------------------------------------------------------ *
 * Google status
 * ------------------------------------------------------------------ */

/** The columns of app_sheet_google_links the list needs — one row per sheet. */
export interface SheetGoogleStatusRow {
  sheet_id: string;
  provision_status: ProvisionStatus;
  provision_error: string | null;
  last_synced_at: string | null;
  last_status: "ok" | "error" | "running" | null;
  last_error: string | null;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  sheet_gid: number | null;
  /* The last Drive share pass (google-share.ts recordShare). Optional: a row
     read before these were selected, or a test fixture, simply has no pass. */
  owned_by_us?: boolean | null;
  share_status?: "ok" | "partial" | "failed" | null;
  share_error?: string | null;
  share_counts?: ShareCountsLike | null;
  shared_at?: string | null;
  direction?: "push" | "pull" | "both" | null;
}

/** app_sheet_google_links.share_counts, read defensively (it is jsonb). */
export interface ShareCountsLike {
  granted?: number;
  promoted?: number;
  unchanged?: number;
  failed?: number;
  left_out?: string[];
  limited?: number;
  /**
   * True when the pass also recorded WHO it gave the file to
   * (app_sheet_share_grants, migration 20261146). Absent on a pass from
   * before that record existed: the access list then cannot vouch for anyone.
   */
  per_person?: boolean;
}

/** The whole team's answer, from one read of each table (useSheetsGoogleStatus). */
export interface SheetsGoogleStatus {
  /** Keyed by sheet id. A sheet with no entry has no link row at all. */
  links: Record<string, SheetGoogleStatusRow>;
  /** Sheet ids with an active, unexpired Drive push channel. */
  live: string[];
}

export type ListStatusKind =
  | "live"
  | "synced"
  | "syncing"
  | "not-synced"
  | "setting-up"
  | "create-failed"
  | "sync-error"
  | "not-linked";

/**
 * success: green dot · progress: indigo, animated · pending: amber ·
 * danger: red · neutral: grey · none: hollow ring (nothing there at all).
 */
export type ListStatusTone = "success" | "progress" | "pending" | "danger" | "neutral" | "none";

export interface ListGoogleStatus {
  kind: ListStatusKind;
  tone: ListStatusTone;
  /** Two words at most — it shares a line with the source chip. */
  label: string;
  /** When set, printed after the label as a relative time (Geist Mono). */
  at: string | null;
  /** The tooltip. Server errors are passed through: they are already sanitised. */
  hint: string;
}

/**
 * One sheet's Google state, in the order that keeps it honest:
 *
 *   no row          → Not linked      (nothing was ever set up)
 *   pending         → Setting up      (the file does not exist yet)
 *   failed          → Couldn't create (Google refused; the sheet can retry)
 *   last run error  → Sync error      (beats Live: a watched file that will
 *                                      not sync is broken, not live)
 *   running         → Syncing
 *   active channel  → Live
 *   synced before   → Synced <when>
 *   otherwise       → Not synced yet
 */
export function describeListStatus(row: SheetGoogleStatusRow | undefined, live: boolean): ListGoogleStatus {
  if (!row) {
    return {
      kind: "not-linked",
      tone: "none",
      label: "Not linked",
      at: null,
      hint: "This sheet has no Google Sheet yet. Open it to create one or link one you already have.",
    };
  }
  if (row.provision_status === "pending") {
    return {
      kind: "setting-up",
      tone: "pending",
      label: "Setting up",
      at: null,
      hint: "Its Google Sheet hasn't been created yet. Open the sheet to finish setting it up.",
    };
  }
  if (row.provision_status === "failed") {
    return {
      kind: "create-failed",
      tone: "danger",
      label: "Couldn't create",
      at: null,
      hint: `${clean(row.provision_error) ?? "Google refused to create the file."} Open the sheet to try again.`,
    };
  }
  if (row.last_status === "error") {
    return {
      kind: "sync-error",
      tone: "danger",
      label: "Sync error",
      // No time next to an error: "Sync error 9h ago" reads as when it broke,
      // and last_synced_at does not promise to be that.
      at: null,
      hint: clean(row.last_error) ?? "The last sync failed. Open the sheet's Google panel for details.",
    };
  }
  if (row.last_status === "running") {
    return { kind: "syncing", tone: "progress", label: "Syncing", at: null, hint: "A sync with Google is running now." };
  }
  if (live) {
    return {
      kind: "live",
      tone: "success",
      label: "Live",
      at: null,
      hint: "Google tells Cubes the moment someone edits this file, so changes arrive within seconds.",
    };
  }
  if (row.last_synced_at) {
    return {
      kind: "synced",
      tone: "success",
      label: "Synced",
      at: row.last_synced_at,
      hint: "In sync with its Google Sheet.",
    };
  }
  return {
    kind: "not-synced",
    tone: "neutral",
    label: "Not synced yet",
    at: null,
    hint: "Linked to a Google Sheet that hasn't synced yet.",
  };
}

/**
 * What a card's "Google Sheet" row says when there is no spreadsheet to link
 * to. A ready link is drawn as the link chip instead (null here): a chip that
 * goes nowhere would be worse than a plain sentence.
 */
export function sheetFileText(row: SheetGoogleStatusRow | undefined): string | null {
  if (!row) return "No Google Sheet yet";
  if (row.provision_status === "pending") return "Not created yet";
  if (row.provision_status === "failed") return "Not created";
  return null;
}

function clean(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

/* ------------------------------------------------------------------ *
 * Access — who can open the Google Sheet
 * ------------------------------------------------------------------ */

/** One row of app_sheets_access_list (migration 20261146): see its header. */
export type SheetAccessKind = "owner" | "shared" | "refused" | "not_yet" | "no_email";

export interface SheetAccessEntry {
  user_id: string;
  access: SheetAccessKind;
}

/**
 * What the card's Access row says.
 *
 *   not-shared    no file yet, or Cubes has never shared the one it made
 *   drive-owner   a file picked from someone's Drive: its owner decides who
 *                 sees it and Cubes cannot read that list
 *   shared        the last share pass, person by person, from its record of
 *                 what Drive did (app_sheet_share_grants)
 *   counts-only   no per-person answer to draw — the function could not be
 *                 read, or the last pass ran before passes recorded who they
 *                 reached (`unrecorded`): the pass's own counts, and no claim
 *                 about the viewer either way
 *   share-failed  the last pass failed outright
 */
export type AccessState = "not-shared" | "drive-owner" | "shared" | "counts-only" | "share-failed";

/**
 * The viewer's own standing.
 *   in        the record says they hold it, or they own it
 *   refused   the last pass asked Google to share it with them; Google refused
 *   not-yet   the last pass did not give it to them — they joined, were
 *             promoted from limited, or added an address since, or the pass
 *             was cut short before reaching them
 *   no-email  no Google-shaped address: a pass cannot give them the file
 *   out       not among the people it would be shared with
 *   unknown   Cubes cannot tell (someone else's Drive; no per-person answer)
 *
 * There is no "maybe": since the pass records whose invitation Google refused,
 * a refusal no longer puts every holder in doubt.
 */
export type AccessViewer = "in" | "refused" | "not-yet" | "no-email" | "out" | "unknown";

export interface AccessView {
  state: AccessState;
  /** The Google file exists — tells "no file yet" from "a file nobody was given". */
  ready: boolean;
  /** User ids to draw — only people who HAVE it: the viewer first when they are among them, then the owner. */
  people: string[];
  /** The owner among `people`, when they are a member. */
  ownerId: string | null;
  /** How many people can open it — people.length, or the pass's counts. */
  total: number;
  viewer: AccessViewer;
  /** Invitations Google refused at the last pass (share_counts.failed). */
  refused: number;
  /** Whose, when the pass recorded it: the viewer first. Empty for an unrecorded pass. */
  refusedPeople: string[];
  /** How many the last pass offered the file to: everyone it holds for, plus the refusals. */
  invited: number;
  /** Names the pass left out: no address Drive could be given AT THAT PASS. */
  leftOut: string[];
  /** Other members the last pass did not give it to (the viewer is not counted). */
  notYet: number;
  /**
   * Members who cannot open it, the viewer included — the card's quiet line.
   * From the record when there is one (refused + not yet + no address, as
   * they stand now); otherwise only what the pass itself counted as missing
   * (left out + refused), because who else lacks it was never recorded.
   */
  missing: number;
  /** "push" sheets are shared read-only: an edit in Google would be overwritten. */
  role: "writer" | "reader";
  sharedAt: string | null;
  /**
   * The last pass's sanitised share_error (google-share.ts summarise()): the
   * whole story when the pass failed, and where a refusal's reason comes from.
   */
  error: string | null;
  /** counts-only because the last pass predates per-person records, not because a read failed. */
  unrecorded: boolean;
}

const NO_ONE: Omit<AccessView, "state"> = {
  ready: false,
  people: [],
  ownerId: null,
  total: 0,
  viewer: "unknown",
  refused: 0,
  refusedPeople: [],
  invited: 0,
  leftOut: [],
  notYet: 0,
  missing: 0,
  role: "writer",
  sharedAt: null,
  error: null,
  unrecorded: false,
};

function countOf(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * One sheet's access, from its link row (the list's batched read), its entries
 * from app_sheets_access_list (null when that could not be read) and who is
 * looking. Pure, so the promise it makes can be held to account: it never
 * says a person has the file because they are a member — only because the
 * share pass RECORDED giving it to them, or they own it.
 *
 * A LIMITED viewer never reaches this: the card shows them their own line
 * (Decision B), and the function returns them nothing.
 */
export function describeAccess(
  row: SheetGoogleStatusRow | undefined,
  entries: readonly SheetAccessEntry[] | null,
  viewerId: string | null,
): AccessView {
  const role: AccessView["role"] = row?.direction === "push" ? "reader" : "writer";
  if (!row || row.provision_status !== "ready") return { ...NO_ONE, state: "not-shared", role };

  const owner = entries?.find((e) => e.access === "owner")?.user_id ?? null;
  if (row.owned_by_us === false) {
    const people = owner ? [owner] : [];
    return {
      ...NO_ONE,
      ready: true,
      state: "drive-owner",
      people,
      ownerId: owner,
      total: people.length,
      // Being its owner is the one thing Cubes can know about this file.
      viewer: owner && owner === viewerId ? "in" : "unknown",
      role,
    };
  }
  if (!row.shared_at) return { ...NO_ONE, ready: true, state: "not-shared", role };

  const counts = row.share_counts ?? {};
  const refused = countOf(counts.failed);
  const leftOut = Array.isArray(counts.left_out) ? counts.left_out.filter((n): n is string => typeof n === "string" && n.trim() !== "") : [];
  const passTotal = countOf(counts.granted) + countOf(counts.promoted) + countOf(counts.unchanged);
  const base = {
    ...NO_ONE,
    ready: true,
    role,
    refused,
    invited: passTotal + refused,
    leftOut,
    missing: leftOut.length + refused,
    sharedAt: row.shared_at,
    error: clean(row.share_error),
  };

  if (row.share_status === "failed" && passTotal === 0) {
    return { ...base, state: "share-failed" };
  }
  if (!entries) {
    return { ...base, state: "counts-only", total: passTotal };
  }
  // A pass from before per-person records. Its entries cannot vouch for
  // anyone, so draw no one and say only what the pass counted. The database
  // agrees (it returns such a link's members as not_yet), but the card does
  // not lean on that: an older function would still infer from membership.
  if (counts.per_person !== true) {
    return { ...base, state: "counts-only", total: passTotal, unrecorded: true };
  }

  const holders = entries.filter((e) => e.access === "owner" || e.access === "shared").map((e) => e.user_id);
  const mine = viewerId ? entries.find((e) => e.user_id === viewerId) : undefined;
  let viewer: AccessViewer;
  if (viewerId && holders.includes(viewerId)) viewer = "in";
  else if (mine?.access === "refused") viewer = "refused";
  else if (mine?.access === "not_yet") viewer = "not-yet";
  else if (mine?.access === "no_email") viewer = "no-email";
  else viewer = viewerId ? "out" : "unknown";

  const others = holders.filter((id) => id !== viewerId && id !== owner);
  const people = [
    ...(viewerId && holders.includes(viewerId) ? [viewerId] : []),
    ...(owner && owner !== viewerId && holders.includes(owner) ? [owner] : []),
    ...others,
  ];
  const refusedIds = entries.filter((e) => e.access === "refused").map((e) => e.user_id);
  return {
    ...base,
    state: "shared",
    people,
    ownerId: owner,
    total: people.length,
    viewer,
    refusedPeople: [...refusedIds.filter((id) => id === viewerId), ...refusedIds.filter((id) => id !== viewerId)],
    notYet: entries.filter((e) => e.access === "not_yet" && e.user_id !== viewerId).length,
    // As things stand now, not as the pass found them: someone left out for
    // having no address who has added one since is still without the file,
    // but no longer "not on Google".
    missing: entries.filter((e) => e.access === "refused" || e.access === "not_yet" || e.access === "no_email").length,
  };
}

/**
 * The words on the Access row. `suffix` is the quiet "N without access" —
 * the members `missing` counts — drawn on its own small line. It says who
 * lacks the file, not why: the reasons differ person by person (Google
 * refused, not included in the last share, no address) and the tooltip gives
 * each one.
 */
export function accessLine(v: AccessView): { text: string; suffix: string | null } {
  const suffix = v.missing > 0 && (v.state === "shared" || v.state === "counts-only") ? `${v.missing} without access` : null;
  switch (v.state) {
    case "not-shared":
      return { text: "Not shared yet", suffix: null };
    case "share-failed":
      return { text: "Couldn't share", suffix: null };
    case "drive-owner":
      return { text: v.viewer === "in" ? "You own it" : "Shared by its owner", suffix: null };
    case "counts-only":
      return { text: v.total > 0 ? `Shared with ${v.total}` : "Not shared yet", suffix };
    case "shared": {
      const others = v.total - 1;
      const text =
        v.viewer === "in"
          ? others > 0
            ? `You + ${others}`
            : "Only you"
          : v.viewer === "unknown"
            ? v.total > 0
              ? `${v.total} ${v.total === 1 ? "person" : "people"}`
              : "No one yet"
            : "Not shared with you";
      return { text, suffix };
    }
  }
}

/** "Asha, Ravi and 3 more" — the tooltip's list, capped so it stays a tooltip. */
function nameList(names: readonly string[], cap = 8): string {
  if (names.length <= cap) return names.join(", ");
  return `${names.slice(0, cap).join(", ")} and ${names.length - cap} more`;
}

/** Google's reason for the first refusal, from share_error (google-share.ts summarise() writes it). */
function refusalReason(error: string | null): string | null {
  const m = error?.match(/Google refused \d+ of the invitations: ([^]*)$/);
  const reason = m?.[1].trim().replace(/[.\s]+$/, "");
  return reason ? reason : null;
}

/**
 * The Access row's tooltip, line by line (the card adds "Last shared …").
 * `plainName` turns a user id into what to call them — "You" for the viewer.
 *
 * Every line is something the record supports. "N can open it" counts only
 * the people drawn as faces, and a refusal is told in the same words to EVERY
 * viewer — holder or not — naming whose it was when the pass recorded it.
 */
export function accessTipLines(v: AccessView, plainName: (id: string) => string): string[] {
  const nameOf = (id: string) => plainName(id) + (id === v.ownerId ? " (owner)" : "");
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const roleWords = v.role === "reader" ? "view only — this sheet only sends changes to Google" : "can edit";
  const lines: string[] = [];
  switch (v.state) {
    case "not-shared":
      lines.push(
        v.ready
          ? "Cubes hasn't shared this Google Sheet with the team yet, so only the Google account that owns it can open it."
          : "There is no Google Sheet yet, so nobody has been given one.",
      );
      break;
    case "share-failed":
      lines.push(`The last attempt to share it failed${v.error ? `: ${v.error}` : "."}`);
      break;
    case "drive-owner":
      lines.push(
        `This Google Sheet came from ${v.viewer === "in" ? "your" : v.ownerId ? `${plainName(v.ownerId)}'s` : "someone's"} own Drive, not from Cubes, so its owner decides who can open it. Cubes can't see that list.`,
      );
      break;
    case "counts-only":
      lines.push(
        v.unrecorded
          ? `Shared with ${people(v.total)} (${roleWords}). Cubes didn't record who at that share, so it can't say whether you're one of them — the next share records it.`
          : `Shared with ${people(v.total)} (${roleWords}). Who exactly couldn't be read just now.`,
      );
      break;
    case "shared":
      lines.push(v.total > 0 ? `${people(v.total)} can open it (${roleWords}): ${nameList(v.people.map(nameOf))}` : "Nobody in the workspace has been given it yet.");
      if (v.viewer === "refused") {
        lines.push("Google refused to share it with your address at the last share.");
      } else if (v.viewer === "not-yet") {
        // Not "you joined after": a member promoted from limited, or one who
        // added a Google address, joined long before and is here too.
        lines.push("You weren't included when it was last shared. Re-sharing from the sheet's Google panel adds you.");
      } else if (v.viewer === "no-email") {
        lines.push("Your Cubes account has no address Google can share with.");
      }
      if (v.notYet > 0) {
        const one = v.notYet === 1;
        lines.push(`${v.notYet} ${one ? "member wasn't" : "members weren't"} included when it was last shared and ${one ? "doesn't" : "don't"} have it yet.`);
      }
      break;
  }
  if (v.state === "shared" || v.state === "counts-only") {
    // About the pass, not about now: someone left out may have added an
    // address since, and is then not yet shared rather than "not on Google".
    if (v.leftOut.length) lines.push(`At the last share, no Google address was on file for ${nameList(v.leftOut)}.`);
    if (v.refused > 0) {
      const whose = v.refusedPeople.length ? ` (${nameList(v.refusedPeople.map(plainName))})` : "";
      const reason = refusalReason(v.error);
      lines.push(`Invited ${v.invited} · Google refused ${v.refused}${whose}${reason ? `: ${reason}` : ""}.`);
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/**
 * "just now" · "4m ago" · "3h ago" · "2d ago" · "3w ago" · "5mo ago" · "2y ago".
 * Floors rather than rounds, so 59 minutes never reads as "1h". A time in the
 * future (a skewed clock) reads as "just now" rather than as a negative.
 */
export function shortAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.max(1, Math.floor(s / 60));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.max(1, Math.floor(d / 30))}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/**
 * The card footer's time: "now" · "4m" · "6h" · "Yesterday" · "3d" · "2w" ·
 * "5mo" · "2y". Shorter than shortAgo because it sits beside a clock glyph
 * that already says "ago". Under a day it counts hours, even across midnight.
 * Past a day it counts CALENDAR days in the viewer's own time zone, so 36
 * hours ago can be "2d" (the day before yesterday), never "Yesterday".
 */
export function footerAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 45) return "now";
  const m = Math.max(1, Math.floor(s / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = calendarDaysBetween(t, now);
  if (d <= 1) return "Yesterday";
  if (d < 7) return `${d}d`;
  if (d < 35) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.max(1, Math.floor(d / 30))}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** Whole local calendar days from `from` to `to` (both epoch ms). DST-safe: counts dates, not 24h blocks. */
function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((dayB - dayA) / 86_400_000);
}

/* ------------------------------------------------------------------ *
 * What a card says about the columns
 * ------------------------------------------------------------------ */

/** The part of a column the card reads. */
export interface CardColumnInput {
  label: string;
  hidden?: boolean;
  /** Set when the column is bound to one of the source's fields. */
  field?: string;
}

export interface CardColumns {
  /** Visible columns, in order — what the header count and the pills describe. */
  visible: string[];
  /** The first few, as pills. */
  shown: string[];
  /** How many visible columns the pills leave out ("+N"). */
  more: number;
  hidden: number;
  /** Visible columns bound to the source's own fields (they sync with Cubes records). */
  bound: number;
  /** Visible columns that are the sheet's own (a "Notes" column on a task sheet). */
  own: number;
}

/** Roughly how wide a column pill draws (11.5px Geist, 8px padding a side), clamped to its CSS min/max. */
export function pillWidth(label: string): number {
  return Math.max(28, Math.min(104, Math.round(label.length * 6.2 + 17)));
}

/**
 * The column facts a card prints — all from the columns the list already
 * holds, so a card never fetches anything to say what is in the sheet. A
 * blank label (a column not named yet) is skipped in the pills rather than
 * drawn as an empty lozenge, but still counted.
 *
 * The pills share one line with "+N" in the narrowest card the grid draws,
 * so they are chosen against a width budget: three short names ("#", "Task",
 * "Status") fit, but "Publish on" and "Caption / body" would each be cut to
 * a stub — two readable names and "+8" say more than three ellipses. The
 * first pill is always shown (its ellipsis is the last resort).
 */
export function cardColumns(columns: readonly CardColumnInput[], max = 3, budget = 150): CardColumns {
  const visibleCols = columns.filter((c) => !c.hidden);
  const visible = visibleCols.map((c) => c.label.trim());
  const named = visible.filter(Boolean);
  const shown: string[] = [];
  let used = 0;
  for (const label of named) {
    if (shown.length >= max) break;
    const w = pillWidth(label) + (shown.length ? 4 : 0);
    if (shown.length && used + w > budget) break;
    shown.push(label);
    used += w;
  }
  const bound = visibleCols.filter((c) => Boolean(c.field)).length;
  return {
    visible,
    shown,
    more: visible.length - shown.length,
    hidden: columns.length - visibleCols.length,
    bound,
    own: visibleCols.length - bound,
  };
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

/**
 * Up to two letters for an avatar with no photo. Letters and digits only, so
 * a label like "Priya · On leave" never leaks its "·" into the monogram.
 */
export function initialsOf(name: string | null | undefined): string {
  const letters = (name ?? "")
    .split(/[\s._-]+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean);
  return letters.slice(0, 2).join("").toUpperCase() || "?";
}

/* ------------------------------------------------------------------ *
 * Live, for one sheet
 * ------------------------------------------------------------------ */

/**
 * The open sheet's header asks the same question the list does — is a Drive
 * push channel watching this file right now? — and must answer it the same
 * way: only an ACTIVE channel that has not expired (useSheetsGoogleStatus).
 */
export function isChannelLive(
  channel: { status: string; expires_at?: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!channel || channel.status !== "active") return false;
  if (!channel.expires_at) return true;
  const t = Date.parse(channel.expires_at);
  return !Number.isFinite(t) || t > now;
}

/* ------------------------------------------------------------------ *
 * The create card's shortcuts
 * ------------------------------------------------------------------ */

/**
 * Which templates the "New sheet" card offers as one-click chips: the
 * preferred ones where they can be used in this scope, topped up from the
 * fallbacks when they cannot (a workspace scope has no tasks; a team without
 * Marketing has no Meta Ads). A chip that could only say "not here" is not a
 * shortcut; the wizard still lists every template with its reason.
 */
export function pickCreateShortcuts(
  preferred: readonly string[],
  fallbacks: readonly string[],
  usable: (key: string) => boolean,
  count = 3,
): string[] {
  const out: string[] = [];
  for (const key of [...preferred, ...fallbacks]) {
    if (out.length >= count) break;
    if (!out.includes(key) && usable(key)) out.push(key);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Source identity
 * ------------------------------------------------------------------ */

/** The Sheets app's own green: custom sheets keep it, bound sources get their app's hue. */
export const SHEETS_BRAND = "#1e9e6a";

/** Which useC() hue each source wears; "brand" is SHEETS_BRAND. */
export type SourceAccentKey = "brand" | "accent" | "lavender" | "mint" | "gold";

export const SOURCE_ACCENT: Record<SheetSource, SourceAccentKey> = {
  custom: "brand",
  tasks: "accent",
  content_studio_items: "lavender",
};

/* ------------------------------------------------------------------ *
 * The mini spreadsheet
 * ------------------------------------------------------------------ */

/** The part of a column the preview reads — sheet columns and template columns both fit. */
export interface PreviewColumnInput {
  label: string;
  type: ColumnType;
  hidden?: boolean;
  options?: SelectOption[];
}

export interface PreviewColumn {
  label: string;
  type: ColumnType;
  /** Relative width (fr): a title column is wider than a checkbox. */
  weight: number;
  /** Option colours, cycled down the rows so a Status column looks like one. */
  colors: string[];
}

const WEIGHT: Partial<Record<ColumnType, number>> = {
  text: 1.7,
  long_text: 1.9,
  url: 1.4,
  email: 1.5,
  phone: 1.2,
  select: 1.15,
  multi_select: 1.3,
  person: 1.1,
  people: 1.2,
  date: 1.05,
  datetime: 1.15,
  number: 0.95,
  currency: 1,
  percent: 0.85,
  checkbox: 0.7,
};

/**
 * The first `max` VISIBLE columns, shaped for drawing. Drawn from the columns
 * the list already holds, so a card never fetches anything to show them.
 */
export function previewColumns(columns: readonly PreviewColumnInput[], max = 5): PreviewColumn[] {
  return columns
    .filter((c) => !c.hidden)
    .slice(0, max)
    .map((c) => ({
      label: c.label,
      type: c.type,
      // A "#" column is an id, not a number to read: keep it narrow.
      weight: c.label.trim().length <= 2 && c.type === "number" ? 0.55 : (WEIGHT[c.type] ?? 1.2),
      colors: (c.options ?? []).map((o) => o.color).filter((x): x is string => typeof x === "string" && x.length > 0),
    }));
}

/**
 * A stable number in [0, 1) for a seed — FNV-1a, so the same sheet draws the
 * same placeholder bars on every render and on every machine.
 */
export function seeded(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}
