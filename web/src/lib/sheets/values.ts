/**
 * Sheets app — one canonical form per column type, and the conversions between
 * it and the three places a value lives: the API (grid / adapters), Google
 * Sheets cells, and the sync snapshot.
 *
 * The three-way merge compares values from all three, so every comparison goes
 * through `equal` on CANONICAL values. If a value could come back from Google
 * in a slightly different shape than it went out (a trailing space, a datetime
 * with milliseconds, an array in another order), the merge would see a change
 * nobody made and push it back and forth forever. Canonicalizing both sides the
 * same way is what keeps a quiet sheet quiet.
 *
 * Canonical forms:
 *   text / long_text / url / email / phone  string (trimmed; "" -> null)
 *   number / currency / percent             finite number | null (percent as it reads: 12.5 = 12.5%)
 *   date                                    "YYYY-MM-DD" | null — a calendar day, never shifted through UTC
 *   datetime                                ISO instant at whole seconds, "…:SSZ" | null
 *   checkbox                                boolean (blank = false)
 *   select / person                         option value | null
 *   multi_select / people                   option value[] (deduplicated; order ignored by `equal`)
 *
 * Google layout: cells are written with valueInputOption USER_ENTERED, so a
 * date goes out as "YYYY-MM-DD" and Google stores a real date; text goes out
 * with a leading apostrophe (Google's "this is text" prefix, not stored) so
 * "00123", "=SUM(…)" or "1/2" stay exactly what was typed. Cells come back as
 * UNFORMATTED_VALUE with SERIAL_NUMBER dates. Selects show their LABEL in
 * Google — people read labels — and a label or a value is accepted back.
 *
 * Pure: type-only imports, so the node test harness runs it directly.
 */
import type { ColumnType, SelectOption } from "./types";

export interface ValueContext {
  /** Resolved options for select / multi_select / person / people. */
  options?: SelectOption[] | null;
  /**
   * When true an unknown option is an error; when false any text is accepted
   * as its own value. A select with a fixed option list is strict; a custom
   * select whose list is still empty is not (users build the list as they go).
   */
  strictOptions?: boolean;
  /** IANA zone for datetime <-> Google wall time. Default UTC. */
  timeZone?: string | null;
}

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/** A Google cell as the Sheets API returns it with UNFORMATTED_VALUE. */
export type GoogleCell = string | number | boolean | null | undefined;

/** Google caps a cell at 50,000 characters. */
export const GOOGLE_CELL_LIMIT = 50_000;

const DAY_MS = 86_400_000;
/** Google (and Lotus 1-2-3 before it) count days from 1899-12-30. */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

const TEXT_TYPES = new Set<ColumnType>(["text", "long_text", "url", "email", "phone"]);
const NUMBER_TYPES = new Set<ColumnType>(["number", "currency", "percent"]);
const MULTI_TYPES = new Set<ColumnType>(["multi_select", "people"]);
const SINGLE_OPTION_TYPES = new Set<ColumnType>(["select", "person"]);

export function isMultiType(type: ColumnType): boolean {
  return MULTI_TYPES.has(type);
}

export function isOptionType(type: ColumnType): boolean {
  return MULTI_TYPES.has(type) || SINGLE_OPTION_TYPES.has(type);
}

/** The canonical blank for a type — what an empty cell means. */
export function blankValue(type: ColumnType): unknown {
  if (type === "checkbox") return false;
  if (MULTI_TYPES.has(type)) return [];
  return null;
}

export function isBlank(type: ColumnType, value: unknown): boolean {
  const v = normalize(type, value);
  if (type === "checkbox") return v === false;
  if (Array.isArray(v)) return v.length === 0;
  return v === null;
}

// -----------------------------------------------------------------------------
// Dates and zones (no library: Intl is enough and keeps this module pure)
// -----------------------------------------------------------------------------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : "UTC";
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1 || y > 9999) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(ms: number, tz: string | null | undefined) {
  const z = zone(tz);
  let fmt = partsCache.get(z);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: z,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(z, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/**
 * The instant at which a zone's wall clock reads the given time. Two passes of
 * offset correction settle DST edges; a wall time that does not exist (spring
 * forward) lands just after the gap, which is what a person typing it meant.
 */
export function wallTimeToInstant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string | null | undefined,
): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = wall - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/** An instant's calendar day in a zone ("the user's day"). */
export function instantToDay(value: string | null | undefined, tz: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const p = zonedParts(ms, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local midnight of a calendar day in a zone, as an ISO instant — how the
 *  task drawer's date picker stores a picked day. */
export function dayToInstant(day: string | null | undefined, tz: string | null | undefined): string | null {
  if (!day) return null;
  const m = DAY_RE.exec(day);
  if (!m) return null;
  return new Date(wallTimeToInstant(+m[1], +m[2], +m[3], 0, 0, 0, tz)).toISOString();
}

/**
 * A Google serial only means a date inside the calendar Sheets itself uses
 * (0001-01-01 … 9999-12-31). Outside that it is somebody's measurement typed
 * into a date column, and turning it into a Date gives an invalid instant that
 * throws the moment Intl touches it — which would stop the whole sheet syncing
 * over one nonsense cell.
 */
const MIN_SERIAL = -693594;
const MAX_SERIAL = 2958465;

function serialInRange(serial: number): boolean {
  return Number.isFinite(serial) && serial >= MIN_SERIAL && serial <= MAX_SERIAL;
}

function serialToWallMs(serial: number): number | null {
  if (!serialInRange(serial)) return null;
  return SERIAL_EPOCH_MS + Math.round(serial * DAY_MS / 1000) * 1000;
}

export function serialToDay(serial: number): string | null {
  if (!serialInRange(serial)) return null;
  const t = new Date(SERIAL_EPOCH_MS + Math.floor(serial + 1e-9) * DAY_MS);
  if (!Number.isFinite(t.getTime())) return null;
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function dayToSerial(day: string): number | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - SERIAL_EPOCH_MS) / DAY_MS);
}

function canonicalInstant(ms: number): string {
  // Whole seconds: Google serials carry no more than that reliably, and a
  // millisecond difference must not read as an edit.
  return new Date(Math.round(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Date-like text → day. Accepts ISO days, ISO datetimes (their date part) and
 * YYYY/MM/DD. Deliberately NOT 03/04/2026: whether that is March or April
 * depends on who typed it, and guessing wrong silently moves a deadline.
 */
function parseDayText(text: string): string | null {
  const t = text.trim();
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  return validDay(y, mo, d) ? `${pad(y, 4)}-${pad(mo)}-${pad(d)}` : null;
}

/** Datetime text → instant ms. Offset/Z strings are absolute; bare wall times
 *  are read in `tz`. */
function parseDateTimeText(text: string, tz: string | null | undefined): number | null {
  const t = text.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t) && /\d{4}-\d{2}-\d{2}T/.test(t)) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(t);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (!validDay(y, mo, d)) return null;
  const h = m[4] ? +m[4] : 0;
  const mi = m[5] ? +m[5] : 0;
  const s = m[6] ? +m[6] : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  return wallTimeToInstant(y, mo, d, h, mi, s, tz);
}

// -----------------------------------------------------------------------------
// Numbers
// -----------------------------------------------------------------------------

/** "1,234.50", "₹ 1,200", "$-3", "12.5%", "(40)" → number. */
function parseNumberText(text: string): number | null {
  let t = text.trim();
  if (t === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  // A currency symbol or ISO code on either side ("₹ 1,200", "$-3", "1200 INR")
  // and a trailing percent sign are decoration; anything else makes it text.
  t = t.replace(/^(?:\p{Sc}|[A-Za-z]{3}\s)\s*/u, "").replace(/\s*(?:\p{Sc}|\s[A-Za-z]{3}|%)$/u, "");
  t = t.replace(/^([+-]?)\s*\p{Sc}\s*/u, "$1").replace(/[\s,]/g, "");
  if (t === "" || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function numbersEqual(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

function matchOption(text: string, options: SelectOption[] | null | undefined): string | null {
  if (!options || options.length === 0) return null;
  const t = text.trim();
  const byValue = options.find((o) => o.value === t);
  if (byValue) return byValue.value;
  const want = optionKey(t);
  const byLabel = options.find((o) => optionKey(o.label) === want);
  if (byLabel) return byLabel.value;
  const byValueCi = options.find((o) => optionKey(o.value) === want);
  return byValueCi ? byValueCi.value : null;
}

/** Case, runs of spaces and spacing around commas don't make a different option. */
function optionKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s*([,;])\s*/g, "$1").replace(/\s+/g, " ");
}

function optionLabel(value: string, options: SelectOption[] | null | undefined): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}

function uniqueStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    // Objects are not option values; String() would turn one into the literal
    // "[object Object]" and store that as a member or a label id.
    if (v === null || v === undefined || typeof v === "object") continue;
    const s = String(v).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// -----------------------------------------------------------------------------
// normalize / validate / equal
// -----------------------------------------------------------------------------

/**
 * Lenient canonicalization of a value that already came from Cubes (a DB row,
 * the snapshot, an adapter). Never throws; something that cannot be read as
 * the type becomes the type's blank. Use `validate` for values a PERSON sent.
 */
export function normalize(type: ColumnType, value: unknown): unknown {
  if (TEXT_TYPES.has(type)) {
    if (value === null || value === undefined) return null;
    // An object or array is not text: String() would make it "[object Object]"
    // and that string would then be pushed to Google and stored as the value.
    if (typeof value === "object") return null;
    const s = (typeof value === "string" ? value : String(value)).replace(/\r\n?/g, "\n").trim();
    return s === "" ? null : s;
  }
  if (NUMBER_TYPES.has(type)) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") return parseNumberText(value);
    return null;
  }
  switch (type) {
    case "date": {
      if (typeof value !== "string") return null;
      return parseDayText(value);
    }
    case "datetime": {
      if (typeof value !== "string" || value.trim() === "") return null;
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? canonicalInstant(ms) : null;
    }
    case "checkbox":
      return value === true || value === "true" || value === 1;
    case "select":
    case "person": {
      if (value === null || value === undefined || typeof value === "object") return null;
      const s = String(value).trim();
      return s === "" ? null : s;
    }
    case "multi_select":
    case "people": {
      if (Array.isArray(value)) return uniqueStrings(value);
      if (value === null || value === undefined || value === "") return [];
      return uniqueStrings([value]);
    }
  }
  return value ?? null;
}

/**
 * Strict check of a value a person sent from the grid (PATCH cells, new row).
 * Returns the canonical value or a message naming what is wrong.
 */
export function validate(type: ColumnType, value: unknown, ctx: ValueContext = {}): Parsed {
  if (value === undefined) return { ok: true, value: blankValue(type) };
  if (TEXT_TYPES.has(type)) {
    if (value !== null && typeof value !== "string" && typeof value !== "number") {
      return { ok: false, error: "Expected text." };
    }
    const v = normalize(type, value) as string | null;
    if (v !== null && v.length > GOOGLE_CELL_LIMIT) {
      return { ok: false, error: `Text is longer than ${GOOGLE_CELL_LIMIT.toLocaleString("en-US")} characters.` };
    }
    if (type === "email" && v !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return { ok: false, error: `“${v}” is not an email address.` };
    }
    return { ok: true, value: v };
  }
  if (NUMBER_TYPES.has(type)) {
    if (value === null || value === "") return { ok: true, value: null };
    const v = normalize(type, value);
    return v === null ? { ok: false, error: "Expected a number." } : { ok: true, value: v };
  }
  switch (type) {
    case "date": {
      if (value === null || value === "") return { ok: true, value: null };
      const v = normalize(type, value);
      return v === null ? { ok: false, error: "Expected a date (YYYY-MM-DD)." } : { ok: true, value: v };
    }
    case "datetime": {
      if (value === null || value === "") return { ok: true, value: null };
      const v = normalize(type, value);
      return v === null ? { ok: false, error: "Expected a date and time." } : { ok: true, value: v };
    }
    case "checkbox":
      if (value === null) return { ok: true, value: false };
      if (typeof value !== "boolean") return { ok: false, error: "Expected true or false." };
      return { ok: true, value };
    case "select":
    case "person": {
      const v = normalize(type, value) as string | null;
      if (v === null) return { ok: true, value: null };
      return checkOptions([v], ctx, false);
    }
    case "multi_select":
    case "people": {
      if (value !== null && !Array.isArray(value) && typeof value !== "string") {
        return { ok: false, error: "Expected a list." };
      }
      return checkOptions(normalize(type, value) as string[], ctx, true);
    }
  }
  return { ok: true, value };
}

function checkOptions(values: string[], ctx: ValueContext, multi: boolean): Parsed {
  const strict = ctx.strictOptions ?? Boolean(ctx.options && ctx.options.length > 0);
  if (strict) {
    const known = new Set((ctx.options ?? []).map((o) => o.value));
    const bad = values.find((v) => !known.has(v));
    if (bad !== undefined) return { ok: false, error: `“${bad}” is not one of this column's options.` };
  }
  return { ok: true, value: multi ? values : values[0] ?? null };
}

/**
 * The value as Google can actually hold it: a text longer than a cell's
 * 50,000-character limit is stored shortened, and comes back shortened.
 */
export function asStoredByGoogle(type: ColumnType, value: unknown): unknown {
  const v = normalize(type, value);
  if (!TEXT_TYPES.has(type) || typeof v !== "string" || v.length <= GOOGLE_CELL_LIMIT - 1) return v;
  return normalize(type, v.slice(0, GOOGLE_CELL_LIMIT - 1));
}

/**
 * Comparison for a CUBES value against a value that has been through Google.
 * Google shortening a too-long text is Google's limit, not somebody's edit —
 * reading it as one would write the shortened copy back over the real text on
 * the very next sync. Every other type compares exactly as `equal`.
 */
export function equalAfterGoogle(type: ColumnType, cubes: unknown, google: unknown): boolean {
  if (equal(type, cubes, google)) return true;
  if (!TEXT_TYPES.has(type)) return false;
  return equal(type, asStoredByGoogle(type, cubes), google);
}

/** Are two values the same for this type? Order of multi values is ignored. */
export function equal(type: ColumnType, a: unknown, b: unknown): boolean {
  const x = normalize(type, a);
  const y = normalize(type, b);
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) return false;
    const sx = [...x].sort();
    const sy = [...y].sort();
    return sx.every((v, i) => v === sy[i]);
  }
  if (typeof x === "number" && typeof y === "number") return numbersEqual(x, y);
  return x === y;
}

// -----------------------------------------------------------------------------
// Google
// -----------------------------------------------------------------------------

/** Text that must stay text in Google: the apostrophe prefix is Google's own
 *  "treat as text" marker under USER_ENTERED and is not stored in the cell. */
function asGoogleText(s: string): string {
  return "'" + (s.length > GOOGLE_CELL_LIMIT - 1 ? s.slice(0, GOOGLE_CELL_LIMIT - 1) : s);
}

/**
 * The cell value to send (valueInputOption USER_ENTERED) for a canonical value.
 * Blank → "" (clears the cell).
 */
export function toGoogle(type: ColumnType, value: unknown, ctx: ValueContext = {}): string | number | boolean {
  const v = normalize(type, value);
  if (type === "checkbox") return v === true;
  if (v === null || (Array.isArray(v) && v.length === 0)) return "";
  if (TEXT_TYPES.has(type)) return asGoogleText(v as string);
  if (NUMBER_TYPES.has(type)) return v as number;
  switch (type) {
    case "date":
      // An ISO day is parsed as a date by every Sheets locale.
      return v as string;
    case "datetime": {
      const p = zonedParts(Date.parse(v as string), ctx.timeZone);
      return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
    }
    case "select":
    case "person":
      return asGoogleText(optionLabel(v as string, ctx.options));
    case "multi_select":
    case "people":
      return asGoogleText((v as string[]).map((x) => optionLabel(x, ctx.options)).join(", "));
  }
  return String(v);
}

function cellText(cell: GoogleCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") {
    // Integers print without exponent up to 2^53; that covers phone numbers
    // typed without a leading +.
    return Number.isInteger(cell) && Math.abs(cell) < 2 ** 53 ? cell.toFixed(0) : String(cell);
  }
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return String(cell);
}

/** Is a raw Google cell empty? */
export function isBlankCell(cell: GoogleCell): boolean {
  return cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
}

/**
 * A Google cell → canonical value, or an error naming what is wrong (the sync
 * skips and counts those instead of writing garbage into Cubes).
 */
export function fromGoogle(type: ColumnType, cell: GoogleCell, ctx: ValueContext = {}): Parsed {
  if (isBlankCell(cell)) return { ok: true, value: blankValue(type) };

  if (TEXT_TYPES.has(type)) {
    const v = normalize(type, cellText(cell));
    if (type === "email" && v !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v as string)) {
      return { ok: false, error: `“${v}” is not an email address.` };
    }
    return { ok: true, value: v };
  }

  if (NUMBER_TYPES.has(type)) {
    if (typeof cell === "number") return { ok: true, value: cell };
    if (typeof cell === "boolean") return { ok: false, error: "Expected a number." };
    const n = parseNumberText(String(cell));
    return n === null ? { ok: false, error: `“${String(cell)}” is not a number.` } : { ok: true, value: n };
  }

  switch (type) {
    case "date": {
      const d = typeof cell === "number" ? serialToDay(cell) : typeof cell === "string" ? parseDayText(cell) : null;
      return d ? { ok: true, value: d } : { ok: false, error: `“${cellText(cell)}” is not a date (use YYYY-MM-DD).` };
    }
    case "datetime": {
      if (typeof cell === "number") {
        const wallMs = serialToWallMs(cell);
        if (wallMs === null) {
          return { ok: false, error: `“${cellText(cell)}” is not a date and time (use YYYY-MM-DD HH:MM).` };
        }
        const wall = new Date(wallMs);
        const ms = wallTimeToInstant(
          wall.getUTCFullYear(),
          wall.getUTCMonth() + 1,
          wall.getUTCDate(),
          wall.getUTCHours(),
          wall.getUTCMinutes(),
          wall.getUTCSeconds(),
          ctx.timeZone,
        );
        return { ok: true, value: canonicalInstant(ms) };
      }
      const ms = typeof cell === "string" ? parseDateTimeText(cell, ctx.timeZone) : null;
      return ms === null
        ? { ok: false, error: `“${cellText(cell)}” is not a date and time (use YYYY-MM-DD HH:MM).` }
        : { ok: true, value: canonicalInstant(ms) };
    }
    case "checkbox": {
      if (typeof cell === "boolean") return { ok: true, value: cell };
      if (typeof cell === "number") {
        if (cell === 1 || cell === 0) return { ok: true, value: cell === 1 };
        return { ok: false, error: "Expected a checkbox (TRUE / FALSE)." };
      }
      const t = String(cell).trim().toLowerCase();
      if (["true", "yes", "y", "1", "x", "✓", "✔", "checked", "done"].includes(t)) return { ok: true, value: true };
      if (["false", "no", "n", "0", "-", "unchecked"].includes(t)) return { ok: true, value: false };
      return { ok: false, error: `“${String(cell)}” is not TRUE or FALSE.` };
    }
    case "select":
    case "person": {
      const text = cellText(cell).trim();
      const hit = matchOption(text, ctx.options);
      if (hit !== null) return { ok: true, value: hit };
      return unknownOption([text], ctx, false);
    }
    case "multi_select":
    case "people": {
      const text = cellText(cell).trim();
      // A whole-cell match first: an option label may itself contain a comma.
      const whole = matchOption(text, ctx.options);
      if (whole !== null) return { ok: true, value: [whole] };
      // Split on separators, then rejoin neighbours greedily (longest first)
      // so "Live, Doe, John" still finds an option labelled "Doe, John".
      const parts = text.split(/[,\n;]/).map((p) => p.trim());
      const values: string[] = [];
      const unknown: string[] = [];
      let i = 0;
      while (i < parts.length) {
        if (parts[i] === "") {
          i++;
          continue;
        }
        let matched = false;
        for (let j = parts.length; j > i; j--) {
          const hit = matchOption(parts.slice(i, j).join(", "), ctx.options);
          if (hit !== null) {
            values.push(hit);
            i = j;
            matched = true;
            break;
          }
        }
        if (!matched) {
          unknown.push(parts[i]);
          i++;
        }
      }
      if (unknown.length > 0) {
        const r = unknownOption(unknown, ctx, true);
        if (!r.ok) return r;
        values.push(...(r.value as string[]));
      }
      return { ok: true, value: uniqueStrings(values) };
    }
  }
  return { ok: true, value: cellText(cell) };
}

function unknownOption(texts: string[], ctx: ValueContext, multi: boolean): Parsed {
  const strict = ctx.strictOptions ?? Boolean(ctx.options && ctx.options.length > 0);
  if (strict) {
    return { ok: false, error: `“${texts[0]}” is not one of this column's options.` };
  }
  return { ok: true, value: multi ? texts : texts[0] };
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
