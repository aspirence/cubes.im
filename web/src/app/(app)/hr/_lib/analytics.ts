/**
 * Loosely-typed view of the `hr_org_analytics(p_org_id)` JSON payload surfaced
 * by Agent A's `useOrgAnalytics()` hook (src/features/hr/use-analytics.ts).
 *
 * The RPC returns a single JSON object, so the hook's data is effectively
 * `Json`. These interfaces give the dashboard/reports pages a structured,
 * resilient view without redefining the contract — every field is optional /
 * nullable so a missing key never throws at render time.
 */

export interface AnalyticsCount {
  name?: string | null;
  count?: number | null;
}

export interface AnalyticsStatusCount {
  status?: string | null;
  count?: number | null;
}

export interface AnalyticsTypeCount {
  type?: string | null;
  count?: number | null;
}

export interface AnalyticsLocationCount {
  location?: string | null;
  count?: number | null;
}

export interface AnalyticsPayrollLast {
  period_month?: number | null;
  period_year?: number | null;
  total_net?: number | null;
  employee_count?: number | null;
  status?: string | null;
}

export interface AnalyticsBirthday {
  full_name?: string | null;
  date_of_birth?: string | null;
  day?: string | null;
}

export interface AnalyticsAnniversary {
  full_name?: string | null;
  date_of_joining?: string | null;
  years?: number | null;
  day?: string | null;
}

export interface OrgAnalytics {
  headcount?: number | null;
  total_employees?: number | null;
  by_department?: AnalyticsCount[] | null;
  by_status?: AnalyticsStatusCount[] | null;
  by_type?: AnalyticsTypeCount[] | null;
  by_location?: AnalyticsLocationCount[] | null;
  on_probation?: number | null;
  new_joiners_30d?: number | null;
  exits_30d?: number | null;
  present_today?: number | null;
  attendance_rate_month?: number | null;
  leave_pending?: number | null;
  payroll_last?: AnalyticsPayrollLast | null;
  upcoming_birthdays?: AnalyticsBirthday[] | null;
  upcoming_anniversaries?: AnalyticsAnniversary[] | null;
}

/**
 * Narrows the hook's `Json` payload to the structured `OrgAnalytics` view.
 * Returns `null` for any non-object value so callers can fall back cleanly.
 */
export function asOrgAnalytics(value: unknown): OrgAnalytics | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as OrgAnalytics;
  }
  return null;
}

/**
 * Coerces a value to a finite number, tolerating the string-encoded numbers
 * that `jsonb` RPC payloads can return. Falls back to `null` when not numeric.
 */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerces a (possibly string-encoded) count to a finite number, else 0. */
export function formatCount(value: number | string | null | undefined): number {
  return toNumber(value) ?? 0;
}

/** A share (0–100) of `part` out of `total`, rounded; 0 when total is 0. */
export function sharePct(
  part: number | string | null | undefined,
  total: number | string | null | undefined,
): number {
  const p = formatCount(part);
  const t = formatCount(total);
  if (t <= 0) return 0;
  return Math.round((p / t) * 100);
}

/** Month names for payroll period labels (1-based). */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Builds a "May 2026" style label from a 1-based month + year, if present. */
export function payrollPeriodLabel(
  payroll: AnalyticsPayrollLast | null | undefined,
): string | null {
  if (!payroll) return null;
  const m = payroll.period_month;
  const y = payroll.period_year;
  if (typeof m === "number" && m >= 1 && m <= 12 && typeof y === "number") {
    return `${MONTHS[m - 1]} ${y}`;
  }
  if (typeof y === "number") return String(y);
  return null;
}

/** Formats a net pay amount as a localized currency-ish string (no symbol). */
export function formatMoney(
  value: number | string | null | undefined,
): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
