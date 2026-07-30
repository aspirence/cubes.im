"use client";

import { useState } from "react";
import { theme } from "antd";
import { CRM_HOVER_ROW_CLASS, useCrmStyles } from "../_lib/ui";

/**
 * The CRM's one list-row primitive: hairline divider, `10px 16px` inset, a
 * `colorFillQuaternary` hover surface, and `CRM_HOVER_ROW_CLASS` so any
 * `<RowActions>` inside reveals on hover.
 *
 * Drop it inside a `Panel padding={0}` and the rows line up with the panel
 * header's own 16px inset. Pass `onClick` and it renders a real `<button>`.
 */
export function CrmListRow({
  children,
  first = false,
  onClick,
  hover = true,
  align = "center",
  style,
}: {
  children: React.ReactNode;
  /** Skip the top divider on the first row of a list. */
  first?: boolean;
  /** Makes the row a button (pointer + keyboard activation). */
  onClick?: () => void;
  /** Hover surface. Turn off for rows that are neither clickable nor actionable. */
  hover?: boolean;
  align?: React.CSSProperties["alignItems"];
  style?: React.CSSProperties;
}) {
  const { token } = theme.useToken();
  useCrmStyles();
  const [lit, setLit] = useState(false);

  // The transparent border keeps the first row exactly as tall as the rest.
  const divider = `1px solid ${first ? "transparent" : token.colorSplit}`;
  const base: React.CSSProperties = {
    display: "flex",
    alignItems: align,
    gap: 10,
    width: "100%",
    minWidth: 0,
    padding: "10px 16px",
    background: hover && lit ? token.colorFillQuaternary : "transparent",
    transition: "background .12s ease",
    textAlign: "left",
    ...style,
  };

  const litProps = hover
    ? {
        onMouseEnter: () => setLit(true),
        onMouseLeave: () => setLit(false),
        onFocus: () => setLit(true),
        onBlur: () => setLit(false),
      }
    : {};

  if (!onClick) {
    return (
      <div
        className={CRM_HOVER_ROW_CLASS}
        style={{ ...base, borderTop: divider }}
        {...litProps}
      >
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={CRM_HOVER_ROW_CLASS}
      onClick={onClick}
      {...litProps}
      style={{
        ...base,
        borderInline: "none",
        borderBottom: "none",
        borderTop: divider,
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
        color: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
