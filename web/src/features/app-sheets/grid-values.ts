/**
 * Sheets grid — the pure half of the grid: how a cell value reads on screen,
 * how text pasted from Excel / Google Sheets becomes a typed value, and how a
 * sheet leaves as CSV.
 *
 * Kept free of React and of the Supabase client so the node test harness can
 * run it directly, and so the grid, the CSV export and the search box all
 * agree on what a cell "says" — a search for "Live" has to find the cell that
 * shows "Live", not the option value "live" hiding behind it.
 *
 * Stored value shapes follow src/lib/sheets/types.ts: dates are "YYYY-MM-DD"
 * (the user's day, never shifted through UTC), datetimes are ISO instants,
 * percent is the number as it reads (12.5 means 12.5%, the way Meta reports
 * CTR), person is a team_members.id and people / multi_select are arrays.
 */
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { ColumnType, SelectOption, SheetColumn } from "@/lib/sheets/types";

dayjs.extend(customParseFormat);

/** Who a person / people cell can point at. `value` is a team_members.id. */
export interface MemberLike {
  value: string;
  label: string;
  email?: string | null;
}

/** Everything a cell needs beyond its own value to be read or parsed. */
export interface CellContext {
  /** The column's resolved options (static, source-defined or dynamic). */
  options?: SelectOption[];
  members?: MemberLike[];
  /** Currency of money columns when the column does not name one. */
  currency?: string | null;
}

export type Coerced =
  | { ok: true; value: unknown; newOption?: SelectOption }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

export function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Structural equality good enough for cell values (scalars and string arrays). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
  }
  if (typeof a === "number" && typeof b === "number") return a === b;
  return a === b;
}

function toNumberish(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).map(String);
  if (isEmptyValue(value)) return [];
  return [String(value)];
}

const NUMBER_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function formatNumber(n: number): string {
  return NUMBER_FMT.format(n);
}

// Building an Intl.NumberFormat costs far more than using one; a search over
// a few thousand rows formats every money cell, so formatters are cached.
const CURRENCY_FMT = new Map<string, Intl.NumberFormat | null>();
const PLAIN_MONEY_FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function currencyFormatter(currency: string): Intl.NumberFormat | null {
  if (!CURRENCY_FMT.has(currency)) {
    let fmt: Intl.NumberFormat | null = null;
    try {
      fmt = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
    } catch {
      // An unknown code (a typo in the column editor) falls back to plain.
    }
    CURRENCY_FMT.set(currency, fmt);
  }
  return CURRENCY_FMT.get(currency) ?? null;
}

function formatCurrency(n: number, currency: string | null | undefined): string {
  const fmt = currency ? currencyFormatter(currency) : null;
  return (fmt ?? PLAIN_MONEY_FMT).format(n);
}

function optionLabel(value: string, options: SelectOption[] | undefined): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}

function memberLabel(value: string, members: MemberLike[] | undefined): string {
  return members?.find((m) => m.value === value)?.label ?? "Unknown member";
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/**
 * The text a cell shows. Also what search matches and what copy puts on the
 * clipboard, so the three can never disagree.
 */
export function formatCell(value: unknown, column: Pick<SheetColumn, "type" | "currency">, ctx: CellContext = {}): string {
  if (column.type === "checkbox") return value === true ? "Yes" : "";
  if (isEmptyValue(value)) return "";
  switch (column.type) {
    case "number": {
      const n = toNumberish(value);
      return n === null ? String(value) : formatNumber(n);
    }
    case "currency": {
      const n = toNumberish(value);
      return n === null ? String(value) : formatCurrency(n, column.currency ?? ctx.currency);
    }
    case "percent": {
      const n = toNumberish(value);
      return n === null ? String(value) : `${formatNumber(n)}%`;
    }
    case "date": {
      const d = dayjs(String(value), "YYYY-MM-DD", true);
      return d.isValid() ? d.format("D MMM YYYY") : String(value);
    }
    case "datetime": {
      const d = dayjs(String(value));
      return d.isValid() ? d.format("D MMM YYYY, HH:mm") : String(value);
    }
    case "select":
      return optionLabel(String(value), ctx.options);
    case "multi_select":
      return asArray(value).map((v) => optionLabel(v, ctx.options)).join(", ");
    case "person":
      return memberLabel(String(value), ctx.members);
    case "people":
      return asArray(value).map((v) => memberLabel(v, ctx.members)).join(", ");
    default:
      return String(value);
  }
}

/**
 * The text a cell exports as. Differs from `formatCell` where a spreadsheet
 * would otherwise mis-read it: numbers stay raw (no thousands separators, no
 * currency sign), dates stay ISO so Excel and Sheets parse them the same in
 * every locale, and booleans are TRUE / FALSE.
 */
export function exportCell(value: unknown, column: Pick<SheetColumn, "type" | "currency">, ctx: CellContext = {}): string {
  if (column.type === "checkbox") return value === true ? "TRUE" : "FALSE";
  if (isEmptyValue(value)) return "";
  switch (column.type) {
    case "number":
    case "currency":
    case "percent": {
      const n = toNumberish(value);
      return n === null ? String(value) : String(n);
    }
    case "date":
      return String(value);
    case "datetime": {
      const d = dayjs(String(value));
      return d.isValid() ? d.format("YYYY-MM-DD HH:mm") : String(value);
    }
    default:
      return formatCell(value, column, ctx);
  }
}

/* ------------------------------------------------------------------ *
 * Parsing pasted / typed text
 * ------------------------------------------------------------------ */

// dayjs strict parsing compares the re-formatted date with the input, so
// "05/03/2026" needs "DD/MM/YYYY" and "5/3/2026" needs "D/M/YYYY"; both
// spellings of every numeric form are listed.
const pad = (fmts: string[]) =>
  fmts.flatMap((f) => [f, f.replace(/\bD\b/g, "DD").replace(/\bM\b/g, "MM")]).filter((f, i, all) => all.indexOf(f) === i);

const DATE_FORMATS = pad([
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "YYYY.MM.DD",
  // Day-first before month-first: this product's teams write 05/03/2026 for
  // the 5th of March. A value that only parses month-first (13 in the second
  // slot) still lands via the later formats.
  "D/M/YYYY",
  "D-M-YYYY",
  "D.M.YYYY",
  "D/M/YY",
  "M/D/YYYY",
  "D MMM YYYY",
  "D MMMM YYYY",
  "D-MMM-YYYY",
  "D-MMM-YY",
  "MMM D YYYY",
  "MMMM D YYYY",
  "ddd, D MMM YYYY",
  "dddd, D MMMM YYYY",
]);

const DATETIME_FORMATS = pad([
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DDTHH:mm",
  "YYYY-MM-DDTHH:mm:ss",
  "YYYY-MM-DD h:mm A",
  "YYYY-MM-DD h:mm a",
  "D/M/YYYY HH:mm",
  "D/M/YYYY H:mm",
  "D/M/YYYY HH:mm:ss",
  "D/M/YYYY h:mm A",
  "D/M/YYYY h:mm a",
  "M/D/YYYY H:mm",
  "M/D/YYYY h:mm A",
  "D MMM YYYY, HH:mm",
  "D MMM YYYY HH:mm",
  "D MMM YYYY, h:mm A",
  "D MMM YYYY h:mm A",
  "MMM D, YYYY h:mm A",
  "MMM D YYYY HH:mm",
]);

/** Excel / Google serial day numbers (1899-12-30 epoch) for plausible dates. */
function fromSerial(n: number): dayjs.Dayjs | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const whole = Math.floor(n);
  const base = dayjs("1899-12-30", "YYYY-MM-DD", true).add(whole, "day");
  const minutes = Math.round((n - whole) * 24 * 60);
  return base.add(minutes, "minute");
}

/** "YYYY-MM-DD" in the user's own day, or null. */
export function parseDateText(text: string): string | null {
  const t = text.trim().replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1").replace(/,(?=\s*\d{4}$)/, "");
  if (!t) return null;
  for (const fmt of DATE_FORMATS) {
    const d = dayjs(t, fmt, true);
    if (d.isValid()) return d.format("YYYY-MM-DD");
  }
  // "2026-03-05T10:00:00Z" and friends: take the local day of that instant.
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = dayjs(t);
    if (d.isValid()) return d.format("YYYY-MM-DD");
  }
  if (/^\d+(\.\d+)?$/.test(t)) {
    const d = fromSerial(Number(t));
    if (d) return d.format("YYYY-MM-DD");
  }
  return null;
}

/** An ISO instant, read in the user's local zone when the text has none. */
export function parseDateTimeText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = dayjs(t);
    return d.isValid() ? d.toISOString() : null;
  }
  for (const fmt of DATETIME_FORMATS) {
    const d = dayjs(t, fmt, true);
    if (d.isValid()) return d.toISOString();
  }
  if (/^\d+(\.\d+)?$/.test(t)) {
    const d = fromSerial(Number(t));
    if (d) return d.toISOString();
  }
  // A bare date means the start of that day, local.
  const day = parseDateText(t);
  if (day) return dayjs(day, "YYYY-MM-DD", true).toISOString();
  return null;
}

/**
 * A number out of what spreadsheets actually put on the clipboard: thousands
 * separators (Western and Indian grouping), currency signs or codes, a
 * trailing %, accounting negatives "(1,200)", non-breaking spaces.
 */
export function parseNumberText(text: string): number | null {
  let t = text.replace(/[\s  ]/g, "");
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/^[A-Za-z]{3}(?=[-+\d.$€£₹¥])/, "").replace(/(?<=[\d.])[A-Za-z]{3}$/, "");
  t = t.replace(/[$€£₹¥]/g, "").replace(/%$/, "").replace(/,/g, "");
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "x", "✓", "✔", "checked", "on", "done"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "unchecked", "off", "-"]);

/** A stable option value for a label typed into a custom select column. */
export function optionValueFor(label: string, existing: SelectOption[] = []): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "option";
  const taken = new Set(existing.map((o) => o.value));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  }
}

function matchOption(text: string, options: SelectOption[]): SelectOption | undefined {
  const t = text.trim();
  const lower = t.toLowerCase();
  return (
    options.find((o) => o.value === t) ??
    options.find((o) => o.label.toLowerCase() === lower) ??
    options.find((o) => o.value.toLowerCase() === lower)
  );
}

function matchMember(text: string, members: MemberLike[]): MemberLike | undefined {
  const t = text.trim();
  const lower = t.toLowerCase();
  return (
    members.find((m) => m.value === t) ??
    members.find((m) => m.label.toLowerCase() === lower) ??
    members.find((m) => (m.email ?? "").toLowerCase() === lower)
  );
}

function splitList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CoerceOptions {
  /**
   * A custom (not source-bound, not dynamic) select column may grow a new
   * option from pasted text; everywhere else an unknown label is an error.
   */
  allowNewOptions?: boolean;
}

/**
 * Turns one pasted or typed string into the column's stored value. An empty
 * string clears the cell (a checkbox clears to false). Never throws.
 */
export function coerceCell(
  raw: string,
  column: Pick<SheetColumn, "type" | "label">,
  ctx: CellContext = {},
  opts: CoerceOptions = {},
): Coerced {
  const text = raw.replace(/\r/g, "");
  const trimmed = text.trim();
  const type: ColumnType = column.type;

  if (type === "checkbox") {
    const lower = trimmed.toLowerCase();
    if (lower === "" || FALSE_WORDS.has(lower)) return { ok: true, value: false };
    if (TRUE_WORDS.has(lower)) return { ok: true, value: true };
    return { ok: false, error: `"${trimmed}" is not yes/no` };
  }
  if (trimmed === "") {
    return { ok: true, value: type === "multi_select" || type === "people" ? [] : null };
  }

  switch (type) {
    case "text":
      return { ok: true, value: trimmed };
    case "long_text":
      // Keep inner line breaks; only the outer whitespace is noise.
      return { ok: true, value: text.replace(/^\s+|\s+$/g, "") };
    case "number":
    case "currency":
    case "percent": {
      const n = parseNumberText(trimmed);
      return n === null ? { ok: false, error: `"${trimmed}" is not a number` } : { ok: true, value: n };
    }
    case "date": {
      const d = parseDateText(trimmed);
      return d ? { ok: true, value: d } : { ok: false, error: `"${trimmed}" is not a date` };
    }
    case "datetime": {
      const d = parseDateTimeText(trimmed);
      return d ? { ok: true, value: d } : { ok: false, error: `"${trimmed}" is not a date and time` };
    }
    case "select": {
      const options = ctx.options ?? [];
      const hit = matchOption(trimmed, options);
      if (hit) return { ok: true, value: hit.value };
      if (opts.allowNewOptions) {
        const option = { value: optionValueFor(trimmed, options), label: trimmed };
        return { ok: true, value: option.value, newOption: option };
      }
      return { ok: false, error: `"${trimmed}" is not an option of ${column.label}` };
    }
    case "multi_select": {
      const options = ctx.options ?? [];
      const out: string[] = [];
      for (const part of splitList(trimmed)) {
        const hit = matchOption(part, options);
        if (!hit) return { ok: false, error: `"${part}" is not an option of ${column.label}` };
        if (!out.includes(hit.value)) out.push(hit.value);
      }
      return { ok: true, value: out };
    }
    case "person": {
      const hit = matchMember(trimmed, ctx.members ?? []);
      return hit ? { ok: true, value: hit.value } : { ok: false, error: `No team member called "${trimmed}"` };
    }
    case "people": {
      const out: string[] = [];
      for (const part of splitList(trimmed)) {
        const hit = matchMember(part, ctx.members ?? []);
        if (!hit) return { ok: false, error: `No team member called "${part}"` };
        if (!out.includes(hit.value)) out.push(hit.value);
      }
      return { ok: true, value: out };
    }
    case "url": {
      const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)
        ? trimmed
        : /^[^\s/]+\.[^\s]+$/.test(trimmed)
          ? `https://${trimmed}`
          : null;
      if (!candidate) return { ok: false, error: `"${trimmed}" is not a link` };
      try {
        const u = new URL(candidate);
        if (!["http:", "https:", "mailto:"].includes(u.protocol)) {
          return { ok: false, error: `"${trimmed}" is not a web link` };
        }
        return { ok: true, value: candidate };
      } catch {
        return { ok: false, error: `"${trimmed}" is not a link` };
      }
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, error: `"${trimmed}" is not an email address` };
    case "phone":
      return /^[+()\d][\d\s().\-/+]{3,}(\s*(x|ext\.?)\s*\d+)?$/i.test(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, error: `"${trimmed}" is not a phone number` };
    default:
      return { ok: true, value: trimmed };
  }
}

/* ------------------------------------------------------------------ *
 * TSV (clipboard) in and out
 * ------------------------------------------------------------------ */

/**
 * Splits clipboard text from Excel / Google Sheets into rows of cells. Both
 * quote a cell that holds a tab, a line break or a quote, doubling inner
 * quotes, so a quoted cell may span lines. A single trailing line break (both
 * apps add one) does not make an extra empty row.
 */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let atCellStart = true;
  while (i < src.length) {
    const ch = src[i];
    if (atCellStart && ch === '"') {
      // Quoted cell: runs to the closing quote that is not doubled.
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        value += src[j];
        j += 1;
      }
      // A stray quote that never closes, or is followed by more text, was
      // literal all along (e.g. 5" screen): read the cell raw instead.
      if (closed && (j >= src.length || src[j] === "\t" || src[j] === "\n")) {
        cell = value;
        i = j;
        atCellStart = false;
        continue;
      }
    }
    atCellStart = false;
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      atCellStart = true;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function tsvCell(text: string): string {
  return /["\t\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toTsv(matrix: string[][]): string {
  return matrix.map((r) => r.map(tsvCell).join("\t")).join("\n");
}

/* ------------------------------------------------------------------ *
 * CSV export
 * ------------------------------------------------------------------ */

/**
 * RFC 4180 quoting, plus a guard against formula injection: a text cell that
 * starts with = + - @ (or a tab / CR) would run as a formula when the file is
 * opened in Excel or Sheets, so it gets a leading apostrophe. Numbers are
 * exempt — "-12.5" is data, not a formula.
 */
export function csvEscape(text: string, { isNumber = false }: { isNumber?: boolean } = {}): string {
  let t = text;
  if (!isNumber && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const NUMERIC_TYPES = new Set<ColumnType>(["number", "currency", "percent"]);

/** A whole sheet as CSV (header row first, CRLF line ends as RFC 4180 asks). */
export function toCsv(
  columns: SheetColumn[],
  rows: { values: Record<string, unknown> }[],
  ctxFor: (column: SheetColumn) => CellContext,
): string {
  const header = columns.map((c) => csvEscape(c.label));
  const ctxs = columns.map(ctxFor);
  const lines = rows.map((row) =>
    columns
      .map((c, i) => {
        const text = exportCell(row.values[c.id], c, ctxs[i]);
        const isNumber = NUMERIC_TYPES.has(c.type) && parseNumberText(text) !== null;
        return csvEscape(text, { isNumber });
      })
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}

/* ------------------------------------------------------------------ *
 * Paste planning
 * ------------------------------------------------------------------ */

export interface PasteRange {
  /** Inclusive, in visible row / column order. */
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface PasteInput {
  matrix: string[][];
  /** Where the paste lands: the selection (or the single active cell). */
  range: PasteRange;
  columns: SheetColumn[];
  rows: { key: string; values: Record<string, unknown> }[];
  /** A reason string when the cell cannot be written, else null. */
  lockedReason: (rowIndex: number, column: SheetColumn) => string | null;
  /** Can a column be written on a row that does not exist yet? */
  writableOnCreate: (column: SheetColumn) => boolean;
  ctxFor: (column: SheetColumn) => CellContext;
  /** Custom select columns that may grow options from pasted labels. */
  allowNewOptions: (column: SheetColumn) => boolean;
  canCreateRows: boolean;
  /** Hard cap on rows a single paste may create. */
  maxNewRows?: number;
}

export interface PasteSkip {
  row: number;
  col: number;
  reason: string;
}

export interface PastePlan {
  updates: { key: string; columnId: string; value: unknown }[];
  creates: Record<string, unknown>[];
  newOptions: Record<string, SelectOption[]>;
  skipped: PasteSkip[];
  /** Rows that were in the clipboard but could not be created. */
  droppedRows: number;
}

/**
 * Maps a clipboard block onto the grid. A single copied value fills the whole
 * selected range (the spreadsheet habit of "copy one, select many, paste");
 * a block lands at the selection's top-left corner and runs as far as it
 * goes. Rows past the end become new rows when the source allows it. Locked
 * cells, columns off the right edge and unparseable values are skipped and
 * reported rather than aborting the whole paste.
 */
export function planPaste(input: PasteInput): PastePlan {
  const { matrix, range, columns, rows } = input;
  const plan: PastePlan = { updates: [], creates: [], newOptions: {}, skipped: [], droppedRows: 0 };
  if (matrix.length === 0) return plan;

  const single = matrix.length === 1 && matrix[0].length === 1;
  const height = single ? range.r1 - range.r0 + 1 : matrix.length;
  const width = single ? range.c1 - range.c0 + 1 : Math.max(...matrix.map((r) => r.length));
  const cellAt = (dr: number, dc: number) => (single ? matrix[0][0] : (matrix[dr]?.[dc] ?? ""));

  // Options grown during this paste, so the same new label maps to one value.
  const grown = new Map<string, SelectOption[]>();
  const coerceFor = (column: SheetColumn, text: string): Coerced => {
    const ctx = input.ctxFor(column);
    const extra = grown.get(column.id) ?? [];
    const options = [...(ctx.options ?? []), ...extra];
    const res = coerceCell(text, column, { ...ctx, options }, { allowNewOptions: input.allowNewOptions(column) });
    if (res.ok && res.newOption) {
      grown.set(column.id, [...extra, res.newOption]);
    }
    return res;
  };

  const maxNew = input.maxNewRows ?? 1000;
  for (let dr = 0; dr < height; dr += 1) {
    const r = range.r0 + dr;
    const existing = r < rows.length ? rows[r] : null;
    if (!existing && !input.canCreateRows) {
      plan.droppedRows += 1;
      continue;
    }
    if (!existing && plan.creates.length >= maxNew) {
      plan.droppedRows += 1;
      continue;
    }
    const createValues: Record<string, unknown> = {};
    let createHasValue = false;
    for (let dc = 0; dc < width; dc += 1) {
      const c = range.c0 + dc;
      const column = columns[c];
      if (!column) {
        plan.skipped.push({ row: r, col: c, reason: "Past the last column" });
        continue;
      }
      const text = cellAt(dr, dc);
      if (existing) {
        const locked = input.lockedReason(r, column);
        if (locked) {
          plan.skipped.push({ row: r, col: c, reason: locked });
          continue;
        }
      } else if (!input.writableOnCreate(column)) {
        if (text.trim() !== "") plan.skipped.push({ row: r, col: c, reason: `${column.label} can't be set on a new row` });
        continue;
      }
      const res = coerceFor(column, text);
      if (!res.ok) {
        plan.skipped.push({ row: r, col: c, reason: res.error });
        continue;
      }
      if (existing) {
        if (!valuesEqual(existing.values[column.id], res.value)) {
          plan.updates.push({ key: existing.key, columnId: column.id, value: res.value });
        }
      } else if (!isEmptyValue(res.value) && res.value !== false) {
        createValues[column.id] = res.value;
        createHasValue = true;
      }
    }
    if (!existing && createHasValue) plan.creates.push(createValues);
  }
  for (const [columnId, options] of grown) plan.newOptions[columnId] = options;
  return plan;
}
