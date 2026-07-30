/** Shared design tokens + helpers for the reporting suite. */

export const T = {
  accent: "#4a4ad0",
  chart: "#5a5ad6",
  accentSoft: "#eceefb",
  canvas: "#f6f7f9",
  panel: "#ffffff",
  hairline: "#ececf0",
  divider: "#f0f0f3",
  dividerSoft: "#f4f4f6",
  chip: "#f2f3f5",
  textPrimary: "#17171c",
  textSecondary: "#6a6d78",
  textTertiary: "#9a9da8",
  textFaint: "#a2a5af",
  cardShadow: "0 1px 2px rgba(16,24,40,.04)",
  cardShadowHover: "0 6px 18px -6px rgba(16,24,40,.12)",
  cardBorderHover: "#d6d7de",
} as const;

/** Semantic palette: always light bg + saturated text. */
export const SEMANTIC = {
  green: { fg: "#2f8f5f", bg: "#e9f6ef" },
  amber: { fg: "#b8842a", bg: "#fdf5e6" },
  red: { fg: "#c0453c", bg: "#fbeceb" },
  orange: { fg: "#c07d2e", bg: "#fdf2e6" },
  slate: { fg: "#6a6d78", bg: "#eef1f5" },
} as const;

/** Solid avatar / category fills (white text). */
export const AVATAR_PALETTE = [
  "#5a5ad6",
  "#e0a83e",
  "#3a9d6e",
  "#8b6fd6",
  "#2f9c9c",
  "#d96a8f",
  "#e0663f",
  "#8a8d98",
] as const;

/** Deterministic palette index from any string key. */
export function paletteFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

/** Uppercase initials (max 2) from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const MONO = "var(--font-geist-mono)";
