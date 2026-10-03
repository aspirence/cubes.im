/**
 * The client portal's palette, derived from one workspace accent.
 *
 * The portal is never themed by the agency user's light/dark preference: a
 * client opening a WhatsApp link has no preference stored here, and a half-dark
 * page with an agency logo on it looks broken rather than branded. So this is a
 * fixed light surface plus the workspace's accent, and every tint is computed
 * from that accent so any brand colour lands somewhere legible.
 *
 * Pure on purpose — no React, so server components and tests can both use it.
 */

export interface PortalPalette {
  accent: string;
  accentText: string;
  accentSoft: string;
  accentLine: string;
  bg: string;
  panel: string;
  panelSoft: string;
  hair: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  green: string;
  red: string;
  gold: string;
}

/** #rrggbb → {r,g,b}; null for anything else. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * Relative luminance (WCAG). Used for one decision only: whether text on top of
 * the accent should be white or near-black — a yellow brand and a navy brand
 * both have to produce a readable button.
 */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Text colour that stays readable on a filled accent button. */
export function onAccent(hex: string): string {
  return luminance(hex) > 0.55 ? "#1b1b22" : "#ffffff";
}

/** `rgba()` of the accent — for tints that must work over any background. */
export function accentAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? { r: 74, g: 74, b: 208 };
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

export function portalPalette(accent: string): PortalPalette {
  return {
    accent,
    accentText: onAccent(accent),
    accentSoft: accentAlpha(accent, 0.1),
    accentLine: accentAlpha(accent, 0.28),
    bg: "#f6f7f9",
    panel: "#ffffff",
    panelSoft: "#f2f3f6",
    hair: "#e5e7ec",
    text: "#17181d",
    textSecondary: "#5a5e6b",
    textTertiary: "#878c99",
    green: "#2f8f5f",
    red: "#c0453c",
    gold: "#b8842a",
  };
}
