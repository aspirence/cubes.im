"use client";

import { APP_CATALOG, appByKey } from "@/lib/apps-platform/catalog";
import { DEFAULT_SIDEBAR_PINNED_ITEM_IDS } from "@/store/ui-store";

export interface PrimarySidebarItem {
  id: string;
  key: string;
  base: string;
  icon: string;
  label: string;
  kind: "core" | "app";
  /** Cannot be removed from the rail. */
  locked?: boolean;
  /** Always rendered first and cannot be reordered (Home). Implies locked. */
  fixedFirst?: boolean;
}

export interface InstalledSidebarApp {
  app_key: string;
  enabled: boolean;
}

export const CORE_PRIMARY_SIDEBAR_ITEMS: PrimarySidebarItem[] = [
  {
    id: "/home",
    key: "/home",
    base: "/home",
    icon: "home",
    label: "Home",
    kind: "core",
    locked: true,
    fixedFirst: true,
  },
  {
    id: "/schedule",
    key: "/schedule",
    base: "/schedule",
    icon: "calendar_month",
    label: "Schedule",
    kind: "core",
  },
  {
    id: "/workflows",
    key: "/workflows",
    base: "/workflows",
    icon: "account_tree",
    label: "Workflows",
    kind: "core",
  },
  {
    id: "/apps",
    key: "/apps",
    base: "/apps",
    icon: "apps",
    label: "Apps",
    kind: "core",
    locked: true,
  },
  {
    id: "/admin-center/overview",
    key: "/admin-center/overview",
    base: "/admin-center",
    icon: "shield",
    label: "Admin",
    kind: "core",
  },
  {
    id: "/settings/profile",
    key: "/settings/profile",
    base: "/settings",
    icon: "settings",
    label: "Settings",
    kind: "core",
    locked: true,
  },
];

const defaultPinnedOrder = [...DEFAULT_SIDEBAR_PINNED_ITEM_IDS];

export function getInstalledPrimarySidebarItems(
  installedApps: InstalledSidebarApp[] | undefined,
): PrimarySidebarItem[] {
  if (!installedApps?.length) return [];
  return installedApps.flatMap((installed) => {
    if (!installed.enabled) return [];
    const app = appByKey(installed.app_key);
    if (!app || app.status !== "available") return [];
    return [
      {
        id: `app:${app.key}`,
        key: app.route,
        base: app.route,
        icon: app.icon,
        label: app.name,
        kind: "app" as const,
      },
    ];
  });
}

export function getPrimarySidebarCatalog(
  installedApps: InstalledSidebarApp[] | undefined,
): PrimarySidebarItem[] {
  return [
    ...CORE_PRIMARY_SIDEBAR_ITEMS,
    ...getInstalledPrimarySidebarItems(installedApps),
  ];
}

export function orderPrimarySidebarItems(
  items: PrimarySidebarItem[],
  pinnedIds: string[] | undefined,
): PrimarySidebarItem[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const requestedOrder = pinnedIds?.length ? pinnedIds : defaultPinnedOrder;
  const ordered: PrimarySidebarItem[] = [];
  const seen = new Set<string>();

  for (const id of requestedOrder) {
    const item = itemMap.get(id);
    if (!item || seen.has(id)) continue;
    ordered.push(item);
    seen.add(id);
  }

  for (const item of items) {
    if (!item.locked || seen.has(item.id)) continue;
    ordered.push(item);
    seen.add(item.id);
  }

  // Fixed-first items (Home) always render at the front regardless of the
  // persisted or dragged order — their priority can't be changed. Stable
  // partition preserves the relative order of everything else.
  const fixedFirst = ordered.filter((item) => item.fixedFirst);
  if (fixedFirst.length === 0) return ordered;
  const rest = ordered.filter((item) => !item.fixedFirst);
  return [...fixedFirst, ...rest];
}

export function isPrimarySidebarItemActive(
  item: PrimarySidebarItem,
  pathname: string,
): boolean {
  const activeBase = "/" + (pathname.split("/")[1] ?? "");
  if (item.base === "/home") {
    return activeBase === "/home" || activeBase === "/projects";
  }
  return pathname === item.key || pathname.startsWith(item.base + "/");
}

export function getPrimarySidebarItemById(id: string) {
  const core = CORE_PRIMARY_SIDEBAR_ITEMS.find((item) => item.id === id);
  if (core) return core;
  if (!id.startsWith("app:")) return undefined;
  const app = APP_CATALOG.find((entry) => `app:${entry.key}` === id);
  if (!app || app.status !== "available") return undefined;
  return {
    id: `app:${app.key}`,
    key: app.route,
    base: app.route,
    icon: app.icon,
    label: app.name,
    kind: "app" as const,
  };
}
