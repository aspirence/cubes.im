"use client";

/**
 * Shared visual primitives for the re-skinned projects list (grid + list views).
 * Pure presentation — no data fetching. Everything is derived from the fields
 * `useProjects()` already loads (color_code, name, key, tasks_counter, status /
 * health / category / client embeds + is_favorite). No new endpoints.
 */

import { useMemo } from "react";
import type { CSSProperties } from "react";
import { theme } from "antd";
import type { ProjectRow, ProjectStatus, ProjectHealth } from "./types";
import type { ProjectCategory } from "@/features/settings/use-categories";
import {
  resolveStatus,
  resolveHealth,
  resolveCategory,
} from "./project-display";

/* ---------------------------------------------------------------- tokens -- */

export function useProjectSkin() {
  const { token } = theme.useToken();
  return useMemo(
    () => ({
      accent: "#4a4ad0",
      accentSoft: token.colorPrimaryBg,
      bar: "#5a5ad6",
      canvas: token.colorBgLayout,
      card: token.colorBgContainer,
      hairline: token.colorBorderSecondary,
      divider: token.colorSplit,
      chipBg: token.colorFillTertiary,
      text: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      textFaint: token.colorTextQuaternary,
      star: "#eab308",
      rowHover: token.colorFillQuaternary,
      cardHoverBorder: token.colorBorder,
      cardShadow: "0 1px 2px rgba(16,24,40,.04)",
      cardHoverShadow: "0 6px 18px -6px rgba(16,24,40,.12)",
    }),
    [token],
  );
}

export type ProjectSkin = ReturnType<typeof useProjectSkin>;

/** Solid avatar / category palette (white text). */
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

/** Semantic pill styles: always light bg + saturated text. */
type Semantic = { bg: string; fg: string };
const SEMANTIC: Record<string, Semantic> = {
  green: { fg: "#2f8f5f", bg: "#e9f6ef" },
  amber: { fg: "#b8842a", bg: "#fdf5e6" },
  red: { fg: "#c0453c", bg: "#fbeceb" },
  orange: { fg: "#c07d2e", bg: "#fdf2e6" },
  slate: { fg: "#6a6d78", bg: "#eef1f5" },
};

export const MONO = "var(--font-geist-mono)";

/* ------------------------------------------------------------- utilities -- */

/** Deterministic palette index from an arbitrary key (id/name). */
export function paletteColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

/** First up-to-2 initials from a name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Map an arbitrary lookup color (hex, rgb, or antd preset name) to the closest
 * semantic bucket so pills always render on a light bg with saturated text.
 */
function semanticFor(color: string | null | undefined, name?: string): Semantic {
  const c = (color ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();

  const test = (needle: string) => c.includes(needle) || n.includes(needle);

  if (test("green") || test("success") || test("complete") || test("good") || test("healthy") || test("done")) {
    return SEMANTIC.green;
  }
  if (test("red") || test("error") || test("danger") || test("blocked") || test("critical") || test("cancel")) {
    return SEMANTIC.red;
  }
  if (test("orange") || test("risk") || test("hold")) {
    return SEMANTIC.orange;
  }
  if (test("amber") || test("yellow") || test("gold") || test("warn") || test("progress") || test("needs")) {
    return SEMANTIC.amber;
  }

  // Hex heuristic: derive bucket from dominant channel when no keyword hit.
  const hex = c.match(/^#?([0-9a-f]{6})$/);
  if (hex) {
    const v = hex[1]!;
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    if (g > r && g > b) return SEMANTIC.green;
    if (r > g && r > b) return b > g ? SEMANTIC.slate : SEMANTIC.red;
    if (r > 180 && g > 120 && b < 120) return SEMANTIC.amber;
  }
  return SEMANTIC.slate;
}

/* ---------------------------------------------------------------- pills ---- */

const pillBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 22,
  padding: "0 9px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: "nowrap",
};

export function SemanticPill({
  label,
  color,
  name,
  dot,
}: {
  label: string;
  color: string | null | undefined;
  name?: string;
  dot?: boolean;
}) {
  const s = semanticFor(color, name ?? label);
  return (
    <span style={{ ...pillBase, background: s.bg, color: s.fg }}>
      {dot ? (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: s.fg,
            display: "inline-block",
          }}
        />
      ) : null}
      {label}
    </span>
  );
}

/** Neutral chip (e.g. category) — uses category color as a small dot. */
export function CategoryChip({
  label,
  color,
}: {
  label: string;
  color: string | null | undefined;
}) {
  const skin = useProjectSkin();
  return (
    <span
      style={{
        ...pillBase,
        background: skin.chipBg,
        color: skin.textSecondary,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color || skin.textTertiary,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------ progress ---- */

/**
 * Derive a display progress % from the project's status name. There is no
 * stored progress column in the loaded data, so this is a best-effort mapping
 * that returns `null` when the status is unknown (bar then hides gracefully).
 */
export function deriveProgress(statusName: string | null | undefined): number | null {
  if (!statusName) return null;
  const n = statusName.toLowerCase();
  if (/(complete|done|closed|finished)/.test(n)) return 100;
  if (/(cancel|blocked)/.test(n)) return 0;
  if (/(review|testing|qa|verify)/.test(n)) return 80;
  if (/(progress|active|doing|ongoing)/.test(n)) return 55;
  if (/(planning|proposed|backlog|todo|to do|not started|new)/.test(n)) return 10;
  if (/(hold|paused|pending)/.test(n)) return 30;
  return null;
}

export function ProgressBar({
  value,
  color,
  height = 6,
}: {
  value: number;
  color: string;
  height?: number;
}) {
  const skin = useProjectSkin();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      style={{
        flex: 1,
        height,
        borderRadius: 999,
        background: skin.divider,
        overflow: "hidden",
        minWidth: 60,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 999,
          background: color,
          transition: "width .3s ease",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- avatars ---- */

export interface AvatarSpec {
  key: string;
  label: string;
  color: string;
}

/**
 * Identity chips for a project. Members are not loaded by `useProjects`, so
 * these are derived honestly from the fields that ARE present: the client name
 * and the project name. Never fabricates people counts.
 */
export function projectAvatars(project: ProjectRow): AvatarSpec[] {
  const specs: AvatarSpec[] = [];
  const clientName = project.client?.name;
  if (clientName) {
    specs.push({
      key: `client-${project.client!.id}`,
      label: initials(clientName),
      color: paletteColor(project.client!.id),
    });
  }
  specs.push({
    key: `project-${project.id}`,
    label: initials(project.name),
    color: project.color_code || paletteColor(project.id),
  });
  return specs;
}

export function AvatarStack({
  avatars,
  size = 24,
}: {
  avatars: AvatarSpec[];
  size?: number;
}) {
  const skin = useProjectSkin();
  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      {avatars.map((a, i) => (
        <span
          key={a.key}
          title={a.label}
          style={{
            width: size,
            height: size,
            marginLeft: i === 0 ? 0 : -8,
            borderRadius: 999,
            background: a.color,
            color: "#fff",
            fontSize: size <= 22 ? 10 : 11,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: `2px solid ${skin.card}`,
            zIndex: avatars.length - i,
            fontFamily: MONO,
            letterSpacing: "-.3px",
          }}
        >
          {a.label}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------- resolved bundle ----- */

export interface ResolvedDisplay {
  status: { name: string; color: string } | null;
  health: { name: string; color: string } | null;
  category: { name: string; color: string | null } | null;
  progress: number | null;
}

/** Resolve status/health/category + derived progress for a project once. */
export function resolveDisplay(
  project: ProjectRow,
  statuses: ProjectStatus[] | undefined,
  healths: ProjectHealth[] | undefined,
  categories: ProjectCategory[] | undefined,
): ResolvedDisplay {
  const status = resolveStatus(project, statuses);
  return {
    status,
    health: resolveHealth(project, healths),
    category: resolveCategory(project, categories),
    progress: deriveProgress(status?.name),
  };
}
