/**
 * Meta insights → the rows the workflow step hands to later steps. Pure (type
 * imports only, no I/O), so every quirk is testable against real payloads.
 *
 * The quirks, carried over from the Marketing app's normaliser:
 *  - Numbers arrive as strings ("12.34"); a missing field means "nothing to
 *    report" — 0 for counts, null for ratios.
 *  - `actions` / `action_values` are [{ action_type, value }] lists in which
 *    several types overlap: `lead` is Meta's roll-up of every lead source and
 *    `omni_purchase` the de-duplicated purchase. Summing every type containing
 *    "lead" would double count, so each metric takes the roll-up when Meta sent
 *    it and otherwise adds up the non-overlapping parts.
 *  - "Results" is what the campaign's objective optimises for (Ads Manager's
 *    Results column), for both the ODAX (OUTCOME_*) and legacy objective names.
 *  - `date_start` is a day in the ad account's own timezone and stays that day,
 *    so a sheet lines up with Ads Manager instead of being shifted to UTC.
 */

import type { RawAction, RawInsight } from "./graph";
import type { MetaInsightLevel, MetaInsightMetric } from "@/lib/workflows/app-action-catalog";

export type MetaInsightRow = Record<string, string | number | null>;

/** A Graph number-ish value → number, or null when absent / not a number. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const int = (v: unknown): number => {
  const n = num(v);
  return n === null ? 0 : Math.round(n);
};

/** [{action_type, value}] → { action_type: number }, summing any repeats. */
export function actionMap(list: RawAction[] | undefined | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(list)) return out;
  for (const a of list) {
    const type = typeof a?.action_type === "string" ? a.action_type : "";
    const n = num(a?.value);
    if (!type || n === null) continue;
    out[type] = (out[type] ?? 0) + n;
  }
  return out;
}

/** The first roll-up Meta sent; else the sum of the non-overlapping parts. */
function pick(map: Record<string, number>, rollups: string[], parts: string[]): number {
  for (const k of rollups) if (map[k] !== undefined) return map[k];
  let sum = 0;
  let seen = false;
  for (const k of parts) {
    if (map[k] !== undefined) {
      sum += map[k];
      seen = true;
    }
  }
  return seen ? sum : 0;
}

export function leadsFrom(actions: Record<string, number>): number {
  const n = pick(actions, ["lead"], ["onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]);
  return n || pick(actions, [], ["leadgen_grouped", "leadgen.other"]);
}

const PURCHASE_ROLLUPS = ["omni_purchase", "purchase"];
const PURCHASE_PARTS = [
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
  "app_custom_event.fb_mobile_purchase",
  "onsite_conversion.purchase",
];

export function purchasesFrom(map: Record<string, number>): number {
  return pick(map, PURCHASE_ROLLUPS, PURCHASE_PARTS);
}

const MESSAGING_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
];
const APP_INSTALL_TYPES = ["mobile_app_install", "app_install", "omni_app_install"];

/** The result an objective optimises for — what Ads Manager's Results column shows. */
export function resultFor(
  objective: string | null | undefined,
  m: { leads: number; purchases: number; linkClicks: number; videoViews: number; actions: Record<string, number> },
): number {
  switch ((objective ?? "").toUpperCase()) {
    case "OUTCOME_LEADS":
    case "LEAD_GENERATION":
      return m.leads;
    case "OUTCOME_SALES":
    case "CONVERSIONS":
    case "PRODUCT_CATALOG_SALES":
      return m.purchases;
    case "OUTCOME_TRAFFIC":
    case "LINK_CLICKS":
      return m.linkClicks;
    case "VIDEO_VIEWS":
      return m.videoViews;
    case "OUTCOME_ENGAGEMENT":
    case "OUTCOME_AWARENESS":
    case "BRAND_AWARENESS":
    case "REACH":
    case "POST_ENGAGEMENT":
      return m.videoViews > 0 ? m.videoViews : m.linkClicks;
    case "MESSAGES":
      return pick(m.actions, [], MESSAGING_TYPES) || m.linkClicks;
    case "OUTCOME_APP_PROMOTION":
    case "APP_INSTALLS":
      return pick(m.actions, APP_INSTALL_TYPES, []) || m.linkClicks;
    default:
      return m.linkClicks;
  }
}

function round(n: number | null, dp: number): number | null {
  if (n === null) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Every metric we can compute for one Graph row, keyed like MetaInsightMetric. */
function metricsOf(raw: RawInsight, objective: string | null): Record<MetaInsightMetric, number | null> {
  const actions = actionMap(raw.actions);
  const values = actionMap(raw.action_values);
  const spend = num(raw.spend) ?? 0;
  const linkClicks = Math.round(num(raw.inline_link_clicks) ?? actions["link_click"] ?? 0);
  const videoPlays = actionMap(raw.video_play_actions);
  const videoViews = Math.round(videoPlays["video_view"] ?? actions["video_view"] ?? 0);
  const leads = leadsFrom(actions);
  const purchases = purchasesFrom(actions);
  const purchaseValue = purchasesFrom(values);
  const results = resultFor(objective, { leads, purchases, linkClicks, videoViews, actions });
  let roas = purchaseValue > 0 ? div(purchaseValue, spend) : null;
  if (roas === null) {
    const reported = pick(actionMap(raw.purchase_roas), PURCHASE_ROLLUPS, PURCHASE_PARTS);
    roas = reported > 0 ? reported : null;
  }
  return {
    spend: round(spend, 2) ?? 0,
    impressions: int(raw.impressions),
    reach: int(raw.reach),
    frequency: round(num(raw.frequency), 4),
    clicks: int(raw.clicks),
    link_clicks: linkClicks,
    ctr: round(num(raw.ctr), 4),
    cpc: round(num(raw.cpc), 4),
    cpm: round(num(raw.cpm), 4),
    results,
    cost_per_result: round(div(spend, results), 4),
    leads,
    cost_per_lead: round(div(spend, leads), 4),
    purchases,
    purchase_value: round(purchaseValue, 2) ?? 0,
    roas: round(roas, 4),
    video_views: videoViews,
  };
}

/**
 * One Graph insights row → one workflow row: the date, who it is about (the
 * account, plus the campaign / ad set / ad down to the chosen level), the
 * currency, and the chosen metrics in the order they were chosen. Null when the
 * row has no date (nothing to key it on).
 */
export function insightRow(
  raw: RawInsight,
  opts: {
    level: MetaInsightLevel;
    account: { external_id: string; name: string; currency: string | null };
    metrics: MetaInsightMetric[];
  },
): MetaInsightRow | null {
  const date = typeof raw.date_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date_start) ? raw.date_start : null;
  if (!date) return null;
  const row: MetaInsightRow = {
    date,
    account_id: opts.account.external_id,
    account_name: opts.account.name,
  };
  if (opts.level !== "account") {
    row.campaign_id = raw.campaign_id ?? null;
    row.campaign_name = raw.campaign_name ?? null;
  }
  if (opts.level === "adset" || opts.level === "ad") {
    row.adset_id = raw.adset_id ?? null;
    row.adset_name = raw.adset_name ?? null;
  }
  if (opts.level === "ad") {
    row.ad_id = raw.ad_id ?? null;
    row.ad_name = raw.ad_name ?? null;
  }
  const objective = raw.objective ?? null;
  if (opts.level !== "account") row.objective = objective;
  row.currency = opts.account.currency;
  const all = metricsOf(raw, objective);
  for (const m of opts.metrics) row[m] = all[m];
  return row;
}

// -----------------------------------------------------------------------------
// Date windows
// -----------------------------------------------------------------------------

/** Today's date (YYYY-MM-DD) in an IANA zone; UTC when the zone is unknown. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A date preset → the inclusive [since, until] window in the ad account's own
 * day. A scheduled run carries no date of its own, so "yesterday" is worked out
 * here, per account, in that account's timezone. last_Nd is the N full days
 * ending yesterday — the same days Ads Manager's own "Last N days" shows.
 */
export function presetRange(
  preset: string,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): { since: string; until: string } {
  const today = todayIn(timeZone, now);
  const yesterday = shiftDate(today, -1);
  switch (preset) {
    case "today":
      return { since: today, until: today };
    case "this_month":
      return { since: `${today.slice(0, 8)}01`, until: today };
    case "last_month": {
      const firstThisMonth = `${today.slice(0, 8)}01`;
      const lastPrev = shiftDate(firstThisMonth, -1);
      return { since: `${lastPrev.slice(0, 8)}01`, until: lastPrev };
    }
    case "last_3d":
    case "last_7d":
    case "last_14d":
    case "last_30d": {
      const n = Number(preset.slice(5, -1));
      return { since: shiftDate(yesterday, -(n - 1)), until: yesterday };
    }
    case "yesterday":
    default:
      return { since: yesterday, until: yesterday };
  }
}
