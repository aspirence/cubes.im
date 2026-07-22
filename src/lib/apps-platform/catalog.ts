/**
 * App catalog — the code registry of installable first-party feature apps
 * (mini-applications). Distinct from the App Center *connectors*
 * (app_connections): these are internal apps that store their own data in
 * namespaced `app_<key>_*` tables joined to the core (projects/tasks/teams).
 *
 * Adding a new app (see docs/APPS_PLATFORM.md):
 *   1. add a descriptor here (status 'coming_soon' until its routes exist),
 *   2. add a migration creating app_<key>_* tables that FK into the core with
 *      the shared is_team_member / is_team_admin RLS,
 *   3. build its pages under src/app/(app)/apps/<key>/ and hooks under
 *      src/features/app-<key>/,
 *   4. flip status to 'available'.
 *
 * `installed_apps` (DB) records which apps a team has installed; this catalog is
 * the source of truth for what CAN be installed and how it is described.
 */

/** Core resources an app reads/writes — surfaced to admins at install time. */
export type CoreResource =
  | "projects"
  | "tasks"
  | "members"
  | "time"
  | "clients";

export interface AppDescriptor {
  /** Stable identity; also the `app_<key>_*` table prefix. */
  key: string;
  name: string;
  tagline: string;
  description: string;
  /** Material Symbols Rounded glyph. */
  icon: string;
  color: string;
  category: "Tools" | "Creative" | "Productivity" | "Sales" | "Operations";
  /** Which core data the app touches (shown at install). */
  coreAccess: CoreResource[];
  /** The app's route subtree; only meaningful when status is 'available'. */
  route: string;
  status: "available" | "coming_soon";
  /** Surfaced in the App Center's Featured section. */
  featured?: boolean;
}

export const APP_CATALOG: AppDescriptor[] = [
  {
    key: "team_pulse",
    name: "Team Pulse",
    tagline: "Live view of who's working on what — with focus rules",
    description:
      "One screen for the whole team: who's working on which task right now (with a live timer), what's queued next for each person, and who has nothing lined up. Activating it also enables focus rules — limited members keep one task In Progress at a time, and the timer starts/stops automatically as tasks move through the Active stage.",
    icon: "monitor_heart",
    color: "#d97706",
    category: "Operations",
    coreAccess: ["tasks", "members", "time"],
    route: "/apps/team-pulse",
    status: "available",
    featured: true,
  },
  {
    key: "hr",
    name: "HR",
    tagline: "People operations, attendance, leave, and payroll in one place",
    description:
      "Run your internal HR workspace inside Cubes with employees, org chart, onboarding, attendance, leave, payroll, and reports behind one installable app.",
    icon: "group",
    color: "#4a4ad0",
    category: "Operations",
    coreAccess: ["members", "time"],
    route: "/hr/dashboard",
    status: "available",
    featured: true,
  },
  {
    key: "whiteboard",
    name: "Whiteboard",
    tagline: "An infinite canvas for sketches, diagrams, and brainstorms",
    description:
      "A full-featured whiteboard powered by Excalidraw — draw shapes, arrows, text and freehand sketches on an infinite canvas, drop in images, and keep multiple boards. Great for wireframes, flowcharts, and quick brainstorms. Boards autosave in your browser (shared, team-wide boards are on the roadmap).",
    icon: "gesture",
    color: "#7c5cff",
    category: "Creative",
    coreAccess: [],
    route: "/apps/whiteboard",
    status: "available",
    featured: true,
  },
  {
    key: "files",
    name: "Files",
    tagline: "Internal file sharing with per-file permissions",
    description:
      "Share files with your team — organized per project with folders, view-only or downloadable, optional watermark overlays, and one-click publish. Videos jump straight into Video Review.",
    icon: "folder_shared",
    color: "#2f9c9c",
    category: "Tools",
    coreAccess: ["projects", "members"],
    route: "/apps/files",
    status: "available",
    featured: true,
  },
  {
    key: "video_review",
    name: "Video Review",
    tagline: "Frame-accurate feedback on project videos",
    description:
      "Upload cuts to a project, leave timestamped comments, and resolve notes — feedback lives alongside the project's tasks.",
    icon: "movie",
    color: "#e0559b",
    category: "Tools",
    coreAccess: ["projects", "tasks", "members"],
    route: "/apps/video-review",
    status: "available",
    featured: true,
  },
  {
    key: "social_studio",
    name: "Social Studio",
    tagline: "Plan, schedule, and track social content with your team",
    description:
      "A Postiz-inspired social workspace for campaigns, channel planning, approval-ready post queues, internal media reuse, and project-linked publishing work.",
    icon: "campaign",
    color: "#ff7a45",
    category: "Creative",
    coreAccess: ["projects", "tasks", "members"],
    route: "/apps/social-studio",
    status: "available",
    featured: true,
  },
  {
    key: "client_portal",
    name: "Client Portal",
    tagline: "A read-only window for clients into their projects",
    description:
      "Give a client a scoped, read-only view of the projects tied to them — status, milestones, and shared updates.",
    icon: "handshake",
    color: "#4a4ad0",
    category: "Sales",
    coreAccess: ["projects", "clients", "tasks"],
    route: "/apps/client-portal",
    status: "available",
    featured: true,
  },
  {
    key: "mcp",
    name: "MCP",
    tagline: "Connect Claude directly to your workspace",
    description:
      "Run an MCP server for this workspace so Claude (Claude Code, Claude Desktop) can list projects, create and update tasks, mark work done, and comment — with a personal access token scoped to this workspace.",
    icon: "smart_toy",
    color: "#c96442",
    category: "Tools",
    coreAccess: ["projects", "tasks", "members"],
    route: "/apps/mcp",
    status: "available",
    featured: true,
  },
  {
    key: "data_manager",
    name: "Data Manager",
    tagline: "Backup, restore, and clear workspace data",
    description:
      "The workspace owner's toolkit: download a portable backup of projects, tasks, statuses and labels; restore a backup into any workspace; or wipe the workspace clean — after a type-to-confirm guard.",
    icon: "settings_backup_restore",
    color: "#b45309",
    category: "Operations",
    coreAccess: ["projects", "tasks", "members", "clients"],
    route: "/apps/data-manager",
    status: "available",
  },
  {
    key: "docs",
    name: "Docs",
    tagline: "Lightweight docs attached to projects",
    description:
      "Write and organize documents inside a project so knowledge lives next to the work.",
    icon: "description",
    color: "#2bb3a3",
    category: "Productivity",
    coreAccess: ["projects"],
    route: "/apps/docs",
    status: "coming_soon",
  },
];

export const appByKey = (key: string): AppDescriptor | undefined =>
  APP_CATALOG.find((a) => a.key === key);
