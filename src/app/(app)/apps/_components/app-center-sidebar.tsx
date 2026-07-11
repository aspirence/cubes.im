"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { theme } from "antd";
import { INTEGRATION_CATEGORIES } from "@/lib/apps-platform/integrations";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/** Featured sits ABOVE All Apps per the App Center layout. */
const RAIL_TOP = [
  { key: "featured", label: "Featured", icon: "favorite" },
  { key: "all", label: "All Apps", icon: "apps" },
  { key: "cubes", label: "Cubes Apps", icon: "widgets" },
];

/**
 * The App Center's category rail, rendered by the shell as the /apps secondary
 * sidebar. Selecting a category drives the page via the `?view=` query param.
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

  const go = (key: string) => router.push(`/apps?view=${key}`);

  const renderRow = (item: { key: string; label: string; icon: string }) => {
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
          color: on ? "#4a4ad0" : token.colorText,
          background: on ? token.colorPrimaryBg : "transparent",
        }}
        onMouseEnter={(e) => {
          if (!on) e.currentTarget.style.background = token.colorFillTertiary;
        }}
        onMouseLeave={(e) => {
          if (!on) e.currentTarget.style.background = "transparent";
        }}
      >
        <MIcon name={item.icon} size={18} color={on ? "#4a4ad0" : token.colorTextTertiary} />
        {item.label}
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
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.5,
            color: token.colorTextTertiary,
            padding: "6px 10px 4px",
          }}
        >
          INTEGRATIONS
        </div>
        {RAIL_TOP.map((item) => renderRow(item))}
        <div style={{ height: 1, background: token.colorSplit, margin: "8px 6px" }} />
        {INTEGRATION_CATEGORIES.map((c) =>
          renderRow({ key: c.key, label: c.label, icon: c.icon }),
        )}
      </nav>
    </>
  );
}
