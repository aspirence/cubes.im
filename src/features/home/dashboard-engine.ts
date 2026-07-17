import dayjs from "dayjs";
import type { TeamTaskWithProject } from "@/features/tasks/use-all-tasks";
import type {
  CardFilter,
  GroupBy,
  MetricKind,
  DueFilter,
} from "./dashboard-types";

/**
 * A task's due day is bucketed in the VIEWER's local timezone. Due dates are
 * authored with a date-only picker (stored as local-midnight → UTC), so there
 * is no perfectly timezone-stable answer without the author's zone; we pick the
 * viewer-local interpretation to stay consistent with the rest of the app
 * (e.g. the task drawer's own overdue badge). Every comparison below shares
 * this basis so all cards agree with one another.
 */
function startOfToday() {
  return dayjs().startOf("day");
}
function weekBounds() {
  const start = dayjs().startOf("week");
  return { start, end: start.add(1, "week") };
}

/**
 * Identity colours for groups that have no colour of their own (assignees, and
 * status/project fallbacks). Order is load-bearing, not cosmetic: it is chosen
 * so that ADJACENT slots stay apart for colour-blind readers.
 *
 * Each mode is its own selected set validated against that mode's surface — a
 * dark palette is not a flipped light one. Both sets pass the full gate
 * (lightness band, chroma floor, CVD separation, normal-vision floor):
 *   light on #ffffff — worst adjacent CVD ΔE 9.1, normal-vision ΔE 19.6
 *   dark  on #14171f — worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3
 * The previous single 8-hue list failed both: two slots read as gray, and
 * orange↔magenta sat at ΔE 10 — indistinguishable even with full colour vision.
 * If you change a hue here, re-run the palette validator on the new ordering.
 */
export const PALETTE_LIGHT = [
  "#5a5ad6", // indigo (brand)
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
  "#e34948", // red
];

export const PALETTE_DARK = [
  "#7b7bea",
  "#008300",
  "#d55181",
  "#c98500",
  "#199e70",
  "#d95926",
  "#9085e9",
  "#e66767",
];

/** Default (light) palette — kept as the historical export name. */
export const PALETTE = PALETTE_LIGHT;

export function paletteFor(dark: boolean): string[] {
  return dark ? PALETTE_DARK : PALETTE_LIGHT;
}

function colorForKey(key: string, palette: string[]): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

const isOpen = (t: TeamTaskWithProject) => !t.done;

function matchesDue(t: TeamTaskWithProject, due: DueFilter): boolean {
  if (due === "any") return true;
  if (!t.end_date) return due === "no-date";
  if (due === "no-date") return false;
  const d = dayjs(t.end_date);
  const today = startOfToday();
  switch (due) {
    case "overdue":
      return d.isBefore(today);
    case "today":
      return d.isSame(today, "day");
    case "week": {
      const { start, end } = weekBounds();
      return !d.isBefore(start) && d.isBefore(end);
    }
    case "week-overdue": {
      // Overdue OR due within the current week.
      const { end } = weekBounds();
      return d.isBefore(today) || d.isBefore(end);
    }
    case "upcoming":
      return !d.isBefore(today);
    default:
      return true;
  }
}

/**
 * Applies a card's population filters — scope, projects, assignees, priority,
 * status — but NOT completion/due (those are layered on per card type so that,
 * e.g., "completed this week" can look at done tasks regardless of the toggle).
 */
export function scopeTasks(
  tasks: TeamTaskWithProject[],
  filter: CardFilter,
  myTeamMemberId: string | undefined,
): TeamTaskWithProject[] {
  const projects = new Set(filter.projectIds);
  const assignees = new Set(filter.assigneeIds);
  const priorities = new Set(filter.priorities.map((p) => p.toLowerCase()));
  const statuses = new Set(filter.statuses.map((s) => s.toLowerCase()));

  return tasks.filter((t) => {
    if (filter.scope === "me") {
      if (!myTeamMemberId) return false;
      if (!t.assignees.some((a) => a.team_member_id === myTeamMemberId)) {
        return false;
      }
    }
    if (projects.size > 0 && !projects.has(t.project_id)) return false;
    if (
      assignees.size > 0 &&
      !t.assignees.some((a) => assignees.has(a.team_member_id))
    ) {
      return false;
    }
    if (
      priorities.size > 0 &&
      !priorities.has((t.priority?.name ?? "").toLowerCase())
    ) {
      return false;
    }
    if (
      statuses.size > 0 &&
      !statuses.has((t.status?.name ?? "").toLowerCase())
    ) {
      return false;
    }
    return true;
  });
}

/** True when the task was completed inside the requested window (viewer-local). */
function completedWithin(
  t: TeamTaskWithProject,
  window: NonNullable<CardFilter["completedWithin"]>,
): boolean {
  if (!t.done || !t.completed_at) return false;
  const c = dayjs(t.completed_at);
  const today = startOfToday();
  switch (window) {
    case "today":
      return c.isSame(today, "day");
    case "week": {
      const { start, end } = weekBounds();
      return !c.isBefore(start) && c.isBefore(end);
    }
    case "month":
      return c.isSame(today, "month");
    default:
      return true;
  }
}

/** Population + completion + due filters — the set a chart/list card renders. */
export function visibleTasks(
  tasks: TeamTaskWithProject[],
  filter: CardFilter,
  myTeamMemberId: string | undefined,
): TeamTaskWithProject[] {
  const doneWindow = filter.completedWithin ?? "any";
  return scopeTasks(tasks, filter, myTeamMemberId).filter((t) => {
    if (doneWindow !== "any") {
      // Throughput mode: the population is "what got DONE in the window".
      // `includeCompleted` is moot here, and the due filter still composes on
      // top (e.g. "completed this week that was overdue").
      if (!completedWithin(t, doneWindow)) return false;
    } else if (!filter.includeCompleted && !isOpen(t)) {
      return false;
    }
    if (!matchesDue(t, filter.due)) return false;
    return true;
  });
}

export interface GroupDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

const DUE_BUCKET_ORDER = [
  "Overdue",
  "Today",
  "This week",
  "Later",
  "No date",
] as const;

function dueBucket(t: TeamTaskWithProject): string {
  if (!t.end_date) return "No date";
  const d = dayjs(t.end_date);
  const today = startOfToday();
  if (d.isBefore(today)) return "Overdue";
  if (d.isSame(today, "day")) return "Today";
  const { end } = weekBounds();
  if (d.isBefore(end)) return "This week";
  return "Later";
}

const DUE_BUCKET_COLOR: Record<string, string> = {
  Overdue: "#e0663f",
  Today: "#e0a83e",
  "This week": "#5a5ad6",
  Later: "#3a9d6e",
  "No date": "#8a8d98",
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "#e0663f",
  medium: "#e0a83e",
  low: "#3a9d6e",
};

/**
 * Groups visible tasks into chart-ready buckets by the chosen dimension.
 * `assigneeAllow` (when non-empty) restricts assignee counting to those
 * team_member ids, so a card filtered to specific assignees (or scope='me')
 * doesn't leak a task's OTHER co-assignees into the chart.
 */
export function groupTasks(
  tasks: TeamTaskWithProject[],
  groupBy: GroupBy,
  assigneeAllow?: Set<string>,
  palette: string[] = PALETTE_LIGHT,
): GroupDatum[] {
  const acc = new Map<string, GroupDatum>();
  const bump = (key: string, label: string, color: string) => {
    const cur = acc.get(key);
    if (cur) cur.value += 1;
    else acc.set(key, { key, label, value: 1, color });
  };
  const restrict = assigneeAllow && assigneeAllow.size > 0 ? assigneeAllow : null;

  for (const t of tasks) {
    switch (groupBy) {
      case "assignee": {
        const counted = restrict
          ? t.assignees.filter((a) => restrict.has(a.team_member_id))
          : t.assignees;
        if (counted.length === 0) {
          if (!restrict) bump("__none", "Unassigned", "#c3c5cc");
          break;
        }
        for (const a of counted) {
          const name = a.team_member?.user?.name ?? "Member";
          bump(a.team_member_id, name, colorForKey(a.team_member_id, palette));
        }
        break;
      }
      case "status": {
        const name = t.status?.name ?? "No status";
        const color = t.status?.category?.color_code ?? colorForKey(name, palette);
        bump(name, name, color);
        break;
      }
      case "priority": {
        const name = t.priority?.name ?? "None";
        const color =
          PRIORITY_COLOR[name.toLowerCase()] ??
          t.priority?.color_code ??
          "#8a8d98";
        bump(name, name, color);
        break;
      }
      case "project": {
        const name = t.project?.name ?? "Project";
        bump(t.project_id, name, t.project?.color_code ?? colorForKey(name, palette));
        break;
      }
      case "due-bucket": {
        const b = dueBucket(t);
        bump(b, b, DUE_BUCKET_COLOR[b] ?? "#8a8d98");
        break;
      }
    }
  }

  const rows = [...acc.values()];
  if (groupBy === "due-bucket") {
    return rows.sort(
      (a, b) =>
        DUE_BUCKET_ORDER.indexOf(a.label as never) -
        DUE_BUCKET_ORDER.indexOf(b.label as never),
    );
  }
  if (groupBy === "priority") {
    const order = ["high", "medium", "low", "none"];
    return rows.sort(
      (a, b) =>
        order.indexOf(a.label.toLowerCase()) -
        order.indexOf(b.label.toLowerCase()),
    );
  }
  return rows.sort((a, b) => b.value - a.value);
}

/**
 * The tasks behind one chart group — the drill-down twin of `groupTasks`, so
 * clicking a mark shows exactly the rows that mark counted. The keying here
 * MUST mirror `groupTasks` (including the `assigneeAllow` leak guard), or a
 * drill-down would disagree with the number it came from.
 */
export function tasksInGroup(
  tasks: TeamTaskWithProject[],
  groupBy: GroupBy,
  key: string,
  assigneeAllow?: Set<string>,
): TeamTaskWithProject[] {
  const restrict = assigneeAllow && assigneeAllow.size > 0 ? assigneeAllow : null;
  return tasks.filter((t) => {
    switch (groupBy) {
      case "assignee": {
        const counted = restrict
          ? t.assignees.filter((a) => restrict.has(a.team_member_id))
          : t.assignees;
        if (key === "__none") return !restrict && counted.length === 0;
        return counted.some((a) => a.team_member_id === key);
      }
      case "status":
        return (t.status?.name ?? "No status") === key;
      case "priority":
        return (t.priority?.name ?? "None") === key;
      case "project":
        return t.project_id === key;
      case "due-bucket":
        return dueBucket(t) === key;
      default:
        return false;
    }
  });
}

/** Computes a single metric over the scoped population (its own completion/due). */
export function computeMetric(
  tasks: TeamTaskWithProject[],
  filter: CardFilter,
  metric: MetricKind,
  myTeamMemberId: string | undefined,
): number {
  const pop = scopeTasks(tasks, filter, myTeamMemberId);
  const today = startOfToday();
  const { start, end } = weekBounds();

  switch (metric) {
    case "open":
      return pop.filter(isOpen).length;
    case "overdue":
      return pop.filter(
        (t) => isOpen(t) && t.end_date && dayjs(t.end_date).isBefore(today),
      ).length;
    case "due-today":
      return pop.filter(
        (t) => isOpen(t) && t.end_date && dayjs(t.end_date).isSame(today, "day"),
      ).length;
    case "due-week":
      return pop.filter((t) => {
        if (!isOpen(t) || !t.end_date) return false;
        const d = dayjs(t.end_date);
        return !d.isBefore(start) && d.isBefore(end);
      }).length;
    case "in-progress":
      return pop.filter((t) => isOpen(t) && t.status?.category?.is_doing).length;
    case "completed-week":
      return pop.filter((t) => {
        if (!t.done || !t.completed_at) return false;
        const c = dayjs(t.completed_at);
        return !c.isBefore(start) && c.isBefore(end);
      }).length;
    case "total":
      return pop.length;
    default:
      return 0;
  }
}

/** Distinct status + priority names present in the loaded team tasks (for filter menus). */
export function distinctFacets(tasks: TeamTaskWithProject[]): {
  statuses: string[];
  priorities: string[];
} {
  // Dedupe case-insensitively (matching how filters compare), keeping the
  // first-seen casing for display.
  const statuses = new Map<string, string>();
  const priorities = new Map<string, string>();
  for (const t of tasks) {
    const s = t.status?.name;
    if (s && !statuses.has(s.toLowerCase())) statuses.set(s.toLowerCase(), s);
    const p = t.priority?.name;
    if (p && !priorities.has(p.toLowerCase())) priorities.set(p.toLowerCase(), p);
  }
  return {
    statuses: [...statuses.values()].sort(),
    priorities: [...priorities.values()].sort(),
  };
}
