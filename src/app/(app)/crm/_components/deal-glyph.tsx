"use client";

import { theme } from "antd";
import { MIcon } from "./m-icon";
import { avatarColor } from "../_lib/ui";
import { ENTITY_META } from "./entity-meta";

/**
 * The deal avatar.
 *
 * People are circles and companies are rounded squares (`EntityAvatar`); a deal
 * is neither, so it gets the same deterministic fill with the deal glyph inside
 * instead of initials. Used everywhere a deal is represented — board-adjacent
 * table, dashboard feed, record drawer header, target picker — so one deal
 * always looks like the same deal.
 */
export function DealGlyph({
  name,
  size = 28,
}: {
  name: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      title={name || undefined}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.29)),
        background: avatarColor(name),
        color: "#fff",
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MIcon
        name={ENTITY_META.deal.icon}
        size={Math.round(size * 0.6)}
        color="#fff"
      />
    </span>
  );
}

/**
 * First-column table cell for deals — the `EntityCell` shape (avatar + 500
 * name + muted second line) with the deal glyph in front.
 */
export function DealCell({
  name,
  subtitle,
  size = 28,
  muted = false,
}: {
  name: string;
  subtitle?: React.ReactNode;
  size?: number;
  /** Dim the primary line (soft-deleted rows). */
  muted?: boolean;
}) {
  const { token } = theme.useToken();
  const ellipsis: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <DealGlyph name={name} size={size} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            color: muted ? token.colorTextTertiary : token.colorText,
            lineHeight: 1.35,
            ...ellipsis,
          }}
        >
          {name}
        </div>
        {subtitle ? (
          <div
            style={{
              fontSize: 12,
              color: token.colorTextTertiary,
              lineHeight: 1.35,
              ...ellipsis,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
