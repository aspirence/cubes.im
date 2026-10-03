import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SOURCES, sourceField } from "./sources";
import type {
  DynamicOptions,
  SelectOption,
  SheetColumn,
  SheetData,
  SheetRecordRow,
  SheetRow,
  SheetSource,
} from "./types";
import { blankValue, isOptionType, isValidTimeZone, normalize, validate, type ValueContext } from "./values";
import { customAdapter, patchSheetRow, readSheetRows } from "./adapters/custom";
import { tasksAdapter } from "./adapters/tasks";
import { contentStudioAdapter } from "./adapters/content-studio";
import { AdapterError, isMissingTable, latest, type AdapterCtx, type SheetAdapter } from "./adapters/types";

/**
 * Sheets — the layer between a sheet's COLUMNS and its source's FIELDS, shared
 * by the grid routes and the Google sync so both read and write a sheet the
 * same way.
 *
 * A column with `field` reads/writes the source record through its adapter; a
 * column without one is the user's own and lives in app_sheet_rows.data. Every
 * value crossing this layer is canonical (values.ts) and keyed by column id.
 */

export const ADAPTERS: Record<SheetSource, SheetAdapter> = {
  custom: customAdapter,
  tasks: tasksAdapter,
  content_studio_items: contentStudioAdapter,
};

const SHEET_COLUMNS =
  "id, team_id, project_id, name, description, source, source_config, columns, template_key, archived, created_by, created_at, updated_at";

/** A sheet by id, scoped by team (service_role bypasses RLS — never by id alone). */
export async function loadSheet(admin: SupabaseClient, teamId: string, sheetId: string): Promise<SheetRecordRow | null> {
  const { data, error } = await admin
    .from("app_sheets")
    .select(SHEET_COLUMNS)
    .eq("id", sheetId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const sheet = data as SheetRecordRow;
  return { ...sheet, columns: sanitizeColumns(sheet.columns), source_config: sheet.source_config ?? {} };
}

/** Columns as stored are client-written jsonb; keep only well-formed ones and
 *  drop repeated ids, so one bad entry can't break the whole sheet. */
export function sanitizeColumns(raw: unknown): SheetColumn[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SheetColumn[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const col = c as SheetColumn;
    if (typeof col.id !== "string" || !col.id || seen.has(col.id)) continue;
    if (typeof col.label !== "string" || typeof col.type !== "string") continue;
    seen.add(col.id);
    out.push(col);
  }
  return out;
}

export interface CtxInput {
  admin: SupabaseClient;
  sheet: SheetRecordRow;
  actorUserId: string | null;
  timeZone?: string | null;
  /** A limited member: the adapters narrow both reads and writes to the rows
   *  that are theirs (adapters/limited.ts). Null for a scheduled Google sync,
   *  which reads and writes the whole team's rows on purpose. */
  limitToUserId?: string | null;
  actorIsTeamAdmin?: boolean;
  userClient?: SupabaseClient | null;
}

export function makeCtx(input: CtxInput): AdapterCtx {
  const configured = input.sheet.source_config?.timezone;
  const tz = isValidTimeZone(input.timeZone)
    ? input.timeZone
    : isValidTimeZone(typeof configured === "string" ? configured : null)
      ? (configured as string)
      : "UTC";
  return {
    admin: input.admin,
    sheet: input.sheet,
    teamId: input.sheet.team_id,
    projectId: input.sheet.project_id,
    actorUserId: input.actorUserId,
    timeZone: tz,
    limitToUserId: input.limitToUserId ?? null,
    actorIsTeamAdmin: input.actorIsTeamAdmin ?? false,
    userClient: input.userClient ?? null,
    out: { notices: [] },
  };
}

// -----------------------------------------------------------------------------
// Columns
// -----------------------------------------------------------------------------

/** The dynamic option set a column draws from, if any. People columns always
 *  list team members, even when a hand-made column forgot to say so. */
export function dynamicOf(source: SheetSource, col: SheetColumn): DynamicOptions | undefined {
  if (col.dynamicOptions) return col.dynamicOptions;
  const f = col.field ? sourceField(source, col.field) : undefined;
  if (f?.dynamicOptions) return f.dynamicOptions;
  if (col.type === "person" || col.type === "people") return "team_members";
  return undefined;
}

/** Can this column be written at all (before any per-row rule)? */
export function columnWritable(source: SheetSource, col: SheetColumn): boolean {
  if (!col.field) return true;
  if (source === "custom") return true;
  return Boolean(sourceField(source, col.field)?.writable);
}

/**
 * Google shows a select's LABEL, and a label read back is matched to an option.
 * Two options with the same label (two team members called "John Smith", two
 * statuses both named "Review") would therefore both resolve to the first one,
 * silently moving a task to the wrong person. Numbering the duplicates keeps
 * the mapping one-to-one — in Google and in the grid's own picker.
 */
export function uniqueLabels(options: SelectOption[]): SelectOption[] {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const total = new Map<string, number>();
  for (const o of options) total.set(key(o.label), (total.get(key(o.label)) ?? 0) + 1);
  if ([...total.values()].every((n) => n < 2)) return options;
  const seen = new Map<string, number>();
  return options.map((o) => {
    const k = key(o.label);
    if ((total.get(k) ?? 0) < 2) return o;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...o, label: `${o.label} (${n})` };
  });
}

/** The value context (options and how strict to be) for a column. */
export function valueContext(
  source: SheetSource,
  col: SheetColumn,
  options: Partial<Record<DynamicOptions, SelectOption[]>>,
  timeZone: string | null,
): ValueContext {
  const dyn = dynamicOf(source, col);
  if (dyn) return { options: options[dyn] ?? [], strictOptions: true, timeZone };
  const f = col.field ? sourceField(source, col.field) : undefined;
  const opts = col.options && col.options.length > 0 ? col.options : f?.options ?? col.options ?? [];
  return { options: uniqueLabels(opts), strictOptions: opts.length > 0 || Boolean(f?.options), timeZone };
}

// -----------------------------------------------------------------------------
// Dynamic options
// -----------------------------------------------------------------------------

type Opts = Partial<Record<DynamicOptions, SelectOption[]>>;

async function optionList(ctx: AdapterCtx, name: DynamicOptions): Promise<SelectOption[]> {
  const { admin, teamId, projectId } = ctx;
  switch (name) {
    case "task_statuses": {
      if (!projectId) return [];
      const { data } = await admin
        .from("task_statuses")
        .select("id, name, sort_order, sys_task_status_categories!task_statuses_category_id_fk(color_code)")
        .eq("project_id", projectId)
        .eq("team_id", teamId)
        .order("sort_order", { ascending: true });
      return ((data ?? []) as unknown as { id: string; name: string; sys_task_status_categories: { color_code: string } | null }[]).map(
        (s) => ({ value: s.id, label: s.name, color: s.sys_task_status_categories?.color_code }),
      );
    }
    case "task_priorities": {
      const { data } = await admin.from("task_priorities").select("id, name, value, color_code").order("value", { ascending: true });
      return ((data ?? []) as { id: string; name: string; color_code: string }[]).map((p) => ({
        value: p.id,
        label: p.name,
        color: p.color_code,
      }));
    }
    case "team_members": {
      const { data } = await admin
        .from("team_members")
        .select("id, users!team_members_user_id_fk(name, email)")
        .eq("team_id", teamId)
        .eq("active", true);
      return ((data ?? []) as unknown as { id: string; users: { name: string | null; email: string | null } | null }[])
        .filter((m) => m.users)
        .map((m) => ({ value: m.id, label: m.users?.name || m.users?.email || "Member" }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    case "team_labels": {
      const { data } = await admin.from("team_labels").select("id, name, color_code").eq("team_id", teamId).order("name");
      return ((data ?? []) as { id: string; name: string; color_code: string }[]).map((l) => ({
        value: l.id,
        label: l.name,
        color: l.color_code,
      }));
    }
    case "cs_destinations":
    case "cs_campaigns": {
      const table = name === "cs_destinations" ? "app_content_studio_destinations" : "app_content_studio_campaigns";
      const cols = name === "cs_destinations" ? "id, name, platform, theme_color" : "id, name, theme_color";
      let q = admin.from(table).select(cols).eq("team_id", teamId);
      q = projectId ? q.or(`project_id.is.null,project_id.eq.${projectId}`) : q.is("project_id", null);
      const { data, error } = await q.order("name");
      if (error && isMissingTable(error)) return [];
      return ((data ?? []) as unknown as { id: string; name: string; theme_color?: string }[]).map((r) => ({
        value: r.id,
        label: r.name,
        color: r.theme_color,
      }));
    }
    case "crm_campaigns": {
      const { data, error } = await admin
        .from("app_crm_campaigns")
        .select("id, name")
        .eq("team_id", teamId)
        .is("deleted_at", null)
        .order("name");
      if (error) return [];
      return ((data ?? []) as { id: string; name: string }[]).map((c) => ({ value: c.id, label: c.name }));
    }
  }
  return [];
}

export async function resolveOptions(ctx: AdapterCtx, columns: SheetColumn[]): Promise<Opts> {
  const wanted = new Set<DynamicOptions>();
  for (const col of columns) {
    const dyn = dynamicOf(ctx.sheet.source, col);
    if (dyn) wanted.add(dyn);
  }
  const entries = await Promise.all([...wanted].map(async (n) => [n, uniqueLabels(await optionList(ctx, n))] as const));
  return Object.fromEntries(entries) as Opts;
}

// -----------------------------------------------------------------------------
// Records
// -----------------------------------------------------------------------------

export interface LoadedRecord {
  key: string;
  /** Canonical values keyed by column id. */
  values: Record<string, unknown>;
  updatedAt: string | null;
  position: number;
  /** Column ids this row cannot change. */
  readonly: string[];
}

export async function loadRecords(
  ctx: AdapterCtx,
  columns: SheetColumn[],
  opts: { keys?: string[] } = {},
): Promise<LoadedRecord[]> {
  const source = ctx.sheet.source;
  const records = await ADAPTERS[source].list(ctx, opts);
  const customRows =
    source === "custom"
      ? null
      : new Map((await readSheetRows(ctx, opts.keys ?? undefined)).map((r) => [r.record_key, r]));

  return records.map((rec) => {
    const own = customRows?.get(rec.key);
    const data = source === "custom" ? rec.fields : own?.data ?? {};
    const values: Record<string, unknown> = {};
    const readonly: string[] = [];
    for (const col of columns) {
      const raw = col.field && source !== "custom" ? rec.fields[col.field] : data[col.id];
      values[col.id] = normalize(col.type, raw ?? blankValue(col.type));
      if (!columnWritable(source, col) || (col.field && rec.readonlyFields?.includes(col.field))) readonly.push(col.id);
    }
    return {
      key: rec.key,
      values,
      updatedAt: latest(rec.updatedAt, own?.updated_at),
      position: rec.position,
      readonly,
    };
  });
}

function toSheetRow(r: LoadedRecord): SheetRow {
  return { key: r.key, values: r.values, position: r.position, readonly: r.readonly };
}

export async function buildSheetData(ctx: AdapterCtx): Promise<SheetData & { notices: string[] }> {
  const { sheet } = ctx;
  const [options, records] = await Promise.all([resolveOptions(ctx, sheet.columns), loadRecords(ctx, sheet.columns)]);
  const src = SOURCES[sheet.source];
  return {
    sheetId: sheet.id,
    columns: sheet.columns,
    rows: records.map(toSheetRow),
    options,
    canCreateRows: src.canCreate,
    canDeleteRows: src.canDelete,
    currency: ctx.out.currency ?? null,
    notices: ctx.out.notices,
  };
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

/**
 * Applies canonical values (keyed by column id) to one record: source fields
 * through the adapter, the user's own columns into app_sheet_rows. Read-only
 * columns are refused here, not just hidden in the UI.
 */
export async function applyRecordPatch(
  ctx: AdapterCtx,
  key: string,
  patch: Record<string, unknown>,
  opts: { readonlyColumns?: string[] } = {},
): Promise<void> {
  const source = ctx.sheet.source;
  const byId = new Map(ctx.sheet.columns.map((c) => [c.id, c]));
  const fieldPatch: Record<string, unknown> = {};
  const customPatch: Record<string, unknown> = {};
  for (const [colId, value] of Object.entries(patch)) {
    const col = byId.get(colId);
    if (!col) throw new AdapterError("That column no longer exists.", 404);
    if (!columnWritable(source, col) || opts.readonlyColumns?.includes(colId)) {
      throw new AdapterError(`“${col.label}” is read-only here.`, 403);
    }
    if (col.field && source !== "custom") fieldPatch[col.field] = value;
    else customPatch[colId] = value;
  }
  if (Object.keys(fieldPatch).length > 0) await ADAPTERS[source].update(ctx, key, fieldPatch);
  if (Object.keys(customPatch).length > 0) {
    if (source === "custom") await customAdapter.update(ctx, key, customPatch);
    else await patchSheetRow(ctx, key, customPatch);
  }
}

/** Creates a record from canonical values keyed by column id; returns its key. */
export async function createRecord(
  ctx: AdapterCtx,
  values: Record<string, unknown>,
  position?: number,
): Promise<string> {
  const source = ctx.sheet.source;
  const src = SOURCES[source];
  const adapter = ADAPTERS[source];
  if (!src.canCreate || !adapter.create) throw new AdapterError(`New rows can't be added to a “${src.label}” sheet.`);
  const byId = new Map(ctx.sheet.columns.map((c) => [c.id, c]));
  const fieldValues: Record<string, unknown> = {};
  const customValues: Record<string, unknown> = {};
  for (const [colId, value] of Object.entries(values)) {
    const col = byId.get(colId);
    if (!col) continue;
    if (col.field && source !== "custom") {
      if (columnWritable(source, col)) fieldValues[col.field] = value;
    } else {
      customValues[colId] = value;
    }
  }
  if (source === "custom") {
    if (position !== undefined) {
      const key = randomUUID();
      await patchSheetRow(ctx, key, customValues, position);
      return key;
    }
    return adapter.create(ctx, customValues);
  }
  for (const f of src.fields) {
    if (f.requiredOnCreate && (fieldValues[f.key] === undefined || fieldValues[f.key] === null || fieldValues[f.key] === "")) {
      // Named as THIS sheet names the column: the sync writes this sentence
      // onto the Google row it refuses (row-notes.ts), and a person looking
      // at a "Caption" header should not be told about "Body / caption".
      const label = ctx.sheet.columns.find((c) => c.field === f.key && !c.hidden)?.label.trim() || f.label;
      throw new AdapterError(`“${label}” is needed to add a row.`);
    }
  }
  const key = await adapter.create(ctx, fieldValues);
  if (Object.keys(customValues).length > 0 || position !== undefined) {
    await patchSheetRow(ctx, key, customValues, position);
  }
  return key;
}

export async function deleteRecord(ctx: AdapterCtx, key: string): Promise<void> {
  const source = ctx.sheet.source;
  const src = SOURCES[source];
  const adapter = ADAPTERS[source];
  if (!src.canDelete || !adapter.remove) throw new AdapterError(`Rows can't be deleted from a “${src.label}” sheet.`);
  await adapter.remove(ctx, key);
  if (source !== "custom") {
    await ctx.admin.from("app_sheet_rows").delete().eq("sheet_id", ctx.sheet.id).eq("record_key", key);
  }
}

/** Validates a person's value for a column (grid writes). */
export function validateCell(
  ctx: AdapterCtx,
  col: SheetColumn,
  value: unknown,
  options: Opts,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const vctx = valueContext(ctx.sheet.source, col, options, ctx.timeZone);
  return validate(col.type, value, vctx);
}

/** Grid edit of one cell → the row as it now reads. */
export async function writeCell(ctx: AdapterCtx, key: string, columnId: string, value: unknown): Promise<SheetRow> {
  const col = ctx.sheet.columns.find((c) => c.id === columnId);
  if (!col) throw new AdapterError("That column no longer exists.", 404);
  const [current] = await loadRecords(ctx, ctx.sheet.columns, { keys: [key] });
  if (!current) throw new AdapterError("That row no longer exists.", 404);
  if (current.readonly.includes(columnId)) throw new AdapterError(`“${col.label}” is read-only here.`, 403);
  const options = isOptionType(col.type) ? await resolveOptions(ctx, [col]) : {};
  const checked = validateCell(ctx, col, value, options);
  if (!checked.ok) throw new AdapterError(checked.error);
  await applyRecordPatch(ctx, key, { [columnId]: checked.value });
  const [row] = await loadRecords(ctx, ctx.sheet.columns, { keys: [key] });
  if (!row) throw new AdapterError("That row no longer exists.", 404);
  return toSheetRow(row);
}

/** Grid "add row" → the new row. */
export async function addRow(ctx: AdapterCtx, values: Record<string, unknown>, position?: number): Promise<SheetRow> {
  const options = await resolveOptions(ctx, ctx.sheet.columns);
  const clean: Record<string, unknown> = {};
  for (const [colId, value] of Object.entries(values ?? {})) {
    const col = ctx.sheet.columns.find((c) => c.id === colId);
    if (!col) throw new AdapterError("That column no longer exists.", 404);
    const checked = validateCell(ctx, col, value, options);
    if (!checked.ok) throw new AdapterError(`${col.label}: ${checked.error}`);
    clean[colId] = checked.value;
  }
  const key = await createRecord(ctx, clean, position);
  const [row] = await loadRecords(ctx, ctx.sheet.columns, { keys: [key] });
  // A limited member may create a task they then can't see; answer with what
  // they sent rather than failing a write that succeeded.
  return row
    ? toSheetRow(row)
    : { key, values: clean, position: position ?? 0, readonly: [] };
}
