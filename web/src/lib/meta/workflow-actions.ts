import type { AppActionHandler } from "@/lib/workflows/app-action-types";
import {
  META_DEFAULT_METRICS,
  META_INSIGHT_METRICS,
  type MetaInsightLevel,
  type MetaInsightMetric,
} from "@/lib/workflows/app-action-catalog";
import { MetaGraphError, fetchInsights } from "./graph";
import { insightRow, presetRange, type MetaInsightRow } from "./insights";
import { accountsForRun, markMetaConnection, metaToken } from "./store";

/**
 * meta.get_insights — daily numbers from Facebook Ads Manager as rows.
 *
 * Output (context.steps.<key>):
 *   rows       [{ date, account_id, account_name, campaign_id?, campaign_name?,
 *                 adset_…?, ad_…?, objective?, currency, <metric>: number }]
 *   row_count  how many rows came back (all of them; `rows` may be capped)
 *   spend      { <currency>: total } — accounts can bill in different currencies
 *   date_from / date_to  the widest window read (each account in its own timezone)
 *   accounts   [{ id, name, rows, error? }]
 *   errors     member-safe messages, one per failed account
 *
 * One failing account never fails the others; the step fails only when no
 * account could be read. A token Facebook rejects marks its connection, so the
 * Integrations page says "reconnect" instead of the run log alone.
 *
 * The whole `rows` array is what later steps take: a field set to exactly
 * {{steps.<key>.rows}} receives the array itself (interpolateDeep), e.g. an
 * HTTP step body posting them to Apps Script, Zapier or Make.
 */

/** Rows kept in the run context. Every row is fetched and counted; beyond this
 *  the run history and later steps get the first ROW_CAP. */
const ROW_CAP = 5000;

const LEVELS: MetaInsightLevel[] = ["account", "campaign", "adset", "ad"];
const KNOWN_METRICS = new Set(META_INSIGHT_METRICS.map((m) => m.value));

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (typeof v === "string" && v.trim()) {
    try {
      return strings(JSON.parse(v));
    } catch {
      return v.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

const getInsights: AppActionHandler = async (ctx, params) => {
  const level = LEVELS.includes(params.level as MetaInsightLevel) ? (params.level as MetaInsightLevel) : "campaign";
  const preset = typeof params.date_preset === "string" && params.date_preset ? params.date_preset : "yesterday";
  const chosen = strings(params.metrics).filter((m): m is MetaInsightMetric => KNOWN_METRICS.has(m as MetaInsightMetric));
  const metrics = chosen.length ? chosen : META_DEFAULT_METRICS;

  const accounts = await accountsForRun(ctx.admin, ctx.teamId, strings(params.account_ids));
  if (!accounts.length) {
    return {
      ok: false,
      output: { rows: [], row_count: 0 },
      error:
        "No Facebook ad accounts to read. Connect Facebook in Workflows → Integrations and make sure the chosen accounts are switched on.",
    };
  }

  const rows: MetaInsightRow[] = [];
  const spend: Record<string, number> = {};
  const errors: string[] = [];
  const read: { id: string; name: string; rows: number; error?: string }[] = [];
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let total = 0;
  const tokens = new Map<string, string | null>();
  const failedConnections = new Set<string>();

  for (const account of accounts) {
    if (failedConnections.has(account.connection_id)) {
      const message = "Facebook access for this account's connection stopped working — reconnect it.";
      errors.push(`${account.name}: ${message}`);
      read.push({ id: account.external_id, name: account.name, rows: 0, error: message });
      continue;
    }
    if (!tokens.has(account.connection_id)) tokens.set(account.connection_id, await metaToken(ctx.admin, account.connection_id));
    const token = tokens.get(account.connection_id);
    if (!token) {
      const message = "This account's Facebook connection has no token — reconnect it.";
      errors.push(`${account.name}: ${message}`);
      read.push({ id: account.external_id, name: account.name, rows: 0, error: message });
      continue;
    }

    const { since, until } = presetRange(preset, account.timezone_name);
    if (!dateFrom || since < dateFrom) dateFrom = since;
    if (!dateTo || until > dateTo) dateTo = until;

    try {
      const raw = await fetchInsights(token, account.external_id, level, since, until);
      let count = 0;
      for (const r of raw) {
        const row = insightRow(r, {
          level,
          account: { external_id: account.external_id, name: account.name, currency: account.currency },
          metrics,
        });
        if (!row) continue;
        count += 1;
        total += 1;
        if (rows.length < ROW_CAP) rows.push(row);
        const amount = typeof row.spend === "number" ? row.spend : Number(r.spend ?? 0) || 0;
        const cur = account.currency ?? "—";
        spend[cur] = Math.round(((spend[cur] ?? 0) + amount) * 100) / 100;
      }
      read.push({ id: account.external_id, name: account.name, rows: count });
    } catch (err) {
      const message =
        err instanceof MetaGraphError ? err.message : "Could not read this ad account from Facebook.";
      errors.push(`${account.name}: ${message}`);
      read.push({ id: account.external_id, name: account.name, rows: 0, error: message });
      if (err instanceof MetaGraphError && err.tokenInvalid) {
        failedConnections.add(account.connection_id);
        await markMetaConnection(ctx.admin, account.connection_id, { ok: false, error: message, revoked: true });
      }
    }
  }

  // Rows in a predictable order for whatever receives them: by day, then by
  // account and the names down to the chosen level.
  rows.sort((a, b) => {
    const keys = ["date", "account_name", "campaign_name", "adset_name", "ad_name"];
    for (const k of keys) {
      const x = String(a[k] ?? "");
      const y = String(b[k] ?? "");
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  });

  const okAccounts = read.filter((a) => !a.error).length;
  const output = {
    rows,
    row_count: total,
    ...(total > rows.length ? { rows_truncated: true, rows_kept: rows.length } : {}),
    spend,
    date_from: dateFrom,
    date_to: dateTo,
    level,
    accounts: read,
    errors,
  };
  if (okAccounts === 0) {
    return { ok: false, output, error: errors[0] ?? "No ad account could be read from Facebook." };
  }
  for (const id of new Set(accounts.map((a) => a.connection_id))) {
    if (!failedConnections.has(id)) await markMetaConnection(ctx.admin, id, { ok: true });
  }
  return { ok: true, output };
};

export const metaActions = {
  "meta.get_insights": getInsights,
} as const;
