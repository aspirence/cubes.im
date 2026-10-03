/**
 * Sheets ↔ Google Sheets — how a Google tab maps onto a sheet's columns. Pure.
 *
 * Layout: row 1 holds headers; one column headed "Cubes ID" holds each row's
 * record key (placed in A when Cubes lays the tab out, protected with a
 * warning); every other column is matched to a Cubes column BY HEADER TEXT on
 * every run. People reorder, insert and delete columns in Google, so a stored
 * column position would go stale the first time they did; a header they can
 * see and read is the thing both sides agree on. Headers that match no Cubes
 * column are someone's own working columns and are left alone.
 *
 * Renames: when a column is renamed in Cubes, its Google header still carries
 * the old label. The labels Cubes last wrote are kept (HeaderState) so that
 * header is recognised as the same column and renamed in place, rather than
 * orphaned while a new column is added next to it.
 */
import type { ColumnType, SelectOption, SheetColumn } from "./types";
import type { CellInput, GoogleRow } from "./sync-core";
import type { GoogleCell } from "./values";
import type { GoogleConditionalRule, GoogleRgb } from "@/lib/google/sheets-api";

export const ID_HEADER = "Cubes ID";

/** Kept in app_sheet_sync_state under HEADER_STATE_KEY. */
export interface HeaderState {
  /** Column id → the header text Cubes last wrote for it. */
  labels: Record<string, string>;
  /** Header row styled, frozen and the id column protected. */
  formatted?: boolean;
  /** The dropdowns and colours Cubes last put on option columns. */
  rules?: OptionRulesState;
  /** How many rows carried a "Not in Cubes yet" note after the last run
   *  (row-notes.ts). Non-zero means the next run must look for them even if
   *  nothing is refused any more — to take them away. */
  refusals?: number;
}

/** What the last successful optionRuleRequests() apply left in Google. */
export interface OptionRulesState {
  /** rulesFingerprint() of what was applied; a different one means re-apply. */
  fp: string;
  /** The tab's row count then. Validation is a property of CELLS, so rows
   *  Google adds later (an append past the grid) do not have it until it is
   *  set again; a changed count re-sends the dropdowns, and nothing else. */
  rows: number;
  /** ruleMark() of every colour rule we added, so the next apply can find and
   *  delete exactly those — Google gives conditional formats no id. */
  marks: string[];
  /** Column ids we put a dropdown on, so one that stops being a fixed list
   *  has it cleared instead of keeping a list that now refuses free text. */
  validated: string[];
}

export const HEADER_STATE_KEY = "__cubes_headers__";

export interface HeaderLayout {
  /** Index of the "Cubes ID" column, or null when the tab has none. */
  idIndex: number | null;
  /** Google column index of each matched Cubes column. */
  colIndex: Map<string, number>;
  /** Header cells to rewrite because the Cubes column was renamed. */
  renames: { index: number; label: string; columnId: string }[];
  /** Cubes columns with no header in Google. */
  missing: string[];
  /** Index one past the last non-empty header cell. */
  width: number;
  /** True when row 1 is entirely empty (a new or cleared tab). */
  emptyHeader: boolean;
}

function headerText(cell: GoogleCell): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).trim();
}

function key(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Matches Google header cells to Cubes columns. First by current label (in
 * order, so two columns both called "Notes" pair up left to right), then by
 * the label Cubes last wrote (a rename in Cubes).
 */
export function matchHeaders(
  headerRow: GoogleCell[],
  columns: Pick<SheetColumn, "id" | "label">[],
  previous: HeaderState | null,
): HeaderLayout {
  const cells = headerRow.map(headerText);
  let width = 0;
  cells.forEach((c, i) => {
    if (c !== "") width = i + 1;
  });

  let idIndex: number | null = null;
  cells.forEach((c, i) => {
    if (idIndex === null && key(c) === key(ID_HEADER)) idIndex = i;
  });

  const colIndex = new Map<string, number>();
  const claimed = new Set<number>();
  if (idIndex !== null) claimed.add(idIndex);

  // Pass 1: current label.
  for (const col of columns) {
    const want = key(col.label);
    for (let i = 0; i < cells.length; i++) {
      if (claimed.has(i) || cells[i] === "") continue;
      if (key(cells[i]) === want) {
        colIndex.set(col.id, i);
        claimed.add(i);
        break;
      }
    }
  }

  // Pass 2: the label Cubes wrote last time (the column was renamed here).
  const renames: HeaderLayout["renames"] = [];
  if (previous) {
    for (const col of columns) {
      if (colIndex.has(col.id)) continue;
      const old = previous.labels[col.id];
      if (!old || key(old) === key(col.label)) continue;
      for (let i = 0; i < cells.length; i++) {
        if (claimed.has(i) || cells[i] === "") continue;
        if (key(cells[i]) === key(old)) {
          colIndex.set(col.id, i);
          claimed.add(i);
          renames.push({ index: i, label: col.label, columnId: col.id });
          break;
        }
      }
    }
  }

  const missing = columns.filter((c) => !colIndex.has(c.id)).map((c) => c.id);
  return { idIndex, colIndex, renames, missing, width, emptyHeader: width === 0 };
}

/** The Cubes ID as text: keys are strings, but Google may hand a numeric-looking
 *  one back as a number if someone retyped it. */
export function readKey(cell: GoogleCell): string | null {
  if (cell === null || cell === undefined) return null;
  const s = typeof cell === "number" ? (Number.isInteger(cell) ? cell.toFixed(0) : String(cell)) : String(cell);
  const t = s.trim();
  return t === "" ? null : t;
}

/**
 * Data rows (everything below row 1) → GoogleRow[] for sync-core, parsing each
 * matched cell with `parse`. Rows beyond the last non-empty one are not
 * returned by the Sheets API in the first place.
 */
export function parseRows(
  values: GoogleCell[][],
  layout: Pick<HeaderLayout, "idIndex" | "colIndex">,
  parse: (columnId: string, cell: GoogleCell) => CellInput,
): GoogleRow[] {
  const rows: GoogleRow[] = [];
  for (let r = 1; r < values.length; r++) {
    const line = values[r] ?? [];
    const cells: Record<string, CellInput> = {};
    for (const [colId, idx] of layout.colIndex) cells[colId] = parse(colId, line[idx]);
    rows.push({
      row: r - 1,
      key: layout.idIndex === null ? null : readKey(line[layout.idIndex]),
      cells,
    });
  }
  return rows;
}

/** A1 range quoting for a tab title ("Q3 plan" → "'Q3 plan'", "O'Brien" → "'O''Brien'"). */
export function quoteTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// -----------------------------------------------------------------------------
// Frozen columns
// -----------------------------------------------------------------------------

/** How far right the column that names a row may sit and still be frozen. */
const FREEZE_LOOKAHEAD = 2;

/**
 * How many columns Google should freeze so a row stays recognisable while
 * someone scrolls right through a wide sheet: "Cubes ID" plus the leading
 * columns up to and including the first plain-text one — the row's name
 * (Title, Task, Campaign, Idea) and the short column before it, if any
 * (Publish date, #). The id column cannot be skipped: Google only freezes from
 * the left edge.
 *
 * 0 when there is no text column in the first two, or when the tab is not laid
 * out the way Cubes lays it out (id in A, columns in sheet order): on a file
 * someone arranged themselves, a freeze would pin whatever happened to land on
 * the left.
 */
export function frozenColumnCount(
  columns: Pick<SheetColumn, "id" | "type">[],
  idIndex: number,
  index: ReadonlyMap<string, number>,
): number {
  if (idIndex !== 0) return 0;
  for (let i = 0; i < Math.min(FREEZE_LOOKAHEAD, columns.length); i++) {
    if (index.get(columns[i].id) !== i + 1) return 0;
    if (columns[i].type === "text") return i + 2;
  }
  return 0;
}

// -----------------------------------------------------------------------------
// Option columns: dropdowns and colours in Google
// -----------------------------------------------------------------------------
//
// Full members work IN the Google Sheet, so a select column has to behave
// there the way it does in Cubes: offer its options, refuse anything else in
// the cell (not just count it as "skipped" three minutes later), and show each
// option's colour. Google has no "select column", so it is built from two
// things a tab can carry: a strict ONE_OF_LIST data-validation rule (the
// dropdown) and one TEXT_EQ conditional-format rule per coloured option.

/** A column as the option rules see it. */
export interface OptionColumn {
  id: string;
  type: ColumnType;
  /** Where the column is in Google (0-based). */
  index: number;
  /** The column's FIXED options, or null when they are resolved at sync time
   *  (team members, Content Studio destinations and campaigns, task statuses…). */
  options: SelectOption[] | null;
}

export interface OptionColor {
  label: string;
  /** Cell fill, #rrggbb. */
  bg: string;
  /** Text colour on that fill, #rrggbb. */
  fg: string;
}

export interface OptionRule {
  columnId: string;
  index: number;
  /** Labels of a strict dropdown, or null for no dropdown. */
  list: string[] | null;
  colors: OptionColor[];
}

/**
 * Which columns get a dropdown and which get colours. Only FIXED lists:
 *
 *   Dynamic lists are skipped on purpose. A copy frozen into the file goes
 *   stale the moment a member joins or a campaign is added in Cubes, and a
 *   STRICT stale list would then refuse the correct new name in the cell until
 *   some later sync refreshed it — while a non-strict one only paints a warning
 *   on values that are fine. The sync already checks those columns against the
 *   live list on every run, so nothing wrong gets in either way.
 *
 *   A multi_select gets colours but no dropdown: Sheets v4's DataValidationRule
 *   has no field for Google's "allow multiple selections", and a strict single
 *   pick list would refuse every legitimate "Reel, Carousel" cell. Its colour
 *   rules match a cell holding exactly one option.
 *
 *   An empty list stays free-form, as it is in Cubes (values.ts: a custom
 *   select whose list is empty accepts what is typed).
 *
 * The labels are the column's options as Cubes shows them in Google — pass
 * them through data.ts valueContext, which numbers duplicate labels.
 */
export function optionRules(columns: OptionColumn[]): OptionRule[] {
  const out: OptionRule[] = [];
  for (const col of columns) {
    if (col.options === null) continue;
    if (col.type !== "select" && col.type !== "multi_select") continue;
    const opts = col.options.filter((o) => o.label.trim() !== "");
    if (opts.length === 0) continue;
    // "Formulas are not supported in the values" (ConditionType ONE_OF_LIST):
    // one such label would make Google refuse the whole batch, so that column
    // goes without a dropdown rather than stopping every other column's.
    const listable = col.type === "select" && opts.every((o) => !o.label.trimStart().startsWith("="));
    const colors: OptionColor[] = [];
    for (const o of opts) {
      const c = o.color ? chipColors(o.color) : null;
      if (c) colors.push({ label: o.label, ...c });
    }
    if (!listable && colors.length === 0) continue;
    out.push({ columnId: col.id, index: col.index, list: listable ? opts.map((o) => o.label) : null, colors });
  }
  return out;
}

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Share of the option colour in the cell fill — Cubes' chips tint the same way. */
const TINT = 0.18;
/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;

/**
 * The fill and text colour for an option colour. The raw colour is not usable
 * as a fill: most of the palette is too dark for Google's default black text.
 * So the fill is a light tint of it, and the text is the colour itself,
 * darkened step by step until it reads at 4.5:1 on that tint. Null for
 * anything that is not #rgb / #rrggbb (no rule rather than a wrong one).
 */
export function chipColors(hex: string): { bg: string; fg: string } | null {
  const c = parseHex(hex);
  if (!c) return null;
  // Rounded at every step: the contrast that counts is the one of the
  // #rrggbb Google stores, not of the floats before rounding.
  const bg = c.map((v) => Math.round(255 - (255 - v) * TINT)) as Rgb;
  let fg = c;
  for (let dark = 0; dark <= 1 && contrast(fg, bg) < MIN_CONTRAST; dark += 0.05) {
    fg = c.map((v) => Math.round(v * (1 - dark))) as Rgb;
  }
  return { bg: toHex(bg), fg: toHex(fg) };
}

/** Identifies one of OUR colour rules among everything on the tab. */
export function ruleMark(c: OptionColor): string {
  return JSON.stringify([c.label, c.bg.toLowerCase(), c.fg.toLowerCase()]);
}

/** Changes exactly when what Google should show changes. FNV-1a, 32-bit. */
export function rulesFingerprint(rules: OptionRule[]): string {
  const text = JSON.stringify(rules.map((r) => [r.columnId, r.index, r.list, r.colors.map((c) => [c.label, c.bg, c.fg])]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function googleColor(hex: string): { red: number; green: number; blue: number } {
  const [red, green, blue] = (parseHex(hex) ?? [0, 0, 0]).map((v) => v / 255);
  return { red, green, blue };
}

/** Google's Color back to #rrggbb. Google leaves zero channels out of its JSON. */
function hexOf(c: GoogleRgb | undefined): string | null {
  if (!c) return null;
  return toHex([c.red ?? 0, c.green ?? 0, c.blue ?? 0].map((v) => v * 255) as Rgb);
}

/** The mark of a rule Google returned, if it has the shape ours have. */
function markOf(rule: GoogleConditionalRule): string | null {
  const cond = rule.booleanRule?.condition;
  if (cond?.type !== "TEXT_EQ" || cond.values?.length !== 1) return null;
  const label = cond.values[0]?.userEnteredValue;
  const f = rule.booleanRule?.format;
  const bg = hexOf(f?.backgroundColorStyle?.rgbColor ?? f?.backgroundColor);
  const fg = hexOf(f?.textFormat?.foregroundColorStyle?.rgbColor ?? f?.textFormat?.foregroundColor);
  if (typeof label !== "string" || !bg || !fg) return null;
  return ruleMark({ label, bg, fg });
}

/**
 * The Sheets v4 batchUpdate requests that make the tab show `rules`.
 *
 *   clear     column indexes whose dropdown we set before and that no longer
 *             get one: setDataValidation with the rule omitted clears it.
 *   dropdowns setDataValidation per list column, rows 2 to the end (never the
 *             header). "The new data validation rule will overwrite any prior
 *             rule", so re-sending is idempotent. filteredRowsIncluded, or rows
 *             hidden by someone's filter would be left without one.
 *   colours   only when `existing` (the tab's conditionalFormats, as read) is
 *             given. Rules carry no id, so ours are recognised by their mark
 *             — the label, fill and text colour we wrote — from this apply or
 *             the last one (`forget`), and deleted bottom-up so the indexes
 *             stay valid; then ours are appended AFTER everything that stays,
 *             so a person's own rules keep priority over ours. A rule that
 *             merely looks like ours but in other colours is theirs, and stays.
 *
 * Deletes are by index, which the API offers no way to make conditional: a
 * person reordering rules in the moment between the read and this write could
 * shift one. That window is one round trip.
 */
export function optionRuleRequests(
  gid: number,
  rules: OptionRule[],
  opts: { existing: GoogleConditionalRule[] | null; forget: string[]; clear: number[] },
): unknown[] {
  const range = (index: number) => ({ sheetId: gid, startRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 });
  const requests: unknown[] = [];
  for (const index of opts.clear) requests.push({ setDataValidation: { range: range(index), filteredRowsIncluded: true } });
  for (const r of rules) {
    if (!r.list) continue;
    requests.push({
      setDataValidation: {
        range: range(r.index),
        rule: {
          condition: { type: "ONE_OF_LIST", values: r.list.map((label) => ({ userEnteredValue: label })) },
          strict: true,
          showCustomUi: true,
        },
        filteredRowsIncluded: true,
      },
    });
  }
  if (opts.existing) {
    const ours = new Set([...opts.forget, ...rules.flatMap((r) => r.colors.map(ruleMark))]);
    const drop: number[] = [];
    opts.existing.forEach((rule, i) => {
      const mark = markOf(rule);
      if (mark !== null && ours.has(mark)) drop.push(i);
    });
    for (const index of drop.reverse()) requests.push({ deleteConditionalFormatRule: { sheetId: gid, index } });
    let at = opts.existing.length - drop.length;
    for (const r of rules) {
      for (const c of r.colors) {
        requests.push({
          addConditionalFormatRule: {
            index: at++,
            rule: {
              ranges: [range(r.index)],
              booleanRule: {
                condition: { type: "TEXT_EQ", values: [{ userEnteredValue: c.label }] },
                format: {
                  backgroundColorStyle: { rgbColor: googleColor(c.bg) },
                  textFormat: { foregroundColorStyle: { rgbColor: googleColor(c.fg) } },
                },
              },
            },
          },
        });
      }
    }
  }
  return requests;
}
