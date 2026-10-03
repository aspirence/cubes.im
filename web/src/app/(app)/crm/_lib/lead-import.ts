/**
 * Lead import — the pure half: read a file (CSV, TSV, Excel .xlsx) or pasted
 * rows, guess which column is what, and turn every row into a lead draft the
 * import can write. No React, no Supabase: everything here is data in, data
 * out, so the dialog can re-run it on every mapping change.
 *
 * Where leads come from in practice, and what that means here:
 *   • Meta Lead Ads downloads — UTF-16 tab-separated with a BOM, columns like
 *     full_name / phone_number ("p:+91…") / campaign_name / form answers;
 *   • Google Sheets / Excel — .xlsx, or rows copied and pasted (tab-separated);
 *   • website forms, IndiaMART / JustDial exports, other CRMs — CSV with
 *     "Mobile No", "Contact Number", "Requirement", "Remarks"…
 * Unrecognised columns are kept: they default to "Add to note" and land on the
 * lead's note as "Column: value", so no answer on a form is lost. Bookkeeping
 * columns (ids, serial numbers) default to "Don't import".
 */

import { strFromU8, unzipSync } from "fflate";
import { CRM_LEAD_STATUSES, type CrmLeadStatus } from "@/features/app-crm/types";
import { parseDate } from "./paste-parse";

/* ------------------------------------------------------------ tables */

export interface ImportTable {
  /** Sheet name for workbooks; null for CSV / paste. */
  name: string | null;
  /** Every non-empty row, cells as text, the header row included. */
  rows: string[][];
}

export class LeadImportError extends Error {}

/** Accepted file types, for the picker. */
export const LEAD_IMPORT_ACCEPT = ".csv,.tsv,.txt,.xlsx";

/** Reads a dropped / picked file into one table per sheet (CSV: one). */
export async function readLeadFile(file: File): Promise<ImportTable[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls")) {
    throw new LeadImportError("Old .xls files can't be read — open it and save as .xlsx or CSV.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".xlsx") || isZip(bytes)) return readXlsx(bytes);
  if (bytes.length === 0) throw new LeadImportError("That file is empty.");
  return [{ name: null, rows: parseDelimited(decodeText(bytes)) }];
}

function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** UTF-16 (Meta's export) and UTF-8 by BOM; UTF-8 when valid; else Windows-1252 (old Excel CSVs). */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder("utf-8").decode(b.subarray(3));
  // UTF-16 without a BOM: every other byte of ASCII text is zero.
  if (b.length > 3 && b[1] === 0 && b[3] === 0 && b[0] !== 0) return new TextDecoder("utf-16le").decode(b);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("windows-1252").decode(b);
  }
}

/**
 * CSV / TSV / semicolon / pipe text into rows (RFC 4180 quoting, CRLF or LF).
 * The delimiter is the one that splits the first lines most consistently.
 */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return tidyRows(rows);
}

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  let best = ",";
  let bestScore = -1;
  for (const d of ["\t", ",", ";", "|"]) {
    const counts = lines.map((l) => splitCount(l, d));
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 100 + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitCount(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Trims cells, drops empty rows, pads rows to the widest one. */
function tidyRows(rows: string[][]): string[][] {
  const out = rows.map((r) => r.map((c) => c.replace(/\u0000/g, "").trim())).filter((r) => r.some((c) => c !== ""));
  const width = Math.max(0, ...out.map((r) => r.length));
  return out.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill("")] : r));
}

/* ------------------------------------------------------------- xlsx */

/**
 * A small .xlsx reader (a zip of XML): every sheet's cells as text. Shared and
 * inline strings, booleans and numbers; numbers in a date format become
 * YYYY-MM-DD. Formulas contribute their cached value.
 */
export function readXlsx(bytes: Uint8Array): ImportTable[] {
  if (typeof DOMParser === "undefined") throw new LeadImportError("Excel files can only be read in the browser.");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new LeadImportError("That doesn't look like a valid Excel file.");
  }
  const xml = (path: string): Document | null => {
    const f = files[path];
    return f ? new DOMParser().parseFromString(strFromU8(f), "application/xml") : null;
  };
  const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS("*", tag));

  const workbook = xml("xl/workbook.xml");
  if (!workbook) throw new LeadImportError("That Excel file has no workbook in it.");
  const date1904 = byTag(workbook, "workbookPr")[0]?.getAttribute("date1904") === "1";

  const rels = new Map<string, string>();
  const relDoc = xml("xl/_rels/workbook.xml.rels");
  for (const r of relDoc ? byTag(relDoc, "Relationship") : []) {
    const target = r.getAttribute("Target") ?? "";
    rels.set(r.getAttribute("Id") ?? "", target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }

  const shared: string[] = [];
  const sst = xml("xl/sharedStrings.xml");
  for (const si of sst ? byTag(sst, "si") : []) {
    shared.push(byTag(si, "t").map((t) => t.textContent ?? "").join(""));
  }

  // Which cell styles are dates: built-in date formats, or custom codes with
  // day/month/year tokens outside quotes and brackets.
  const dateStyles = new Set<number>();
  const styles = xml("xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    for (const f of byTag(styles, "numFmt")) custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "");
    const cellXfs = byTag(styles, "cellXfs")[0];
    const xfs = cellXfs ? Array.from(cellXfs.children).filter((c) => c.localName === "xf") : [];
    xfs.forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId") ?? 0);
      const code = custom.get(id);
      const builtinDate = (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
      const customDate = code ? /[dmyh]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, "")) : false;
      if (builtinDate || customDate) dateStyles.add(i);
    });
  }

  const tables: ImportTable[] = [];
  for (const sheet of byTag(workbook, "sheet")) {
    const rid = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? sheet.getAttribute("r:id") ?? "";
    const path = rels.get(rid);
    const doc = path ? xml(path) : null;
    if (!doc) continue;
    const rows: string[][] = [];
    for (const r of byTag(doc, "row")) {
      const rowIndex = Number(r.getAttribute("r") ?? rows.length + 1) - 1;
      const out: string[] = [];
      for (const c of Array.from(r.children).filter((n) => n.localName === "c")) {
        const ref = c.getAttribute("r") ?? "";
        const col = ref ? columnIndex(ref) : out.length;
        const type = c.getAttribute("t");
        const v = Array.from(c.children).find((n) => n.localName === "v")?.textContent ?? "";
        let text = "";
        if (type === "s") text = shared[Number(v)] ?? "";
        else if (type === "inlineStr") text = byTag(c, "t").map((t) => t.textContent ?? "").join("");
        else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
        else if (type === "str" || type === "e") text = v;
        else if (v !== "") {
          const n = Number(v);
          const style = Number(c.getAttribute("s") ?? -1);
          text = Number.isFinite(n) && dateStyles.has(style) ? excelDate(n, date1904) : numberText(v);
        }
        while (out.length < col) out.push("");
        out[col] = text;
      }
      while (rows.length < rowIndex) rows.push([]);
      rows[rowIndex] = out;
    }
    tables.push({ name: sheet.getAttribute("name"), rows: tidyRows(rows.map((r) => r ?? [])) });
  }
  if (!tables.length) throw new LeadImportError("No sheets found in that Excel file.");
  return tables;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial → YYYY-MM-DD (with a time part when it has one). */
function excelDate(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial * 86400000));
  const iso = d.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Keeps long digit runs (phone numbers stored as numbers) out of exponent form. */
function numberText(v: string): string {
  if (/e/i.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && Math.abs(n) < 1e21 && Number.isInteger(n)) return BigInt(Math.round(n)).toString();
  }
  return v;
}

/* ------------------------------------------------------------- fields */

export type LeadField =
  | "deal_name"
  | "full_name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "company"
  | "website"
  | "job_title"
  | "city"
  | "linkedin"
  | "stage"
  | "status"
  | "campaign"
  | "source"
  | "tags"
  | "notes"
  | "close_date"
  | "owner"
  | "lead_date";

/** Left out of the import entirely. */
export const IGNORE = "__ignore__" as const;
/** Kept on the lead's note as "Column: value" — where unrecognised columns go. */
export const TO_NOTE = "__note__" as const;
export type ColumnTarget = LeadField | typeof IGNORE | typeof TO_NOTE;

export function isColumnTarget(v: unknown): v is ColumnTarget {
  return v === IGNORE || v === TO_NOTE || LEAD_FIELDS.some((f) => f.key === v);
}

export interface LeadFieldMeta {
  key: LeadField;
  label: string;
  group: "Lead" | "Contact" | "Company";
  /** Several columns may feed it (their values are combined). */
  multi?: boolean;
  hint?: string;
}

export const LEAD_FIELDS: LeadFieldMeta[] = [
  { key: "deal_name", label: "Lead / deal name", group: "Lead", hint: "Falls back to the company or the person's name" },
  { key: "status", label: "Lead status", group: "Lead", hint: "New, Contacted, Follow up, Qualified…" },
  { key: "stage", label: "Pipeline stage", group: "Lead", hint: "Matched to your stages by name" },
  { key: "campaign", label: "Campaign", group: "Lead", hint: "Matched to your CRM campaigns by name" },
  { key: "source", label: "Source", group: "Lead", hint: "Facebook, Website, Referral…" },
  { key: "tags", label: "Tags", group: "Lead", multi: true, hint: "Comma-separated; matched to your tags" },
  { key: "notes", label: "Notes", group: "Lead", multi: true, hint: "Several columns can go into the note" },
  { key: "owner", label: "Owner", group: "Lead", hint: "A team member's name or email" },
  { key: "close_date", label: "Expected close date", group: "Lead" },
  { key: "lead_date", label: "Lead date", group: "Lead", hint: "When the lead came in (kept on the lead)" },
  { key: "full_name", label: "Full name", group: "Contact" },
  { key: "first_name", label: "First name", group: "Contact" },
  { key: "last_name", label: "Last name", group: "Contact" },
  { key: "phone", label: "Phone / mobile", group: "Contact" },
  { key: "email", label: "Email", group: "Contact" },
  { key: "job_title", label: "Job title", group: "Contact" },
  { key: "city", label: "City", group: "Contact" },
  { key: "linkedin", label: "LinkedIn", group: "Contact" },
  { key: "company", label: "Company", group: "Company" },
  { key: "website", label: "Website / domain", group: "Company" },
];

export const LEAD_FIELD_LABEL: Record<LeadField, string> = Object.fromEntries(
  LEAD_FIELDS.map((f) => [f.key, f.label]),
) as Record<LeadField, string>;

/** Header words → field. Checked in order; exact matches beat partial ones. */
const SYNONYMS: [LeadField, string[]][] = [
  ["email", ["email", "e mail", "email address", "email id", "mail", "mail id", "emailaddress"]],
  ["phone", ["phone", "phone number", "mobile", "mobile no", "mobile number", "contact", "contact no", "contact number", "whatsapp", "whatsapp number", "whatsapp no", "cell", "tel", "telephone", "number", "ph no", "phone no", "mob"]],
  ["first_name", ["first name", "firstname", "fname", "given name", "first"]],
  ["last_name", ["last name", "lastname", "lname", "surname", "family name", "last"]],
  ["full_name", ["full name", "fullname", "name", "lead name", "customer name", "client name", "contact name", "person", "naam", "your name", "buyer name"]],
  ["company", ["company", "company name", "organization", "organisation", "org", "business", "business name", "firm", "brand", "account", "account name"]],
  ["website", ["website", "domain", "url", "site", "web"]],
  ["job_title", ["job title", "title", "designation", "position", "role", "job"]],
  ["city", ["city", "location", "town", "district", "area", "state"]],
  ["linkedin", ["linkedin", "linkedin url", "linkedin profile"]],
  ["deal_name", ["deal", "deal name", "opportunity", "lead title", "subject", "requirement", "requirements", "interested in", "product", "service", "enquiry", "inquiry", "query"]],
  ["stage", ["stage", "pipeline stage", "deal stage"]],
  ["status", ["status", "lead status"]],
  ["campaign", ["campaign", "campaign name", "utm campaign", "adset", "adset name", "ad set", "ad set name", "ad", "ad name", "form", "form name"]],
  ["source", ["source", "lead source", "channel", "platform", "medium", "utm source", "utm_source"]],
  ["tags", ["tags", "tag", "labels", "label"]],
  ["notes", ["notes", "note", "comments", "comment", "remarks", "remark", "message", "description", "details", "feedback"]],
  ["owner", ["owner", "assigned to", "assignee", "sales rep", "agent", "salesperson", "lead owner"]],
  ["close_date", ["close date", "expected close", "expected close date", "closing date"]],
  ["lead_date", ["created", "created at", "created time", "created date", "date", "lead date", "timestamp", "submitted at", "submission date"]],
];

const MULTI = new Set(LEAD_FIELDS.filter((f) => f.multi).map((f) => f.key));

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_\-.:?#*()/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether the first row reads as column names rather than a lead. */
export function looksLikeHeader(row: string[]): boolean {
  if (!row.length) return false;
  const known = row.filter((c) => guessField(c, "exact") !== null).length;
  if (known >= 1) return true;
  const dataLike = row.filter((c) => EMAIL_RE.test(c) || digitsOf(c).length >= 7 || /^\d+([.,]\d+)?$/.test(c)).length;
  return dataLike === 0 && row.every((c) => c.length > 0 && c.length < 60);
}

/** The field a header names, and how strongly (lower rank = better). */
function scoreHeader(header: string): { field: LeadField; rank: number } | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  let best: { field: LeadField; rank: number } | null = null;
  for (const [field, words] of SYNONYMS) {
    const i = words.indexOf(h);
    if (i >= 0 && (!best || i < best.rank)) best = { field, rank: i };
  }
  if (best) return best;
  // Partial: a known phrase as a whole word inside a longer header
  // ("what is your budget", "customer mobile number"). Ranked after exact ones.
  for (const [field, words] of SYNONYMS) {
    const i = words.findIndex((w) => w.length > 3 && (h.startsWith(`${w} `) || h.endsWith(` ${w}`) || h.includes(` ${w} `)));
    if (i >= 0 && (!best || 1000 + i < best.rank)) best = { field, rank: 1000 + i };
  }
  return best;
}

function guessField(header: string, mode: "exact" | "partial"): LeadField | null {
  const s = scoreHeader(header);
  if (!s) return null;
  return mode === "exact" && s.rank >= 1000 ? null : s.field;
}

/**
 * Bookkeeping columns nobody wants on a lead's note: row ids and serial
 * numbers, and the id columns of a Meta export (ad_id, adset_id, form_id…)
 * that sit beside the names that are worth keeping.
 */
function isNoiseHeader(header: string): boolean {
  const h = normalizeHeader(header);
  return /^(id|#|s ?no|sr ?no|sl ?no|serial|serial no|row|row no|is organic)$/.test(h) || / id$/.test(h);
}

/**
 * What a column holds, judged by its values — for headerless pastes and for
 * headers we don't know ("Contact" is a phone column in one file and a name in
 * the next). Only the unambiguous shapes: emails and phone numbers.
 */
function guessFromValues(values: string[]): LeadField | null {
  const filled = values.map((v) => v.trim()).filter(Boolean).slice(0, 50);
  if (filled.length < 1) return null;
  const share = (test: (v: string) => boolean) => filled.filter(test).length / filled.length;
  if (share((v) => cleanEmail(v) !== null) >= 0.6) return "email";
  const phoneLike = (v: string) => {
    if (/[a-z]/i.test(v.replace(/^(p|tel|ph|mob)\s*:/i, ""))) return false;
    // Dates and amounts are digit runs too; a phone is 10–13 digits.
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(v)) return false;
    const n = digitsOf(v).length;
    return n >= 10 && n <= 13 && cleanPhone(v) !== null;
  };
  if (share(phoneLike) >= 0.6) return "phone";
  return null;
}

/**
 * A column → field guess per header. A single-value field goes to the column
 * that names it best ("campaign_name" beats "ad_name" for Campaign; exact
 * beats partial), ties to the leftmost; multi-value fields take every match.
 * Pass the data rows and a column whose header says nothing is still matched
 * by what it holds. Whatever is left goes to the note — or is skipped, for
 * id / serial-number columns.
 */
export function autoMap(headers: string[], rows: string[][] = []): ColumnTarget[] {
  const scores = headers.map(scoreHeader);
  const out: ColumnTarget[] = headers.map((h) => (isNoiseHeader(h) ? IGNORE : TO_NOTE));
  const bestFor = new Map<LeadField, number>();
  scores.forEach((s, i) => {
    if (!s) return;
    if (MULTI.has(s.field)) {
      out[i] = s.field;
      return;
    }
    const cur = bestFor.get(s.field);
    if (cur === undefined || s.rank < (scores[cur]?.rank ?? Infinity)) bestFor.set(s.field, i);
  });
  bestFor.forEach((i, f) => (out[i] = f));
  // A full name beside first/last columns would double up; send it to the note.
  if (out.includes("first_name") && out.includes("full_name")) {
    out.forEach((t, i) => {
      if (t === "full_name") out[i] = TO_NOTE;
    });
  }
  if (rows.length) {
    headers.forEach((_, i) => {
      if (out[i] !== TO_NOTE) return;
      const field = guessFromValues(rows.map((r) => r[i] ?? ""));
      if (field && !out.includes(field)) out[i] = field;
    });
  }
  return out;
}

/**
 * Mapping for a table with no header row: phones and emails by their values,
 * the rest to the note. The first text column that reads like a person's name
 * becomes Full name, so a pasted "Name / Phone" block still imports as people.
 */
export function autoMapHeaderless(rows: string[][]): ColumnTarget[] {
  const width = rows[0]?.length ?? 0;
  const out: ColumnTarget[] = Array.from({ length: width }, () => TO_NOTE);
  for (let i = 0; i < width; i++) {
    const field = guessFromValues(rows.map((r) => r[i] ?? ""));
    if (field && !out.includes(field)) out[i] = field;
  }
  const nameLike = (v: string) => /^[\p{L}.'’-]+(\s+[\p{L}.'’-]+){0,3}$/u.test(v.trim());
  for (let i = 0; i < width; i++) {
    if (out[i] !== TO_NOTE) continue;
    const filled = rows.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    if (filled.length && filled.filter(nameLike).length / filled.length >= 0.8) {
      out[i] = "full_name";
      break;
    }
  }
  return out;
}

/** A file layout's identity, for remembering how it was mapped last time. */
export function mappingSignature(headers: string[]): string {
  return headers.map(normalizeHeader).join("|");
}

/* --------------------------------------------------------- normalize */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

/** "p:+91 98765-43210" → "+919876543210"; null when it can't be a phone number. */
export function cleanPhone(raw: string): string | null {
  const t = raw.trim().replace(/^(p|tel|ph|mob)\s*:\s*/i, "");
  if (!t) return null;
  const plus = t.startsWith("+") || t.startsWith("00");
  const digits = digitsOf(t).replace(/^00/, "");
  if (digits.length < 6 || digits.length > 16) return null;
  return (plus ? "+" : "") + digits;
}

/** The last 10 digits: how two spellings of one number are recognised as the same. */
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = digitsOf(phone);
  return d.length >= 6 ? d.slice(-10) : null;
}

export function cleanEmail(raw: string): string | null {
  const t = raw.trim().replace(/^mailto:/i, "").toLowerCase();
  return EMAIL_RE.test(t) ? t : null;
}

export function matchLeadStatus(raw: string): CrmLeadStatus | null {
  const t = normalizeHeader(raw).replace(/\s/g, "");
  if (!t) return null;
  for (const s of CRM_LEAD_STATUSES) {
    if (s.value.replace(/_/g, "") === t || s.label.toLowerCase().replace(/\s/g, "") === t) return s.value;
  }
  const aliases: Record<string, CrmLeadStatus> = {
    fresh: "new",
    open: "new",
    // Meta's lead_status column says CREATED on every lead it hands over.
    created: "new",
    newlead: "new",
    pending: "new",
    notcontacted: "new",
    called: "contacted",
    connected: "contacted",
    followup: "follow_up",
    callback: "follow_up",
    callbacklater: "follow_up",
    rnr: "follow_up",
    ringing: "follow_up",
    noanswer: "follow_up",
    notreachable: "follow_up",
    switchedoff: "follow_up",
    busy: "follow_up",
    warm: "follow_up",
    interested: "qualified",
    hot: "qualified",
    won: "converted",
    closed: "converted",
    closedwon: "converted",
    booked: "converted",
    sold: "converted",
    paid: "converted",
    enrolled: "converted",
    notinterested: "not_interested",
    lost: "not_interested",
    closedlost: "not_interested",
    rejected: "not_interested",
    dnd: "not_interested",
    spam: "junk",
    invalid: "junk",
    fake: "junk",
    wrongnumber: "junk",
    duplicate: "junk",
    test: "junk",
  };
  return aliases[t] ?? null;
}

/**
 * The moment a lead came in, as an ISO timestamp: full date-times keep their
 * time (Meta's "2026-09-28T10:15:00+05:30", Excel's "2026-09-28 10:15"); a bare
 * date lands at local noon, so it reads as that day in every nearby timezone.
 * Null when it can't be read, or when it is more than a day in the future —
 * a typo, not a lead from tomorrow.
 */
export function parseLeadMoment(raw: string, now: Date = new Date()): string | null {
  const t = raw.trim();
  if (!t) return null;
  let at: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(t)) {
    const ms = Date.parse(t.replace(" ", "T"));
    if (Number.isFinite(ms)) at = new Date(ms);
  }
  if (!at) {
    const day = parseDate(t);
    if (day) {
      const [y, m, d] = day.split("-").map(Number);
      at = new Date(y, m - 1, d, 12);
    }
  }
  if (!at || Number.isNaN(at.getTime())) return null;
  if (at.getTime() > now.getTime() + 86_400_000) return null;
  return at.toISOString();
}

const SOURCE_ALIASES: Record<string, string> = {
  fb: "Facebook",
  facebook: "Facebook",
  "facebook ads": "Facebook",
  "facebook lead ads": "Facebook",
  meta: "Meta",
  "meta ads": "Meta",
  ig: "Instagram",
  insta: "Instagram",
  instagram: "Instagram",
  wa: "WhatsApp",
  whatsapp: "WhatsApp",
  google: "Google",
  "google ads": "Google Ads",
  adwords: "Google Ads",
  gmb: "Google Business",
  web: "Website",
  site: "Website",
  website: "Website",
  "website form": "Website",
  indiamart: "IndiaMART",
  "india mart": "IndiaMART",
  justdial: "JustDial",
  "just dial": "JustDial",
  jd: "JustDial",
  referral: "Referral",
  reference: "Referral",
  "walk in": "Walk-in",
  walkin: "Walk-in",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  email: "Email",
  "cold call": "Cold call",
};

/** "fb" → "Facebook", "ig" → "Instagram"; anything else as typed (trimmed). */
export function normalizeSource(raw: string): string {
  const t = raw.trim();
  return (SOURCE_ALIASES[normalizeHeader(t)] ?? t).slice(0, 60);
}

export function splitTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,;|\n]/)
        .map((t) => t.trim())
        .filter((t) => t && t.length <= 60),
    ),
  );
}

/* ------------------------------------------------------------- drafts */

export interface LeadDraft {
  /** 1-based row number in the file (header row counted), for messages. */
  row: number;
  dealName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  jobTitle: string | null;
  city: string | null;
  linkedin: string | null;
  stageName: string | null;
  status: CrmLeadStatus | null;
  statusRaw: string | null;
  campaignName: string | null;
  source: string | null;
  tags: string[];
  ownerRaw: string | null;
  closeDate: string | null;
  leadDate: string | null;
  /** When the lead came in, as a timestamp — see `parseLeadMoment`. */
  leadAt: string | null;
  /** The combined note: Notes columns as they are, then "Column: value" lines. */
  note: string | null;
  /** Things that were dropped or couldn't be read, per row. */
  warnings: string[];
  /** Set when the row can't become a lead at all. */
  error: string | null;
}

export function buildDrafts(
  rows: string[][],
  headers: string[],
  mapping: ColumnTarget[],
  opts: { firstRow: number },
): LeadDraft[] {
  return rows.map((cells, i) => {
    const warnings: string[] = [];
    const get = (f: LeadField): string[] =>
      mapping.flatMap((t, c) => (t === f && (cells[c] ?? "").trim() ? [(cells[c] ?? "").trim()] : []));
    const one = (f: LeadField): string | null => get(f)[0] ?? null;

    let firstName = one("first_name") ?? "";
    let lastName = one("last_name") ?? "";
    const full = one("full_name");
    if (!firstName && !lastName && full) {
      // "Sharma, Rohit" — the directory spelling — is Rohit Sharma.
      const flipped = /^([^,\d]+),\s*([^,\d]+)$/.exec(full);
      if (flipped) {
        firstName = flipped[2].trim();
        lastName = flipped[1].trim();
      } else {
        const [first, ...rest] = full.split(/\s+/);
        firstName = first ?? "";
        lastName = rest.join(" ");
      }
    }

    const phoneRaw = one("phone");
    const phone = phoneRaw ? cleanPhone(phoneRaw) : null;
    if (phoneRaw && !phone) warnings.push(`Phone "${phoneRaw}" doesn't look like a number — left out`);
    const emailRaw = one("email");
    const email = emailRaw ? cleanEmail(emailRaw) : null;
    if (emailRaw && !email) warnings.push(`Email "${emailRaw}" isn't valid — left out`);


    const statusRaw = one("status");
    const status = statusRaw ? matchLeadStatus(statusRaw) : null;
    if (statusRaw && !status) warnings.push(`Status "${statusRaw}" isn't a lead status — the default is used`);

    const closeRaw = one("close_date");
    const closeDate = closeRaw ? parseDate(closeRaw) : null;
    if (closeRaw && !closeDate) warnings.push(`Close date "${closeRaw}" couldn't be read`);
    const leadDateRaw = one("lead_date");
    const iso = leadDateRaw ? /^\d{4}-\d{2}-\d{2}/.exec(leadDateRaw) : null;
    const leadDate = leadDateRaw ? (iso ? iso[0] : (parseDate(leadDateRaw) ?? leadDateRaw.slice(0, 40))) : null;
    const leadAt = leadDateRaw ? parseLeadMoment(leadDateRaw) : null;
    if (leadDateRaw && !leadAt) warnings.push(`Lead date "${leadDateRaw}" couldn't be read — the import time is used`);

    const company = one("company");
    const website = one("website");
    const name = [firstName, lastName].filter(Boolean).join(" ");
    const dealNameRaw = one("deal_name");
    const dealName = (dealNameRaw || company || name || email || phone || "").slice(0, 300);

    const noteParts = get("notes");
    mapping.forEach((t, c) => {
      const v = (cells[c] ?? "").trim();
      if (t === TO_NOTE && v) noteParts.push(`${headers[c] || `Column ${c + 1}`}: ${v}`);
    });
    const note = noteParts.length ? noteParts.join("\n") : null;

    const error = !dealName ? "No name, phone, email or company in this row" : null;

    return {
      row: opts.firstRow + i,
      dealName,
      firstName: firstName.slice(0, 150),
      lastName: lastName.slice(0, 150),
      email,
      phone,
      company: company ? company.slice(0, 300) : null,
      website: website ? website.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").slice(0, 200) : null,
      jobTitle: one("job_title"),
      city: one("city"),
      linkedin: one("linkedin"),
      stageName: one("stage"),
      status,
      statusRaw,
      campaignName: one("campaign"),
      source: one("source"),
      tags: get("tags").flatMap(splitTags),
      ownerRaw: one("owner"),
      closeDate,
      leadDate,
      leadAt,
      note,
      warnings,
      error,
    };
  });
}

/* --------------------------------------------------------- duplicates */

export interface ExistingLeadIndex {
  /** Live people filed under the import's project. */
  people: { id: string; email: string | null; phone: string | null }[];
  /** Live deals filed under the import's project, with their contact's email/phone. */
  deals: { id: string; name: string; phone: string | null; contactEmail: string | null; contactPhone: string | null }[];
}

export interface DraftMatch {
  /** A person already in the CRM (same project) with this email or phone. */
  personId: string | null;
  /** A deal already in the CRM (same project) for this email or phone. */
  dealId: string | null;
  dealName: string | null;
  /** An earlier row in the file with the same email or phone (row number). */
  sameAsRow: number | null;
}

export function matchDrafts(drafts: LeadDraft[], existing: ExistingLeadIndex): DraftMatch[] {
  const personByEmail = new Map<string, string>();
  const personByPhone = new Map<string, string>();
  for (const p of existing.people) {
    if (p.email) personByEmail.set(p.email.toLowerCase(), p.id);
    const k = phoneKey(p.phone);
    if (k) personByPhone.set(k, p.id);
  }
  const dealByEmail = new Map<string, { id: string; name: string }>();
  const dealByPhone = new Map<string, { id: string; name: string }>();
  for (const d of existing.deals) {
    if (d.contactEmail) dealByEmail.set(d.contactEmail.toLowerCase(), d);
    for (const k of [phoneKey(d.phone), phoneKey(d.contactPhone)]) if (k) dealByPhone.set(k, d);
  }
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  return drafts.map((d) => {
    const pk = phoneKey(d.phone);
    const deal = (d.email && dealByEmail.get(d.email)) || (pk && dealByPhone.get(pk)) || null;
    const personId = (d.email && personByEmail.get(d.email)) || (pk && personByPhone.get(pk)) || null;
    const sameAsRow = (d.email && seenEmail.get(d.email)) || (pk && seenPhone.get(pk)) || null;
    if (!d.error) {
      if (d.email && !seenEmail.has(d.email)) seenEmail.set(d.email, d.row);
      if (pk && !seenPhone.has(pk)) seenPhone.set(pk, d.row);
    }
    return { personId, dealId: deal ? deal.id : null, dealName: deal ? deal.name : null, sameAsRow };
  });
}

/* ------------------------------------------------------ column checks */

export interface ColumnCheck {
  /** Rows with something in this column. */
  filled: number;
  /** Filled values the chosen field can't use (they'll be left out). */
  invalid: number;
  /** The first such value, to show what went wrong. */
  example: string | null;
}

/**
 * How well a column's values fit the field it is mapped to — the mapping
 * screen's "12 of these aren't phone numbers", before anything is written.
 */
export function checkColumn(values: string[], target: ColumnTarget): ColumnCheck {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  const reads: Partial<Record<LeadField, (v: string) => boolean>> = {
    phone: (v) => cleanPhone(v) !== null,
    email: (v) => cleanEmail(v) !== null,
    status: (v) => matchLeadStatus(v) !== null,
    close_date: (v) => parseDate(v) !== null,
    lead_date: (v) => parseLeadMoment(v) !== null,
  };
  const test = target !== IGNORE && target !== TO_NOTE ? reads[target] : undefined;
  if (!test) return { filled: filled.length, invalid: 0, example: null };
  const bad = filled.filter((v) => !test(v));
  return { filled: filled.length, invalid: bad.length, example: bad[0] ?? null };
}

/* ------------------------------------------------------- import batches */

export interface ImportRef {
  importId: string;
  file: string | null;
  /** The lead's row in the file (header counted), for file-order sorting. */
  row: number | null;
  importedAt: string | null;
}

/** The import a deal came from, read off its `source_ref` (null if it wasn't imported). */
export function importRefOf(sourceRef: unknown): ImportRef | null {
  if (!sourceRef || typeof sourceRef !== "object" || Array.isArray(sourceRef)) return null;
  const r = sourceRef as Record<string, unknown>;
  if (typeof r.import_id !== "string" || !r.import_id) return null;
  return {
    importId: r.import_id,
    file: typeof r.file === "string" ? r.file : null,
    row: typeof r.row === "number" ? r.row : null,
    importedAt: typeof r.imported_at === "string" ? r.imported_at : null,
  };
}

/**
 * Whether pasted text is a block of spreadsheet rows (several tab-separated
 * lines of the same width) rather than one lead — the CRM pages send those
 * to the importer instead of the single-deal form.
 */
export function looksLikePastedTable(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  const widths = lines.map((l) => l.split("\t").length);
  if (widths.some((w) => w < 2)) return false;
  const same = widths.filter((w) => w === widths[0]).length;
  if (same / widths.length < 0.8) return false;
  return lines.length >= 3 || looksLikeHeader(lines[0].split("\t").map((c) => c.trim()));
}

/** Rows back to CSV (skipped rows download). */
export function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\r\n");
}
