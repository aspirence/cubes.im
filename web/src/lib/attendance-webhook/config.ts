/**
 * Attendance-webhook payload mapping — the "fully customizable" contract shared
 * by the inbound receiver route and the HR settings UI. Every key is optional
 * in the stored `attendance_webhooks.config` jsonb; `resolveConfig` fills the
 * defaults so both sides agree on the effective mapping. Pure/isomorphic: no
 * server or client imports.
 */

export interface AttendanceWebhookConfig {
  /** Which hr_employees column the payload's employee key matches. */
  employee_match: "employee_code" | "work_email" | "employee_id";
  /** Dot-path into each event for the employee key. */
  employee_field: string;
  /** Dot-path for the punch-type value. */
  event_field: string;
  /** event_field values meaning clock-IN (case-insensitive). */
  in_values: string[];
  /** event_field values meaning clock-OUT (case-insensitive). */
  out_values: string[];
  /** Fallback when event_field resolves to nothing. 'auto' = first punch of the day is IN. */
  default_direction: "auto" | "in" | "out";
  /** Dot-path for the punch time (ISO 8601 or unix seconds/ms). Empty ⇒ arrival time. */
  timestamp_field: string;
  /** Dot-path to an ARRAY of events for batch payloads. Empty ⇒ the body itself. */
  events_field: string;
  /** IANA zone used to derive the attendance DATE from the punch time. */
  timezone: string;
  /** Reject deliveries without a valid X-Signature (needs a signing secret). */
  require_signature: boolean;
}

export const DEFAULT_ATTENDANCE_WEBHOOK_CONFIG: AttendanceWebhookConfig = {
  employee_match: "employee_code",
  employee_field: "employee",
  event_field: "event",
  in_values: ["in", "checkin", "check_in", "clock_in", "entry", "0"],
  out_values: ["out", "checkout", "check_out", "clock_out", "exit", "1"],
  default_direction: "auto",
  timestamp_field: "timestamp",
  events_field: "",
  timezone: "UTC",
  require_signature: false,
};

const EMPLOYEE_MATCHES = new Set(["employee_code", "work_email", "employee_id"]);
const DIRECTIONS = new Set(["auto", "in", "out"]);
/** Cap for every configured string — keeps paths safely embeddable in the
 *  ≤1000-char delivery-log error column. */
const MAX_CONFIG_STRING = 200;

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  // Trim entries: the tags input happily stores " checkin", which would then
  // never match the trimmed payload value in the receiver.
  const list = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, MAX_CONFIG_STRING))
    .filter((v) => v !== "");
  return list.length > 0 ? list : fallback;
}

/** True when Intl recognizes the IANA zone (isomorphic — browser and Node). */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Overlays a stored config jsonb onto the defaults, dropping invalid values. */
export function resolveAttendanceWebhookConfig(
  raw: unknown,
): AttendanceWebhookConfig {
  const d = DEFAULT_ATTENDANCE_WEBHOOK_CONFIG;
  const c = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" ? v.trim().slice(0, MAX_CONFIG_STRING) : fallback;
  const match = str(c.employee_match, d.employee_match);
  const dir = str(c.default_direction, d.default_direction);
  // An unknown zone would make EVERY punch raise inside the RPC — fall back to
  // UTC here so a typo degrades the date bucketing instead of bricking intake.
  const timezone = str(c.timezone, d.timezone) || d.timezone;
  return {
    employee_match: (EMPLOYEE_MATCHES.has(match)
      ? match
      : d.employee_match) as AttendanceWebhookConfig["employee_match"],
    employee_field: str(c.employee_field, d.employee_field) || d.employee_field,
    event_field: str(c.event_field, d.event_field),
    in_values: stringList(c.in_values, d.in_values),
    out_values: stringList(c.out_values, d.out_values),
    default_direction: (DIRECTIONS.has(dir)
      ? dir
      : d.default_direction) as AttendanceWebhookConfig["default_direction"],
    timestamp_field: str(c.timestamp_field, d.timestamp_field),
    events_field: str(c.events_field, d.events_field),
    timezone: isValidTimezone(timezone) ? timezone : d.timezone,
    require_signature: c.require_signature === true,
  };
}

/** Reads a dot-path ("a.b.c") out of a nested object; '' returns the value itself. */
export function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** The zone's UTC offset (ms) at a given instant, via Intl (no dependencies). */
function timezoneOffsetMs(atMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) parts[p.type] = p.value;
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some ICU versions render midnight as "24".
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return wall - atMs;
}

/** Converts wall-clock components in an IANA zone to a UTC instant (two-pass
 *  offset resolution — the second pass corrects around DST transitions). */
function zonedWallClockToUtc(
  y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number,
  timeZone: string,
): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const first = timezoneOffsetMs(asUtc, timeZone);
  const second = timezoneOffsetMs(asUtc - first, timeZone);
  return new Date(asUtc - second);
}

/** "2026-07-18T09:00:00", "2026-07-18 09:00", "2026-07-18" — no zone/offset. */
const ZONELESS_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?)?$/;

/**
 * Parses a punch timestamp: ISO 8601, unix seconds, or unix milliseconds.
 * Zone-LESS strings (the format most devices emit) are wall-clock times in
 * `timezone` — NOT the server's local zone, which would skew every punch by
 * the server-vs-org offset. Strings with an explicit offset/Z keep it.
 * Returns null when unparseable.
 */
export function parsePunchTimestamp(
  value: unknown,
  timezone = "UTC",
): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: values before year ~2286 in ms are > 1e12; seconds are < 1e11.
    const ms = value < 1e11 ? value * 1000 : value;
    const date = new Date(ms);
    return isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return parsePunchTimestamp(Number(trimmed));
    const zoneless = ZONELESS_RE.exec(trimmed);
    if (zoneless) {
      const [, y, mo, d, h, mi, s, frac] = zoneless;
      return zonedWallClockToUtc(
        Number(y), Number(mo), Number(d),
        Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0),
        Number((frac ?? "0").padEnd(3, "0")),
        isValidTimezone(timezone) ? timezone : "UTC",
      );
    }
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}
