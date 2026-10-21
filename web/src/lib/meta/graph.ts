/**
 * Meta Graph (Marketing API) client — the only code in the product that talks
 * to graph.facebook.com.
 *
 * TOKEN HANDLING. The token rides in the `Authorization: Bearer` header and
 * nowhere else. Graph also accepts `?access_token=`, and its `paging.next`
 * links echo it back when a request used it — which is exactly how a token ends
 * up in a proxy log, an error message or a stored sync run. Pagination links
 * are therefore stripped of access_token and followed only on the host we
 * started from, so a tampered or unexpected `next` can never receive the token.
 *
 * ERRORS. Graph reports everything as `{ error: { code, error_subcode,
 * message } }`. Three families matter here:
 *  - 190 / 102 — the token is expired, revoked or its System User lost access.
 *    Retrying is pointless; the caller must ask for a new token.
 *  - 4, 17, 32, 613, 80000–80014 — throttling (app, user, page, custom and the
 *    Business Use Case limits). Retried with backoff, honouring the wait Meta
 *    announces in `x-business-use-case-usage` / `x-ad-account-usage` when it is
 *    short; when it is long we give up with a message that says how long,
 *    rather than holding a request open for half an hour.
 *  - 1 / 2 and 5xx — transient; a couple of quick retries.
 *
 * Server-only (it is handed tokens), but import-light so node tests can load it.
 * First written for the Marketing app (removed 2026-09-28); kept for the
 * workflow integration (Workflows → Integrations → Meta Ads, meta.get_insights).
 */

const DEFAULT_VERSION = "v23.0";
const DEFAULT_BASE = "https://graph.facebook.com";

/** Longest wait we will sit through inside one request before giving up. */
const MAX_INLINE_WAIT_MS = 60_000;
const MAX_ATTEMPTS = 5;

export function graphVersion(): string {
  const v = (process.env.META_GRAPH_VERSION ?? "").trim();
  return /^v\d+\.\d+$/.test(v) ? v : DEFAULT_VERSION;
}

/**
 * The base URL. The override exists only so tests can point at a local mock;
 * production ignores it, so a stray env var can never redirect real tokens.
 */
export function graphBaseUrl(): string {
  const override = (process.env.META_GRAPH_BASE_URL ?? "").trim();
  if (override && process.env.NODE_ENV !== "production") return override.replace(/\/+$/, "");
  return DEFAULT_BASE;
}

/** Backoff unit; tests shrink it so a throttling path runs in milliseconds. */
function retryBaseMs(): number {
  const raw = Number(process.env.META_GRAPH_RETRY_BASE_MS);
  if (process.env.NODE_ENV !== "production" && Number.isFinite(raw) && raw >= 0) return raw;
  return 2_000;
}

const THROTTLE_CODES = new Set([4, 17, 32, 613]);
const TOKEN_CODES = new Set([190, 102]);

export class MetaGraphError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly status: number;
  readonly tokenInvalid: boolean;
  readonly throttled: boolean;
  /** Set when Meta asked us to wait longer than we are willing to inline. */
  readonly retryAfterMs: number | null;

  constructor(opts: {
    message: string;
    code: number | null;
    subcode: number | null;
    status: number;
    retryAfterMs?: number | null;
  }) {
    super(opts.message);
    this.name = "MetaGraphError";
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.status = opts.status;
    this.tokenInvalid = opts.code !== null && TOKEN_CODES.has(opts.code);
    this.throttled = opts.code !== null && isThrottleCode(opts.code);
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

function isThrottleCode(code: number): boolean {
  return THROTTLE_CODES.has(code) || (code >= 80000 && code <= 80014);
}

/** Member-facing text for a token that no longer works. */
export const TOKEN_INVALID_MESSAGE =
  "Facebook access expired or was revoked — reconnect it in Workflows → Integrations.";

/**
 * The longest wait any usage header announces, in ms. Both headers are JSON:
 *  - x-business-use-case-usage: { "<id>": [{ estimated_time_to_regain_access: <minutes>, … }] }
 *  - x-ad-account-usage: { acc_id_util_pct, reset_time_duration: <seconds>, … }
 * Unparseable headers count as "no hint" — they are advisory, never a reason
 * to fail a sync.
 */
export function usageWaitMs(headers: Headers): number | null {
  let wait: number | null = null;
  const bump = (ms: number) => {
    if (Number.isFinite(ms) && ms > 0) wait = Math.max(wait ?? 0, ms);
  };
  const buc = headers.get("x-business-use-case-usage");
  if (buc) {
    try {
      const parsed = JSON.parse(buc) as Record<string, { estimated_time_to_regain_access?: number }[]>;
      for (const entries of Object.values(parsed ?? {})) {
        for (const e of Array.isArray(entries) ? entries : []) {
          bump(Number(e?.estimated_time_to_regain_access ?? 0) * 60_000);
        }
      }
    } catch {
      /* advisory header only */
    }
  }
  const acct = headers.get("x-ad-account-usage");
  if (acct) {
    try {
      const parsed = JSON.parse(acct) as { reset_time_duration?: number; acc_id_util_pct?: number };
      // reset_time_duration only means "wait" once the account is at its cap.
      if (Number(parsed?.acc_id_util_pct ?? 0) >= 100) bump(Number(parsed?.reset_time_duration ?? 0) * 1000);
    } catch {
      /* advisory header only */
    }
  }
  return wait;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Params = Record<string, string | number | undefined>;

function buildUrl(path: string, params: Params): URL {
  const url = new URL(`${graphBaseUrl()}/${graphVersion()}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url;
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
}

/**
 * One GET with retries. Returns the parsed JSON body; throws MetaGraphError.
 */
async function getJson<T>(token: string, url: URL): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
    } catch (err) {
      if (attempt < 3) {
        await sleep(retryBaseMs() * attempt);
        continue;
      }
      throw new MetaGraphError({
        message: `Could not reach Meta (${err instanceof Error ? err.name : "network error"}).`,
        code: null,
        subcode: null,
        status: 0,
      });
    }

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (res.ok && body && typeof body === "object" && !(body as GraphErrorBody).error) {
      return body as T;
    }

    const e = (body as GraphErrorBody | null)?.error;
    const code = typeof e?.code === "number" ? e.code : null;
    const subcode = typeof e?.error_subcode === "number" ? e.error_subcode : null;
    const message = (e?.error_user_msg || e?.message || `Meta returned HTTP ${res.status}.`).slice(0, 500);

    if (code !== null && TOKEN_CODES.has(code)) {
      throw new MetaGraphError({ message: TOKEN_INVALID_MESSAGE, code, subcode, status: res.status });
    }

    if (code !== null && isThrottleCode(code)) {
      const hinted = usageWaitMs(res.headers);
      const backoff = retryBaseMs() * 2 ** (attempt - 1);
      const wait = Math.max(hinted ?? 0, backoff);
      if (attempt < MAX_ATTEMPTS && wait <= MAX_INLINE_WAIT_MS) {
        await sleep(wait);
        continue;
      }
      const minutes = Math.max(1, Math.ceil((hinted ?? wait) / 60_000));
      throw new MetaGraphError({
        message: `Meta is rate-limiting this ad account — try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        code,
        subcode,
        status: res.status,
        retryAfterMs: hinted ?? wait,
      });
    }

    const transient = res.status >= 500 || code === 1 || code === 2;
    if (transient && attempt < 3 && !isTooMuchData(code, subcode, message)) {
      await sleep(retryBaseMs() * attempt);
      continue;
    }

    throw new MetaGraphError({ message, code, subcode, status: res.status });
  }
}

/** Graph's "Please reduce the amount of data you're asking for" family. */
function isTooMuchData(code: number | null, subcode: number | null, message: string): boolean {
  return (
    subcode === 1487534 ||
    ((code === 1 || code === 100) && /reduce the amount of data/i.test(message))
  );
}

export function isTooMuchDataError(err: unknown): boolean {
  return err instanceof MetaGraphError && isTooMuchData(err.code, err.subcode, err.message);
}

/**
 * The next page URL, made safe to follow: same origin as where we started,
 * and without any access_token parameter.
 */
function safeNextUrl(next: unknown, origin: string): URL | null {
  if (typeof next !== "string" || !next) return null;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  url.searchParams.delete("access_token");
  return url;
}

/** Every item of a paged edge (follows paging.next until exhausted). */
export async function graphGetAll<T>(
  token: string,
  path: string,
  params: Params,
  maxPages = 200,
): Promise<T[]> {
  const out: T[] = [];
  let url: URL | null = buildUrl(path, params);
  const origin = url.origin;
  for (let page = 0; url && page < maxPages; page++) {
    const body: { data?: T[]; paging?: { next?: string } } = await getJson(token, url);
    if (Array.isArray(body.data)) out.push(...body.data);
    url = safeNextUrl(body.paging?.next, origin);
  }
  return out;
}

export async function graphGet<T>(token: string, path: string, params: Params = {}): Promise<T> {
  return getJson<T>(token, buildUrl(path, params));
}

// ---------------------------------------------------------------------------
// Typed calls
// ---------------------------------------------------------------------------

/** "1234" or "act_1234" → "act_1234"; anything else → null. */
export function toActId(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const m = /^(?:act_)?([0-9]{1,30})$/.exec(s);
  return m ? `act_${m[1]}` : null;
}

export interface MetaAdAccount {
  /** With the act_ prefix. */
  external_id: string;
  name: string;
  currency: string | null;
  timezone_name: string | null;
  account_status: number | null;
  business_name: string | null;
}

interface RawAdAccount {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number | string;
  business?: { name?: string } | null;
}

function toAccount(raw: RawAdAccount): MetaAdAccount | null {
  const external = toActId(raw.account_id ?? raw.id ?? "");
  if (!external) return null;
  const status = raw.account_status === undefined ? null : Number(raw.account_status);
  return {
    external_id: external,
    name: (raw.name ?? "").trim() || external,
    currency: raw.currency ?? null,
    timezone_name: raw.timezone_name ?? null,
    account_status: Number.isFinite(status) ? status : null,
    business_name: raw.business?.name ?? null,
  };
}

const ACCOUNT_FIELDS = "account_id,name,currency,timezone_name,account_status,business{name}";

/** Who the token is, and every ad account it can see. */
export async function debugAccounts(
  token: string,
): Promise<{ user: { id: string; name: string | null }; accounts: MetaAdAccount[] }> {
  const me = await graphGet<{ id?: string; name?: string }>(token, "me", { fields: "id,name" });
  const raw = await graphGetAll<RawAdAccount>(token, "me/adaccounts", { fields: ACCOUNT_FIELDS, limit: 200 });
  const accounts = raw.map(toAccount).filter((a): a is MetaAdAccount => a !== null);
  accounts.sort((a, b) => a.name.localeCompare(b.name));
  return { user: { id: String(me.id ?? ""), name: me.name ?? null }, accounts };
}

/** One ad account's current metadata (also proves the token can read it). */
export async function fetchAccount(token: string, actId: string): Promise<MetaAdAccount> {
  const raw = await graphGet<RawAdAccount>(token, actId, { fields: ACCOUNT_FIELDS });
  const acc = toAccount({ ...raw, account_id: raw.account_id ?? actId });
  if (!acc) throw new MetaGraphError({ message: "Meta returned an unexpected ad account.", code: null, subcode: null, status: 200 });
  return acc;
}

export interface RawAction {
  action_type?: string;
  value?: string | number;
}

export interface RawInsight {
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  objective?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: RawAction[];
  action_values?: RawAction[];
  cost_per_action_type?: RawAction[];
  purchase_roas?: RawAction[];
  video_play_actions?: RawAction[];
  [k: string]: unknown;
}

// campaign_name / adset_name / ad_name are beyond the contract's list: they
// let the sync create a named stub for an object the objects edges no longer
// return (archived or deleted since), instead of showing a bare id.
const INSIGHT_FIELDS = [
  "account_id",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
  "video_play_actions",
  "objective",
].join(",");

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(since: string, until: string): number {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Daily insights for one level over [since, until] (YYYY-MM-DD, inclusive, in
 * the account's timezone). A big account at ad level over 90 days can trip
 * Graph's "reduce the amount of data" error; the range is then halved and
 * each half fetched separately, down to single days.
 */
export async function fetchInsights(
  token: string,
  actId: string,
  level: "account" | "campaign" | "adset" | "ad",
  since: string,
  until: string,
): Promise<RawInsight[]> {
  try {
    return await graphGetAll<RawInsight>(token, `${actId}/insights`, {
      level,
      time_increment: 1,
      time_range: JSON.stringify({ since, until }),
      fields: INSIGHT_FIELDS,
      limit: 500,
    });
  } catch (err) {
    const span = daysBetween(since, until);
    if (!isTooMuchDataError(err) || span <= 1) throw err;
    const mid = addDays(since, Math.floor(span / 2) - 1);
    const first = await fetchInsights(token, actId, level, since, mid);
    const second = await fetchInsights(token, actId, level, addDays(mid, 1), until);
    return [...first, ...second];
  }
}
