"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useMyMemberType, useTeamMembers } from "@/features/team-members/use-team-members";
import { useAuth } from "@/features/auth/use-auth";
import type { DriveChannelState, WatchReport } from "./sync-status";
import type { SheetAccessEntry, SheetGoogleStatusRow, SheetsGoogleStatus } from "./sheet-list-model";
import {
  newColumnId,
  type ConflictPolicy,
  type DeletePolicy,
  type GoogleLinkRow,
  type SheetColumn,
  type SheetData,
  type SheetRecordRow,
  type SheetRow,
  type SheetSource,
  type SheetTemplate,
  type ProvisionStatus,
  type ShareCountsRow,
  type SyncCounts,
  type SyncDirection,
} from "@/lib/sheets/types";

/**
 * Sheets app — client data layer.
 *
 * Two paths, split the way docs/SHEETS_WORKFLOWS.md splits them:
 *  - the sheet records themselves (list, create, rename, columns, archive) and
 *    team templates are plain rows the caller may write under RLS, so they go
 *    straight through the browser client;
 *  - everything that touches a sheet's DATA (rows, cells, the Google link and
 *    its sync) goes through /api/sheets/**, because a bound sheet's rows live
 *    in another app's tables and a Google sync needs the service-role token.
 *
 * The app_sheet* tables are newer than src/types/database.ts, hence `loose()`.
 */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** PostgREST answers for "that table isn't there" (migration not pushed yet). */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export class SheetsMigrationPendingError extends Error {
  constructor() {
    super("The Sheets tables aren't in this database yet — the app_sheets migration has to be pushed first.");
    this.name = "SheetsMigrationPendingError";
  }
}

function rethrow(error: { code?: string; message: string }): never {
  if (error.code && MISSING_TABLE_CODES.has(error.code)) throw new SheetsMigrationPendingError();
  throw error;
}

/** JSON fetch against the Sheets routes; the route's `{ error }` becomes the thrown message. */
async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : res.status === 404
          ? "Not found — it may have been archived or moved."
          : res.status === 409
            ? "Something else is working on this right now — try again in a moment."
            : `Request failed (${res.status}).`;
    throw new Error(msg);
  }
  return body as T;
}

/**
 * The viewer's IANA zone. The routes take it so a date column means the
 * viewer's day (a task due "5 Mar" in Kolkata is not 4 Mar in UTC), and a
 * Google link records it for the scheduled syncs that run without a browser.
 */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Keys
 * ------------------------------------------------------------------ */

export const sheetsKey = (teamId: string | undefined) => ["sheets", "list", teamId ?? "__none__"] as const;
export const sheetTemplatesKey = (teamId: string | undefined) => ["sheets", "templates", teamId ?? "__none__"] as const;
export const sheetDataKey = (sheetId: string | undefined) => ["sheets", "data", sheetId ?? "__none__"] as const;
export const googleLinkKey = (sheetId: string | undefined) => ["sheets", "google-link", sheetId ?? "__none__"] as const;
export const syncRunsKey = (sheetId: string | undefined) => ["sheets", "sync-runs", sheetId ?? "__none__"] as const;
export const googleConnectionsKey = (teamId: string | undefined) => ["sheets", "google-connections", teamId ?? "__none__"] as const;
export const limitedMemberKey = (teamId: string | undefined) => ["sheets", "is-limited-member", teamId ?? "__none__"] as const;
export const driveChannelKey = (sheetId: string | undefined) => ["sheets", "drive-channel", sheetId ?? "__none__"] as const;

/* ------------------------------------------------------------------ *
 * Defensive JSONB readers
 * ------------------------------------------------------------------ */

const COLUMN_TYPES = new Set<SheetColumn["type"]>([
  "text", "long_text", "number", "currency", "percent", "date", "datetime", "checkbox",
  "select", "multi_select", "person", "people", "url", "email", "phone",
]);

/**
 * app_sheets.columns is jsonb the browser wrote; a hand-edited or older row
 * must not crash the grid, so anything that isn't a usable column is dropped.
 */
export function readColumns(json: unknown): SheetColumn[] {
  if (!Array.isArray(json)) return [];
  const out: SheetColumn[] = [];
  const seen = new Set<string>();
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string" || seen.has(c.id)) continue;
    const type = COLUMN_TYPES.has(c.type as SheetColumn["type"]) ? (c.type as SheetColumn["type"]) : "text";
    seen.add(c.id);
    out.push({
      id: c.id,
      label: typeof c.label === "string" && c.label ? c.label : "Untitled",
      type,
      ...(typeof c.field === "string" ? { field: c.field } : {}),
      ...(Array.isArray(c.options)
        ? {
            options: c.options
              .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object")
              .filter((o) => typeof o.value === "string")
              .map((o) => ({
                value: o.value as string,
                label: typeof o.label === "string" ? o.label : (o.value as string),
                ...(typeof o.color === "string" ? { color: o.color } : {}),
              })),
          }
        : {}),
      ...(typeof c.dynamicOptions === "string" ? { dynamicOptions: c.dynamicOptions as SheetColumn["dynamicOptions"] } : {}),
      ...(typeof c.currency === "string" ? { currency: c.currency } : {}),
      ...(typeof c.width === "number" && c.width > 0 ? { width: c.width } : {}),
      ...(c.hidden === true ? { hidden: true } : {}),
    });
  }
  return out;
}

function readSheet(row: Record<string, unknown>): SheetRecordRow {
  return {
    ...(row as unknown as SheetRecordRow),
    source_config:
      row.source_config && typeof row.source_config === "object" && !Array.isArray(row.source_config)
        ? (row.source_config as Record<string, unknown>)
        : {},
    columns: readColumns(row.columns),
  };
}

function readTemplate(row: Record<string, unknown>): SheetTemplate {
  // Template columns carry no ids; they are assigned when a sheet is made.
  const raw = Array.isArray(row.columns)
    ? row.columns.map((c, i) => (c && typeof c === "object" && !("id" in c) ? { ...c, id: `t_${i}` } : c))
    : [];
  const columns: Omit<SheetColumn, "id">[] = readColumns(raw).map((c) => {
    const rest: Partial<SheetColumn> = { ...c };
    delete rest.id;
    return rest as Omit<SheetColumn, "id">;
  });
  return {
    key: String(row.id),
    name: String(row.name ?? "Untitled"),
    description: typeof row.description === "string" ? row.description : "",
    icon: typeof row.icon === "string" && row.icon ? row.icon : "bookmark",
    category: "Custom",
    source: (row.source as SheetSource) ?? "custom",
    sourceConfig:
      row.source_config && typeof row.source_config === "object" && !Array.isArray(row.source_config)
        ? (row.source_config as Record<string, unknown>)
        : {},
    columns,
    builtIn: false,
  };
}

/** A team template row plus who made it (for the "delete" permission). */
export interface TeamSheetTemplate extends SheetTemplate {
  createdBy: string | null;
}

/** Template columns get fresh ids when a sheet is made from them. */
export function columnsFromTemplate(columns: Omit<SheetColumn, "id">[]): SheetColumn[] {
  const ids: string[] = [];
  return columns.map((c) => {
    const id = newColumnId(ids);
    ids.push(id);
    return { ...c, id };
  });
}

/* ------------------------------------------------------------------ *
 * Sheets
 * ------------------------------------------------------------------ */

const SHEET_COLUMNS =
  "id, team_id, project_id, name, description, source, source_config, columns, template_key, archived, created_by, created_at, updated_at";

/**
 * Every sheet the caller can see in the active team — workspace and project
 * sheets together, one query, so the rail can count per scope without a
 * request per project. RLS already hides projects the caller isn't in.
 */
export function useSheets() {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: sheetsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SheetRecordRow[]> => {
      const { data, error } = await supabase
        .from("app_sheets")
        .select(SHEET_COLUMNS)
        .eq("team_id", teamId as string)
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      if (error) rethrow(error);
      return ((data ?? []) as Record<string, unknown>[]).map(readSheet);
    },
    retry: (count, err) => !(err instanceof SheetsMigrationPendingError) && count < 2,
  });
}

export interface GoogleSetup {
  connectionId: string;
  mode: "create" | "existing";
  spreadsheetId?: string;
  direction: SyncDirection;
  conflictPolicy: ConflictPolicy;
  deletePolicy: DeletePolicy;
  autoSync: boolean;
  intervalMinutes: number;
}

export interface CreateSheetInput {
  name: string;
  description?: string | null;
  projectId: string | null;
  source: SheetSource;
  sourceConfig: Record<string, unknown>;
  columns: SheetColumn[];
  templateKey?: string | null;
  google?: GoogleSetup | null;
}

function patchList(qc: QueryClient, teamId: string | undefined, fn: (rows: SheetRecordRow[]) => SheetRecordRow[]) {
  qc.setQueryData<SheetRecordRow[]>(sheetsKey(teamId), (old) => (old ? fn(old) : old));
}

/** No Google account → no new sheet. Decision A, in one sentence. */
export const NEEDS_GOOGLE_TO_CREATE =
  "Connect a Google account first — every new sheet is created as a Google Sheet, so there is nowhere to put this one yet.";

/**
 * A limited member → no new sheet. Decision B, in one sentence, for the paths
 * that refuse with a message rather than a panel (the Marketing hand-off).
 * Said BEFORE the app_sheets row is inserted: the insert itself is allowed by
 * RLS, so a refusal that came after it would leave a sheet with no spreadsheet
 * and no way for its creator to finish one.
 */
export const LIMITED_CANNOT_CREATE =
  "A sheet is created as a Google Sheet and shared with the whole workspace, and your access is limited to your own rows — so a full workspace member has to create this one.";

/** The gate could not be read at all: block, and say that it is a check, not a verdict. */
export const CANNOT_CHECK_TO_CREATE =
  "Cubes couldn't check this workspace's Google connection, so it won't start a sheet it may not be able to finish. Try again in a moment.";

/**
 * Creates a sheet and gives it its Google Sheet.
 *
 * Every sheet IS its Google Sheet now — the sheet view renders the live
 * spreadsheet — so a new sheet without one would open onto a "set this up"
 * card and stay there. That half-thing is no longer made: `input.google` is
 * REQUIRED, and a caller that has no connected account is refused here rather
 * than falling back to the "pending" provision row. The UI gates the same rule
 * before the wizard opens (GoogleRequiredNotice); this is the backstop for the
 * case where the account was revoked while the wizard sat open.
 *
 * Sheets that ALREADY exist without a spreadsheet are untouched by this: they
 * keep /google/provision and the sheet view's Create / Connect / Use-one-I-have
 * card (see useProvisionGoogle).
 *
 * The two steps stay separate requests (the sheet row is RLS, the link is
 * service-role) and a Google failure NEVER rolls the sheet back — the columns
 * someone just built are worth more than the tidiness, and the sheet's own
 * "Try again" fixes it.
 */
export interface CreateSheetResult {
  sheet: SheetRecordRow;
  googleError: string | null;
  /**
   * The Google link the POST came back with, so the sheet opens on its real
   * sync settings instead of waiting a round trip for them.
   */
  link: GoogleLinkRow | null;
  /**
   * What happened to the Drive push channel while linking. Creation is where
   * most watches are born, so this is the answer a person is most likely to
   * want — describeSheetCreated turns it into the sentence.
   */
  watch: WatchReport | null;
}

export function useCreateSheet() {
  const supabase = useMemo(() => loose(createClient()), []);
  const qc = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useMutation({
    mutationFn: async (input: CreateSheetInput): Promise<CreateSheetResult> => {
      if (!teamId) throw new Error("No active workspace.");
      if (!input.google) throw new Error(NEEDS_GOOGLE_TO_CREATE);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_sheets")
        .insert({
          team_id: teamId,
          project_id: input.projectId,
          name: input.name.trim().slice(0, 120),
          description: input.description?.trim() ? input.description.trim().slice(0, 2000) : null,
          source: input.source,
          source_config: input.sourceConfig,
          columns: input.columns,
          template_key: input.templateKey ?? null,
          created_by: user?.id ?? null,
        })
        .select(SHEET_COLUMNS)
        .single();
      if (error) rethrow(error);
      const sheet = readSheet(data as Record<string, unknown>);
      // Prime the list so the sheet can be opened before the refetch lands.
      patchList(qc, teamId, (rows) => [sheet, ...rows.filter((r) => r.id !== sheet.id)]);

      let googleError: string | null = null;
      let link: GoogleLinkRow | null = null;
      let watch: WatchReport | null = null;
      try {
        const res = await api<LinkGoogleResult>(`/api/sheets/${sheet.id}/google`, {
          method: "POST",
          json: { ...input.google, timeZone: browserTimeZone() },
        });
        link = res?.link ?? null;
        // The route reports the Drive channel instead of failing over it; the
        // wizard is the last place that can say so while the person is still
        // looking at the thing they just made.
        watch = res?.watch ?? null;
      } catch (err) {
        googleError = err instanceof Error ? err.message : "Couldn't set up the Google Sheet.";
      }
      return { sheet, googleError, link, watch };
    },
    onSuccess: ({ sheet, link }) => {
      if (link) qc.setQueryData(googleLinkKey(sheet.id), link);
      void qc.invalidateQueries({ queryKey: sheetsKey(teamId) });
      void qc.invalidateQueries({ queryKey: googleLinkKey(sheet.id) });
      void qc.invalidateQueries({ queryKey: driveChannelKey(sheet.id) });
    },
  });
}

export type SheetPatch = Partial<Pick<SheetRecordRow, "name" | "description" | "columns" | "source_config" | "archived">>;

/**
 * Updates a sheet record optimistically — a column rename or reorder must not
 * wait a round trip — and rolls back on failure. The data query is refreshed
 * when columns or config change, because a newly added source-field column
 * has no values until the route reads them.
 */
export function useUpdateSheet() {
  const supabase = useMemo(() => loose(createClient()), []);
  const qc = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: SheetPatch }): Promise<SheetRecordRow> => {
      const { data, error } = await supabase
        .from("app_sheets")
        .update(patch)
        .eq("id", id)
        .select(SHEET_COLUMNS);
      if (error) rethrow(error);
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) throw new Error("You can't change this sheet.");
      return readSheet(rows[0]);
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: sheetsKey(teamId) });
      const previous = qc.getQueryData<SheetRecordRow[]>(sheetsKey(teamId));
      patchList(qc, teamId, (rows) =>
        patch.archived ? rows.filter((r) => r.id !== id) : rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(sheetsKey(teamId), ctx.previous);
    },
    onSuccess: (sheet, { patch }) => {
      if (!patch.archived) patchList(qc, teamId, (rows) => rows.map((r) => (r.id === sheet.id ? sheet : r)));
      if (patch.columns || patch.source_config) void qc.invalidateQueries({ queryKey: sheetDataKey(sheet.id) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sheetsKey(teamId) });
    },
  });
}

/** Hard delete — RLS allows it for the sheet's creator or a team admin only. */
export function useDeleteSheet() {
  const supabase = useMemo(() => loose(createClient()), []);
  const qc = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("app_sheets").delete().eq("id", id).select("id");
      if (error) rethrow(error);
      if (!data || data.length === 0) throw new Error("Only the sheet's creator or a workspace admin can delete it.");
    },
    onSuccess: (_d, id) => {
      patchList(qc, teamId, (rows) => rows.filter((r) => r.id !== id));
      void qc.invalidateQueries({ queryKey: sheetsKey(teamId) });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Team templates
 * ------------------------------------------------------------------ */

export function useSheetTemplates() {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: sheetTemplatesKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamSheetTemplate[]> => {
      const { data, error } = await supabase
        .from("app_sheet_templates")
        .select("id, name, description, icon, source, source_config, columns, created_by")
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });
      if (error) rethrow(error);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        ...readTemplate(row),
        createdBy: typeof row.created_by === "string" ? row.created_by : null,
      }));
    },
    retry: (count, err) => !(err instanceof SheetsMigrationPendingError) && count < 2,
  });
}

export function useSaveSheetTemplate() {
  const supabase = useMemo(() => loose(createClient()), []);
  const qc = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      icon?: string;
      source: SheetSource;
      sourceConfig: Record<string, unknown>;
      columns: SheetColumn[];
    }): Promise<TeamSheetTemplate> => {
      if (!teamId) throw new Error("No active workspace.");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("app_sheet_templates")
        .insert({
          team_id: teamId,
          name: input.name.trim().slice(0, 120),
          description: input.description?.trim() || null,
          icon: input.icon ?? "bookmark",
          source: input.source,
          source_config: input.sourceConfig,
          // Widths and hidden flags are how one person arranged their grid,
          // not part of the template; column ids are reassigned on use.
          columns: input.columns.map((c) => {
            const rest = { ...c };
            delete rest.width;
            return rest;
          }),
          created_by: user?.id ?? null,
        })
        .select("id, name, description, icon, source, source_config, columns, created_by")
        .single();
      if (error) rethrow(error);
      const row = data as Record<string, unknown>;
      return { ...readTemplate(row), createdBy: typeof row.created_by === "string" ? row.created_by : null };
    },
    onSuccess: (tpl) => {
      // Primed so the template shows in the gallery immediately.
      qc.setQueryData<TeamSheetTemplate[]>(sheetTemplatesKey(teamId), (old) =>
        [...(old ?? []).filter((t) => t.key !== tpl.key), tpl].sort((a, b) => a.name.localeCompare(b.name)),
      );
      void qc.invalidateQueries({ queryKey: sheetTemplatesKey(teamId) });
    },
  });
}

export function useDeleteSheetTemplate() {
  const supabase = useMemo(() => loose(createClient()), []);
  const qc = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("app_sheet_templates").delete().eq("id", id).select("id");
      if (error) rethrow(error);
      if (!data || data.length === 0) throw new Error("Only the template's author or a workspace admin can delete it.");
    },
    onSuccess: (_d, id) => {
      qc.setQueryData<TeamSheetTemplate[]>(sheetTemplatesKey(teamId), (old) => old?.filter((t) => t.key !== id));
      void qc.invalidateQueries({ queryKey: sheetTemplatesKey(teamId) });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Sheet data (rows + cells) — through the routes
 * ------------------------------------------------------------------ */

export function useSheetData(sheetId: string | undefined) {
  return useQuery({
    queryKey: sheetDataKey(sheetId),
    enabled: Boolean(sheetId),
    queryFn: () => {
      const tz = browserTimeZone();
      return api<SheetData>(`/api/sheets/${sheetId}/data${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`);
    },
    // Bound sheets mirror other apps' data, which changes under us; a short
    // stale window plus refetch-on-focus keeps the grid honest without polling.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

function patchRows(qc: QueryClient, sheetId: string, fn: (rows: SheetRow[]) => SheetRow[]) {
  qc.setQueryData<SheetData>(sheetDataKey(sheetId), (old) => (old ? { ...old, rows: fn(old.rows) } : old));
}

/**
 * One cell write. Optimistic in the cache (the grid never waits on a round
 * trip to show what was typed), replaced by the row the route hands back —
 * which is what the source actually stored, e.g. a trimmed title — and rolled
 * back to the previous value on failure.
 */
export function useUpdateCell(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { key: string; columnId: string; value: unknown }) =>
      api<{ row: SheetRow }>(`/api/sheets/${sheetId}/cells`, {
        method: "PATCH",
        json: { ...input, tz: browserTimeZone() },
      }),
    onMutate: async ({ key, columnId, value }) => {
      await qc.cancelQueries({ queryKey: sheetDataKey(sheetId) });
      const before = qc.getQueryData<SheetData>(sheetDataKey(sheetId))?.rows.find((r) => r.key === key);
      patchRows(qc, sheetId, (rows) =>
        rows.map((r) => (r.key === key ? { ...r, values: { ...r.values, [columnId]: value } } : r)),
      );
      return { previous: before?.values[columnId], hadRow: Boolean(before) };
    },
    onError: (_err, { key, columnId }, ctx) => {
      if (!ctx?.hadRow) return;
      patchRows(qc, sheetId, (rows) =>
        rows.map((r) => (r.key === key ? { ...r, values: { ...r.values, [columnId]: ctx.previous } } : r)),
      );
    },
    onSuccess: ({ row }, { key }) => {
      if (row && typeof row === "object" && row.key) {
        patchRows(qc, sheetId, (rows) => rows.map((r) => (r.key === key ? row : r)));
      }
    },
  });
}

export function useAddRow(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { values?: Record<string, unknown>; position?: number }) =>
      api<{ row: SheetRow }>(`/api/sheets/${sheetId}/rows`, {
        method: "POST",
        json: { ...input, tz: browserTimeZone() },
      }),
    onSuccess: ({ row }) => {
      if (row?.key) {
        patchRows(qc, sheetId, (rows) =>
          [...rows.filter((r) => r.key !== row.key), row].sort((a, b) => a.position - b.position),
        );
      }
    },
  });
}

export function useDeleteRows(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    // The route takes at most 500 keys per call.
    mutationFn: async (keys: string[]) => {
      for (let i = 0; i < keys.length; i += 500) {
        await api<unknown>(`/api/sheets/${sheetId}/rows`, { method: "DELETE", json: { keys: keys.slice(i, i + 500) } });
      }
    },
    onSuccess: (_d, keys) => {
      const gone = new Set(keys);
      patchRows(qc, sheetId, (rows) => rows.filter((r) => !gone.has(r.key)));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sheetDataKey(sheetId) });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Google
 * ------------------------------------------------------------------ */

export interface GoogleConnection {
  id: string;
  email: string | null;
  usable: boolean;
  lastTestError: string | null;
}

/** Every Google account connected to the team (a team may connect several). */
export function useGoogleConnections() {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: googleConnectionsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<GoogleConnection[]> => {
      const { data, error } = await supabase
        .from("app_google_connections")
        .select("id, google_account_email, revoked_at, enabled, has_refresh_token, last_test_error, created_at")
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) rethrow(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        email: typeof r.google_account_email === "string" ? r.google_account_email : null,
        usable: !r.revoked_at && r.enabled !== false && r.has_refresh_token !== false,
        lastTestError: typeof r.last_test_error === "string" ? r.last_test_error : null,
      }));
    },
    // Consent completes in another tab / after a redirect; keep it fresh.
    staleTime: 15_000,
  });
}

export function useGoogleLink(sheetId: string | undefined, opts: { poll?: boolean } = {}) {
  const supabase = useMemo(() => loose(createClient()), []);
  return useQuery({
    queryKey: googleLinkKey(sheetId),
    enabled: Boolean(sheetId),
    queryFn: async (): Promise<GoogleLinkRow | null> => {
      const { data, error } = await supabase
        .from("app_sheet_google_links")
        .select("*")
        .eq("sheet_id", sheetId as string)
        .maybeSingle();
      if (error) rethrow(error);
      return (data as GoogleLinkRow | null) ?? null;
    },
    // While a sync runs elsewhere (auto sync, a workflow), watch it finish.
    refetchInterval: (query) => (opts.poll || query.state.data?.last_status === "running" ? 4000 : false),
  });
}

export type GoogleSettings = Pick<GoogleSetup, "direction" | "conflictPolicy" | "deletePolicy" | "autoSync" | "intervalMinutes">;

/**
 * Every route that changes whether Cubes should be watching the Google file
 * reports what happened to the Drive push channel as `watch`, instead of
 * failing the request over it — push is the fast path, the timer is the
 * guarantee. The client types it so the panel can show it; sync-status.ts
 * turns it into the sentence (and decides that 'unreachable' is not an error).
 */
export interface LinkGoogleResult {
  link: GoogleLinkRow;
  sync?: SyncCounts | null;
  shareError?: string | null;
  watch?: WatchReport | null;
}

export interface UpdateGoogleLinkResult {
  link?: GoogleLinkRow;
  watch?: WatchReport | null;
}

export interface UnlinkGoogleResult {
  ok: boolean;
  /** How many live channels were marked for cancellation on the way out. */
  stopping?: number;
}

export function useLinkGoogle(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GoogleSetup) =>
      api<LinkGoogleResult>(`/api/sheets/${sheetId}/google`, {
        method: "POST",
        json: { ...input, timeZone: browserTimeZone() },
      }),
    onSuccess: ({ link }) => {
      if (link) qc.setQueryData(googleLinkKey(sheetId), link);
      void qc.invalidateQueries({ queryKey: googleLinkKey(sheetId) });
      void qc.invalidateQueries({ queryKey: syncRunsKey(sheetId) });
      void qc.invalidateQueries({ queryKey: sheetDataKey(sheetId) });
      void qc.invalidateQueries({ queryKey: driveChannelKey(sheetId) });
    },
  });
}

export function useUpdateGoogleLink(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<GoogleSettings>) =>
      api<UpdateGoogleLinkResult>(`/api/sheets/${sheetId}/google`, { method: "PATCH", json: input }),
    onSuccess: (res) => {
      if (res?.link) qc.setQueryData(googleLinkKey(sheetId), res.link);
      void qc.invalidateQueries({ queryKey: googleLinkKey(sheetId) });
      // Direction or auto-sync may have started or cancelled the channel.
      void qc.invalidateQueries({ queryKey: driveChannelKey(sheetId) });
    },
  });
}

export function useUnlinkGoogle(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<UnlinkGoogleResult>(`/api/sheets/${sheetId}/google`, { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData(googleLinkKey(sheetId), null);
      void qc.invalidateQueries({ queryKey: googleLinkKey(sheetId) });
      void qc.invalidateQueries({ queryKey: syncRunsKey(sheetId) });
      void qc.invalidateQueries({ queryKey: driveChannelKey(sheetId) });
    },
  });
}

/**
 * The Drive push channel behind this sheet, read straight from
 * app_sheet_drive_channels — the durable answer to "is this live?", as opposed
 * to the `watch` a single request happened to return. Any member of the sheet
 * may read it (its SELECT policy is app_sheets_can_access).
 *
 * Newest row wins: a renewal registers a new channel before the old one is
 * stopped, so ordering by created_at is what "the current one" means.
 */
export function useSheetLiveChannel(sheetId: string | undefined, enabled = true) {
  const supabase = useMemo(() => loose(createClient()), []);
  return useQuery({
    queryKey: driveChannelKey(sheetId),
    enabled: Boolean(sheetId) && enabled,
    queryFn: async (): Promise<DriveChannelState | null> => {
      const { data, error } = await supabase
        .from("app_sheet_drive_channels")
        .select("status, last_error, expires_at, last_notified_at")
        .eq("sheet_id", sheetId as string)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) {
        // The push tables land in a later migration than the rest of Sheets;
        // a deployment without them is "not live", not an error to show.
        if (error.code && MISSING_TABLE_CODES.has(error.code)) return null;
        throw error;
      }
      return ((data ?? [])[0] as DriveChannelState | undefined) ?? null;
    },
    staleTime: 15_000,
  });
}

export const sheetsGoogleStatusKey = (teamId: string | undefined) => ["sheets", "google-status", teamId ?? "__none__"] as const;

/**
 * Every sheet's Google state for the whole team, for the sheet LIST — one read
 * of app_sheet_google_links and one of app_sheet_drive_channels, however many
 * cards are on screen. A per-card useGoogleLink would be a request per sheet.
 *
 * Both tables are member-readable (their SELECT policies are
 * app_sheets_can_access), so RLS already trims the answer to the sheets the
 * caller can see.
 *
 * Only ACTIVE channels that have not expired count as live: an 'active' row
 * past its expiry is a channel Google has already stopped calling, and the
 * runner that marks it 'expired' may not have passed yet.
 *
 * staleTime 0, overriding the app's 60s default: the list mounts again every
 * time someone comes back from a sheet — often after creating or relinking
 * its Google Sheet — and must say so on the way back. The cached answer still
 * renders at once; the refetch only corrects it.
 */
export function useSheetsGoogleStatus() {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: sheetsGoogleStatusKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SheetsGoogleStatus> => {
      const [links, channels] = await Promise.all([
        supabase
          .from("app_sheet_google_links")
          // The share_* columns and direction feed each card's Access row; no
          // owner_email — the list never prints an address.
          .select(
            "sheet_id, provision_status, provision_error, last_synced_at, last_status, last_error, spreadsheet_id, spreadsheet_url, sheet_gid, owned_by_us, share_status, share_error, share_counts, shared_at, direction",
          )
          .eq("team_id", teamId as string),
        supabase
          .from("app_sheet_drive_channels")
          .select("sheet_id")
          .eq("team_id", teamId as string)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString()),
      ]);
      if (links.error) rethrow(links.error);
      // The push tables land in a later migration than the rest of Sheets; a
      // deployment without them has no live sheets, which is not an error.
      if (channels.error && !(channels.error.code && MISSING_TABLE_CODES.has(channels.error.code))) throw channels.error;
      const byId: Record<string, SheetGoogleStatusRow> = {};
      for (const row of (links.data ?? []) as SheetGoogleStatusRow[]) byId[row.sheet_id] = row;
      const live = [...new Set(((channels.data ?? []) as { sheet_id: string }[]).map((c) => c.sheet_id))];
      return { links: byId, live };
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    // A sync that is running finishes in seconds; watch it land. Anything
    // else is refreshed by the next mount or window focus, not by polling.
    refetchInterval: (query) =>
      Object.values(query.state.data?.links ?? {}).some((l) => l.last_status === "running") ? 5000 : false,
    retry: (count, err) => !(err instanceof SheetsMigrationPendingError) && count < 2,
  });
}

export const sheetsAccessListKey = (teamId: string | undefined) => ["sheets", "access-list", teamId ?? "__none__"] as const;

/** PostgREST / Postgres for "no such function" — migration 20261144 not pushed yet. */
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

/**
 * Who can open each sheet's Google file, for the whole list — ONE call to
 * app_sheets_access_list, however many cards are on screen (the per-sheet
 * app_sheets_share_targets is service-role only, and would be a call a card).
 *
 * `bySheet` is null when the function is not in this database yet: the cards
 * then fall back to the share pass's own counts rather than show nothing.
 * The function returns user ids only, never addresses, and nothing at all to a
 * limited member — the list does not ask on their behalf (`enabled`).
 *
 * staleTime 0 like useSheetsGoogleStatus: coming back from a sheet whose
 * Google panel just re-shared it must show the new people.
 */
export function useSheetsAccessList(enabled: boolean) {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: sheetsAccessListKey(teamId),
    enabled: Boolean(teamId) && enabled,
    queryFn: async (): Promise<{ bySheet: Record<string, SheetAccessEntry[]> | null }> => {
      const { data, error } = await supabase.rpc("app_sheets_access_list", { p_team_id: teamId as string });
      if (error) {
        if (error.code && MISSING_FUNCTION_CODES.has(error.code)) return { bySheet: null };
        throw error;
      }
      const bySheet: Record<string, SheetAccessEntry[]> = {};
      for (const row of (data ?? []) as (SheetAccessEntry & { sheet_id: string })[]) {
        (bySheet[row.sheet_id] ??= []).push({ user_id: row.user_id, access: row.access });
      }
      return { bySheet };
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export const sheetSharesKey = (sheetId: string | undefined) => ["sheets", "google-shares", sheetId ?? "__none__"] as const;

export interface ProvisionResult {
  status: ProvisionStatus;
  link: GoogleLinkRow | null;
  /** Why it is not ready — only on "pending" / "failed". */
  reason?: string;
  /** Set on "ready" when the sheet exists but not everyone could be shared in. */
  shareError?: string | null;
  /** What happened to the Drive push channel; see LinkGoogleResult. */
  watch?: WatchReport | null;
}

/**
 * Gives this sheet its Google Sheet: the button on a sheet that has none, and
 * the retry after a failure. Idempotent on the server, so a double press is
 * free.
 */
export function useProvisionGoogle(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { connectionId?: string | null } = {}) =>
      api<ProvisionResult>(`/api/sheets/${sheetId}/google/provision`, {
        method: "POST",
        json: { ...input, timeZone: browserTimeZone() },
      }),
    onSuccess: (res) => {
      if (res?.link) qc.setQueryData(googleLinkKey(sheetId), res.link);
      void qc.invalidateQueries({ queryKey: googleLinkKey(sheetId) });
      void qc.invalidateQueries({ queryKey: sheetSharesKey(sheetId) });
      void qc.invalidateQueries({ queryKey: syncRunsKey(sheetId) });
      void qc.invalidateQueries({ queryKey: driveChannelKey(sheetId) });
    },
  });
}

/**
 * Is the signed-in user a LIMITED member of this workspace?
 *
 * This is the client half of a rule the server already enforces twice — the
 * data route cuts their rows down (route-auth.ts limitToUserId) and
 * google-share.ts refuses to grant them the Drive file ('limited') — and
 * without it the sheets UI hands a limited member the iframe, which lands them
 * on Google's access wall with advice to ask for the whole file. Drive shares
 * per file, never per row, so following that advice is precisely the widening
 * the restriction exists to stop.
 *
 * Same shape as useCanCreateTasks in team-members: the RPC is the authority,
 * the roster's member_type answers first and answers the same question, and
 * `known` lets the caller hold the render rather than flash the wrong view in
 * either direction.
 *
 * WHEN BOTH SOURCES FAIL, THIS SAYS SO. `known` stays false — as it must, or a
 * failed probe would hand a limited member the iframe and land them on
 * Google's access wall — but `failed` separates "we are still asking" from "we
 * asked twice and got nothing", so the caller can show an error with a retry
 * instead of a reserved grey block that never resolves. Never optimistic: a
 * probe that could not answer is not an answer of "not limited".
 */
export interface LimitedMemberAccess {
  isLimited: boolean;
  /** One of the two sources answered; safe to render a view. */
  known: boolean;
  /** Neither could answer. Not "not limited" — show the failure and a retry. */
  failed: boolean;
  error: unknown;
  /** Asks both again. */
  retry: () => void;
  retrying: boolean;
}

export function useIsLimitedMember(): LimitedMemberAccess {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  const memberType = useMyMemberType();
  // The same query useMyMemberType reads, for its error and its refetch: that
  // hook returns a value only, so a roster that FAILED and a roster that has
  // not arrived look identical through it.
  const roster = useTeamMembers();
  // The roster answers about THIS user, so a roster that arrived before the
  // session did has not answered anything yet.
  const { user, loading: authLoading } = useAuth();

  const probe = useQuery({
    queryKey: limitedMemberKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_limited_member", { _team_id: teamId as string });
      if (error) throw error;
      return Boolean(data);
    },
    // A tier change is an admin action in another session; it does not need to
    // be watched, but it must not be cached for the whole visit either.
    staleTime: 60_000,
  });

  const retry = () => {
    void probe.refetch();
    void roster.refetch();
  };
  const retrying = probe.isFetching || roster.isFetching;

  if (probe.data !== undefined) {
    return { isLimited: probe.data, known: true, failed: false, error: null, retry, retrying };
  }
  if (memberType !== undefined) {
    return { isLimited: memberType === "limited", known: true, failed: false, error: null, retry, retrying };
  }
  // The RPC is out, and the roster is out too — either it errored, or it came
  // back, with the session known, without this user in it, which answers
  // nothing. A roster still in flight (or a session still resolving) is not a
  // failure: the fallback may yet answer, and a failure flashed in that window
  // would be a lie that clears itself.
  const rosterIsOut = roster.isError || (roster.data !== undefined && !authLoading && Boolean(user));
  const failed = probe.isError && rosterIsOut;
  return {
    isLimited: false,
    known: false,
    failed,
    error: probe.error ?? roster.error ?? null,
    retry,
    retrying,
  };
}

export interface SharePlanView {
  plan: {
    /** Names and roles only — the route never returns members' addresses. */
    grants: { name: string; role: "writer" | "reader" }[];
    skipped: { who: string; reason: "no_email" | "limited" | "owner" }[];
  } | null;
  ownedByUs: boolean;
  ownerEmail: string | null;
  shareStatus?: "ok" | "partial" | "failed" | null;
  shareError?: string | null;
  sharedAt?: string | null;
}

/** Who can open this sheet's Google file, and who cannot and why. */
export function useSheetShares(sheetId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: sheetSharesKey(sheetId),
    enabled: Boolean(sheetId) && enabled,
    queryFn: () => api<SharePlanView>(`/api/sheets/${sheetId}/google/share`),
    staleTime: 30_000,
  });
}

export type ShareResult =
  | { status: "ok" | "partial" | "failed"; counts: ShareCountsRow; error: string | null }
  | { scope: "team"; sheets: number; shared: number };

/**
 * Re-runs the Drive permissions pass — the control behind "a member joined".
 * scope "team" does it for every Cubes-owned sheet in the workspace at once,
 * because a person joins the workspace, not one sheet at a time.
 */
export function useShareGoogle(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scope?: "team" } = {}) =>
      api<ShareResult>(`/api/sheets/${sheetId}/google/share`, { method: "POST", json: input }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sheetSharesKey(sheetId) });
      void qc.invalidateQueries({ queryKey: googleLinkKey(sheetId) });
    },
  });
}

export function useSyncNow(sheetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SyncCounts & { status?: string }>(`/api/sheets/${sheetId}/google/sync`, { method: "POST" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: googleLinkKey(sheetId) });
      void qc.invalidateQueries({ queryKey: syncRunsKey(sheetId) });
      // A pull changes rows; show them.
      void qc.invalidateQueries({ queryKey: sheetDataKey(sheetId) });
    },
  });
}

export interface SyncRun {
  id: string;
  trigger: "manual" | "auto" | "workflow";
  status: "running" | "ok" | "error";
  started_at: string;
  finished_at: string | null;
  counts: SyncCounts | null;
  error: string | null;
}

export function useSyncRuns(sheetId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: syncRunsKey(sheetId),
    enabled: Boolean(sheetId) && enabled,
    queryFn: async (): Promise<SyncRun[]> => {
      const res = await api<SyncRun[] | { runs: SyncRun[] }>(`/api/sheets/${sheetId}/google/runs`);
      return Array.isArray(res) ? res : (res?.runs ?? []);
    },
  });
}

