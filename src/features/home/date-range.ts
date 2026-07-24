/**
 * Dashboard time-range filter. Scopes the task universe fed to every dashboard
 * card to a period (Today / This week / … / All time) so the analytics can be
 * viewed through a time lens without touching individual card definitions.
 *
 * A task "belongs" to a period if it was created, is due (end_date), starts, or
 * was completed within it — an activity-overlap model that keeps a weekly view
 * about this week's work while "All time" shows everything.
 */

export type RangeKey = "today" | "week" | "month" | "quarter" | "year" | "all";

export interface RangeOption {
  key: RangeKey;
  label: string;
}

export const RANGE_OPTIONS: RangeOption[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
];

/** Half-open [start, end) epoch-ms bounds. */
export interface Bounds {
  start: number;
  end: number;
}

/** Local-time boundaries for a range; null = unbounded ("All time"). */
export function rangeBounds(key: RangeKey, now: Date = new Date()): Bounds | null {
  if (key === "all") return null;
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  let start: Date;
  let end: Date;
  switch (key) {
    case "today":
      start = new Date(y, m, d);
      end = new Date(y, m, d + 1);
      break;
    case "week": {
      // Week starts Monday (getDay(): 0 = Sunday → shift to Monday-indexed).
      const dow = (now.getDay() + 6) % 7;
      start = new Date(y, m, d - dow);
      end = new Date(y, m, d - dow + 7);
      break;
    }
    case "month":
      start = new Date(y, m, 1);
      end = new Date(y, m + 1, 1);
      break;
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      start = new Date(y, q, 1);
      end = new Date(y, q + 3, 1);
      break;
    }
    case "year":
      start = new Date(y, 0, 1);
      end = new Date(y + 1, 0, 1);
      break;
    default:
      return null;
  }
  return { start: start.getTime(), end: end.getTime() };
}

const inBounds = (iso: string | null | undefined, b: Bounds): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t >= b.start && t < b.end;
};

/** The task date fields the range filter inspects. */
export interface DatedTask {
  created_at?: string | null;
  completed_at?: string | null;
  end_date?: string | null;
  start_date?: string | null;
  done?: boolean | null;
}

/** True when a task was created, is due, starts, or was completed in the range. */
export function taskInRange(task: DatedTask, b: Bounds): boolean {
  return (
    inBounds(task.created_at, b) ||
    inBounds(task.completed_at, b) ||
    inBounds(task.end_date, b) ||
    inBounds(task.start_date, b)
  );
}

export interface RangeStats {
  /** Tasks in view for the selected period. */
  total: number;
  /** Created within the period (all-time: every task). */
  created: number;
  /** Completed within the period (all-time: every done task). */
  completed: number;
  /** Not done and past due, as of now. */
  overdue: number;
  /** Share of in-view tasks that are done, 0–100. */
  donePct: number;
}

/**
 * Headline numbers for the period summary strip, computed on the already
 * range-scoped task set. `bounds` is null for All time.
 */
export function rangeStats(
  scoped: DatedTask[],
  bounds: Bounds | null,
  now: number = Date.now(),
): RangeStats {
  let created = 0;
  let completed = 0;
  let done = 0;
  let overdue = 0;
  for (const t of scoped) {
    const isDone = Boolean(t.done);
    if (isDone) done += 1;
    if (bounds ? inBounds(t.created_at, bounds) : true) created += 1;
    if (bounds ? inBounds(t.completed_at, bounds) : isDone) completed += 1;
    if (!isDone && t.end_date) {
      const due = new Date(t.end_date).getTime();
      if (!Number.isNaN(due) && due < now) overdue += 1;
    }
  }
  const total = scoped.length;
  return {
    total,
    created,
    completed,
    overdue,
    donePct: total ? Math.round((done / total) * 100) : 0,
  };
}
