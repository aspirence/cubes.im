"use client";

import { useMemo } from "react";
import { Empty, theme } from "antd";

/**
 * The Client app's agency-side palette and small pieces, following the same
 * shape as Content Studio's `ui.tsx`: surfaces and text come from the AntD
 * theme so light and dark both work, while the named hues are the app's own
 * accents and stay literal because they are brand, not theme.
 *
 * The CLIENT-facing portal deliberately does NOT use this — it paints itself
 * from the workspace's own accent and never reads the agency user's theme.
 */
export function useC() {
  const { token } = theme.useToken();
  return useMemo(
    () => ({
      bg: token.colorBgLayout,
      panel: token.colorBgContainer,
      panelSoft: token.colorFillTertiary,
      hair: token.colorBorderSecondary,
      text: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      accent: "#0f8f7a",
      accentSoft: "rgba(15,143,122,0.10)",
      accentDeep: "#0b6f5f",
      indigo: "#4a4ad0",
      red: "#c0453c",
      green: "#2f8f5f",
      gold: "#b8842a",
    }),
    [token],
  );
}

/** Material Symbols glyph, sized and coloured inline. */
export function MIcon({
  name,
  size = 18,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  extra,
  children,
  padding = 14,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  padding?: number;
}) {
  const C = useC();
  return (
    <section
      style={{
        background: C.panel,
        border: `1px solid ${C.hair}`,
        borderRadius: 14,
        minWidth: 0,
      }}
    >
      {title || extra ? (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "11px 14px",
            borderBottom: `1px solid ${C.hair}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{title}</div>
            {subtitle ? (
              <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 2 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          {extra ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {extra}
            </div>
          ) : null}
        </header>
      ) : null}
      <div style={{ padding }}>{children}</div>
    </section>
  );
}

export function ViewTab({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  const C = useC();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 38,
        padding: "0 14px",
        borderRadius: 12,
        border: "none",
        background: active ? C.text : C.panel,
        color: active ? C.panel : C.textSecondary,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        fontWeight: 600,
        boxShadow: active ? "0 12px 30px rgba(30,29,25,0.16)" : "none",
      }}
    >
      <MIcon name={icon} size={17} color={active ? C.panel : C.textTertiary} />
      {label}
      {count ? (
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: active ? "rgba(255,255,255,0.18)" : C.accentSoft,
            color: active ? C.panel : C.accentDeep,
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** A state chip: dot + label in the state's own tone. */
export function StatePill({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: string;
  icon?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        background: `${tone}14`,
        color: tone,
        border: `1px solid ${tone}33`,
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {icon ? (
        <MIcon name={icon} size={13} color={tone} />
      ) : (
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tone }} />
      )}
      {label}
    </span>
  );
}

export function EmptyPanel({
  title,
  desc,
  action,
}: {
  title: string;
  desc: string;
  action?: React.ReactNode;
}) {
  const C = useC();
  return (
    <div
      style={{
        background: C.panel,
        border: `1px dashed ${C.hair}`,
        borderRadius: 14,
        padding: "26px 18px",
      }}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 14.5 }}>{title}</div>
            <div style={{ color: C.textSecondary, fontSize: 12.5, marginTop: 4 }}>{desc}</div>
          </div>
        }
      />
      {action ? (
        <div style={{ display: "flex", justifyContent: "center" }}>{action}</div>
      ) : null}
    </div>
  );
}

/** An avatar tile for a client contact — initials, tinted by role. */
export function ContactAvatar({
  initials,
  tone,
  size = 34,
}: {
  initials: string;
  tone: string;
  size?: number;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: 10,
        background: `${tone}1a`,
        color: tone,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        letterSpacing: 0.3,
      }}
    >
      {initials}
    </span>
  );
}
