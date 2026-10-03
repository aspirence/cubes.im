import type { ScheduleTriggerConfig } from "./app-action-catalog";

/**
 * The TypeScript twin of SQL `workflow_schedule_next_run` (migration
 * 20261128000000_app_runner_workflows.sql), for previews in the builder:
 * "next runs: Mon 09:00, Tue 09:00, …". The database stays the authority —
 * workflows.next_run_at is always computed there — so this only has to agree
 * with it, and a test checks that it does for a spread of configs and zones.
 *
 * Pure, no imports beyond a type: it runs in the browser and under node tests.
 */

const MINUTE = 60_000;

/** Browsers still report some legacy zone names; Intl accepts them all. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The SQL recurrence_timezone(): a zone Intl cannot use falls back to UTC. */
export function validTimeZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0);
    return zone;
  } catch {
    return "UTC";
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = partsCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(zone, f);
  }
  return f;
}

interface Local {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
}

/** Wall-clock fields of an instant in a zone. */
function localParts(ms: number, zone: string): Local {
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute };
}

/** The zone's UTC offset at an instant, in minutes (east positive). */
function offsetAt(ms: number, zone: string): number {
  const l = localParts(ms, zone);
  const asUtc = Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi);
  return Math.round((asUtc - Math.floor(ms / MINUTE) * MINUTE) / MINUTE);
}

/**
 * Wall-clock fields in a zone → the instant, resolved the way Postgres's
 * `timestamp AT TIME ZONE zone` does: a time that exists once maps to it; a
 * time in a spring-forward gap takes the offset from before the jump; a time
 * that exists twice (fall-back overlap) takes the offset from after it.
 */
function localToInstant(l: Local, zone: string): number {
  const naive = Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi);
  const before = offsetAt(naive - 36 * 60 * MINUTE, zone);
  const after = offsetAt(naive + 36 * 60 * MINUTE, zone);
  const valid = [before, after].filter(
    (o, i, all) => all.indexOf(o) === i && offsetAt(naive - o * MINUTE, zone) === o,
  );
  if (valid.length === 1) return naive - valid[0] * MINUTE;
  if (valid.length === 2) return naive - after * MINUTE;
  // In a gap: neither offset produces this wall-clock time, and Postgres
  // uses the one from before the jump (02:30 on spring-forward day → 03:30).
  return naive - before * MINUTE;
}

function parseTime(time: string | undefined): { hh: number; mm: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh <= 23 && mm <= 59) return { hh, mm };
  }
  return { hh: 9, mm: 0 };
}

function intervalMinutes(c: ScheduleTriggerConfig): number {
  const raw = c.interval_minutes as unknown;
  const n =
    typeof raw === "number" && Number.isInteger(raw) && raw >= 0
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? Number(raw)
        : 60;
  return Math.min(Math.max(n, 15), 720);
}

function weekDays(c: ScheduleTriggerConfig): number[] {
  const days = Array.isArray(c.days)
    ? c.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];
  return days.length ? days : [1];
}

/** The first instant strictly after `after` that matches the config, or null. */
export function nextScheduleRun(c: ScheduleTriggerConfig | null | undefined, after: Date): Date | null {
  if (!c || typeof c !== "object" || !c.frequency) return null;
  const zone = validTimeZone(c.timezone);
  const afterMs = after.getTime();
  const { hh, mm } = parseTime(c.time);

  switch (c.frequency) {
    case "every_n_minutes": {
      // A fixed grid from the Unix epoch, same as SQL.
      const step = intervalMinutes(c) * MINUTE;
      return new Date((Math.floor(afterMs / step) + 1) * step);
    }
    case "hourly": {
      let cand = Math.floor(afterMs / MINUTE) * MINUTE + MINUTE;
      for (let i = 0; i < 4; i++) {
        const n = localParts(cand, zone).mi;
        if (n === mm) break;
        cand += ((mm - n + 60) % 60) * MINUTE;
      }
      return new Date(cand);
    }
    case "daily":
    case "weekly": {
      const days = c.frequency === "weekly" ? weekDays(c) : null;
      const start = localParts(afterMs, zone);
      // Walk calendar days in the zone; Date.UTC on (y, m, d + i) normalises
      // month/year roll-over.
      for (let i = 0; i <= 8; i++) {
        const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
        if (days && !days.includes(day.getUTCDay())) continue;
        const cand = localToInstant(
          { y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate(), h: hh, mi: mm },
          zone,
        );
        if (cand > afterMs) return new Date(cand);
      }
      return null;
    }
    default:
      return null;
  }
}

/** The next `count` run instants after `from` (the builder shows three). */
export function previewScheduleRuns(
  c: ScheduleTriggerConfig | null | undefined,
  count = 3,
  from: Date = new Date(),
): Date[] {
  const out: Date[] = [];
  let cursor: Date | null = from;
  while (out.length < count && cursor) {
    cursor = nextScheduleRun(c, cursor);
    if (cursor) out.push(cursor);
  }
  return out;
}

/** Validation the builder runs before saving; null when the config is usable. */
export function scheduleConfigProblem(c: ScheduleTriggerConfig): string | null {
  if (c.frequency === "every_n_minutes") {
    const n = c.interval_minutes;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 15 || n > 720) {
      return "Pick an interval between 15 and 720 minutes.";
    }
  }
  if ((c.frequency === "daily" || c.frequency === "weekly") && !/^\d{1,2}:\d{2}$/.test(c.time ?? "")) {
    return "Pick a time of day.";
  }
  if (c.frequency === "weekly" && !(c.days ?? []).length) {
    return "Pick at least one day.";
  }
  if (validTimeZone(c.timezone) !== c.timezone) {
    return "That time zone is not recognised.";
  }
  return null;
}

/** A run instant in the schedule's own zone, e.g. "Mon 21 Sep, 09:00". */
export function formatInZone(d: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: validTimeZone(zone),
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
