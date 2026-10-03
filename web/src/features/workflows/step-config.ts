/**
 * Config shapes for the step types the builder adds beyond the original three:
 * Delay, outbound HTTP, and the retry block app/HTTP steps may carry.
 *
 * Pure. Each normalizer reads whatever is stored (including nothing) into a
 * complete object the form can edit, and each validator returns the first
 * problem in the words the drawer shows. Contract:
 * docs/AUTOMATION_CLIENT.md §2.5, §2.6, §2.7.
 */

/* ------------------------------------------------------------------ delay -- */

export type DelayUnit = "minutes" | "hours" | "days";

export interface DelayConfig {
  kind: "for" | "until";
  unit: DelayUnit;
  amount: number;
  /** For `until`: an ISO date-time, or a token that resolves to one. */
  until: string;
}

/** 30 days, per the contract — long enough for a follow-up, short of a cron. */
export const MAX_DELAY_MINUTES = 30 * 24 * 60;

const UNIT_MINUTES: Record<DelayUnit, number> = { minutes: 1, hours: 60, days: 1440 };

export function delayMinutes(c: DelayConfig): number {
  return Math.round(c.amount * UNIT_MINUTES[c.unit]);
}

export function normalizeDelayConfig(raw: unknown): DelayConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const until = typeof c.until === "string" ? c.until : "";
  const forBlock = (c.for && typeof c.for === "object" ? c.for : {}) as Record<string, unknown>;
  for (const unit of ["days", "hours", "minutes"] as DelayUnit[]) {
    const v = forBlock[unit];
    if (typeof v === "number" && v > 0) {
      return { kind: "for", unit, amount: v, until };
    }
  }
  if (until) return { kind: "until", unit: "hours", amount: 1, until };
  return { kind: "for", unit: "minutes", amount: 15, until: "" };
}

export function compactDelayConfig(c: DelayConfig): Record<string, unknown> {
  if (c.kind === "until") return { until: c.until };
  return { for: { [c.unit]: c.amount } };
}

export function validateDelayConfig(c: DelayConfig): string | null {
  if (c.kind === "until") {
    if (!c.until.trim()) return "Pick the date field the run should wait for.";
    return null;
  }
  if (!Number.isFinite(c.amount) || c.amount <= 0) return "Enter how long to wait.";
  if (delayMinutes(c) > MAX_DELAY_MINUTES) return "The longest a run can wait is 30 days.";
  return null;
}

export function describeDelay(c: DelayConfig): string {
  if (c.kind === "until") return c.until ? `Wait until ${c.until}` : "Wait until a date";
  const n = c.amount;
  const unit = n === 1 ? c.unit.replace(/s$/, "") : c.unit;
  return `Wait ${n} ${unit}`;
}

/* ------------------------------------------------------------------- http -- */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export interface HttpHeader {
  name: string;
  value: string;
}

export interface HttpConfig {
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  /** Raw request body; usually JSON with tokens in it. */
  body: string;
  timeout_ms: number;
}

export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export function normalizeHttpConfig(raw: unknown): HttpConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const method = HTTP_METHODS.includes(String(c.method).toUpperCase() as HttpMethod)
    ? (String(c.method).toUpperCase() as HttpMethod)
    : "POST";
  const headers: HttpHeader[] = [];
  if (Array.isArray(c.headers)) {
    for (const h of c.headers) {
      const row = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
      headers.push({ name: String(row.name ?? ""), value: String(row.value ?? "") });
    }
  } else if (c.headers && typeof c.headers === "object") {
    for (const [name, value] of Object.entries(c.headers as Record<string, unknown>)) {
      headers.push({ name, value: String(value ?? "") });
    }
  }
  return {
    method,
    url: typeof c.url === "string" ? c.url : "",
    headers,
    body: typeof c.body === "string" ? c.body : c.body ? JSON.stringify(c.body, null, 2) : "",
    timeout_ms:
      typeof c.timeout_ms === "number" && c.timeout_ms > 0 ? c.timeout_ms : DEFAULT_HTTP_TIMEOUT_MS,
  };
}

/** Headers go back as an object, which is what the server step reads. */
export function compactHttpConfig(c: HttpConfig): Record<string, unknown> {
  const headers: Record<string, string> = {};
  for (const h of c.headers) if (h.name.trim()) headers[h.name.trim()] = h.value;
  const out: Record<string, unknown> = {
    method: c.method,
    url: c.url.trim(),
    headers,
    timeout_ms: c.timeout_ms,
  };
  if (c.method !== "GET" && c.body.trim()) out.body = c.body;
  return out;
}

/**
 * The checks worth making in the browser. The real guards — https only, no
 * private/loopback addresses, the per-team host allowlist — are enforced on the
 * server, because a browser check is advice, not security.
 */
export function validateHttpConfig(c: HttpConfig): string | null {
  const url = c.url.trim();
  if (!url) return "Enter the URL to call.";
  if (url.includes("{{")) {
    // A templated URL cannot be parsed until the run fills it in; the server
    // re-checks the resolved URL anyway.
    if (!url.startsWith("https://")) return "The URL has to start with https://.";
  } else {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "That is not a valid URL.";
    }
    if (parsed.protocol !== "https:") return "Only https:// URLs are allowed.";
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|169\.254\.)/i.test(parsed.hostname))
      return "Private and loopback addresses are refused by the server.";
  }
  for (const h of c.headers) {
    if (h.value.trim() && !h.name.trim()) return "A header has a value but no name.";
    if (h.name.trim() && !/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(h.name.trim()))
      return `"${h.name}" is not a valid header name.`;
  }
  if (c.method !== "GET" && c.body.trim()) {
    const looksJson = /^[[{]/.test(c.body.trim());
    if (looksJson && !c.body.includes("{{")) {
      try {
        JSON.parse(c.body);
      } catch {
        return "The body looks like JSON but does not parse.";
      }
    }
  }
  if (!Number.isFinite(c.timeout_ms) || c.timeout_ms < 1000 || c.timeout_ms > 60_000)
    return "The timeout has to be between 1 and 60 seconds.";
  return null;
}

export function describeHttp(c: HttpConfig): string {
  return c.url.trim() ? `${c.method} ${c.url.trim()}` : `${c.method} — pick a URL`;
}

/* ------------------------------------------------------------------ retry -- */

export type RetryBackoff = "fixed" | "exponential";

export interface RetryConfig {
  enabled: boolean;
  max: number;
  backoff: RetryBackoff;
}

export const MAX_RETRY_ATTEMPTS = 5;

export function normalizeRetryConfig(raw: unknown): RetryConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const r = (c.retry && typeof c.retry === "object" ? c.retry : null) as Record<
    string,
    unknown
  > | null;
  if (!r) return { enabled: false, max: 3, backoff: "exponential" };
  const max = typeof r.max === "number" ? Math.min(Math.max(Math.trunc(r.max), 1), MAX_RETRY_ATTEMPTS) : 3;
  return { enabled: true, max, backoff: r.backoff === "fixed" ? "fixed" : "exponential" };
}

/**
 * Puts the retry block back on a step config where the engine looks for it:
 * the top level, beside `url` on an http step and beside `action`/`params` on
 * an app one (wf_resume_app_step reads workflow_step_runs.input -> 'retry').
 * Switching retries off removes the key rather than storing `enabled: false`,
 * which the engine would read as one attempt anyway but nobody would guess.
 */
export function withRetry(
  config: Record<string, unknown>,
  retry: RetryConfig,
): Record<string, unknown> {
  const out = { ...config };
  if (retry.enabled) out.retry = { max: retry.max, backoff: retry.backoff };
  else delete out.retry;
  return out;
}

export function describeRetry(r: RetryConfig): string {
  if (!r.enabled) return "No retries — a failure stops the run.";
  return `Up to ${r.max} attempt${r.max === 1 ? "" : "s"}, ${
    r.backoff === "fixed" ? "same wait each time" : "waiting longer each time"
  }.`;
}
