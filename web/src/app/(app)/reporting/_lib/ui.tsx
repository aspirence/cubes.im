"use client";

/** Shared presentational primitives for the reporting suite. */

import { useState } from "react";
import { T, MONO, paletteFor, initials } from "./tokens";

/** Page heading: H1 21/600 with tracking, muted subtitle. */
export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 18,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: "-0.4px",
            color: T.textPrimary,
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: T.textSecondary,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div style={{ display: "flex", gap: 8 }}>{right}</div> : null}
    </div>
  );
}

/** White card with hairline, card radius + shadow, optional hover-lift. */
export function Panel({
  children,
  style,
  hover = false,
  padding = 16,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  hover?: boolean;
  padding?: number | string;
}) {
  const [h, setH] = useState(false);
  return (
    <div
      onMouseEnter={hover ? () => setH(true) : undefined}
      onMouseLeave={hover ? () => setH(false) : undefined}
      style={{
        background: T.panel,
        border: `1px solid ${hover && h ? T.cardBorderHover : T.hairline}`,
        borderRadius: 12,
        boxShadow: hover && h ? T.cardShadowHover : T.cardShadow,
        padding,
        transition: "box-shadow .15s ease, border-color .15s ease",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Section title (13.5/600). */
export function SectionTitle({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: T.textPrimary,
          letterSpacing: "-0.1px",
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

/** Solid-fill avatar chip with initials (deterministic palette). */
export function AvatarChip({
  name,
  size = 30,
  colorKey,
}: {
  name: string;
  size?: number;
  colorKey?: string;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: paletteFor(colorKey ?? name),
        color: "#fff",
        fontSize: size <= 26 ? 10.5 : 11.5,
        fontWeight: 600,
        letterSpacing: "0.2px",
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** Material Symbols Rounded ligature icon. */
export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="material-symbols-rounded"
      style={{ fontSize: size, color, lineHeight: 1, ...style }}
    >
      {name}
    </span>
  );
}

/** KPI tile: label, mono value (25px, -1px tracking), optional suffix. */
export function KpiTile({
  label,
  value,
  suffix,
  icon,
  danger = false,
  loading = false,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  icon?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Panel padding={16} hover>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        {icon ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 8,
              background: danger ? "#fbeceb" : T.accentSoft,
              color: danger ? "#c0453c" : T.accent,
            }}
          >
            <Icon name={icon} size={16} />
          </span>
        ) : null}
        <span
          style={{
            fontSize: 12,
            color: T.textSecondary,
            fontWeight: 500,
          }}
        >
          {label}
        </span>
      </div>
      {loading ? (
        <div
          style={{
            width: "55%",
            height: 26,
            borderRadius: 6,
            background: T.divider,
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: MONO,
            fontSize: 25,
            fontWeight: 600,
            letterSpacing: "-1px",
            lineHeight: 1,
            color: danger ? "#c0453c" : T.textPrimary,
          }}
        >
          {value}
          {suffix ? (
            <span
              style={{
                fontSize: 14,
                marginLeft: 3,
                color: danger ? "#c0453c" : T.textTertiary,
                letterSpacing: 0,
              }}
            >
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/** Horizontal bar row: label + mono value, 8px track with filled bar at pct. */
export function BarRow({
  label,
  value,
  pct,
  color,
  swatch,
}: {
  label: string;
  value: React.ReactNode;
  pct: number;
  color: string;
  swatch?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ padding: "9px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 7,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: T.textPrimary,
            minWidth: 0,
          }}
        >
          {swatch ? (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 3,
                background: color,
                flexShrink: 0,
              }}
            />
          ) : null}
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: T.textPrimary,
            flexShrink: 0,
          }}
        >
          {value}
        </span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: T.divider,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            borderRadius: 999,
            background: color,
            transition: "width .3s ease",
          }}
        />
      </div>
    </div>
  );
}

/** Error banner styled to the skin (light red bg, saturated text). */
export function ErrorBanner({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Panel
      style={{
        borderColor: "#f3d4d1",
        background: "#fbeceb",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <Icon name="error" size={18} color="#c0453c" style={{ marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#c0453c" }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "#a3564f", marginTop: 2 }}>
          {message}
        </div>
      </div>
    </Panel>
  );
}
