/**
 * Project view registry — the code source of truth for the view TYPES a project
 * can show. The "+ View" picker, the tab strip, and the project-template default
 * views all render from this. Adding a new view type = 1 descriptor here + 1
 * component branch in the project page's `viewComponent()`.
 *
 * `kind: "task"` views are per-project instances (stored in project_views,
 * addable/removable). `kind: "utility"` tabs are fixed app surfaces (Overview,
 * Members, …) shown on every project and NOT stored.
 */

export type ViewKind = "task" | "utility";

export interface ProjectViewDescriptor {
  key: string;
  title: string;
  /** Material Symbols Rounded glyph. */
  icon: string;
  color: string;
  kind: ViewKind;
  description: string;
  /** Whether it can be added via the "+ View" picker (task views only). */
  addable: boolean;
  /** False = shown in the picker as "coming soon", not selectable. */
  available: boolean;
}

export const PROJECT_VIEWS: ProjectViewDescriptor[] = [
  {
    key: "board",
    title: "Board",
    icon: "view_kanban",
    color: "#3f8ff0",
    kind: "task",
    description: "Kanban columns by status.",
    addable: true,
    available: true,
  },
  {
    key: "list",
    title: "List",
    icon: "format_list_bulleted",
    color: "#4a4ad0",
    kind: "task",
    description: "Grouped, sortable rows of tasks.",
    addable: true,
    available: true,
  },
  {
    key: "calendar",
    title: "Calendar",
    icon: "calendar_month",
    color: "#f0883e",
    kind: "task",
    description: "Tasks placed on a month grid by due date.",
    addable: true,
    available: true,
  },
  {
    key: "timeline",
    title: "Timeline",
    icon: "timeline",
    color: "#e0556a",
    kind: "task",
    description: "A roadmap of tasks across time.",
    addable: true,
    available: true,
  },
  {
    key: "table",
    title: "Table",
    icon: "table_chart",
    color: "#2bb3a3",
    kind: "task",
    description: "A dense spreadsheet-style table of tasks.",
    addable: true,
    available: true,
  },
  {
    key: "video-review",
    title: "Video Review",
    icon: "movie",
    color: "#e0559b",
    kind: "task",
    description: "Cuts for this project with timestamped feedback + review flow.",
    addable: true,
    available: true,
  },
  {
    key: "files",
    title: "Files",
    icon: "folder_shared",
    color: "#2f9c9c",
    kind: "task",
    description: "This project's shared files with per-file permissions.",
    addable: true,
    available: true,
  },
  {
    key: "social-studio",
    title: "Social Studio",
    icon: "campaign",
    color: "#ff7a45",
    kind: "task",
    description: "Campaign planning, channel scheduling, and internal content ops.",
    addable: true,
    available: true,
  },
  {
    key: "workload",
    title: "Workload",
    icon: "monitoring",
    color: "#3fa67a",
    kind: "task",
    description: "Who's over- or under-loaded — estimated hours per person per day.",
    addable: true,
    available: true,
  },
  // --- Utility tabs: always shown, never stored per project ---
  {
    key: "doc",
    title: "Doc",
    icon: "menu_book",
    color: "#2bb3a3",
    kind: "utility",
    description: "Project docs — a page tree with rich blocks.",
    addable: false,
    available: true,
  },
  {
    key: "updates",
    title: "Activity",
    icon: "forum",
    color: "#e0559b",
    kind: "utility",
    description: "Recent activity and updates.",
    addable: false,
    available: true,
  },
  {
    key: "overview",
    title: "Overview",
    icon: "insights",
    color: "#7c6cf0",
    kind: "utility",
    description: "Project health and summary.",
    addable: false,
    available: true,
  },
  // --- Coming soon (shown disabled in the picker) ---
  {
    key: "gantt",
    title: "Gantt",
    icon: "stacked_bar_chart",
    color: "#e0556a",
    kind: "task",
    description: "Dependency-aware schedule bars.",
    addable: true,
    available: false,
  },
  {
    key: "mindmap",
    title: "Mind Map",
    icon: "account_tree",
    color: "#b46ff0",
    kind: "task",
    description: "Branching map of tasks.",
    addable: true,
    available: false,
  },
  {
    key: "form",
    title: "Form",
    icon: "assignment",
    color: "#3f8ff0",
    kind: "task",
    description: "Intake form that creates tasks.",
    addable: true,
    available: false,
  },
];

export const viewByKey = (key: string): ProjectViewDescriptor | undefined =>
  PROJECT_VIEWS.find((v) => v.key === key);

/** Task views that can be added via the picker (available + addable). */
export const ADDABLE_VIEWS = PROJECT_VIEWS.filter(
  (v) => v.kind === "task" && v.addable,
);

/** Fixed utility tabs shown on every project. */
export const UTILITY_VIEWS = PROJECT_VIEWS.filter((v) => v.kind === "utility");
