/**
 * Sheets app — shared contract between the database, the server (adapters,
 * Google sync, routes) and the client (grid, wizard). Pure types and constants:
 * no imports, so it is safe on both sides and runnable under
 * `node --experimental-strip-types` for tests.
 *
 * See docs/SHEETS_WORKFLOWS.md for the tables these mirror.
 */

/** Where a sheet's rows come from. */
export type SheetSource =
  | "custom" // rows live in app_sheet_rows
  | "tasks" // the project's tasks
  | "content_studio_items"; // Content Studio items (needs the content_studio app)

export type ColumnType =
  | "text"
  | "long_text"
  | "number"
  | "currency"
  | "percent"
  | "date" // "YYYY-MM-DD"
  | "datetime" // ISO 8601 instant
  | "checkbox"
  | "select" // one option value
  | "multi_select" // option values[]
  | "person" // one team_members.id
  | "people" // team_members.id[]
  | "url"
  | "email"
  | "phone";

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
}

/**
 * Options that depend on the sheet's scope and are resolved at read time
 * (by the data route) rather than stored in the column.
 */
export type DynamicOptions =
  | "task_statuses" // the project's task_statuses (value = id)
  | "task_priorities" // task_priorities (value = id)
  | "team_members" // active team members (value = team_members.id)
  | "team_labels" // team_labels (value = id)
  | "cs_destinations" // Content Studio destinations in scope (value = id)
  | "cs_campaigns" // Content Studio campaigns in scope (value = id)
  | "crm_campaigns"; // CRM campaigns of the team (value = id)

/**
 * One column of a sheet, as stored in app_sheets.columns (jsonb array).
 * `field` set  -> the value is read from / written to the source record.
 * `field` unset -> a custom column, stored in app_sheet_rows.data[column.id]
 *                  (works on every source, which is how users add their own
 *                  columns — notes, targets, owners — next to app data).
 */
export interface SheetColumn {
  /** Stable id, never reused within a sheet: "c_" + 8 chars. */
  id: string;
  label: string;
  type: ColumnType;
  field?: string;
  options?: SelectOption[];
  dynamicOptions?: DynamicOptions;
  /** ISO 4217, for type "currency" when the source does not carry one. */
  currency?: string;
  width?: number;
  hidden?: boolean;
}

/** A row as the data route returns it: values keyed by COLUMN id. */
export interface SheetRow {
  /** app_sheet_rows.record_key for custom sheets; the source record id otherwise. */
  key: string;
  values: Record<string, unknown>;
  position: number;
  /** Column ids the caller may not edit on this row (source-owned, derived, or no permission). */
  readonly: string[];
}

export interface SheetData {
  sheetId: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  /** Resolved dynamic options, keyed by DynamicOptions name. */
  options: Partial<Record<DynamicOptions, SelectOption[]>>;
  /** Source capabilities for this sheet (e.g. tasks can create, insights cannot). */
  canCreateRows: boolean;
  canDeleteRows: boolean;
  /** Currency of money columns when the source knows it (Meta account currency). */
  currency?: string | null;
}

/** app_sheets row. */
export interface SheetRecordRow {
  id: string;
  team_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  source: SheetSource;
  source_config: Record<string, unknown>;
  columns: SheetColumn[];
  template_key: string | null;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SyncDirection = "both" | "push" | "pull";
export type ConflictPolicy = "newest" | "cubes" | "google";
export type DeletePolicy = "keep" | "delete";

/**
 * Where a sheet's Google Sheet has got to.
 *  - "pending" the Cubes sheet exists and the Google file does not yet (no
 *    Google account connected, or provisioning has not run). The sheet view
 *    shows the "finish this" card, never a blank frame.
 *  - "ready"   there is a spreadsheet and an account that can open it.
 *  - "failed"  Google refused; provision_error says why, and the same card
 *    offers to try again.
 */
export type ProvisionStatus = "pending" | "ready" | "failed";

/** The outcome of the last Drive-permissions pass. */
export type ShareStatus = "ok" | "partial" | "failed";

/** app_sheet_google_links row (one per sheet).
 *
 *  connection_id and spreadsheet_id are null exactly while provision_status is
 *  not "ready": a pending row holds the sheet's one link slot so that "no
 *  Google Sheet yet" has a home with a reason in it. */
export interface GoogleLinkRow {
  id: string;
  sheet_id: string;
  team_id: string;
  connection_id: string | null;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  sheet_gid: number | null;
  sheet_title: string | null;
  direction: SyncDirection;
  conflict_policy: ConflictPolicy;
  delete_policy: DeletePolicy;
  auto_sync: boolean;
  interval_minutes: number;
  next_run_at: string | null;
  last_synced_at: string | null;
  last_status: "ok" | "error" | "running" | null;
  last_error: string | null;
  last_counts: SyncCounts | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  /* Google-first provisioning (20261141000000_google_first_sheets.sql). */
  provision_status: ProvisionStatus;
  provision_error: string | null;
  provisioned_at: string | null;
  /** True only when Cubes created the file — which is what makes it shareable. */
  owned_by_us: boolean;
  /** The Google account that owns the file; named in the embed's access note. */
  owner_email: string | null;
  share_status: ShareStatus | null;
  share_error: string | null;
  share_counts: ShareCountsRow | null;
  shared_at: string | null;
}

/** app_sheet_google_links.share_counts. Names, never email addresses: this
 *  column is workspace-member readable. */
export interface ShareCountsRow {
  granted: number;
  promoted: number;
  unchanged: number;
  failed: number;
  left_out: string[];
  limited: number;
}

export interface SyncCounts {
  pushed: number; // Cubes -> Google cell/row updates
  pulled: number; // Google -> Cubes updates applied
  created: number; // rows created on either side
  deleted: number;
  conflicts: number;
  skipped: number; // Google edits rejected (read-only column, invalid value)
}

/** A built-in (code) or team (app_sheet_templates) template. */
export interface SheetTemplate {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: "Content" | "Tasks" | "Planning" | "Custom";
  source: SheetSource;
  sourceConfig: Record<string, unknown>;
  /** Column ids are assigned when the template is applied. */
  columns: Omit<SheetColumn, "id">[];
  builtIn: boolean;
}

/** Column id generator — stable, collision-resistant within a sheet. */
export function newColumnId(existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (;;) {
    const id = "c_" + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
    if (!taken.has(id)) return id;
  }
}
