import type { CSSProperties } from "react";

/**
 * Cubes brand mark — an isometric cube built from three faces. `color` sets the
 * base tone; the faces use opacity steps so the mark reads 3-D on any
 * background (white-on-gradient tiles, ink-on-light, etc.).
 */
export function CubesMark({
  size = 20,
  color = "currentColor",
  style,
  title = "Cubes",
}: {
  size?: number;
  color?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={title}
      style={style}
    >
      {/* top */}
      <path d="M12 2.4 20.6 7.2 12 12 3.4 7.2Z" fill={color} fillOpacity={1} />
      {/* left */}
      <path d="M3.4 7.2 12 12v9.6L3.4 16.8Z" fill={color} fillOpacity={0.68} />
      {/* right */}
      <path d="M20.6 7.2 12 12v9.6l8.6-4.8Z" fill={color} fillOpacity={0.42} />
    </svg>
  );
}

/** Mark + wordmark lockup. */
export function CubesLogo({
  markSize = 26,
  fontSize = 19,
  color = "currentColor",
  gap = 9,
  style,
}: {
  markSize?: number;
  fontSize?: number;
  color?: string;
  gap?: number;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap, color, ...style }}>
      <CubesMark size={markSize} color={color} />
      <span
        style={{
          fontWeight: 800,
          fontSize,
          letterSpacing: "-0.02em",
          fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          color,
        }}
      >
        Cubes
      </span>
    </span>
  );
}
