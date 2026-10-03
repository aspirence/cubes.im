"use client";

import { useMemo } from "react";
import {
  portalPalette,
  type PortalPalette,
} from "./portal-theme";
import type { PortalBrand } from "./types";

/**
 * The client portal's chrome and primitives.
 *
 * Mobile-first literally: one column, 16px gutters, 44px minimum tap targets,
 * and nothing that needs a hover to be discovered — this page is opened on a
 * phone, from a WhatsApp message, by someone who visits it twice a month.
 * Styling is inline rather than AntD because the portal must look like the
 * agency's brand, not like the agency's theme preference.
 */

export function usePortalPalette(accent: string): PortalPalette {
  return useMemo(() => portalPalette(accent), [accent]);
}

export function BrandMark({
  brand,
  palette,
  size = 34,
}: {
  brand: PortalBrand;
  palette: PortalPalette;
  size?: number;
}) {
  if (brand.logoUrl) {
    return (
      // A workspace logo is an arbitrary remote URL, so next/image would need
      // every agency's host in next.config — a plain img is the honest tool.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={brand.name}
        style={{
          width: size,
          height: size,
          borderRadius: 9,
          objectFit: "cover",
          background: palette.panelSoft,
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        background: palette.accent,
        color: palette.accentText,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: size * 0.42,
      }}
    >
      {brand.name.trim().slice(0, 1).toUpperCase() || "C"}
    </span>
  );
}

export function PortalShell({
  brand,
  palette,
  back,
  right,
  banner,
  children,
}: {
  brand: PortalBrand;
  palette: PortalPalette;
  back?: { href: string; label: string };
  right?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: palette.bg,
        color: palette.text,
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: palette.panel,
          borderBottom: `1px solid ${palette.hair}`,
        }}
      >
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <BrandMark brand={brand} palette={palette} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {brand.name}
            </div>
            {back ? (
              <a
                href={back.href}
                style={{
                  fontSize: 12.5,
                  color: palette.textSecondary,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 15 }}>
                  chevron_left
                </span>
                {back.label}
              </a>
            ) : null}
          </div>
          {right}
        </div>
      </header>

      {banner}

      <main
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "16px 16px 64px",
          display: "grid",
          gap: 14,
        }}
      >
        {children}
      </main>
    </div>
  );
}

export function PCard({
  palette,
  children,
  padding = 14,
  accentEdge,
}: {
  palette: PortalPalette;
  children: React.ReactNode;
  padding?: number;
  accentEdge?: string;
}) {
  return (
    <section
      style={{
        background: palette.panel,
        border: `1px solid ${palette.hair}`,
        borderLeft: accentEdge ? `3px solid ${accentEdge}` : undefined,
        borderRadius: 14,
        padding,
        minWidth: 0,
      }}
    >
      {children}
    </section>
  );
}

export function PSectionTitle({
  palette,
  icon,
  title,
  hint,
  right,
}: {
  palette: PortalPalette;
  icon: string;
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "6px 2px 0",
      }}
    >
      <span
        className="material-symbols-rounded"
        aria-hidden
        style={{ fontSize: 18, color: palette.textTertiary }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
        {hint ? (
          <div style={{ fontSize: 12, color: palette.textTertiary }}>{hint}</div>
        ) : null}
      </div>
      {right}
    </div>
  );
}

export function PPill({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: string;
  icon?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        background: `${tone}14`,
        border: `1px solid ${tone}33`,
        color: tone,
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {icon ? (
        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 13 }}>
          {icon}
        </span>
      ) : null}
      {label}
    </span>
  );
}

export function PButton({
  palette,
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  full,
  tone,
}: {
  palette: PortalPalette;
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "quiet";
  disabled?: boolean;
  type?: "button" | "submit";
  full?: boolean;
  tone?: string;
}) {
  const accent = tone ?? palette.accent;
  const base: React.CSSProperties = {
    minHeight: 44,
    padding: "0 16px",
    borderRadius: 11,
    fontSize: 14.5,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    width: full ? "100%" : undefined,
    transition: "opacity .15s ease",
  };
  const skin: React.CSSProperties =
    variant === "primary"
      ? { background: accent, color: palette.accentText, border: `1px solid ${accent}` }
      : variant === "ghost"
        ? { background: palette.panel, color: accent, border: `1px solid ${accent}55` }
        : { background: "transparent", color: palette.textSecondary, border: "1px solid transparent" };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...skin }}>
      {children}
    </button>
  );
}

export function PField({
  palette,
  label,
  hint,
  children,
}: {
  palette: PortalPalette;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 5 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.textSecondary }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ fontSize: 11.5, color: palette.textTertiary }}>{hint}</span>
      ) : null}
    </label>
  );
}

/** Shared input styling — 16px font, because anything smaller zooms on iOS. */
export function inputStyle(palette: PortalPalette): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 44,
    padding: "10px 12px",
    borderRadius: 11,
    border: `1px solid ${palette.hair}`,
    background: palette.panel,
    color: palette.text,
    fontSize: 16,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };
}

export function PNotice({
  palette,
  tone,
  icon,
  title,
  children,
}: {
  palette: PortalPalette;
  tone: string;
  icon: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "11px 13px",
        borderRadius: 12,
        background: `${tone}12`,
        border: `1px solid ${tone}33`,
      }}
    >
      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 19, color: tone }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: palette.text }}>{title}</div>
        {children ? (
          <div style={{ fontSize: 12.5, color: palette.textSecondary, marginTop: 2 }}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PEmpty({
  palette,
  icon,
  title,
  desc,
}: {
  palette: PortalPalette;
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "26px 16px",
        border: `1px dashed ${palette.hair}`,
        borderRadius: 14,
        background: palette.panel,
      }}
    >
      <span
        className="material-symbols-rounded"
        aria-hidden
        style={{ fontSize: 30, color: palette.textTertiary }}
      >
        {icon}
      </span>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: palette.textSecondary, marginTop: 3 }}>{desc}</div>
    </div>
  );
}
