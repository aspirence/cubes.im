/**
 * Configurable dashboard card model. A user's Home is an ordered list of these,
 * persisted per-user (user_dashboards.layout). Every card derives from the one
 * team-tasks query and is filtered/grouped client-side, so cards are pure
 * config — no per-card fetch.
 */

export type CardKind = "chart" | "metric" | "tasks" | "activity" | "todo";
export type ChartType = "donut" | "pie" | "bar" | "hbar" | "line" | "area";
export type GroupBy =
  | "assignee"
  | "status"
  | "priority"
  | "project"
  | "due-bucket";
export type DueFilter =
  | "any"
  | "overdue"
  | "today"
  | "week"
  | "week-overdue"
  | "upcoming"
  | "no-date";
export type MetricKind =
  | "open"
  | "overdue"
  | "due-today"
  | "due-week"
  | "in-progress"
  | "completed-week"
  | "total";
export type TaskScope = "team" | "me";

export interface CardFilter {
  scope: TaskScope;
  /** Empty array = all projects. */
  projectIds: string[];
  /** team_members.id — empty = all assignees. */
  assigneeIds: string[];
  /** Priority names — empty = all. */
  priorities: string[];
  /** Status names — empty = all. */
  statuses: string[];
  due: DueFilter;
  /** false (default) = only open tasks; true = include completed. */
  includeCompleted: boolean;
}

export interface DashboardCard {
  id: string;
  kind: CardKind;
  title: string;
  /** Legacy width (kept for back-compat); superseded by `w` column span. */
  span: "half" | "full";
  /** Width in grid columns (1..GRID_COLS). Falls back to `span` when absent. */
  w?: number;
  /** Card body height in px (charts/lists); undefined = natural height. */
  h?: number;
  filter: CardFilter;
  /** chart cards */
  chart?: ChartType;
  groupBy?: GroupBy;
  /** metric cards */
  metric?: MetricKind;
  /** how many rows a `tasks` card shows */
  limit?: number;
}

/** The dashboard grid is this many columns wide on desktop. */
export const GRID_COLS = 4;
export const GRID_GAP = 16;

/** A card's width in columns, derived from `w` or the legacy `span`. */
export function cardCols(card: DashboardCard): number {
  const raw = card.w ?? (card.span === "full" ? GRID_COLS : 2);
  return Math.max(1, Math.min(GRID_COLS, Math.round(raw)));
}

export const DEFAULT_FILTER: CardFilter = {
  scope: "team",
  projectIds: [],
  assigneeIds: [],
  priorities: [],
  statuses: [],
  due: "any",
  includeCompleted: false,
};

/* ------------------------------------------------------------- option lists */

export const CARD_KIND_OPTIONS: { value: CardKind; label: string }[] = [
  { value: "chart", label: "Chart" },
  { value: "metric", label: "Number (KPI)" },
  { value: "tasks", label: "Task list" },
  { value: "activity", label: "Activity feed" },
  { value: "todo", label: "Personal to-dos" },
];

export const CHART_TYPE_OPTIONS: { value: ChartType; label: string }[] = [
  { value: "donut", label: "Donut" },
  { value: "pie", label: "Pie" },
  { value: "bar", label: "Bar (vertical)" },
  { value: "hbar", label: "Bar (horizontal)" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
];

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "assignee", label: "Assignee" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "project", label: "Project" },
  { value: "due-bucket", label: "Due date" },
];

export const METRIC_OPTIONS: { value: MetricKind; label: string }[] = [
  { value: "open", label: "Open tasks" },
  { value: "overdue", label: "Overdue" },
  { value: "due-today", label: "Due today" },
  { value: "due-week", label: "Due this week" },
  { value: "in-progress", label: "In progress" },
  { value: "completed-week", label: "Completed this week" },
  { value: "total", label: "Total tasks" },
];

export const DUE_FILTER_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "any", label: "Any due date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
  { value: "week-overdue", label: "This week or overdue" },
  { value: "upcoming", label: "Upcoming (today onward)" },
  { value: "no-date", label: "No due date" },
];

export const SCOPE_OPTIONS: { value: TaskScope; label: string }[] = [
  { value: "team", label: "Whole team" },
  { value: "me", label: "Only me" },
];

/* ---------------------------------------------------------- default presets */

let cardSeq = 0;
/** Stable-ish id for a seeded card (deterministic; runtime cards use randomUUID). */
function seedId(kind: string): string {
  cardSeq += 1;
  return `seed-${kind}-${cardSeq}`;
}

function chartCard(
  title: string,
  chart: ChartType,
  groupBy: GroupBy,
  span: "half" | "full",
  filter: Partial<CardFilter> = {},
): DashboardCard {
  return {
    id: seedId("chart"),
    kind: "chart",
    title,
    span,
    w: span === "full" ? 4 : 2,
    chart,
    groupBy,
    filter: { ...DEFAULT_FILTER, ...filter },
  };
}

function metricCard(
  title: string,
  metric: MetricKind,
  filter: Partial<CardFilter> = {},
): DashboardCard {
  return {
    id: seedId("metric"),
    kind: "metric",
    title,
    span: "half",
    w: 1,
    metric,
    filter: { ...DEFAULT_FILTER, ...filter },
  };
}

/** The starter dashboard (team-oriented, resembling a weekly overview). */
export function defaultDashboardCards(): DashboardCard[] {
  cardSeq = 0;
  return [
    metricCard("Open tasks", "open"),
    metricCard("Overdue", "overdue"),
    metricCard("Due this week", "due-week"),
    metricCard("Completed this week", "completed-week"),
    chartCard("Open tasks by assignee", "bar", "assignee", "half"),
    chartCard("Tasks by status", "donut", "status", "half"),
    chartCard("Workload by project", "hbar", "project", "half"),
    chartCard("Tasks by priority", "donut", "priority", "half"),
    {
      id: seedId("tasks"),
      kind: "tasks",
      title: "Tasks due this week or overdue",
      span: "full",
      w: 4,
      limit: 12,
      filter: { ...DEFAULT_FILTER, due: "week-overdue" },
    },
    {
      id: seedId("activity"),
      kind: "activity",
      title: "Latest activity",
      span: "half",
      w: 2,
      filter: { ...DEFAULT_FILTER },
    },
    {
      id: seedId("todo"),
      kind: "todo",
      title: "My to-dos",
      span: "half",
      w: 2,
      filter: { ...DEFAULT_FILTER },
    },
  ];
}

/** Named starter layouts offered in the customize UI. */
export function dashboardTemplates(): {
  key: string;
  label: string;
  cards: DashboardCard[];
}[] {
  return [
    { key: "weekly", label: "Weekly overview", cards: defaultDashboardCards() },
    {
      key: "my-work",
      label: "My work",
      cards: (() => {
        cardSeq = 100;
        return [
          metricCard("My open tasks", "open", { scope: "me" }),
          metricCard("My overdue", "overdue", { scope: "me" }),
          chartCard("My tasks by status", "donut", "status", "half", {
            scope: "me",
          }),
          chartCard("My tasks by project", "hbar", "project", "half", {
            scope: "me",
          }),
          {
            id: seedId("tasks"),
            kind: "tasks",
            title: "My tasks due soon",
            span: "full",
            w: 4,
            limit: 12,
            filter: { ...DEFAULT_FILTER, scope: "me", due: "upcoming" },
          },
          {
            id: seedId("todo"),
            kind: "todo",
            title: "My to-dos",
            span: "half",
            w: 2,
            filter: { ...DEFAULT_FILTER },
          },
        ];
      })(),
    },
    {
      key: "leadership",
      label: "Team analytics",
      cards: (() => {
        cardSeq = 200;
        return [
          metricCard("Total tasks", "total"),
          metricCard("Open", "open"),
          metricCard("Overdue", "overdue"),
          metricCard("In progress", "in-progress"),
          chartCard("By assignee", "bar", "assignee", "full"),
          chartCard("By project", "hbar", "project", "half"),
          chartCard("By status", "donut", "status", "half"),
          chartCard("By priority", "bar", "priority", "half"),
          chartCard("By due date", "bar", "due-bucket", "half"),
        ];
      })(),
    },
  ];
}
