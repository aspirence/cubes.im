"use client";

import { theme, Tooltip } from "antd";
import {
  CHART_TYPE_OPTIONS,
  CHART_FAMILIES,
  type ChartType,
} from "./dashboard-types";

/**
 * Tiny line-art glyph per chart type. These are deliberately SVG rather than
 * live mini-charts: the gallery shows 15 tiles at once, and 15 canvases would
 * cost far more than they teach. The real data preview sits above the gallery.
 */
function Glyph({ type }: { type: ChartType }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const f = { fill: "currentColor", stroke: "none" };
  switch (type) {
    case "donut":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <circle cx="12" cy="12" r="8" {...s} />
          <circle cx="12" cy="12" r="3.4" {...s} />
          <path d="M12 4a8 8 0 0 1 8 8h-8Z" {...f} />
        </svg>
      );
    case "pie":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <circle cx="12" cy="12" r="8" {...s} />
          <path d="M12 12V4a8 8 0 0 1 6.9 4Z" {...f} />
          <path d="M12 12 4.6 9.2" {...s} />
        </svg>
      );
    case "rose":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M12 12V3" {...s} />
          <path d="M12 12 4.5 8" {...s} />
          <path d="M12 12h8.5" {...s} />
          <path d="M12 12a9 9 0 0 1 8.5 0" {...f} opacity=".85" />
          <circle cx="12" cy="12" r="1.4" {...f} />
          <path d="M12 12a6 6 0 0 0-7.5-4" {...s} />
        </svg>
      );
    case "treemap":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <rect x="3.5" y="4" width="10" height="9" rx="1.2" {...f} opacity=".9" />
          <rect x="15" y="4" width="5.5" height="9" rx="1.2" {...s} />
          <rect x="3.5" y="14.5" width="6" height="5.5" rx="1.2" {...s} />
          <rect x="11" y="14.5" width="9.5" height="5.5" rx="1.2" {...s} />
        </svg>
      );
    case "funnel":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M3.5 4.5h17l-4.5 5.5h-8Z" {...f} opacity=".9" />
          <path d="M6.5 11.5h11l-3 4.5h-5Z" {...s} />
          <path d="M10 17.5h4v2.5h-4Z" {...s} />
        </svg>
      );
    case "stack":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <rect x="3" y="9.5" width="7" height="5" rx="1" {...f} opacity=".9" />
          <rect x="10.6" y="9.5" width="5" height="5" rx="1" {...s} />
          <rect x="16.2" y="9.5" width="4.8" height="5" rx="1" {...s} />
        </svg>
      );
    case "bar":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M3.5 20.5h17" {...s} />
          <rect x="5" y="12" width="3.6" height="7" rx="1.2" {...f} />
          <rect x="10.2" y="7" width="3.6" height="12" rx="1.2" {...s} />
          <rect x="15.4" y="14.5" width="3.6" height="4.5" rx="1.2" {...s} />
        </svg>
      );
    case "hbar":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M3.5 3.5v17" {...s} />
          <rect x="5" y="5" width="12" height="3.4" rx="1.2" {...f} />
          <rect x="5" y="10.3" width="15" height="3.4" rx="1.2" {...s} />
          <rect x="5" y="15.6" width="8" height="3.4" rx="1.2" {...s} />
        </svg>
      );
    case "lollipop":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M3.5 20.5h17" {...s} />
          <path d="M7 20V12M12 20V6.5M17 20v-6" {...s} />
          <circle cx="7" cy="11" r="2" {...f} />
          <circle cx="12" cy="5.6" r="2" {...s} />
          <circle cx="17" cy="13" r="2" {...s} />
        </svg>
      );
    case "polar":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <circle cx="12" cy="12" r="2" {...s} />
          <path d="M12 6.5a5.5 5.5 0 0 1 5.2 3.7" {...s} strokeWidth="2.4" />
          <path d="M12 3.2a8.8 8.8 0 0 1 8.3 6" {...f} opacity="0" />
          <path d="M12 3.4a8.6 8.6 0 0 1 7.4 4.3" {...s} strokeWidth="2.4" />
          <path d="M9.4 17.2A5.5 5.5 0 0 1 6.6 14" {...s} strokeWidth="2.4" />
        </svg>
      );
    case "radar":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M12 3.2 20 9l-3 9.6H7L4 9Z" {...s} />
          <path d="M12 7.4 16.6 11l-1.8 5.4H9.2L7.4 11Z" {...f} opacity=".55" />
        </svg>
      );
    case "line":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M3.5 20.5h17" {...s} />
          <path d="M5 16l4-5 4 3 5-8" {...s} strokeWidth="2" />
          <circle cx="9" cy="11" r="1.8" {...f} />
        </svg>
      );
    case "area":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M3.5 20.5h17" {...s} />
          <path d="M5 17l4-5 4 3 5-8v10Z" {...f} opacity=".45" />
          <path d="M5 17l4-5 4 3 5-8" {...s} strokeWidth="2" />
        </svg>
      );
    case "gauge":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <path d="M4 17a8 8 0 1 1 16 0" {...s} />
          <path d="M4 17A8 8 0 0 1 8.7 9.7" {...s} strokeWidth="2.6" />
          <path d="M12 17l4-5" {...s} />
        </svg>
      );
    case "table":
      return (
        <svg viewBox="0 0 24 24" width="26" height="26">
          <rect x="3.5" y="5" width="17" height="14" rx="1.6" {...s} />
          <path d="M3.5 9.5h17M3.5 14h17M10 9.5V19" {...s} />
          <rect x="3.5" y="5" width="17" height="4.5" rx="1.6" {...f} opacity=".8" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * The chart-type picker: every form on offer, grouped by what it's FOR, so the
 * choice is "what do I want to say" rather than "which shape is prettiest".
 * `groupCount` drives the soft warning on forms that blur past a few groups.
 */
export function ChartTypeGallery({
  value,
  onChange,
  groupCount,
}: {
  value: ChartType;
  onChange: (t: ChartType) => void;
  groupCount: number;
}) {
  const { token } = theme.useToken();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {CHART_FAMILIES.map((family) => {
        const opts = CHART_TYPE_OPTIONS.filter((o) => o.family === family);
        if (!opts.length) return null;
        return (
          <div key={family}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                color: token.colorTextQuaternary,
                marginBottom: 6,
              }}
            >
              {family}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6 }}>
              {opts.map((o) => {
                const active = o.value === value;
                const tooMany = o.maxGroups !== undefined && groupCount > o.maxGroups;
                return (
                  <Tooltip
                    key={o.value}
                    title={
                      tooMany
                        ? `${o.hint} — you have ${groupCount} groups; this reads best up to ${o.maxGroups}.`
                        : o.hint
                    }
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onChange(o.value)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        padding: "9px 4px 7px",
                        borderRadius: 9,
                        cursor: "pointer",
                        background: active ? token.colorPrimaryBg : token.colorBgContainer,
                        border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                        color: active ? token.colorPrimary : token.colorTextSecondary,
                        position: "relative",
                        transition: "border-color .12s, background .12s",
                      }}
                    >
                      <Glyph type={o.value} />
                      <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500, lineHeight: 1.2, textAlign: "center" }}>
                        {o.label}
                      </span>
                      {tooMany ? (
                        <span
                          aria-hidden
                          title="Reads best with fewer groups"
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: token.colorWarning,
                          }}
                        />
                      ) : null}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
