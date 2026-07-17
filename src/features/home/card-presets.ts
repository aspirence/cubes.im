import {
  DEFAULT_FILTER,
  type DashboardCard,
  type CardFilter,
} from "./dashboard-types";

/**
 * Prebuilt analytics — complete card configurations for the questions teams
 * actually ask ("who did what this week", "where is the overdue risk"), offered
 * in the Add-card gallery as starting points. A preset only SEEDS the draft:
 * every filter stays editable afterwards, so one preset covers many cases.
 *
 * `level` is the access contract the role gate keys on:
 *  - "team" — reads the whole team's work or reveals member identities
 *    (team scope, assignee grouping). Offered to owner/admin/member; for a
 *    member the numbers cover only the spaces/projects they can access (RLS).
 *  - "user" — the viewer's own work only. The full offer for limited members.
 *
 * Presets promise only what the engine can honestly answer from task data.
 * Anything needing another source (cubes, time logs) doesn't belong here.
 */
export interface CardPreset {
  key: string;
  title: string;
  /** One line on the question this card answers. */
  description: string;
  /** Material Symbols glyph. */
  icon: string;
  category:
    | "Performance"
    | "Workload"
    | "Deadlines"
    | "Overview"
    | "KPIs"
    | "Lists"
    | "Personal";
  /** Access level — see the doc comment above. */
  level: "user" | "team";
  /** Shown in the gallery's Featured rail. */
  featured?: boolean;
  card: Omit<DashboardCard, "id">;
}

function filter(p: Partial<CardFilter> = {}): CardFilter {
  return { ...DEFAULT_FILTER, ...p };
}

export const CARD_PRESETS: CardPreset[] = [
  /* ---------------------------------------------------------- performance */
  {
    key: "perf-completed-week-member",
    title: "Weekly performance by member",
    description: "Tasks each person completed this week — the throughput view.",
    icon: "trophy",
    category: "Performance",
    level: "team",
    featured: true,
    card: {
      kind: "chart",
      title: "Completed this week by member",
      span: "half",
      w: 2,
      chart: "bar",
      groupBy: "assignee",
      filter: filter({ completedWithin: "week" }),
    },
  },
  {
    key: "perf-completed-week-project",
    title: "Delivery by project",
    description: "Where this week's completed work landed, project by project.",
    icon: "rocket_launch",
    category: "Performance",
    level: "team",
    card: {
      kind: "chart",
      title: "Completed this week by project",
      span: "half",
      w: 2,
      chart: "hbar",
      groupBy: "project",
      filter: filter({ completedWithin: "week" }),
    },
  },
  {
    key: "perf-completed-today",
    title: "Completed today",
    description: "Today's finished tasks, by member.",
    icon: "task_alt",
    category: "Performance",
    level: "team",
    card: {
      kind: "chart",
      title: "Completed today",
      span: "half",
      w: 2,
      chart: "lollipop",
      groupBy: "assignee",
      filter: filter({ completedWithin: "today" }),
    },
  },
  {
    key: "perf-monthly-mix",
    title: "Monthly delivery mix",
    description: "This month's completed work split by project.",
    icon: "calendar_month",
    category: "Performance",
    level: "team",
    card: {
      kind: "chart",
      title: "Completed this month by project",
      span: "half",
      w: 2,
      chart: "donut",
      groupBy: "project",
      filter: filter({ completedWithin: "month" }),
    },
  },
  {
    key: "perf-my-week",
    title: "My weekly throughput",
    description: "What you personally completed this week, by project.",
    icon: "military_tech",
    category: "Performance",
    level: "user",
    featured: true,
    card: {
      kind: "chart",
      title: "My completed this week",
      span: "half",
      w: 2,
      chart: "hbar",
      groupBy: "project",
      filter: filter({ scope: "me", completedWithin: "week" }),
    },
  },

  /* -------------------------------------------------------------- workload */
  {
    key: "load-open-by-member",
    title: "Workload by member",
    description: "Open tasks on each person's plate — spot over/under-allocation.",
    icon: "groups",
    category: "Workload",
    level: "team",
    featured: true,
    card: {
      kind: "chart",
      title: "Open tasks by member",
      span: "half",
      w: 2,
      chart: "bar",
      groupBy: "assignee",
      filter: filter(),
    },
  },
  {
    key: "load-by-project",
    title: "Workload by project",
    description: "Where the open work is concentrated across projects.",
    icon: "folder_open",
    category: "Workload",
    level: "team",
    card: {
      kind: "chart",
      title: "Workload by project",
      span: "half",
      w: 2,
      chart: "hbar",
      groupBy: "project",
      filter: filter(),
    },
  },
  {
    key: "load-priority-by-member",
    title: "High-priority load",
    description: "Who is carrying the high-priority work right now.",
    icon: "priority_high",
    category: "Workload",
    level: "team",
    card: {
      kind: "chart",
      title: "High-priority tasks by member",
      span: "half",
      w: 2,
      chart: "bar",
      groupBy: "assignee",
      filter: filter({ priorities: ["High"] }),
    },
  },
  {
    key: "load-my-projects",
    title: "My load by project",
    description: "Your open tasks, split across the projects they belong to.",
    icon: "person_apron",
    category: "Workload",
    level: "user",
    card: {
      kind: "chart",
      title: "My open tasks by project",
      span: "half",
      w: 2,
      chart: "hbar",
      groupBy: "project",
      filter: filter({ scope: "me" }),
    },
  },

  /* ------------------------------------------------------------- deadlines */
  {
    key: "risk-overdue-by-member",
    title: "Overdue by member",
    description: "Who is sitting on overdue tasks — the risk view.",
    icon: "warning",
    category: "Deadlines",
    level: "team",
    featured: true,
    card: {
      kind: "chart",
      title: "Overdue by member",
      span: "half",
      w: 2,
      chart: "bar",
      groupBy: "assignee",
      filter: filter({ due: "overdue" }),
    },
  },
  {
    key: "risk-overdue-by-project",
    title: "Overdue by project",
    description: "Which projects the overdue work belongs to.",
    icon: "report",
    category: "Deadlines",
    level: "team",
    card: {
      kind: "chart",
      title: "Overdue by project",
      span: "half",
      w: 2,
      chart: "hbar",
      groupBy: "project",
      filter: filter({ due: "overdue" }),
    },
  },
  {
    key: "risk-due-week-member",
    title: "This week's plate",
    description: "Tasks due this week, per member — what must land by Friday.",
    icon: "event_upcoming",
    category: "Deadlines",
    level: "team",
    card: {
      kind: "chart",
      title: "Due this week by member",
      span: "half",
      w: 2,
      chart: "bar",
      groupBy: "assignee",
      filter: filter({ due: "week" }),
    },
  },
  {
    key: "risk-pipeline",
    title: "Due-date pipeline",
    description: "Open work bucketed by when it's due — overdue through later.",
    icon: "timeline",
    category: "Deadlines",
    level: "team",
    card: {
      kind: "chart",
      title: "Due-date pipeline",
      span: "half",
      w: 2,
      chart: "bar",
      groupBy: "due-bucket",
      filter: filter(),
    },
  },
  {
    key: "risk-my-pipeline",
    title: "My due-date pipeline",
    description: "Your own open tasks bucketed by when they're due.",
    icon: "hourglass_top",
    category: "Deadlines",
    level: "user",
    card: {
      kind: "chart",
      title: "My due-date pipeline",
      span: "half",
      w: 2,
      chart: "bar",
      groupBy: "due-bucket",
      filter: filter({ scope: "me" }),
    },
  },

  /* -------------------------------------------------------------- overview */
  {
    key: "mix-status",
    title: "Status breakdown",
    description: "Every open task by its current status.",
    icon: "donut_small",
    category: "Overview",
    level: "team",
    featured: true,
    card: {
      kind: "chart",
      title: "Tasks by status",
      span: "half",
      w: 2,
      chart: "donut",
      groupBy: "status",
      filter: filter(),
    },
  },
  {
    key: "mix-priority",
    title: "Priority mix",
    description: "How the open work splits across priorities.",
    icon: "flag",
    category: "Overview",
    level: "team",
    card: {
      kind: "chart",
      title: "Tasks by priority",
      span: "half",
      w: 2,
      chart: "donut",
      groupBy: "priority",
      filter: filter(),
    },
  },
  {
    key: "me-status",
    title: "My status breakdown",
    description: "Your own open tasks by status.",
    icon: "account_circle",
    category: "Overview",
    level: "user",
    card: {
      kind: "chart",
      title: "My tasks by status",
      span: "half",
      w: 2,
      chart: "donut",
      groupBy: "status",
      filter: filter({ scope: "me" }),
    },
  },
  {
    key: "me-week",
    title: "My week",
    description: "Your own tasks due this week or already overdue.",
    icon: "person",
    category: "Overview",
    level: "user",
    featured: true,
    card: {
      kind: "chart",
      title: "My week",
      span: "half",
      w: 2,
      chart: "table",
      groupBy: "due-bucket",
      filter: filter({ scope: "me", due: "week-overdue" }),
    },
  },

  /* ------------------------------------------------------------------ KPIs */
  {
    key: "kpi-open",
    title: "Open tasks",
    description: "One number: everything currently open.",
    icon: "counter_1",
    category: "KPIs",
    level: "team",
    card: {
      kind: "metric",
      title: "Open tasks",
      span: "half",
      w: 1,
      metric: "open",
      filter: filter(),
    },
  },
  {
    key: "kpi-overdue",
    title: "Overdue",
    description: "One number: open tasks already past their due date.",
    icon: "alarm",
    category: "KPIs",
    level: "team",
    featured: true,
    card: {
      kind: "metric",
      title: "Overdue",
      span: "half",
      w: 1,
      metric: "overdue",
      filter: filter(),
    },
  },
  {
    key: "kpi-due-week",
    title: "Due this week",
    description: "One number: what's due before the week ends.",
    icon: "event",
    category: "KPIs",
    level: "team",
    card: {
      kind: "metric",
      title: "Due this week",
      span: "half",
      w: 1,
      metric: "due-week",
      filter: filter(),
    },
  },
  {
    key: "kpi-completed-week",
    title: "Completed this week",
    description: "One number: the week's finished work.",
    icon: "verified",
    category: "KPIs",
    level: "team",
    card: {
      kind: "metric",
      title: "Completed this week",
      span: "half",
      w: 1,
      metric: "completed-week",
      filter: filter(),
    },
  },
  {
    key: "kpi-my-open",
    title: "My open tasks",
    description: "One number: your personal open count.",
    icon: "how_to_reg",
    category: "KPIs",
    level: "user",
    card: {
      kind: "metric",
      title: "My open tasks",
      span: "half",
      w: 1,
      metric: "open",
      filter: filter({ scope: "me" }),
    },
  },
  {
    key: "kpi-my-overdue",
    title: "My overdue",
    description: "One number: your own tasks past due.",
    icon: "notification_important",
    category: "KPIs",
    level: "user",
    card: {
      kind: "metric",
      title: "My overdue",
      span: "half",
      w: 1,
      metric: "overdue",
      filter: filter({ scope: "me" }),
    },
  },

  /* ----------------------------------------------------------------- lists */
  {
    key: "list-overdue",
    title: "Overdue tasks",
    description: "The overdue list itself — names, projects, dates.",
    icon: "format_list_bulleted",
    category: "Lists",
    level: "team",
    card: {
      kind: "tasks",
      title: "Overdue tasks",
      span: "full",
      w: 4,
      limit: 12,
      filter: filter({ due: "overdue" }),
    },
  },
  {
    key: "list-due-week",
    title: "Due this week",
    description: "Everything the team must land before the week ends.",
    icon: "checklist",
    category: "Lists",
    level: "team",
    card: {
      kind: "tasks",
      title: "Due this week or overdue",
      span: "full",
      w: 4,
      limit: 12,
      filter: filter({ due: "week-overdue" }),
    },
  },
  {
    key: "list-my-tasks",
    title: "My tasks due soon",
    description: "Your own upcoming tasks, soonest first.",
    icon: "fact_check",
    category: "Lists",
    level: "user",
    featured: true,
    card: {
      kind: "tasks",
      title: "My tasks due soon",
      span: "full",
      w: 4,
      limit: 12,
      filter: filter({ scope: "me", due: "upcoming" }),
    },
  },

  /* -------------------------------------------------------------- personal */
  {
    key: "personal-todos",
    title: "My to-dos",
    description: "Your private checklist — visible only to you.",
    icon: "checklist_rtl",
    category: "Personal",
    level: "user",
    card: {
      kind: "todo",
      title: "My to-dos",
      span: "half",
      w: 2,
      filter: filter(),
    },
  },
  {
    key: "personal-activity",
    title: "Latest activity",
    description: "Recent comments across the work you can access.",
    icon: "forum",
    category: "Personal",
    level: "user",
    card: {
      kind: "activity",
      title: "Latest activity",
      span: "half",
      w: 2,
      filter: filter(),
    },
  },
];

export const PRESET_CATEGORIES: CardPreset["category"][] = [
  "Performance",
  "Workload",
  "Deadlines",
  "Overview",
  "KPIs",
  "Lists",
  "Personal",
];

/** The presets a viewer may be offered (see analytics-access.ts for the why). */
export function presetsForViewer(teamScope: boolean): CardPreset[] {
  return teamScope ? CARD_PRESETS : CARD_PRESETS.filter((p) => p.level === "user");
}
