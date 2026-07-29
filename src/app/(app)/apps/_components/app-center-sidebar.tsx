"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { theme } from "antd";
import {
  CONNECTABLE_CATEGORIES,
  CONNECTABLE_INTEGRATIONS,
  integrationsByCategory,
} from "@/lib/apps-platform/integrations";
import { APP_CATALOG } from "@/lib/apps-platform/catalog";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";
import { useAppConnections } from "@/features/apps/use-apps";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const ACCENT = "#4a4ad0";

/**
 * The App Center's category rail, rendered by the shell as the /apps secondary
 * sidebar. Selecting a view drives the page via the `?view=` query param.
 * Discover (Featured / All / Cubes / Installed) sits above the integration
 * categories; rows carry live counts so the store feels inhabited.
 */
export function AppCenterSidebar() {
  return (
    <Suspense fallback={<div style={{ flex: 1 }} />}>
      <AppCenterSidebarInner />
    </Suspense>
  );
}

function AppCenterSidebarInner() {
  const { token } = theme.useToken();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = pathname === "/apps" ? (searchParams.get("view") ?? "all") : "";

  const { data: installed } = useInstalledApps();
  const { data: connections } = useAppConnections();

  const availableApps = useMemo(
    () => APP_CATALOG.filter((app) => app.status === "available"),
    [],
  );
  const installedCount = useMemo(() => {
    const appKeys = new Set(availableApps.map((a) => a.key));
    const apps = (installed ?? []).filter((i) => appKeys.has(i.app_key)).length;
    const connected = (connections ?? []).filter((c) => c.enabled).length;
    return apps + connected;
  }, [installed, connections, availableApps]);

  const discoverRows = [
    { key: "featured", label: "Featured", icon: "favorite", count: null as number | null },
    {
      key: "all",
      label: "All Apps",
      icon: "apps",
      count: CONNECTABLE_INTEGRATIONS.length + availableApps.length,
    },
    { key: "cubes", label: "Cubes Apps", icon: "widgets", count: availableApps.length },
    { key: "installed", label: "Installed", icon: "download_done", count: installedCount },
  ];

  const go = (key: string) => router.push(`/apps?view=${key}`);

  const sectionLabel = (label: string) => (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: 0.7,
        color: token.colorTextTertiary,
        padding: "6px 10px 4px",
      }}
    >
      {label}
    </div>
  );

  const renderRow = (item: {
    key: string;
    label: string;
    icon: string;
    count: number | null;
  }) => {
    const on = view === item.key;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => go(item.key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          width: "100%",
          height: 34,
          padding: "0 10px",
          borderRadius: 7,
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          marginBottom: 1,
          fontSize: 13.5,
          fontWeight: on ? 600 : 500,
          color: on ? ACCENT : token.colorText,
          background: on ? token.colorPrimaryBg : "transparent",
          transition: "background .12s ease, color .12s ease",
        }}
        onMouseEnter={(e) => {
          if (!on) e.currentTarget.style.background = token.colorFillTertiary;
        }}
        onMouseLeave={(e) => {
          if (!on) e.currentTarget.style.background = "transparent";
        }}
      >
        <MIcon name={item.icon} size={18} color={on ? ACCENT : token.colorTextTertiary} />
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
        {item.count !== null && item.count > 0 ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              lineHeight: "18px",
              minWidth: 18,
              textAlign: "center",
              padding: "0 5px",
              borderRadius: 999,
              color: on ? ACCENT : token.colorTextTertiary,
              background: on ? token.colorBgContainer : token.colorFillTertiary,
              flex: "none",
            }}
          >
            {item.count}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      {/* Brand header */}
      <div
        style={{
          height: 58,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flex: "none",
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: "linear-gradient(135deg,#5a5ad6,#8b6fd6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MIcon name="grid_view" size={18} color="#fff" />
        </div>
        <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText }}>App Center</span>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {sectionLabel("DISCOVER")}
        {discoverRows.map(renderRow)}

        <div style={{ height: 1, background: token.colorSplit, margin: "8px 6px" }} />

        {sectionLabel("CATEGORIES")}
        {CONNECTABLE_CATEGORIES.map((c) =>
          renderRow({
            key: c.key,
            label: c.label,
            icon: c.icon,
            count: integrationsByCategory(c.key).length,
          }),
        )}
      </nav>

      {/* Footer shortcut to connection management (org admins land on settings). */}
      <div
        style={{
          flex: "none",
          padding: 8,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <button
          type="button"
          onClick={() => router.push("/settings/apps")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            width: "100%",
            height: 34,
            padding: "0 10px",
            borderRadius: 7,
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            fontSize: 13,
            fontWeight: 500,
            color: token.colorTextSecondary,
            background: "transparent",
            transition: "background .12s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = token.colorFillTertiary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <MIcon name="tune" size={18} color={token.colorTextTertiary} />
          Manage connections
        </button>
      </div>
    </>
  );
}
