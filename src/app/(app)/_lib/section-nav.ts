/**
 * Central registry of section (secondary) navigations.
 *
 * Sections that own a sub-navigation (HR, Settings, Reporting, Admin) render it
 * as a SECONDARY sidebar next to the (collapsed) primary rail —
 * handled by the app shell — instead of inside the page content. Each section's
 * layout is a pass-through so the pages render full-width in the shell content.
 */

export type SectionNavEntry =
  | { type: "divider" }
  | {
      key: string;
      label: string;
      icon: string;
      /** Only rendered for platform super-admins (is_platform_admin RPC). */
      superAdminOnly?: boolean;
    };

export interface SectionNav {
  base: string;
  title: string;
  icon: string;
  items: SectionNavEntry[];
  /** When set, the shell renders a custom component in the secondary sidebar
   *  (e.g. the live Projects tree) instead of the static `items` list. */
  custom?: "projects" | "app-center" | "chat";
}

export const SECTION_NAVS: SectionNav[] = [
  {
    base: "/projects",
    title: "Projects",
    icon: "layers",
    custom: "projects",
    items: [],
  },
  {
    base: "/chat",
    title: "Chat",
    icon: "forum",
    custom: "chat",
    items: [],
  },
  {
    base: "/hr",
    title: "HR",
    icon: "group",
    items: [
      { key: "/hr/dashboard", label: "Dashboard", icon: "space_dashboard" },
      { key: "/hr/employees", label: "Employees", icon: "badge" },
      { key: "/hr/org-chart", label: "Org Chart", icon: "account_tree" },
      { key: "/hr/onboarding", label: "Onboarding", icon: "assignment_ind" },
      { key: "/hr/settings", label: "Settings", icon: "settings" },
      { type: "divider" },
      { key: "/hr/attendance", label: "Attendance", icon: "schedule" },
      { key: "/hr/leave", label: "Leave", icon: "calendar_month" },
      { key: "/hr/payroll", label: "Payroll", icon: "payments" },
      { key: "/hr/reports", label: "Reports", icon: "bar_chart" },
    ],
  },
  {
    base: "/settings",
    title: "Settings",
    icon: "settings",
    items: [
      { key: "/settings/profile", label: "Profile", icon: "person" },
      { key: "/settings/notifications", label: "Notifications", icon: "notifications" },
      { key: "/settings/appearance", label: "Appearance", icon: "palette" },
      { key: "/settings/password", label: "Password", icon: "lock" },
      { key: "/settings/account", label: "Account", icon: "shield" },
      { type: "divider" },
      { key: "/settings/clients", label: "Clients", icon: "contacts" },
      { key: "/settings/job-titles", label: "Job Titles", icon: "badge" },
      { key: "/settings/labels", label: "Labels", icon: "label" },
      { key: "/settings/categories", label: "Categories", icon: "category" },
      { key: "/settings/task-ids", label: "Task IDs", icon: "tag" },
      { key: "/settings/templates", label: "Templates", icon: "description" },
      { type: "divider" },
      { key: "/settings/members", label: "Members", icon: "group" },
      { key: "/settings/permissions", label: "Permissions", icon: "shield_person" },
      { key: "/settings/teams", label: "Workspaces", icon: "groups" },
      { key: "/settings/apps", label: "Apps", icon: "extension" },
      { type: "divider" },
      { key: "/settings/support", label: "Support", icon: "support_agent" },
    ],
  },
  {
    base: "/workflows",
    title: "Workflows",
    icon: "account_tree",
    items: [
      { key: "/workflows", label: "Workflows", icon: "account_tree" },
      { key: "/workflows/agents", label: "Agents", icon: "smart_toy" },
    ],
  },
  {
    base: "/apps",
    title: "Apps",
    icon: "apps",
    custom: "app-center",
    items: [],
  },
  {
    base: "/reporting",
    title: "Reporting",
    icon: "bar_chart",
    items: [
      { key: "/reporting/overview", label: "Overview", icon: "space_dashboard" },
      { key: "/reporting/projects", label: "Projects", icon: "folder" },
      { key: "/reporting/members", label: "Members", icon: "group" },
      { key: "/reporting/time-sheets", label: "Time Sheets", icon: "schedule" },
    ],
  },
  {
    base: "/admin-center",
    title: "Admin",
    icon: "shield",
    items: [
      { key: "/admin-center/overview", label: "Overview", icon: "space_dashboard" },
      { key: "/admin-center/users", label: "Users", icon: "person" },
      { key: "/admin-center/join-requests", label: "Join requests", icon: "how_to_reg" },
      { key: "/admin-center/teams", label: "Workspaces", icon: "groups" },
      { key: "/admin-center/projects", label: "Projects", icon: "layers" },
      { key: "/admin-center/billing", label: "Billing", icon: "credit_card" },
      { type: "divider" },
      { key: "/admin-center/platform", label: "Platform", icon: "public", superAdminOnly: true },
      { key: "/admin-center/pricing", label: "Pricing", icon: "sell", superAdminOnly: true },
      { key: "/admin-center/early-access", label: "Early access", icon: "bolt", superAdminOnly: true },
    ],
  },
];

/** The section-nav that owns `pathname`, or null when the route has no sub-nav. */
export function getSectionNav(pathname: string): SectionNav | null {
  // Home is the workspace hub — it shares the Projects tree with
  // the /projects routes, so the tree (Spaces/Projects/All Tasks) is available
  // straight from Home, not only after opening a project.
  if (
    pathname === "/home" ||
    pathname.startsWith("/home/") ||
    pathname === "/projects" ||
    pathname.startsWith("/projects/")
  ) {
    return SECTION_NAVS.find((s) => s.custom === "projects") ?? null;
  }
  // The App Center rail belongs to the store index only; a first-party app's own
  // pages (/apps/<app>) render full-width with their own layout.
  if (pathname.startsWith("/apps/")) return null;
  // The workflow builder is a full-bleed canvas — no secondary sidebar.
  if (/^\/workflows\/[^/]+$/.test(pathname) && pathname !== "/workflows/agents") {
    return null;
  }
  return (
    SECTION_NAVS.find(
      (s) => pathname === s.base || pathname.startsWith(s.base + "/"),
    ) ?? null
  );
}

/** Longest-prefix active item key within a section nav. */
export function activeSectionKey(nav: SectionNav, pathname: string): string {
  const keys = nav.items
    .filter((i): i is Extract<SectionNavEntry, { key: string }> => "key" in i)
    .map((i) => i.key);
  const match = keys
    .filter((k) => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? keys[0] ?? "";
}
