"use client";

import { useMemo, useState } from "react";
import { Avatar, Popover, theme } from "antd";
import dayjs from "dayjs";

/* ------------------------------------------------------------------ tokens */

export const MONO = "var(--font-geist-mono)";

/**
 * Schedule-local token bundle read off the active AntD theme, so every
 * surface (cells, chips, tiles) stays light/dark safe.
 */
export function useScheduleTokens() {
  const { token } = theme.useToken();
  return useMemo(
    () => ({
      accent: token.colorPrimary,
      accentBar: token.colorLink,
      accentSoft: token.colorPrimaryBg,
      canvas: token.colorBgLayout,
      panel: token.colorBgContainer,
      hairline: token.colorBorderSecondary,
      divider: token.colorSplit,
      chipBg: token.colorFillTertiary,
      chipBgHover: token.colorFillSecondary,
      rowHover: token.colorFillQuaternary,
      cellHover: token.colorFillTertiary,
      weekendBg: token.colorFillQuaternary,
      eventBg: token.colorFillQuaternary,
      textPrimary: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      textFaint: token.colorTextQuaternary,
      warnFg: token.colorWarningText,
      warnBg: token.colorWarningBg,
      shadow: token.boxShadowSecondary,
    }),
    [token],
  );
}

export type ScheduleTokens = ReturnType<typeof useScheduleTokens>;

/* ----------------------------------------------------------------- palette */

/**
 * Stable project palette — mid-tone hues that read as bars/dots on both the
 * light and dark surfaces (text always comes from theme tokens). Used when a
 * project has no explicit color_code.
 */
export const PROJECT_COLORS = [
  "#5a5ad6",
  "#e0a83e",
  "#3a9d6e",
  "#8b6fd6",
  "#2f9c9c",
  "#d96a8f",
  "#e0663f",
  "#8a8d98",
];

/** Deterministic key -> palette colour (stable across renders/sessions). */
export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

/** A translucent tint of a hex colour — subtle on light and dark canvases. */
export function tint(hex: string, alphaHex = "1c"): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alphaHex}` : hex;
}

export function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** A small material glyph. */
export function MIcon({
  name,
  size = 14,
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

/* -------------------------------------------------------------- nav button */

export function NavButton({
  children,
  onClick,
  ariaLabel,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel?: string;
  /** Highlighted state (e.g. the Yesterday/Today/Tomorrow jump that matches). */
  active?: boolean;
}) {
  const T = useScheduleTokens();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 32,
        minWidth: 32,
        padding: "0 10px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        border: `1px solid ${active ? T.accent : T.hairline}`,
        borderRadius: 8,
        background: active ? T.accentSoft : hover ? T.rowHover : T.panel,
        color: active ? T.accent : T.textPrimary,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- chips */

/** One pill inside a day cell. */
export interface DayChip {
  key: string;
  kind: "task" | "allocation" | "leave" | "holiday";
  label: string;
  /** Trailing text (e.g. "6h"), rendered in mono. */
  sub?: string;
  color?: string;
  href?: string;
  /** The person the chip belongs to (allocation/leave/task assignee). */
  person?: { name: string; avatarUrl: string | null } | null;
  /** Project name, for the hover detail card. */
  projectName?: string;
  /** Allocated hours for that day (allocations only). */
  hours?: number;
  /** ISO day the chip sits on, for the hover detail card. */
  dateIso?: string;
  /** Extra context line (leave type, assignee overflow, …). */
  detail?: string;
}

const KIND_META: Record<
  DayChip["kind"],
  { label: string; icon: string }
> = {
  allocation: { label: "Allocation", icon: "event_upcoming" },
  task: { label: "Task due", icon: "task_alt" },
  leave: { label: "On leave", icon: "event_busy" },
  holiday: { label: "Holiday", icon: "celebration" },
};

/** Hover card: everything we know about one chip (person, project, hours). */
function ChipDetailCard({ chip, T }: { chip: DayChip; T: ScheduleTokens }) {
  const meta = KIND_META[chip.kind];
  const barColor =
    chip.kind === "leave" || chip.kind === "holiday"
      ? T.warnFg
      : (chip.color ?? T.accentBar);
  const row = (icon: string, content: React.ReactNode) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12.5,
        color: T.textSecondary,
      }}
    >
      <MIcon name={icon} size={15} color={T.textTertiary} />
      {content}
    </div>
  );
  return (
    <div style={{ minWidth: 200, maxWidth: 280, display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.8px",
          textTransform: "uppercase",
          color: T.textTertiary,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <MIcon name={meta.icon} size={13} />
        {meta.label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: 3,
            background: barColor,
            flex: "none",
          }}
        />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: T.textPrimary }}>
          {chip.label}
        </span>
      </div>
      {chip.person
        ? row(
            "person",
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Avatar
                size={18}
                src={chip.person.avatarUrl ?? undefined}
                style={{ fontSize: 9, flex: "none" }}
              >
                {memberInitials(chip.person.name)}
              </Avatar>
              {chip.person.name}
            </span>,
          )
        : null}
      {chip.projectName && chip.projectName !== chip.label
        ? row("folder", chip.projectName)
        : null}
      {chip.dateIso
        ? row(
            "calendar_today",
            <span style={{ fontFamily: MONO }}>
              {dayjs(chip.dateIso).format("ddd, MMM D, YYYY")}
            </span>,
          )
        : null}
      {chip.hours !== undefined && chip.hours > 0
        ? row(
            "schedule",
            <span style={{ fontFamily: MONO }}>{formatHours(chip.hours)} / day</span>,
          )
        : null}
      {chip.detail ? row("info", chip.detail) : null}
    </div>
  );
}

/** "6h" / "6.5h" — compact hour label. */
export function formatHours(hours: number): string {
  return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(1))}h`;
}

export function ChipPill({
  chip,
  onOpen,
  /** Show the person's avatar inside the pill (team-wide views). */
  showAvatar = false,
  /** Skip the hover detail popover (used inside the overflow popover). */
  plain = false,
}: {
  chip: DayChip;
  onOpen: (href: string) => void;
  showAvatar?: boolean;
  plain?: boolean;
}) {
  const T = useScheduleTokens();
  const clickable = Boolean(chip.href);
  const warn = chip.kind === "leave" || chip.kind === "holiday";
  const barColor = warn ? T.warnFg : (chip.color ?? T.accentBar);
  const tone = warn
    ? { bg: T.warnBg, fg: T.warnFg }
    : chip.color
      ? { bg: tint(chip.color), fg: T.textPrimary }
      : { bg: T.eventBg, fg: T.textPrimary };

  const pill = (
    <div
      role={clickable ? "button" : undefined}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onOpen(chip.href as string);
            }
          : undefined
      }
      className="wl-cal-chip"
      // Native tooltip so a truncated label stays readable even in `plain`
      // mode (the overflow popover), where the hover detail card is skipped.
      title={chip.sub ? `${chip.label} — ${chip.sub}` : chip.label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 6px 2px 5px",
        borderRadius: 5,
        background: tone.bg,
        borderLeft: `3px solid ${barColor}`,
        fontSize: 11.5,
        lineHeight: "17px",
        color: tone.fg,
        cursor: clickable ? "pointer" : "default",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {chip.kind === "task" ? (
        <MIcon name="task_alt" size={12} color={barColor} style={{ flex: "none" }} />
      ) : warn ? (
        <MIcon
          name={KIND_META[chip.kind].icon}
          size={12}
          color={T.warnFg}
          style={{ flex: "none" }}
        />
      ) : null}
      {showAvatar && chip.person ? (
        <Avatar
          size={16}
          src={chip.person.avatarUrl ?? undefined}
          style={{ fontSize: 8, flex: "none" }}
        >
          {memberInitials(chip.person.name)}
        </Avatar>
      ) : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {chip.label}
      </span>
      {chip.sub ? (
        <span
          style={{
            color: T.textTertiary,
            flex: "none",
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 10.5,
          }}
        >
          {chip.sub}
        </span>
      ) : null}
    </div>
  );

  if (plain) return pill;
  return (
    <Popover
      content={<ChipDetailCard chip={chip} T={T} />}
      placement="right"
      mouseEnterDelay={0.35}
      trigger="hover"
    >
      {pill}
    </Popover>
  );
}

/* --------------------------------------------------------- overflow popover */

/** Chips bucketed for the "+N more" popover — by person, or by kind. */
function groupChips(
  chips: DayChip[],
  groupByPerson: boolean,
): { title: string; chips: DayChip[] }[] {
  if (groupByPerson) {
    const teamWide: DayChip[] = [];
    const byPerson = new Map<string, DayChip[]>();
    for (const chip of chips) {
      if (!chip.person) {
        teamWide.push(chip);
        continue;
      }
      const list = byPerson.get(chip.person.name) ?? [];
      list.push(chip);
      byPerson.set(chip.person.name, list);
    }
    return [
      ...(teamWide.length ? [{ title: "Team", chips: teamWide }] : []),
      ...[...byPerson.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([title, list]) => ({ title, chips: list })),
    ];
  }
  const sections: { title: string; kinds: DayChip["kind"][] }[] = [
    { title: "Leave & holidays", kinds: ["holiday", "leave"] },
    { title: "Allocations", kinds: ["allocation"] },
    { title: "Tasks due", kinds: ["task"] },
  ];
  return sections
    .map((s) => ({
      title: s.title,
      chips: chips.filter((c) => s.kinds.includes(c.kind)),
    }))
    .filter((s) => s.chips.length > 0);
}

/**
 * "+N more" pill that opens the day's full agenda in a popover, grouped by
 * person (team-wide views) or by kind (single-member views).
 */
export function DayOverflow({
  day,
  chips,
  hiddenCount,
  groupByPerson,
  onOpen,
}: {
  day: dayjs.Dayjs;
  chips: DayChip[];
  hiddenCount: number;
  groupByPerson: boolean;
  onOpen: (href: string) => void;
}) {
  const T = useScheduleTokens();
  const groups = useMemo(
    () => groupChips(chips, groupByPerson),
    [chips, groupByPerson],
  );
  return (
    <Popover
      trigger="click"
      placement="bottom"
      content={
        <div style={{ width: 288 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 13,
                fontWeight: 700,
                color: T.textPrimary,
              }}
            >
              {day.format("ddd, MMM D")}
            </span>
            <span style={{ fontSize: 11.5, color: T.textTertiary }}>
              {chips.length} item{chips.length === 1 ? "" : "s"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxHeight: 320,
              overflowY: "auto",
              paddingRight: 2,
            }}
          >
            {groups.map((group) => (
              <div
                key={group.title}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.7px",
                    textTransform: "uppercase",
                    color: T.textTertiary,
                  }}
                >
                  {group.title}
                </span>
                {group.chips.map((chip) => (
                  <ChipPill key={chip.key} chip={chip} onOpen={onOpen} plain />
                ))}
              </div>
            ))}
          </div>
        </div>
      }
    >
      <button
        type="button"
        className="wl-cal-more"
        style={{
          border: "none",
          background: T.chipBg,
          color: T.textSecondary,
          fontSize: 11,
          fontWeight: 600,
          textAlign: "left",
          padding: "2px 8px",
          borderRadius: 5,
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        +{hiddenCount} more
      </button>
    </Popover>
  );
}
