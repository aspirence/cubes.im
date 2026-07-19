"use client";

import { MIcon, MONO, useScheduleTokens } from "./schedule-ui";

export interface SummaryTile {
  key: string;
  icon: string;
  label: string;
  /** The headline number/text, rendered in mono. */
  value: string;
  /** Small trailing context ("of 12", "41h", …). */
  suffix?: string;
}

/**
 * Compact stat tiles above the calendar grid — all values are computed
 * client-side from the already-fetched allocations/availability/tasks.
 */
export function SummaryStrip({ tiles }: { tiles: SummaryTile[] }) {
  const T = useScheduleTokens();
  if (tiles.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))",
        gap: 8,
      }}
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 12px",
            background: T.panel,
            border: `1px solid ${T.hairline}`,
            borderRadius: 10,
            minWidth: 0,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 8,
              background: T.accentSoft,
              color: T.accent,
              flex: "none",
            }}
          >
            <MIcon name={tile.icon} size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.textTertiary,
                letterSpacing: "0.2px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tile.label}
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: "-0.5px",
                lineHeight: 1.25,
                color: T.textPrimary,
                whiteSpace: "nowrap",
              }}
            >
              {tile.value}
              {tile.suffix ? (
                <span
                  style={{
                    fontSize: 11.5,
                    marginLeft: 4,
                    color: T.textTertiary,
                    letterSpacing: 0,
                  }}
                >
                  {tile.suffix}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
