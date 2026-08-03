"use client";

import { useMemo } from "react";
import { theme } from "antd";

/**
 * Social Studio's palette. Surfaces and text come from the AntD theme so light
 * and dark both work; the named hues below are the app's own accents and stay
 * literal on purpose — they are brand, not theme.
 *
 * Lives here rather than inside the workspace so the calendar and the routine
 * screens share one palette instead of drifting from a second copy.
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
      accent: "#4a4ad0",
      accentSoft: "rgba(74,74,208,0.10)",
      accentDeep: "#3a3ab0",
      mint: "#2f9c9c",
      lavender: "#7a5af5",
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
