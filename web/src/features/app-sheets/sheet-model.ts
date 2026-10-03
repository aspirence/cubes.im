/**
 * Sheets grid — rules about columns that the grid, the column editor, the
 * wizard and paste all need to agree on: which options a column offers, why a
 * cell is locked, how wide a column starts, and which sources a scope may use.
 * Pure (no React, no client), so it runs under the node test harness.
 */
import { SOURCES, sourceField } from "@/lib/sheets/sources";
import type {
  DynamicOptions,
  SelectOption,
  SheetColumn,
  SheetData,
  SheetSource,
} from "@/lib/sheets/types";

/** App display names for "install X" hints; keys are installed_apps.app_key. */
export const APP_NAMES: Record<string, string> = {
  content_studio: "Content Studio",
  sheets: "Sheets",
};

export const TYPE_LABELS: Record<SheetColumn["type"], string> = {
  text: "Text",
  long_text: "Long text",
  number: "Number",
  currency: "Currency",
  percent: "Percent",
  date: "Date",
  datetime: "Date & time",
  checkbox: "Checkbox",
  select: "Single select",
  multi_select: "Multi select",
  person: "Person",
  people: "People",
  url: "Link",
  email: "Email",
  phone: "Phone",
};

export const TYPE_ICONS: Record<SheetColumn["type"], string> = {
  text: "notes",
  long_text: "subject",
  number: "tag",
  currency: "payments",
  percent: "percent",
  date: "calendar_today",
  datetime: "schedule",
  checkbox: "check_box",
  select: "radio_button_checked",
  multi_select: "checklist",
  person: "person",
  people: "group",
  url: "link",
  email: "mail",
  phone: "call",
};

const DEFAULT_WIDTH: Record<SheetColumn["type"], number> = {
  text: 200,
  long_text: 260,
  number: 120,
  currency: 130,
  percent: 110,
  date: 130,
  datetime: 170,
  checkbox: 96,
  select: 160,
  multi_select: 210,
  person: 180,
  people: 220,
  url: 200,
  email: 200,
  phone: 150,
};

export function columnWidth(column: SheetColumn): number {
  return Math.max(70, Math.min(600, column.width ?? DEFAULT_WIDTH[column.type] ?? 160));
}

/** A column the user owns (stored in app_sheet_rows.data), as opposed to a source field. */
export function isCustomColumn(column: SheetColumn): boolean {
  return !column.field;
}

/**
 * The options a select-like column offers: its own list first (custom
 * columns and templates that spell them out), then the source field's fixed
 * list (Content Studio types / statuses), then dynamic options the data route
 * resolved for this sheet's scope.
 */
export function optionsFor(
  column: SheetColumn,
  source: SheetSource,
  resolved: SheetData["options"] | undefined,
): SelectOption[] {
  if (column.options && column.options.length > 0 && !column.dynamicOptions) return column.options;
  const field = column.field ? sourceField(source, column.field) : undefined;
  const dyn: DynamicOptions | undefined = column.dynamicOptions ?? field?.dynamicOptions;
  if (dyn) return resolved?.[dyn] ?? [];
  if (field?.options?.length) return field.options;
  return column.options ?? [];
}

/** Whether pasting an unknown label into this column may add it as an option. */
export function canGrowOptions(column: SheetColumn): boolean {
  return isCustomColumn(column) && column.type === "select" && !column.dynamicOptions;
}

/**
 * Why a cell can't be edited, in words a user can act on — or null when it
 * can. Order matters: "the whole column is Meta's" is more useful than "this
 * row is read-only" for the same cell.
 */
export function lockReason(
  column: SheetColumn,
  source: SheetSource,
  rowReadonly: readonly string[] | undefined,
): string | null {
  if (column.field) {
    const field = sourceField(source, column.field);
    const src = SOURCES[source];
    if (!field) return `${column.label} isn't a field of ${src.label} any more — remove the column or change the source.`;
    if (!field.writable) {
      if (source === "tasks") return `${column.label} is worked out by Cubes for each task and can't be typed in.`;
      return `${column.label} is kept by ${src.label} and can't be edited here.`;
    }
  }
  if (rowReadonly?.includes(column.id)) {
    return column.field
      ? `You can't change ${column.label} on this row — it's owned by the source record or you don't have permission on it.`
      : `You can't change ${column.label} on this row.`;
  }
  return null;
}

/** Can a column take a value on a row that is being created? */
export function writableOnCreate(column: SheetColumn, source: SheetSource): boolean {
  if (!column.field) return true;
  return Boolean(sourceField(source, column.field)?.writable);
}

/** Source-field columns a user may not create a row without. */
export function requiredOnCreate(source: SheetSource): { key: string; label: string }[] {
  return SOURCES[source].fields.filter((f) => f.requiredOnCreate).map((f) => ({ key: f.key, label: f.label }));
}

/* ------------------------------------------------------------------ *
 * Source availability
 * ------------------------------------------------------------------ */

export interface InstalledLike {
  app_key: string;
  enabled: boolean;
  config: unknown;
}

/**
 * Same reading of installed_apps.config as parseAppScope in
 * features/apps-platform/app-scope.ts. Repeated rather than imported because
 * that module is a client module (hooks, Supabase) and this one has to stay
 * runnable in node tests.
 */
function activatedIn(config: unknown, projectId: string): boolean {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const c = config as Record<string, unknown>;
    if (c.scope === "selected") {
      return Array.isArray(c.projectIds) && c.projectIds.includes(projectId);
    }
  }
  return true;
}

export type SourceAvailability = { ok: true } | { ok: false; reason: string; appKey?: string };

/**
 * Whether a source may be used for a sheet in a scope. A bound source needs
 * its app installed and enabled for the team and, for a project sheet,
 * activated in that project (the app's own scoping preference — the data is
 * still RLS-limited either way). Tasks only exist inside a project.
 */
export function sourceAvailability(
  source: SheetSource,
  projectId: string | null,
  installed: InstalledLike[] | undefined,
): SourceAvailability {
  const desc = SOURCES[source];
  if (desc.projectOnly && !projectId) {
    return { ok: false, reason: `${desc.label} needs a project — create this sheet inside a project.` };
  }
  if (!desc.appKey) return { ok: true };
  const name = APP_NAMES[desc.appKey] ?? desc.appKey;
  const record = installed?.find((a) => a.app_key === desc.appKey);
  if (!record) return { ok: false, reason: `Install ${name} to use this.`, appKey: desc.appKey };
  if (!record.enabled) return { ok: false, reason: `${name} is turned off for this workspace.`, appKey: desc.appKey };
  if (projectId) {
    if (!activatedIn(record.config, projectId)) {
      return { ok: false, reason: `${name} isn't active in this project yet.`, appKey: desc.appKey };
    }
  }
  return { ok: true };
}

/** The source-config values a new sheet starts with (template values over defaults). */
export function configWithDefaults(source: SheetSource, given: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SOURCES[source].config) out[f.key] = f.key in given ? given[f.key] : f.default;
  for (const [k, v] of Object.entries(given)) if (!(k in out)) out[k] = v;
  return out;
}

/* ------------------------------------------------------------------ *
 * Creating a sheet at all
 * ------------------------------------------------------------------ */

/** Just enough of a Google connection to answer the question below. */
export interface ConnectionLike {
  usable: boolean;
}

/**
 * May a NEW sheet be created in this workspace?
 *
 * A sheet IS its Google Sheet — the sheet view renders the live spreadsheet —
 * so making one before an account is connected produces a placeholder that
 * cannot be opened, cannot be shared and cannot be synced. The answer is
 * therefore "not yet", said before the wizard opens rather than after four
 * steps of work.
 *
 * `undefined` (the connections query has not answered) is NOT "no": the caller
 * must wait rather than block on a guess, which is why this returns false for
 * it and every caller pairs it with a "still loading" check.
 *
 * Sheets that ALREADY exist without a spreadsheet are a different question and
 * keep their own provision path — this rule is about creation only.
 */
export function canCreateSheets(connections: ConnectionLike[] | undefined): boolean {
  return (connections ?? []).some((c) => c.usable);
}

/**
 * The Google half of the creation gate, with the state every call site kept
 * getting wrong: "we could not find out".
 *
 * `canCreateSheets(undefined)` is false, and a query that ERRORED is neither
 * loading nor holding data — so a gate written as
 * `isLoading && data === undefined` collapsed a failed read into "there is no
 * Google account here", told a workspace that HAS one to connect one, and
 * switched off sheet creation on the strength of a network blip.
 *
 * Four states, and only one of them is allowed to say "connect Google":
 *   unknown      — still asking (or nothing has asked yet). Wait.
 *   error        — asked and failed. Say so, and offer a retry.
 *   ready        — at least one usable connection. Create away.
 *   needs-google — the list came back and holds no usable connection.
 *
 * Data that is already in hand wins over a failed REFETCH: a background error
 * must not retract an answer we were given.
 *
 * Pure, so the node suites can hold every branch to it.
 */
export type GoogleGateState = "unknown" | "error" | "ready" | "needs-google";

/** The shape of a TanStack query, narrowed to what the gate reads. */
export interface ConnectionsQueryLike {
  data: ConnectionLike[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
}

export function googleGate(query: ConnectionsQueryLike): GoogleGateState {
  if (query.data !== undefined) return canCreateSheets(query.data) ? "ready" : "needs-google";
  if (query.isError) return "error";
  return "unknown";
}

/* ------------------------------------------------------------------ *
 * Limited members
 * ------------------------------------------------------------------ */

export interface LimitedViewNote {
  title: string;
  body: string;
  /** True when the server really does cut the rows down to this person's own. */
  rowsAreFiltered: boolean;
}

/**
 * What a LIMITED member is told when a sheet renders as Cubes' own grid rather
 * than as the Google Sheet everyone else sees.
 *
 * The reason is physical, not a policy we could soften: Google Drive shares a
 * FILE, never a row. A member restricted to their own rows therefore cannot be
 * given the spreadsheet at all — handing it over would show them the whole
 * team's rows, which is exactly what the restriction exists to prevent. So
 * google-share.ts skips them ('limited') and this grid is what they get.
 *
 * THREE states, not two, because the data route (src/lib/sheets/adapters/**)
 * treats sources three ways once limitToUserId is set:
 *
 *   - NARROWED — tasks, content_studio_items and custom really do cut the rows
 *     down to this person's own, so the note may say so, and says WHICH rows,
 *     because "yours" means something different on each.
 *   - EMPTY BY DESIGN — the two Meta sources have no per-person owner at all
 *     (spend belongs to an ad account), so a limited member gets no rows. The
 *     adapter already explains that in a notice sheet-view renders above this
 *     grid. Returning a note here too would stack a second explanation on top
 *     that talks about "the sheet itself" — which is exactly the contradiction
 *     a verifier rendered. So these return null and the adapter speaks alone.
 *
 * Keep this in step with the adapters: if a source starts or stops narrowing,
 * this is the sentence that has to change with it.
 */
export function limitedViewNote(source: SheetSource): LimitedViewNote | null {
  const whyNotGoogle =
    "A Google Sheet can only be shared whole — there is no way to share part of one — so this sheet opens as its own grid here, and this is the version that keeps to your access. Edits you make here sync to the spreadsheet like everyone else's.";
  const yours: Partial<Record<SheetSource, string>> = {
    tasks: "Your access is limited to the tasks assigned to you.",
    content_studio_items: "Your access is limited to the items that are yours: the ones you created and the ones on tasks assigned to you.",
    custom: "Your access is limited to the rows you added to this sheet.",
  };
  const which = yours[source];
  // No owner concept for this source: the adapter's own notice is the whole story.
  if (!which) return null;
  return {
    title: "You're seeing the rows that are yours",
    body: `${which} ${whyNotGoogle}`,
    rowsAreFiltered: true,
  };
}
