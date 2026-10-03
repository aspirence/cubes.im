"use client";

/**
 * Sheets — the small pieces a sheet card, a list row and the open sheet's
 * header are built from: the source's tile and chip, the Google state pill,
 * the link out to Google, the column pills, the project chip and the
 * creator's avatar.
 *
 * They live apart from the card so the list and the open sheet speak the same
 * visual language: the tile a sheet wears on its card is the tile it wears in
 * its own header, and "Synced 6h ago" looks the same in both places.
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";
import dayjs from "dayjs";
import { Avatar, Tooltip } from "antd";
import { SOURCES } from "@/lib/sheets/sources";
import type { SheetSource } from "@/lib/sheets/types";
import { MONO_FONT } from "@/lib/theme";
import { MIcon, useC } from "@/features/app-content-studio/ui";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { inkOf } from "./sheet-preview";
import {
  SHEETS_BRAND,
  SOURCE_ACCENT,
  initialsOf,
  seeded,
  shortAgo,
  type CardColumns,
  type ListGoogleStatus,
  type ListStatusTone,
} from "./sheet-list-model";

type Palette = ReturnType<typeof useC>;

/** The hue a source wears on tiles, chips and the preview. */
export function accentFor(source: SheetSource, C: Palette): string {
  const key = SOURCE_ACCENT[source] ?? "brand";
  return key === "brand" ? SHEETS_BRAND : C[key];
}

export const ELLIPSIS: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** A hairline a step stronger than C.hair — for outlined chips that sit on white. */
function chipLine(C: Palette): string {
  return `color-mix(in srgb, ${C.text} 13%, transparent)`;
}

/* ------------------------------------------------------------------ *
 * Source
 * ------------------------------------------------------------------ */

/**
 * The source's glyph on a solid rounded square — the sheet's "logo", like
 * the company tiles on a CRM card. Solid rather than tinted so it still reads
 * at 22px and on the dark theme; the glyph is white on every source hue.
 */
export function SourceTile({ source, size = 24 }: { source: SheetSource; size?: number }) {
  const C = useC();
  const src = SOURCES[source] ?? SOURCES.custom;
  const accent = accentFor(source, C);
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: Math.round(size * 0.29),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: accent,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, #000 8%, transparent), 0 1px 2px color-mix(in srgb, ${accent} 30%, transparent)`,
      }}
    >
      <MIcon name={src.icon} size={Math.round(size * 0.64)} color="#fff" />
    </span>
  );
}

/** Where the rows come from — a tinted pill with a tinted edge, in the source's hue. */
export function SourceChip({ source }: { source: SheetSource }) {
  const C = useC();
  const src = SOURCES[source] ?? SOURCES.custom;
  const accent = accentFor(source, C);
  const ink = inkOf(accent, C);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        maxWidth: "100%",
        minWidth: 0,
        padding: "0 8px 0 6px",
        borderRadius: 999,
        background: `color-mix(in srgb, ${accent} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
        boxSizing: "border-box",
        color: ink,
        fontSize: 11.5,
        fontWeight: 600,
        flex: "none",
      }}
    >
      <MIcon name={src.icon} size={14} color={ink} />
      <span style={ELLIPSIS}>{src.label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Google state
 * ------------------------------------------------------------------ */

export function toneColor(tone: ListStatusTone, C: Palette): string {
  switch (tone) {
    case "success":
      return C.green;
    case "progress":
      return C.accent;
    case "pending":
      return C.gold;
    case "danger":
      return C.red;
    default:
      return C.textTertiary;
  }
}

function StatusTip({ status, extra }: { status: ListGoogleStatus; extra?: ReactNode }) {
  return (
    <div style={{ maxWidth: 280 }}>
      {status.hint}
      {status.at ? <div style={{ opacity: 0.72, marginTop: 4 }}>Last synced {dayjs(status.at).format("D MMM YYYY, HH:mm")}</div> : null}
      {extra ? <div style={{ opacity: 0.72, marginTop: 4 }}>{extra}</div> : null}
    </div>
  );
}

/**
 * The Google state. Outlined with a dot, where the source chip is filled —
 * two visual languages for "what it is" and "how it is", so a gold source and
 * an amber "Setting up" never read as the same thing.
 *
 * With `onClick` it is a button (the open sheet's header, where it opens the
 * Google panel); `size="md"` matches the height of the buttons beside it.
 */
export function GoogleStatusChip({
  status,
  onClick,
  size = "sm",
  label,
}: {
  status: ListGoogleStatus;
  onClick?: () => void;
  size?: "sm" | "md";
  /** Overrides the accessible name of the button form. */
  label?: string;
}) {
  const C = useC();
  const color = toneColor(status.tone, C);
  const danger = status.tone === "danger";
  const pulse = status.kind === "live" || status.kind === "syncing";
  const when = status.at ? shortAgo(status.at) : "";
  const md = size === "md";
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: md ? 7 : 6,
    height: md ? 32 : 22,
    padding: md ? "0 12px 0 11px" : "0 8px",
    borderRadius: 999,
    border: `1px solid ${danger ? `color-mix(in srgb, ${C.red} 38%, transparent)` : md ? chipLine(C) : C.hair}`,
    background: danger ? `color-mix(in srgb, ${C.red} 7%, ${C.panel})` : C.panel,
    color: danger ? inkOf(C.red, C) : md ? C.text : C.textSecondary,
    fontSize: md ? 13 : 11.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    flex: "none",
    boxSizing: "border-box",
    maxWidth: "100%",
  };
  const body = (
    <>
      <span
        className={pulse ? "sheets-dot-pulse" : undefined}
        style={
          {
            "--sheets-dot": color,
            width: md ? 8 : 7,
            height: md ? 8 : 7,
            flex: "none",
            borderRadius: 999,
            background: status.tone === "none" ? "transparent" : color,
            boxSizing: "border-box",
            border: status.tone === "none" ? `1.5px solid ${color}` : "none",
          } as CSSProperties
        }
      />
      {status.label}
      {when ? (
        <span className="sheets-chip-at" style={{ fontFamily: MONO_FONT, fontWeight: 500, fontSize: md ? 12 : 11, color: C.textTertiary }}>
          {when}
        </span>
      ) : null}
    </>
  );
  if (onClick) {
    return (
      <Tooltip title={<StatusTip status={status} extra="Click for the Google Sheets sync settings." />}>
        <button
          type="button"
          className="sheets-status-btn"
          onClick={onClick}
          aria-label={label ?? `Google Sheets: ${status.label}${when ? `, ${when}` : ""}. Open sync settings`}
          style={{ ...style, appearance: "none", font: "inherit", fontSize: style.fontSize, fontWeight: 600, cursor: "pointer", margin: 0 }}
        >
          {body}
          <MIcon name="tune" size={15} color={C.textTertiary} />
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={<StatusTip status={status} />}>
      <span style={style}>{body}</span>
    </Tooltip>
  );
}

/**
 * The spreadsheet, as a link chip — the card's equivalent of a website field.
 * It names where it goes (docs.google.com) and opens a new tab; it never also
 * opens the Cubes view the card around it opens.
 */
export function GoogleLinkChip({ href, name }: { href: string; name: string }) {
  const C = useC();
  return (
    <Tooltip title="Open in Google Sheets">
      <a
        className="sheets-link-chip"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${name} in Google Sheets`}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          height: 24,
          maxWidth: "100%",
          minWidth: 0,
          padding: "0 10px 0 7px",
          borderRadius: 999,
          border: `1px solid ${chipLine(C)}`,
          background: C.panel,
          boxSizing: "border-box",
          color: C.text,
          fontSize: 12,
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        <MIcon name="link" size={15} color={C.textSecondary} />
        <span style={ELLIPSIS}>docs.google.com</span>
      </a>
    </Tooltip>
  );
}

/** The square "open in Google" icon link a list row ends with. */
export function OpenInGoogle({ href, name, style }: { href: string; name: string; style?: CSSProperties }) {
  const C = useC();
  return (
    <Tooltip title="Open in Google Sheets">
      <a
        className="sheets-open-google"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${name} in Google Sheets`}
        // The row around it opens the Cubes view; this one only leaves.
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: C.panel,
          border: `1px solid ${C.hair}`,
          color: C.textSecondary,
          ...style,
        }}
      >
        <MIcon name="open_in_new" size={16} />
      </a>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ *
 * Columns, project, people
 * ------------------------------------------------------------------ */

const PILL: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 22,
  padding: "0 8px",
  borderRadius: 999,
  boxSizing: "border-box",
  fontSize: 11.5,
  fontWeight: 500,
  whiteSpace: "nowrap",
};

/**
 * The first few column names, then "+N" — what tells a person what is IN a
 * sheet before they open it. One line: the pills shrink with an ellipsis
 * rather than wrap, so every card in a row keeps the same height. The
 * tooltip has the whole list.
 */
export function ColumnPills({ cols }: { cols: CardColumns }) {
  const C = useC();
  const pill: CSSProperties = {
    ...PILL,
    background: `color-mix(in srgb, ${C.text} 4.5%, ${C.panel})`,
    border: `1px solid color-mix(in srgb, ${C.text} 8%, transparent)`,
    color: C.textSecondary,
  };
  if (cols.visible.length === 0) return <span style={{ fontSize: 12.5, color: C.textTertiary }}>No columns yet</span>;
  const all = cols.visible.filter(Boolean);
  return (
    <Tooltip
      title={
        all.length ? (
          <div style={{ maxWidth: 300 }}>
            {all.slice(0, 24).join(", ")}
            {all.length > 24 ? `, and ${all.length - 24} more` : ""}
          </div>
        ) : undefined
      }
    >
      <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, maxWidth: "100%", overflow: "hidden" }}>
        {cols.shown.map((label, i) => (
          <span key={i} style={{ ...pill, flex: "0 1 auto", minWidth: 28, maxWidth: 104 }}>
            <span style={ELLIPSIS}>{label}</span>
          </span>
        ))}
        {cols.more > 0 ? (
          <span style={{ ...pill, flex: "none", fontFamily: MONO_FONT, fontSize: 11, color: C.textTertiary, padding: "0 7px" }}>
            +{cols.more}
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}

/** A project, as the reference card draws a contact: outlined, with its colour for an avatar. */
export function ProjectChip({ name, color, height = 24 }: { name: string; color: string | null; height?: number }) {
  const C = useC();
  const workspace = color === null;
  return (
    <span
      title={name}
      style={{
        ...PILL,
        gap: 6,
        height,
        maxWidth: "100%",
        minWidth: 0,
        padding: "0 10px 0 8px",
        border: `1px solid ${chipLine(C)}`,
        background: C.panel,
        color: C.text,
        fontSize: 12,
      }}
    >
      {workspace ? (
        <MIcon name="workspaces" size={14} color={C.textSecondary} />
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flex: "none" }} />
      )}
      <span style={ELLIPSIS}>{name}</span>
    </span>
  );
}

export interface CreatorInfo {
  name: string;
  avatarUrl: string | null;
}

/**
 * user id → name and photo, from the team roster the app already caches (the
 * same query the member pickers use), so the avatars on a page of cards cost
 * no request of their own. Undefined while the roster loads.
 */
export function useCreators(): Map<string, CreatorInfo> | undefined {
  const { data } = useTeamMembers();
  return useMemo(() => {
    if (!data) return undefined;
    const map = new Map<string, CreatorInfo>();
    for (const m of data) {
      const id = m.user_id ?? m.user?.id;
      // Never an email on a card: a member with no name yet is just "Member".
      if (id) map.set(id, { name: m.user?.name?.trim() || "Member", avatarUrl: m.user?.avatar_url ?? null });
    }
    return map;
  }, [data]);
}

/**
 * Who made the sheet. A photo when there is one, otherwise initials on a
 * stable tint; a plain person glyph when the maker is no longer on the
 * roster; a quiet empty circle while the roster loads (no guess).
 */
export function CreatorAvatar({
  userId,
  creators,
  size = 20,
}: {
  userId: string | null;
  creators: Map<string, CreatorInfo> | undefined;
  size?: number;
}) {
  const C = useC();
  if (!userId) return null;
  const base: CSSProperties = { flex: "none", fontSize: size <= 20 ? 9.5 : 11, fontWeight: 600, lineHeight: `${size}px` };
  if (!creators) {
    return <span aria-hidden style={{ width: size, height: size, borderRadius: 999, flex: "none", background: C.panelSoft }} />;
  }
  const who = creators.get(userId);
  if (!who) {
    return (
      <Tooltip title="Made by someone no longer in this workspace">
        <Avatar size={size} style={{ ...base, background: C.panelSoft, color: C.textTertiary }} icon={<MIcon name="person" size={size - 6} />} />
      </Tooltip>
    );
  }
  return (
    <Tooltip title={`Made by ${who.name}`}>
      <Avatar
        size={size}
        src={who.avatarUrl ?? undefined}
        alt={who.name}
        style={{ ...base, background: who.avatarUrl ? undefined : personTint(userId, C), color: "#fff", boxShadow: `0 0 0 1.5px ${C.panel}` }}
      >
        {initialsOf(who.name)}
      </Avatar>
    </Tooltip>
  );
}

/** A member's stable avatar tint — the same person wears the same colour on every card. */
export function personTint(userId: string, C: Palette): string {
  const tints = [C.accent, C.lavender, C.mint, C.gold, C.green, SHEETS_BRAND];
  return tints[Math.floor(seeded(userId) * tints.length)];
}

/** How far each face in a stack tucks under the one before it. */
export const STACK_OVERLAP = 4;

/**
 * A face in a stack, without a tooltip of its own (the stack's owner explains
 * the whole row). `ring` is the colour that separates it from its neighbours;
 * `mark` draws a second, accent ring — "this one is you". Earlier faces sit
 * ON TOP (`z`), so the first one — the viewer, when they are in it — is never
 * clipped, and only the right edge of each later face tucks under.
 */
export function StackAvatar({
  userId,
  people,
  size = 20,
  ring,
  mark = false,
  first = false,
  z,
}: {
  userId: string;
  people: Map<string, CreatorInfo> | undefined;
  size?: number;
  ring: string;
  mark?: boolean;
  first?: boolean;
  z: number;
}) {
  const C = useC();
  const who = people?.get(userId);
  const style: CSSProperties = {
    flex: "none",
    marginLeft: first ? 0 : -STACK_OVERLAP,
    position: "relative",
    zIndex: z,
    fontSize: size <= 20 ? 9.5 : 11,
    fontWeight: 600,
    lineHeight: `${size}px`,
    color: who ? "#fff" : C.textTertiary,
    background: !who ? C.panelSoft : who.avatarUrl ? undefined : personTint(userId, C),
    boxShadow: mark ? `0 0 0 1.5px ${ring}, 0 0 0 3px ${C.accent}` : `0 0 0 1.5px ${ring}`,
  };
  if (!who) return <Avatar size={size} style={style} icon={<MIcon name="person" size={size - 6} />} />;
  return (
    <Avatar size={size} src={who.avatarUrl ?? undefined} alt={who.name} style={style}>
      {initialsOf(who.name)}
    </Avatar>
  );
}
