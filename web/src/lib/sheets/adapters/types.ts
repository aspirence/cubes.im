import type { SupabaseClient } from "@supabase/supabase-js";
import type { SheetRecordRow } from "../types";

/**
 * Sheets adapters — how a bound sheet reads and writes its source's records.
 *
 * Every adapter runs on a SERVICE-ROLE client, so RLS is not there to catch a
 * mistake: each one scopes every query by the sheet's team and project itself,
 * and validates writes against the same rules the database and the app's own
 * screens enforce (enums, required fields, foreign keys inside the scope).
 *
 * Values in and out are CANONICAL (src/lib/sheets/values.ts) and keyed by the
 * source FIELD key from src/lib/sheets/sources.ts — the data layer maps them to
 * and from column ids.
 */

export interface AdapterCtx {
  admin: SupabaseClient;
  sheet: SheetRecordRow;
  teamId: string;
  projectId: string | null;
  /** Who is making the change (null for a scheduled sync). */
  actorUserId: string | null;
  /** IANA zone that "a day" is read in (task dates are instants in the DB). */
  timeZone: string;
  /** Set when the viewer is a limited member: only rows they may see. */
  limitToUserId?: string | null;
  /** Is the person behind this request a team admin? Gates admin-only fields. */
  actorIsTeamAdmin?: boolean;
  /** The caller's own RLS client when a person is behind the request (routes),
   *  for RPCs that authorize on auth.uid(). Null for scheduled syncs. */
  userClient?: SupabaseClient | null;
  /** Filled by adapters: notes the grid shows above the sheet, and the money
   *  currency when the source knows it. */
  out: { notices: string[]; currency?: string | null };
}

export interface AdapterRecord {
  key: string;
  /** Canonical values keyed by source field. */
  fields: Record<string, unknown>;
  /** When the record last changed (feeds the "newest wins" conflict policy). */
  updatedAt: string | null;
  position: number;
  /** Field keys this particular record cannot change (beyond the source's
   *  read-only fields), e.g. an admin-only link for a non-admin. */
  readonlyFields?: string[];
}

export interface ListOptions {
  /** Only these record keys (a single row re-read after an edit). */
  keys?: string[];
}

export interface SheetAdapter {
  list(ctx: AdapterCtx, opts?: ListOptions): Promise<AdapterRecord[]>;
  /** Patch values keyed by field; throws AdapterError on a rule violation. */
  update(ctx: AdapterCtx, key: string, patch: Record<string, unknown>): Promise<void>;
  create?(ctx: AdapterCtx, values: Record<string, unknown>): Promise<string>;
  remove?(ctx: AdapterCtx, key: string): Promise<void>;
}

/**
 * A write the person can fix ("Title is required", "Unknown status"). Routes
 * answer 400 with the message; the sync counts the row as skipped.
 */
export class AdapterError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdapterError";
    this.status = status;
  }
}

/** PostgREST "relation does not exist" — a table whose migration has not run. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|Could not find the table/i.test(error.message ?? "");
}

/** PostgREST caps a response at 1,000 rows; read every page. */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

/** Splits a list for `.in()` filters, which travel in the URL. */
export function chunks<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function latest(...times: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const t of times) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = t;
    }
  }
  return best;
}

/** Is this user an active owner/admin of the team? Service-side twin of
 *  is_team_admin(), for runs that have no session (auth.uid() is null). */
export async function userIsTeamAdmin(
  admin: SupabaseClient,
  teamId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const { data } = await admin
    .from("team_members")
    .select("id, roles!team_members_role_id_fk(owner, admin_role)")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1);
  const row = (data ?? [])[0] as { roles?: { owner?: boolean; admin_role?: boolean } | null } | undefined;
  return Boolean(row?.roles && (row.roles.owner || row.roles.admin_role));
}
