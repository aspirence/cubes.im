"use client";

/** Material Symbols Rounded glyph, shared by the CRM module's pages. */
export function MIcon({
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
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color, ...style }}
    >
      {name}
    </span>
  );
}
