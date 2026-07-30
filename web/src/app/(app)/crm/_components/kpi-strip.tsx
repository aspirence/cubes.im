"use client";

import { Spin, Tooltip, theme } from "antd";
import { MIcon } from "./m-icon";

/**
 * One figure in the strip. `delta` is the change against the comparison
 * period; pass null when a metric has nothing meaningful to compare against
 * (a "due today" count is a snapshot, not a trend).
 */
export interface KpiItem {
  key: string;
  label: string;
  /** Explains what the number counts — shown behind the (i). */
  hint?: string;
  value: React.ReactNode;
  delta?: {
    /** Signed change. Percent when `percent`, otherwise an absolute count. */
    value: number;
    percent?: boolean;
    /** Set false where a rise is bad (spend, overdue). Default true. */
    goodWhenUp?: boolean;
  } | null;
  /** Caption beside the delta chip. Defaults to "vs last month". */
  compare?: string;
  /** Shown instead of the comparison row when there is no delta. */
  footnote?: string;
  onClick?: () => void;
  loading?: boolean;
}

function DeltaChip({
  delta,
}: {
  delta: NonNullable<KpiItem["delta"]>;
}) {
  const { token } = theme.useToken();
  const flat = delta.value === 0;
  const up = delta.value > 0;
  const good = delta.goodWhenUp === false ? !up : up;

  const fg = flat
    ? token.colorTextTertiary
    : good
      ? token.colorSuccess
      : token.colorError;
  const bg = flat
    ? token.colorFillTertiary
    : good
      ? token.colorSuccessBg
      : token.colorErrorBg;

  const magnitude = Math.abs(delta.value);
  const text = flat
    ? "no change"
    : `${up ? "+" : "−"}${magnitude}${delta.percent ? "%" : ""}`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        height: 20,
        padding: "0 7px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1,
        flex: "none",
      }}
    >
      {flat ? null : (
        <MIcon name={up ? "arrow_upward" : "arrow_downward"} size={12} />
      )}
      {text}
    </span>
  );
}

/**
 * The KPI strip: one bordered surface holding the screen's headline figures,
 * hairline-separated, each with its change against the previous period.
 *
 * A row of separate cards makes four numbers look like four unrelated things;
 * one strip reads as a single summary, which is what it is. It wraps to two
 * columns before it ever squashes a figure.
 */
export function KpiStrip({ items }: { items: KpiItem[] }) {
  const { token } = theme.useToken();
  if (items.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 220px), 1fr))`,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {items.map((item, i) => {
        const clickable = Boolean(item.onClick);
        const Cell = clickable ? "button" : "div";
        return (
          <Cell
            key={item.key}
            {...(clickable
              ? { type: "button" as const, onClick: item.onClick }
              : {})}
            style={{
              // A hairline between cells, never before the first — and the
              // grid may wrap, so the divider is a left border that the
              // first-in-row inherits harmlessly at this subtlety.
              borderLeft:
                i === 0 ? "none" : `1px solid ${token.colorBorderSecondary}`,
              padding: "14px 16px",
              textAlign: "left",
              background: "transparent",
              font: "inherit",
              color: "inherit",
              cursor: clickable ? "pointer" : "default",
              minWidth: 0,
              display: "block",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12.5,
                color: token.colorTextSecondary,
              }}
            >
              {item.label}
              {item.hint ? (
                <Tooltip title={item.hint}>
                  <span style={{ display: "inline-flex" }}>
                    <MIcon
                      name="info"
                      size={13}
                      color={token.colorTextQuaternary}
                    />
                  </span>
                </Tooltip>
              ) : null}
            </span>

            <div
              style={{
                marginTop: 4,
                fontSize: 26,
                fontWeight: 650,
                letterSpacing: "-0.5px",
                lineHeight: 1.15,
                color: token.colorText,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.loading ? <Spin size="small" /> : item.value}
            </div>

            <div
              style={{
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11.5,
                color: token.colorTextTertiary,
                minHeight: 20,
              }}
            >
              {item.delta ? (
                <>
                  <span>{item.compare ?? "vs last month"}</span>
                  <DeltaChip delta={item.delta} />
                </>
              ) : (
                <span>{item.footnote ?? ""}</span>
              )}
            </div>
          </Cell>
        );
      })}
    </div>
  );
}
