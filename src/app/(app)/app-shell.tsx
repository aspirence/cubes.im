"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { App as AntdApp, Popover, Select, Tooltip } from "antd";
import { useUIStore } from "@/store/ui-store";
import { useAuth } from "@/features/auth/use-auth";
import {
  useTeams,
  useActiveTeam,
  useSetActiveTeam,
} from "@/features/teams/use-teams";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";
import { useIsPlatformAdmin } from "@/features/billing/use-pricing";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { NotificationsBell } from "./_components/notifications-bell";
import { UploadIndicator } from "@/features/uploads/upload-indicator";
import { getSectionNav, activeSectionKey } from "./_lib/section-nav";
import {
  getPrimarySidebarCatalog,
  isPrimarySidebarItemActive,
  orderPrimarySidebarItems,
  type PrimarySidebarItem,
} from "./_lib/primary-sidebar";
import { APP_CATALOG } from "@/lib/apps-platform/catalog";
import { AppActivationButton } from "@/features/apps-platform/app-activation";
import { isProjectScopedApp } from "@/features/apps-platform/app-scope";
import { ProjectsSidebar } from "./projects/_components/projects-sidebar";
import { AppCenterSidebar } from "./apps/_components/app-center-sidebar";
import { ChatSidebar } from "./chat/_components/chat-sidebar";
import { CreateTaskModal } from "@/features/tasks/create-task-modal";

/** Material Symbols Rounded glyph. */
function MIcon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-rounded" style={{ fontSize: size }}>
      {name}
    </span>
  );
}

function SortableSidebarItem({
  item,
  active,
  dark,
  collapsed,
  showLabel,
  editable,
  onNavigate,
  onRemove,
}: {
  item: PrimarySidebarItem;
  active: boolean;
  dark: boolean;
  collapsed: boolean;
  showLabel: boolean;
  editable: boolean;
  onNavigate: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !editable || Boolean(item.fixedFirst) });
  const [hovered, setHovered] = useState(false);
  const showDragHandle = editable && !collapsed && !item.fixedFirst;
  const showRemoveButton = editable && hovered && !item.locked;
  const showLockedBadge = editable && hovered && item.locked;
  const itemBody = (
    <div
      onClick={() => {
        if (!editable) onNavigate();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        height: 34,
        padding: collapsed ? 0 : "0 10px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 7,
        cursor: editable ? (collapsed ? "grab" : "default") : "pointer",
        fontSize: 13.5,
        fontWeight: 500,
        marginBottom: 1,
        color: active ? "#4a4ad0" : dark ? "#9aa4b6" : "#494b54",
        background: active
          ? dark
            ? "rgba(74,74,208,.2)"
            : "#eceefb"
          : hovered && !editable
            ? dark
              ? "#1b1f29"
              : "#eef0f3"
            : "transparent",
        boxShadow: isDragging ? "0 8px 18px rgba(16,24,40,.12)" : "none",
        position: "relative",
        transition:
          "background .18s ease, color .18s ease, transform .18s ease, box-shadow .18s ease",
        transform: editable && hovered ? "translateX(1px)" : "translateX(0)",
      }}
      {...(editable && collapsed ? { ...attributes, ...listeners } : {})}
    >
      {showDragHandle ? (
        <button
          type="button"
          aria-label={`Reorder ${item.label}`}
          onClick={(e) => e.stopPropagation()}
          {...attributes}
          {...listeners}
          style={{
            width: 18,
            height: 18,
            border: "none",
            background: "transparent",
            color: "#9aa4b6",
            padding: 0,
            cursor: "grab",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: hovered ? 1 : 0.55,
            flex: "none",
          }}
        >
          <MIcon name="drag_indicator" size={16} />
        </button>
      ) : null}
      <MIcon name={item.icon} />
      {showLabel ? (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.label}
        </span>
      ) : null}
      {editable && collapsed ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 7,
            border: hovered ? "1px dashed rgba(74,74,208,.35)" : "1px dashed transparent",
            pointerEvents: "none",
            transition: "border-color .18s ease",
          }}
        />
      ) : null}
      {showRemoveButton ? (
        <button
          type="button"
          aria-label={`Remove ${item.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            width: collapsed ? 18 : 20,
            height: collapsed ? 18 : 20,
            border: "none",
            background: collapsed ? (dark ? "#20242e" : "#ffffff") : "transparent",
            color: "#9aa4b6",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 1,
            flex: "none",
            position: collapsed ? "absolute" : "static",
            top: collapsed ? -2 : undefined,
            right: collapsed ? -2 : undefined,
            borderRadius: 999,
            boxShadow: collapsed ? "0 6px 14px rgba(16,24,40,.12)" : "none",
          }}
        >
          <MIcon name="close" size={15} />
        </button>
      ) : null}
      {showLockedBadge ? (
        <span
          style={{
            position: "absolute",
            top: collapsed ? -2 : 8,
            right: collapsed ? -2 : 10,
            width: collapsed ? 18 : 20,
            height: collapsed ? 18 : 20,
            borderRadius: 999,
            background: dark ? "rgba(185,133,0,.22)" : "#fff7d6",
            color: dark ? "#d8a52a" : "#b98500",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: collapsed ? "0 6px 14px rgba(16,24,40,.12)" : "none",
          }}
        >
          <MIcon name="lock" size={13} />
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.78 : 1,
        position: "relative",
      }}
    >
      {collapsed ? (
        <Tooltip
          title={isDragging ? null : item.label}
          placement="right"
          mouseEnterDelay={0.12}
        >
          {itemBody}
        </Tooltip>
      ) : (
        itemBody
      )}
    </div>
  );
}

/** Tracks the < 900px breakpoint via matchMedia (SSR-safe default). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isMobile;
}

function TeamSwitcher({ compact = false }: { compact?: boolean }) {
  const { data: teams, isLoading: teamsLoading } = useTeams();
  const { data: activeTeam, isLoading: activeLoading } = useActiveTeam();
  const setActiveTeam = useSetActiveTeam();
  const { message } = AntdApp.useApp();

  const options = (teams ?? []).map((t) => ({ value: t.id, label: t.name }));

  return (
    <Select
      aria-label="Switch workspace"
      value={activeTeam?.id}
      options={options}
      onChange={(id) =>
        setActiveTeam.mutate(id, {
          onError: () => message.error("Failed to switch workspace"),
        })
      }
      loading={teamsLoading || activeLoading || setActiveTeam.isPending}
      placeholder="Select workspace"
      // Narrow on phones so the topbar cluster fits a 360px viewport.
      style={{ minWidth: compact ? 116 : 168, maxWidth: compact ? 148 : undefined }}
      variant="filled"
      size="small"
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  const sidebarPinnedItemIds = useUIStore((s) => s.sidebarPinnedItemIds);
  const setSidebarPinnedItems = useUIStore((s) => s.setSidebarPinnedItems);
  const themeMode = useUIStore((s) => s.themeMode);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const { data: installedApps } = useInstalledApps();
  const hrAppEnabled = Boolean(
    installedApps?.some((entry) => entry.app_key === "hr" && entry.enabled),
  );

  const { profile, user } = useAuth();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [sidebarEditMode, setSidebarEditMode] = useState(false);
  // The "More" rail item's popover (add items + reorder) — always-visible entry
  // point that replaces the old hover-revealed add/edit affordances.
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  // Close the mobile drawer on route change — the render-time reset idiom
  // (React "adjusting state during render") instead of a setState-in-effect.
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (pathname !== drawerPath) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  // Sections with a sub-navigation (HR/Settings/Reporting/Admin) render it as a
  // secondary sidebar, and force the primary sidebar to a rail.
  const rawSectionNav = getSectionNav(pathname);
  const sectionNav =
    pathname.startsWith("/hr") && !hrAppEnabled ? null : rawSectionNav;
  // Canvas/app routes (the workflow builder, first-party apps like Video
  // Review) run full-bleed: no secondary sidebar and the primary sidebar
  // pinned to its rail so the app owns the width.
  const isCanvasRoute =
    (/^\/workflows\/[^/]+$/.test(pathname) && pathname !== "/workflows/agents") ||
    pathname.startsWith("/apps/");
  const forceRail = !!sectionNav || isCanvasRoute;
  const secActive = sectionNav ? activeSectionKey(sectionNav, pathname) : "";
  // Platform-wide (super-admin) entries are hidden from everyone else; the
  // pages themselves stay RPC-gated as defense in depth.
  const { data: isPlatformAdmin } = useIsPlatformAdmin();
  const isTeamAdmin = useIsTeamAdmin();
  const secItemsRaw = (sectionNav?.items ?? []).filter(
    (it) =>
      "type" in it ||
      ((!it.superAdminOnly || isPlatformAdmin) && (!it.requiresAdmin || isTeamAdmin)),
  );
  // Gating out admin-only entries can orphan their dividers (leading, trailing,
  // or several in a row). Collapse runs of dividers to one and drop any leading
  // divider, then trim a trailing one, so the nav never shows empty separators.
  const secItems = secItemsRaw.reduce((acc, it) => {
    const last = acc[acc.length - 1];
    if ("type" in it && (!last || "type" in last)) return acc;
    acc.push(it);
    return acc;
  }, [] as typeof secItemsRaw);
  while (secItems.length && "type" in secItems[secItems.length - 1]) {
    secItems.pop();
  }

  // Collapse is purely route-driven: rail on section/canvas pages, always
  // expanded (with no manual collapse) everywhere else.
  const collapsed = !isMobile && forceRail;
  const showLabel = !collapsed;
  const railW = collapsed ? 62 : 244;
  const SEC_W = 244;
  const contentOffset = isMobile ? 0 : railW + (sectionNav ? SEC_W : 0);

  const dark = themeMode === "dark";
  const sidebarBg = dark ? "#14171f" : "#fbfbfc";
  const hair = dark ? "#1e222c" : "#ececf0";
  const canvas = dark ? "#0b0d12" : "#f6f7f9";
  const textPrimary = dark ? "#e6e9ef" : "#17171c";

  // The first-party, project-scoped app currently open (if any) — drives the
  // admin-only activation gear rendered beside the header title.
  const activationApp = pathname.startsWith("/apps/")
    ? APP_CATALOG.find(
        (a) => pathname.startsWith(a.route) && isProjectScopedApp(a.key),
      )
    : undefined;
  // Admin-only rail items (App Center, Admin, Workflows) are hidden from members;
  // the pages themselves stay RLS/route-gated as defense in depth.
  const sidebarCatalog = getPrimarySidebarCatalog(installedApps).filter(
    (item) => !item.requiresAdmin || isTeamAdmin,
  );
  const primaryNavItems = orderPrimarySidebarItems(
    sidebarCatalog,
    sidebarPinnedItemIds,
  );
  const availablePrimaryNavItems = sidebarCatalog.filter(
    (item) => !primaryNavItems.some((pinned) => pinned.id === item.id),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const canCustomizeSidebar = !isMobile;
  const editableRail = canCustomizeSidebar && sidebarEditMode;

  const displayName = profile?.name ?? user?.email ?? "Account";
  const displayEmail = profile?.email ?? user?.email ?? "";
  const initials = (displayName || "?").slice(0, 2).toUpperCase();

  const handleAddSidebarItem = (id: string) => {
    setSidebarPinnedItems([...primaryNavItems.map((item) => item.id), id]);
    setManageMenuOpen(false);
  };

  const enterReorder = () => {
    setManageMenuOpen(false);
    setSidebarEditMode(true);
  };

  const handleRemoveSidebarItem = (id: string) => {
    const item = primaryNavItems.find((entry) => entry.id === id);
    if (item?.locked) return;
    setSidebarPinnedItems(
      primaryNavItems
        .map((entry) => entry.id)
        .filter((entryId) => entryId !== id),
    );
  };

  const handleSidebarDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Home (fixedFirst) can't be moved, and nothing can be dropped above it.
    const fixedCount = primaryNavItems.filter((item) => item.fixedFirst).length;
    const activeItem = primaryNavItems.find((item) => item.id === String(active.id));
    if (activeItem?.fixedFirst) return;
    const orderedIds = primaryNavItems.map((item) => item.id);
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = Math.max(fixedCount, orderedIds.indexOf(String(over.id)));
    if (oldIndex < 0 || newIndex < 0) return;
    setSidebarPinnedItems(arrayMove(orderedIds, oldIndex, newIndex));
  };

  // The active pinned item is the one whose base is the *longest* match for the
  // current path, so a specific item (e.g. Teams at /settings/teams) wins over
  // the general Settings item (/settings) instead of both lighting up.
  const activePrimaryId =
    primaryNavItems.reduce<{ id: string; len: number } | null>((best, item) => {
      if (!isPrimarySidebarItemActive(item, pathname)) return best;
      return !best || item.base.length > best.len
        ? { id: item.id, len: item.base.length }
        : best;
    }, null)?.id ?? null;

  const navItem = (item: PrimarySidebarItem) => {
    const active = item.id === activePrimaryId;
    return (
      <SortableSidebarItem
        key={item.id}
        item={item}
        active={active}
        dark={dark}
        collapsed={collapsed}
        showLabel={showLabel}
        editable={editableRail}
        onNavigate={() => router.push(item.key)}
        onRemove={() => handleRemoveSidebarItem(item.id)}
      />
    );
  };

  // Chip used by both the Reorder row and the add-item rows in the popover.
  const menuRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    border: `1px solid ${dark ? "#272c38" : "#ececf0"}`,
    borderRadius: 10,
    padding: "10px 12px",
    background: dark ? "#191d27" : "#fff",
    cursor: "pointer",
  };
  const menuChipStyle = (accent: boolean): React.CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 8,
    background: accent
      ? dark
        ? "rgba(74,74,208,.22)"
        : "#eef1ff"
      : dark
        ? "rgba(255,255,255,.06)"
        : "#f6f7fb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: accent ? "#4a4ad0" : dark ? "#9aa4b6" : "#687083",
    flex: "none",
  });

  const manageMenuContent = (
    <div style={{ width: 296, maxHeight: 440, overflowY: "auto" }}>
      <div
        style={{
          font: "600 10.5px var(--font-geist-sans)",
          color: "#8a8d98",
          textTransform: "uppercase",
          letterSpacing: ".7px",
          marginBottom: 10,
        }}
      >
        Customize sidebar
      </div>

      {/* Reorder / remove — enters edit mode on the rail. */}
      <button type="button" onClick={enterReorder} style={menuRowStyle}>
        <span style={menuChipStyle(true)}>
          <MIcon name="drag_indicator" size={18} />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              fontSize: 13.5,
              fontWeight: 600,
              color: dark ? "#e6e9ef" : "#17171c",
            }}
          >
            Reorder &amp; remove
          </span>
          <span
            style={{ display: "block", fontSize: 12, color: "#8a8d98", marginTop: 1 }}
          >
            Drag to reorder, hover to remove
          </span>
        </span>
        <MIcon name="chevron_right" size={18} />
      </button>

      <div style={{ height: 1, background: hair, margin: "14px 0" }} />

      <div
        style={{
          font: "600 10.5px var(--font-geist-sans)",
          color: "#8a8d98",
          textTransform: "uppercase",
          letterSpacing: ".7px",
          marginBottom: 10,
        }}
      >
        Add to sidebar
      </div>
      {availablePrimaryNavItems.length ? (
        <div style={{ display: "grid", gap: 14 }}>
          {(["app", "core"] as const).map((kind) => {
            const items = availablePrimaryNavItems.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind} style={{ display: "grid", gap: 8 }}>
                <div
                  style={{
                    font: "600 10.5px var(--font-geist-sans)",
                    color: "#9a9da8",
                    letterSpacing: ".7px",
                    textTransform: "uppercase",
                  }}
                >
                  {kind === "app" ? "Installed apps" : "Workspace areas"}
                </div>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleAddSidebarItem(item.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      textAlign: "left",
                      border: `1px solid ${dark ? "#272c38" : "#ececf0"}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      background: dark ? "#191d27" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background:
                          item.kind === "app"
                            ? dark
                              ? "rgba(74,74,208,.22)"
                              : "#eef1ff"
                            : dark
                              ? "rgba(255,255,255,.06)"
                              : "#f6f7fb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color:
                          item.kind === "app"
                            ? "#4a4ad0"
                            : dark
                              ? "#9aa4b6"
                              : "#687083",
                        flex: "none",
                      }}
                    >
                      <MIcon name={item.icon} size={18} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: dark ? "#e6e9ef" : "#17171c",
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "#8a8d98",
                          marginTop: 1,
                        }}
                      >
                        {item.kind === "app" ? "Installed app" : "Core item"}
                      </span>
                    </span>
                    <MIcon name="add_circle" size={18} />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 2px",
            fontSize: 12.5,
            color: "#8a8d98",
          }}
        >
          <MIcon name="check_circle" size={16} />
          <span>Everything&apos;s already on your sidebar.</span>
        </div>
      )}
    </div>
  );

  // Onboarding renders as a focused, full-screen flow — no sidebar/topbar chrome.
  if (pathname === "/setup") {
    return <>{children}</>;
  }

  return (
    <div style={{ minHeight: "100vh", background: canvas }}>
      {/* Mobile overlay */}
      <div
        onClick={() => setDrawerOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,16,20,.42)",
          zIndex: 55,
          display: isMobile && drawerOpen ? "block" : "none",
        }}
      />

      {/* Sidebar */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "100vh",
          width: isMobile ? 268 : railW,
          background: sidebarBg,
          borderRight: `1px solid ${hair}`,
          display: "flex",
          flexDirection: "column",
          zIndex: 60,
          transform:
            isMobile && !drawerOpen ? "translateX(-100%)" : "translateX(0)",
          boxShadow:
            isMobile && drawerOpen ? "0 16px 50px rgba(15,16,20,.22)" : "none",
          transition: "transform .24s cubic-bezier(.4,0,.2,1)",
        }}
      >
        {/* Workspace switcher */}
        <div
          style={{
            height: 58,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: collapsed ? 0 : "0 14px",
            justifyContent: collapsed ? "center" : "flex-start",
            flex: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/cubes.im_logo_big.png"
            alt=""
            style={{ width: 32, height: 32, flex: "none", objectFit: "contain" }}
          />
          {showLabel ? (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  letterSpacing: "-.2px",
                  color: textPrimary,
                }}
              >
                Cubes
              </div>
                  <div style={{ fontSize: 11, color: "#8a8d98", lineHeight: 1.3 }}>
                Workspace
              </div>
            </div>
          ) : null}
        </div>

        {/* Nav */}
        <nav
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "6px 10px 14px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {showLabel ? (
            <div
              style={{
                font: "600 10.5px var(--font-geist-sans)",
                letterSpacing: ".7px",
                color: "#a2a5af",
                textTransform: "uppercase",
                padding: "12px 10px 6px",
              }}
            >
              Quick Access
            </div>
          ) : (
            <div style={{ height: 10 }} />
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSidebarDragEnd}
          >
            <SortableContext
              items={primaryNavItems.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {primaryNavItems.map(navItem)}
            </SortableContext>
          </DndContext>
          {/* Always-visible "More" — the single entry point for customizing the
              rail (add items + reorder). Replaces the old hover-revealed
              add/edit controls. While reordering it becomes a prominent Done. */}
          {!isMobile ? (
            <div style={{ marginTop: "auto", paddingTop: collapsed ? 10 : 12 }}>
              <div
                style={{
                  height: 1,
                  background: hair,
                  margin: collapsed ? "0 6px 8px" : "0 2px 8px",
                }}
              />
              {sidebarEditMode ? (
                <button
                  type="button"
                  onClick={() => setSidebarEditMode(false)}
                  aria-label="Done editing sidebar"
                  title="Done editing"
                  style={{
                    width: "100%",
                    height: 34,
                    border: "none",
                    borderRadius: 8,
                    background: "#4a4ad0",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 8px 20px rgba(74,74,208,.24)",
                    paddingInline: collapsed ? 0 : 12,
                  }}
                >
                  <MIcon name="check_circle" size={18} />
                  {!collapsed ? <span>Done</span> : null}
                </button>
              ) : (
                <Popover
                  content={manageMenuContent}
                  trigger="click"
                  open={manageMenuOpen}
                  onOpenChange={setManageMenuOpen}
                  placement={collapsed ? "rightBottom" : "topLeft"}
                >
                  <button
                    type="button"
                    aria-label="Customize sidebar"
                    title="More"
                    onMouseEnter={(e) => {
                      if (!manageMenuOpen)
                        e.currentTarget.style.background = dark
                          ? "#1b1f29"
                          : "#eef0f3";
                    }}
                    onMouseLeave={(e) => {
                      if (!manageMenuOpen)
                        e.currentTarget.style.background = "transparent";
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      width: "100%",
                      height: 34,
                      padding: collapsed ? 0 : "0 10px",
                      justifyContent: collapsed ? "center" : "flex-start",
                      border: "none",
                      borderRadius: 7,
                      cursor: "pointer",
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: manageMenuOpen
                        ? "#4a4ad0"
                        : dark
                          ? "#9aa4b6"
                          : "#494b54",
                      background: manageMenuOpen
                        ? dark
                          ? "rgba(74,74,208,.2)"
                          : "#eceefb"
                        : "transparent",
                      transition: "background .18s ease, color .18s ease",
                    }}
                  >
                    <MIcon name="more_horiz" size={20} />
                    {showLabel ? (
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: "left",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        More
                      </span>
                    ) : null}
                  </button>
                </Popover>
              )}
            </div>
          ) : null}
        </nav>

        {/* Footer user chip */}
        <div style={{ flex: "none", borderTop: `1px solid ${hair}`, padding: "8px 10px" }}>
          <div
            onClick={() => router.push("/settings/profile")}
            role="button"
            tabIndex={0}
            title="Profile & settings"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") router.push("/settings/profile");
            }}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 8px",
                borderRadius: 8,
                cursor: "pointer",
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  flex: "none",
                  borderRadius: "50%",
                  background: "#e0663f",
                  color: "#fff",
                  fontSize: 11.5,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {initials}
              </span>
              {showLabel ? (
                <>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        lineHeight: 1.2,
                        color: textPrimary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {displayName}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#8a8d98",
                        lineHeight: 1.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {displayEmail}
                    </div>
                  </div>
                  <MIcon name="chevron_right" size={18} />
                </>
              ) : null}
            </div>
        </div>
      </aside>

      {/* Secondary sidebar (section sub-nav) */}
      {sectionNav && !isMobile ? (
        <aside
          style={{
            position: "fixed",
            top: 0,
            left: railW,
            height: "100vh",
            width: SEC_W,
            background: dark ? "#0f131b" : "#ffffff",
            borderRight: `1px solid ${hair}`,
            zIndex: 58,
            display: "flex",
            flexDirection: "column",
            transition: "left .2s ease",
          }}
        >
          {sectionNav.custom === "projects" ? (
            <ProjectsSidebar />
          ) : sectionNav.custom === "app-center" ? (
            <AppCenterSidebar />
          ) : sectionNav.custom === "chat" ? (
            <ChatSidebar />
          ) : (
            <>
          <div
            style={{
              height: 58,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 16px",
              borderBottom: `1px solid ${hair}`,
              flex: "none",
            }}
          >
            <span style={{ color: "#8a8d98", display: "flex" }}>
              <MIcon name={sectionNav.icon} size={20} />
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: textPrimary }}>
              {sectionNav.title}
            </span>
          </div>
          <nav style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {secItems.map((it, i) =>
              "type" in it ? (
                // Group break — spacing only, no visible divider line.
                <div key={`div-${i}`} style={{ height: 10 }} />
              ) : (
                <a
                  key={it.key}
                  onClick={() => router.push(it.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    height: 34,
                    padding: "0 10px",
                    borderRadius: 7,
                    cursor: "pointer",
                    fontSize: 13.5,
                    fontWeight: 500,
                    marginBottom: 1,
                    color:
                      it.key === secActive
                        ? "#4a4ad0"
                        : dark
                          ? "#9aa4b6"
                          : "#494b54",
                    background:
                      it.key === secActive
                        ? dark
                          ? "rgba(74,74,208,.2)"
                          : "#eceefb"
                        : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (it.key !== secActive)
                      e.currentTarget.style.background = dark
                        ? "#1b1f29"
                        : "#eef0f3";
                  }}
                  onMouseLeave={(e) => {
                    if (it.key !== secActive)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <MIcon name={it.icon} size={19} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.label}
                  </span>
                </a>
              ),
            )}
          </nav>
            </>
          )}
        </aside>
      ) : null}

      {/* Main column */}
      <div
        style={{
          marginLeft: contentOffset,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
          transition: "margin-left .2s ease",
        }}
      >
        {/* Top bar */}
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 30,
            height: 58,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: isMobile ? "0 14px" : "0 24px",
            background: dark ? "rgba(11,13,18,.85)" : "rgba(246,247,249,.85)",
            backdropFilter: "saturate(180%) blur(8px)",
            borderBottom: `1px solid ${hair}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {isMobile ? (
              <button
                onClick={() => setDrawerOpen((v) => !v)}
                aria-label="Open menu"
                style={{
                  width: 34,
                  height: 34,
                  flex: "none",
                  border: `1px solid ${dark ? "#262b37" : "#e6e7ec"}`,
                  background: dark ? "#14171f" : "#fff",
                  borderRadius: 8,
                  color: dark ? "#cdd2dd" : "#44464f",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MIcon name="menu" size={21} />
              </button>
            ) : null}
            {activationApp ? (
              <AppActivationButton appKey={activationApp.key} />
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
            <Tooltip title="Create task">
              <button
                onClick={() => setCreateTaskOpen(true)}
                aria-label="Create task"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  height: 34,
                  padding: isMobile ? "0 9px" : "0 12px",
                  border: "none",
                  background: "#4a4ad0",
                  color: "#fff",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <MIcon name="add" size={18} />
                {!isMobile ? "New" : null}
              </button>
            </Tooltip>
            <TeamSwitcher compact={isMobile} />
            {!isMobile ? (
              <Tooltip title={dark ? "Light mode" : "Dark mode"}>
                <button
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                  style={{
                    width: 34,
                    height: 34,
                    border: `1px solid ${dark ? "#262b37" : "#e6e7ec"}`,
                    background: dark ? "#14171f" : "#fff",
                    borderRadius: 8,
                    color: dark ? "#cdd2dd" : "#44464f",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MIcon name={dark ? "light_mode" : "dark_mode"} size={19} />
                </button>
              </Tooltip>
            ) : null}
            <UploadIndicator />
            <NotificationsBell />
          </div>
        </header>

        <CreateTaskModal
          open={createTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
        />

        {/* Section sub-nav (mobile): horizontal pills above content */}
        {sectionNav && !sectionNav.custom && isMobile ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              padding: "10px 14px",
              borderBottom: `1px solid ${hair}`,
              background: dark ? "#0f131b" : "#fff",
            }}
          >
            {secItems
              .filter(
                (it): it is { key: string; label: string; icon: string } =>
                  !("type" in it),
              )
              .map((it) => (
                <a
                  key={it.key}
                  onClick={() => router.push(it.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    flex: "none",
                    cursor: "pointer",
                    color:
                      it.key === secActive
                        ? "#4a4ad0"
                        : dark
                          ? "#9aa4b6"
                          : "#6a6d78",
                    background:
                      it.key === secActive
                        ? dark
                          ? "rgba(74,74,208,.2)"
                          : "#eceefb"
                        : dark
                          ? "#1b1f29"
                          : "#f2f3f5",
                  }}
                >
                  <MIcon name={it.icon} size={17} />
                  {it.label}
                </a>
              ))}
          </div>
        ) : null}

        {/* Content */}
        <main
          style={{
            flex: 1,
            padding: isMobile ? "16px 14px 40px" : "22px 24px 48px",
            minWidth: 0,
            // Net against stray page-level horizontal overflow on phones;
            // tables/boards keep their own internal scroll containers.
            overflowX: isMobile ? "clip" : undefined,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
