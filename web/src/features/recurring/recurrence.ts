import dayjs, { type Dayjs } from "dayjs";

/** The recurrence cadence stored in `task_recurring_schedules.schedule_type`. */
export type RecurringScheduleType = "daily" | "weekly" | "monthly";

/** What the pickers edit — a schedule minus its anchor and bookkeeping. */
export interface RecurrenceDraft {
  scheduleType: RecurringScheduleType;
  intervalValue: number;
  /** 0 = Sunday … 6 = Saturday. `null` = the anchor's own weekday. */
  dayOfWeek: number | null;
  /** 1–31. `null` = the anchor's own day of the month. */
  dayOfMonth: number | null;
  /** YYYY-MM-DD, or `null` for a series with no end. */
  endsOn: string | null;
}

export const DEFAULT_RECURRENCE: RecurrenceDraft = {
  scheduleType: "weekly",
  intervalValue: 1,
  dayOfWeek: null,
  dayOfMonth: null,
  endsOn: null,
};

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

/**
 * Why this repeat cannot be saved, or null. The DB has the same rule
 * (task_recurring_schedules_range_check), and hitting it there surfaces a raw
 * Postgres error — or, in the create modal, a task that exists without the
 * repeat the user asked for.
 */
export function recurrenceError(draft: RecurrenceDraft, startsOn: string): string | null {
  if (!Number.isFinite(draft.intervalValue) || draft.intervalValue < 1) {
    return "Repeat every 1 or more.";
  }
  if (draft.endsOn && dayjs(draft.endsOn).isBefore(dayjs(startsOn), "day")) {
    return "The end date is before this task's own day.";
  }
  if (draft.endsOn && previewCopies(draft, startsOn, 1).length === 0) {
    return "The end date is before the first copy would be made.";
  }
  return null;
}

/** "Every other day", "Every 2 weeks on Tuesday", "Every month on day 31". */
export function describeRecurrence(d: RecurrenceDraft): string {
  const n = Math.max(1, d.intervalValue);
  if (d.scheduleType === "daily") {
    return n === 1 ? "Every day" : n === 2 ? "Every other day" : `Every ${n} days`;
  }
  if (d.scheduleType === "weekly") {
    const every = n === 1 ? "Every week" : `Every ${n} weeks`;
    const day = WEEKDAY_OPTIONS.find((w) => w.value === d.dayOfWeek)?.label;
    return day ? `${every} on ${day}` : every;
  }
  const every = n === 1 ? "Every month" : `Every ${n} months`;
  return d.dayOfMonth ? `${every} on day ${d.dayOfMonth}` : every;
}

/**
 * The TS twin of recurrence_first_occurrence() (migration 20261126000000): the
 * first day on the schedule, on or after `from`. Daily: `from` itself. Weekly:
 * the first matching weekday. Monthly: that day this month if it has not
 * passed (clamped to the month's length), otherwise next month's.
 */
export function firstOccurrence(
  scheduleType: RecurringScheduleType,
  dayOfWeek: number,
  dayOfMonth: number,
  from: Dayjs,
): Dayjs {
  if (scheduleType === "weekly") {
    return from.add((dayOfWeek - from.day() + 7) % 7, "day");
  }
  if (scheduleType === "monthly") {
    const thisMonth = Math.min(dayOfMonth, from.daysInMonth());
    if (from.date() <= thisMonth) return from.date(thisMonth);
    const next = from.add(1, "month").startOf("month");
    return next.date(Math.min(dayOfMonth, next.daysInMonth()));
  }
  return from;
}

/**
 * The TS twin of recurrence_next_occurrence(): the occurrence after `after`.
 * Weekly/monthly walk to the requested day rather than adding a flat interval,
 * and day 31 clamps so February is not skipped.
 */
export function nextOccurrence(
  scheduleType: RecurringScheduleType,
  intervalValue: number,
  dayOfWeek: number,
  dayOfMonth: number,
  after: Dayjs,
): Dayjs {
  const n = Math.max(1, intervalValue);
  if (scheduleType === "weekly") {
    const d = after.add(n, "week");
    return d.add((dayOfWeek - d.day() + 7) % 7, "day");
  }
  if (scheduleType === "monthly") {
    const d = after.add(n, "month");
    return d.date(Math.min(dayOfMonth, d.daysInMonth()));
  }
  return after.add(n, "day");
}

/**
 * The days the job will make copies on, as YYYY-MM-DD — the TS twin of the
 * first-copy and walk-forward logic in materialize_recurring_tasks(). This
 * preview is the only thing telling the user what the cron will produce, so
 * keep the two in agreement.
 *
 * `startsOn` is the anchor: the source task's own day. The source covers that
 * day itself, so the first copy is the occurrence after it when it sits on the
 * schedule (a Monday task, weekly → next Monday) and the first on-schedule day
 * after it when it does not (a Saturday task, "weekly on Monday" → this coming
 * Monday). Dates already behind today are skipped, never back-filled.
 */
export function previewCopies(
  draft: RecurrenceDraft,
  startsOn: string,
  count = 3,
): string[] {
  const anchor = dayjs(startsOn).startOf("day");
  const dayOfWeek = draft.dayOfWeek ?? anchor.day();
  const dayOfMonth = draft.dayOfMonth ?? anchor.date();
  const step = (d: Dayjs) =>
    nextOccurrence(draft.scheduleType, draft.intervalValue, dayOfWeek, dayOfMonth, d);

  let d = firstOccurrence(draft.scheduleType, dayOfWeek, dayOfMonth, anchor);
  if (!d.isAfter(anchor, "day")) d = step(anchor);

  const today = dayjs().startOf("day");
  while (d.isBefore(today, "day")) d = step(d);

  const end = draft.endsOn ? dayjs(draft.endsOn).startOf("day") : null;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (end && d.isAfter(end, "day")) break;
    out.push(d.format("YYYY-MM-DD"));
    d = step(d);
  }
  return out;
}
