/**
 * Clipboard → deal parser. Sales people copy a lead out of an email, a
 * spreadsheet row, a WhatsApp message or a signature block; this reads that
 * blob and guesses the deal's fields so the create dialog opens pre-filled.
 *
 * Deliberately conservative: a field is only claimed on a strong signal (an
 * explicit label, an @, a parseable date). A wrong guess
 * costs the user an edit, so silence beats invention — everything lands in an
 * editable form anyway.
 */

import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

export interface ParsedDeal {
  /** Deal title — the first line that isn't another field in disguise. */
  name: string | null;
  /** YYYY-MM-DD. */
  closeDate: string | null;
  email: string | null;
  phone: string | null;
  personName: string | null;
  companyName: string | null;
  /** Bare host, lowercased, no www. */
  domain: string | null;
  /** The original text, so the dialog can show what was pasted. */
  raw: string;
}

type ParsedFields = Omit<ParsedDeal, "raw">;

const EMPTY: ParsedFields = {
  name: null,
  closeDate: null,
  email: null,
  phone: null,
  personName: null,
  companyName: null,
  domain: null,
};

/* ------------------------------------------------------------------ atoms */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const EMAIL_RE_G = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** Loose international phone; the digit-count guard below rejects the rest. */
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s.-]){1,4}\d{2,6}/;
/** The last label must be an alphabetic TLD, or "2.5 lakh" reads as a host. */
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,24})\b(?:\/\S*)?/i;
/** Dates must be removed before the phone scan or 2026-08-15 reads as a number. */
const DATEISH_RE = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g;

/** Hosts that identify a person's mail provider, never their company. */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "rediffmail.com",
  "zoho.com",
]);
/** Bare domains that are never the prospect's own site. */
const IGNORED_HOSTS = new Set(["linkedin.com", "twitter.com", "x.com", "facebook.com"]);

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR",
};
const CODE_ALT = ["USD", "EUR", "GBP", "INR", "AED", "AUD", "CAD", "SGD"].join("|");
const MULT_ALT = "k|m|cr|crore|lakh|lac|l";

/** A number carrying a currency marker or a k/m/lakh/crore multiplier. */
const MONEY_RE = new RegExp(
  [
    // ₹1,20,000  ·  $50k
    `([$€£₹])\\s*(\\d[\\d,\\s]*(?:\\.\\d+)?)\\s*(${MULT_ALT})?\\b`,
    // 50,000 USD  ·  1.2m usd
    `(\\d[\\d,\\s]*(?:\\.\\d+)?)\\s*(${MULT_ALT})?\\s*(${CODE_ALT})\\b`,
    // USD 50,000
    `(${CODE_ALT})\\s*(\\d[\\d,\\s]*(?:\\.\\d+)?)\\s*(${MULT_ALT})?\\b`,
    // 50k  ·  2.5 crore — the multiplier alone is the signal
    `(\\d[\\d,\\s]*(?:\\.\\d+)?)\\s*(k|m|cr|crore|lakh|lac)\\b`,
  ].join("|"),
  "i",
);

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  l: 100_000,
  lakh: 100_000,
  lac: 100_000,
  cr: 10_000_000,
  crore: 10_000_000,
};

const DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "DD/MM/YYYY",
  "DD-MM-YYYY",
  "DD.MM.YYYY",
  "MM/DD/YYYY",
  "D MMM YYYY",
  "D MMMM YYYY",
  "MMM D YYYY",
  "MMMM D YYYY",
  "D MMM YY",
  "DD/MM/YY",
];

/* ------------------------------------------------------------- primitives */

/** "1,20,000" → 120000, applying a k/m/lakh/crore multiplier when present. */
function toNumber(digits: string, multiplier?: string | null): number | null {
  const base = Number.parseFloat(digits.replace(/[,\s]/g, ""));
  if (!Number.isFinite(base)) return null;
  const mult = multiplier ? MULTIPLIERS[multiplier.toLowerCase()] : undefined;
  return Math.round(base * (mult ?? 1));
}

/** True when `re` covers most of `line` — i.e. the line IS that thing. */
function isMostly(line: string, re: RegExp): boolean {
  const hit = re.exec(line);
  return Boolean(hit && hit[0].length >= line.trim().length * 0.6);
}

/**
 * The first money-looking value in `text`, with its currency when stated.
 * Deals carry no money — this survives purely as a *detector*, so a price is
 * never mistaken for a phone number, a deal name or a company.
 */
export function parseMoney(
  text: string,
): { amount: number; currencyCode: string | null } | null {
  const m = MONEY_RE.exec(text);
  if (!m) return null;
  // Each alternative writes to its own capture slots; take whichever fired.
  const [, sym, symNum, symMult, numA, multA, codeA, codeB, numB, multB, numC, multC] = m;
  if (sym) {
    const amount = toNumber(symNum, symMult);
    return amount === null ? null : { amount, currencyCode: CURRENCY_SYMBOLS[sym] ?? null };
  }
  if (codeA) {
    const amount = toNumber(numA, multA);
    return amount === null ? null : { amount, currencyCode: codeA.toUpperCase() };
  }
  if (codeB) {
    const amount = toNumber(numB, multB);
    return amount === null ? null : { amount, currencyCode: codeB.toUpperCase() };
  }
  if (numC) {
    const amount = toNumber(numC, multC);
    return amount === null ? null : { amount, currencyCode: null };
  }
  return null;
}

/** Explicit date formats plus the few relative phrases sales actually types. */
export function parseDate(text: string, now: Dayjs = dayjs()): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const endOfQuarter = now.add(2 - (now.month() % 3), "month").endOf("month");
  const relative: Record<string, Dayjs> = {
    today: now,
    tomorrow: now.add(1, "day"),
    "next week": now.add(1, "week"),
    "next month": now.add(1, "month"),
    "end of month": now.endOf("month"),
    eom: now.endOf("month"),
    "end of quarter": endOfQuarter,
    eoq: endOfQuarter,
  };
  for (const [phrase, value] of Object.entries(relative)) {
    if (new RegExp(`\\b${phrase}\\b`).test(t)) return value.format("YYYY-MM-DD");
  }
  const inN = /\bin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/.exec(t);
  if (inN) {
    const unit = inN[2].replace(/s$/, "") as "day" | "week" | "month";
    return now.add(Number.parseInt(inN[1], 10), unit).format("YYYY-MM-DD");
  }

  // Drop an ordinal suffix ("15th Aug 2026") so the formats below match.
  const candidate = text.trim().replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  for (const fmt of DATE_FORMATS) {
    if (dayjs(candidate, fmt, true).isValid()) {
      return dayjs(candidate, fmt, true).format("YYYY-MM-DD");
    }
  }
  // Last resort: a date embedded in a longer sentence.
  const embedded =
    /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}\s+[a-z]{3,9}\s+\d{4}\b|\b[a-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/i.exec(
      candidate,
    );
  if (embedded) {
    const hit = embedded[0].replace(/,/g, "");
    for (const fmt of DATE_FORMATS) {
      if (dayjs(hit, fmt, true).isValid()) {
        return dayjs(hit, fmt, true).format("YYYY-MM-DD");
      }
    }
  }
  return null;
}

/** "john.doe@acme.com" → "John Doe" (null when the local part isn't a name). */
export function nameFromEmail(email: string): string | null {
  const local = email.split("@")[0];
  if (!local || /^\d+$/.test(local)) return null;
  const words = local
    .split(/[._\-+]/)
    .filter((w) => w.length > 1 && /^[a-z]+$/i.test(w))
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  if (words.length === 0 || words.length > 3) return null;
  return words.join(" ");
}

/** "acme-corp.com" → "Acme Corp". */
export function companyFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/* ------------------------------------------------------------- label pass */

/** A label we recognise but deliberately drop — see the money entry below. */
type LabelField = keyof ParsedFields | "ignore";

const LABELS: { keys: string[]; field: LabelField }[] = [
  { keys: ["deal", "opportunity", "title", "subject", "deal name", "project"], field: "name" },
  {
    // Deals carry no money, so the value is thrown away — but the line still
    // has to be *recognised*, or "Budget: 250000" gets picked as the deal name.
    keys: ["amount", "value", "budget", "price", "deal size", "deal value", "revenue", "quote"],
    field: "ignore",
  },
  {
    keys: ["company", "account", "organisation", "organization", "org", "client", "customer"],
    field: "companyName",
  },
  {
    keys: ["contact", "person", "poc", "point of contact", "attn", "contact person", "name"],
    field: "personName",
  },
  { keys: ["email", "e-mail", "mail", "email id"], field: "email" },
  {
    keys: ["phone", "mobile", "tel", "telephone", "contact no", "contact number", "number"],
    field: "phone",
  },
  {
    keys: [
      "close",
      "close date",
      "closing",
      "closing date",
      "expected close",
      "target date",
      "deadline",
      "due",
      "due date",
    ],
    field: "closeDate",
  },
  { keys: ["website", "site", "url", "domain", "web"], field: "domain" },
];

const LABEL_LINE_RE = /^\s*[*\-•]?\s*([A-Za-z][A-Za-z ./_-]{1,24}?)\s*[:\-–—]\s*(.+?)\s*$/;

function labelField(label: string): LabelField | null {
  const key = label.trim().toLowerCase().replace(/\s+/g, " ");
  return LABELS.find((entry) => entry.keys.includes(key))?.field ?? null;
}

/* ------------------------------------------------------------------ parse */

/**
 * Reads a clipboard blob into deal fields. Order of trust:
 *   1. `Label: value` lines (explicit intent),
 *   2. a tab-separated row (a spreadsheet paste),
 *   3. a free-text scan for whatever is still missing.
 */
export function parsePastedDeal(raw: string, now: Dayjs = dayjs()): ParsedDeal {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  const out: ParsedDeal = { ...EMPTY, raw: text };
  if (!text) return out;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  /** Lines the label pass consumed — the deal-name pick skips them. */
  const consumed = new Set<number>();

  // (1) Labelled lines.
  lines.forEach((line, i) => {
    const m = LABEL_LINE_RE.exec(line);
    if (!m) return;
    const field = labelField(m[1]);
    const value = m[2].trim();
    if (!field || !value) return;
    consumed.add(i);
    switch (field) {
      case "closeDate":
        out.closeDate ??= parseDate(value, now);
        break;
      case "email":
        out.email ??= EMAIL_RE.exec(value)?.[0] ?? null;
        break;
      case "phone":
        out.phone ??= PHONE_RE.exec(value)?.[0]?.trim() ?? null;
        break;
      case "domain": {
        const host = URL_RE.exec(value)?.[1]?.toLowerCase() ?? null;
        if (host && !IGNORED_HOSTS.has(host)) out.domain ??= host;
        break;
      }
      case "name":
      case "companyName":
      case "personName":
        out[field] ??= value;
        break;
      default:
        break;
    }
  });

  // (2) Spreadsheet row: tab-separated cells.
  if (lines.length <= 2 && text.includes("\t")) {
    for (const cell of text.split("\t").map((c) => c.trim()).filter(Boolean)) {
      if (!out.email && EMAIL_RE.test(cell)) {
        out.email = EMAIL_RE.exec(cell)![0];
        continue;
      }
      // A price cell is neither the deal name nor the company — skip it.
      if (parseMoney(cell)) continue;
      if (!out.closeDate) {
        const d = parseDate(cell, now);
        if (d) {
          out.closeDate = d;
          continue;
        }
      }
      if (!out.name) out.name = cell;
      else if (!out.companyName) out.companyName = cell;
    }
  }

  // (3) Freeform scan for whatever is still missing.
  out.email ??= EMAIL_RE.exec(text)?.[0] ?? null;
  if (!out.phone) {
    // Blank out money and dates first, or a price or 2026-08-15 reads as one.
    const scrubbed = text
      .replace(new RegExp(MONEY_RE.source, "gi"), " ")
      .replace(DATEISH_RE, " ");
    const hit = PHONE_RE.exec(scrubbed)?.[0]?.trim();
    // A real phone is 10+ digits, or carries an explicit country code.
    if (hit && (hit.replace(/\D/g, "").length >= 10 || hit.trim().startsWith("+"))) {
      out.phone = hit;
    }
  }
  if (!out.domain) {
    // Blank out addresses first: "john.doe@acme.com" otherwise yields the
    // host "john.doe" before the real site further down the signature.
    const host = URL_RE.exec(text.replace(EMAIL_RE_G, " "))?.[1]?.toLowerCase();
    if (host && !IGNORED_HOSTS.has(host) && !FREE_MAIL.has(host)) out.domain = host;
  }
  if (!out.domain && out.email) {
    const host = out.email.split("@")[1]?.toLowerCase();
    if (host && !FREE_MAIL.has(host)) out.domain = host;
  }
  if (!out.closeDate) {
    for (const line of lines) {
      // Only trust a date the line frames as one, not any stray number.
      if (!/\b(close|closing|due|deadline|target|expect|expected|deliver|by)\b/i.test(line)) {
        continue;
      }
      const d = parseDate(line, now);
      if (d) {
        out.closeDate = d;
        break;
      }
    }
  }
  out.personName ??= out.email ? nameFromEmail(out.email) : null;
  out.companyName ??= out.domain ? companyFromDomain(out.domain) : null;

  // Deal name: the first line that isn't another field in disguise.
  if (!out.name) {
    const candidate = lines.find((line, i) => {
      if (consumed.has(i)) return false;
      if (line.length < 3) return false;
      // A line that merely CONTAINS a link still makes a fine title; one that
      // is essentially just a link/email/amount/date does not.
      if (isMostly(line, EMAIL_RE) || isMostly(line, URL_RE)) return false;
      if (isMostly(line, MONEY_RE)) return false;
      // A short line that parses as a date IS the date; a sentence that
      // merely ends "…closing end of month" still makes a fine title.
      if (line.length <= 24 && parseDate(line, now)) return false;
      if (line.replace(/\D/g, "").length > line.length / 2) return false;
      return true;
    });
    out.name = candidate ? candidate.slice(0, 120) : null;
  }
  if (!out.name && out.companyName) out.name = `${out.companyName} deal`;
  if (!out.name && out.personName) out.name = `${out.personName} deal`;

  return out;
}

/** True when the blob yielded enough to be worth opening the dialog for. */
export function hasUsefulSignal(parsed: ParsedDeal): boolean {
  return Boolean(parsed.name || parsed.email || parsed.companyName);
}
