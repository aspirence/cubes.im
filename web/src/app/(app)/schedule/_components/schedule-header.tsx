"use client";

import { Avatar, Button, Segmented, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";

import {
  MIcon,
  MONO,
  NavButton,
  memberInitials,
  useScheduleTokens,
} from "./schedule-ui";

export type ScheduleView = "day" | "week" | "month";

export interface MemberFilterOption {
  value: string;
  label: string;
  avatarUrl?: string | null;
}

/** A subtle inline metadata chip (mirrors the project workspace header). */
function MetaChip({
  icon,
  children,
  mono,
}: {
  icon?: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  const T = useScheduleTokens();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 9px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        color: T.textSecondary,
        background: T.chipBg,
        fontFamily: mono ? MONO : undefined,
        letterSpacing: mono ? 0.3 : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {icon ? (
        <span style={{ color: T.textTertiary }}>
          <MIcon name={icon} size={14} />
        </span>
      ) : null}
      {children}
    </span>
  );
}

/**
 * Schedule header: single compact row — title + inline range/scope chips on
 * the left, whose-calendar picker / view switcher / navigation / Add
 * allocation on the right (matching the project workspace header pattern).
 */
export function ScheduleHeader({
  view,
  onViewChange,
  anchor,
  onAnchorChange,
  scopeLabel,
  isAdmin,
  filterValue,
  filterOptions,
  onFilterChange,
  onAddAllocation,
}: {
  view: ScheduleView;
  onViewChange: (view: ScheduleView) => void;
  anchor: Dayjs;
  onAnchorChange: (anchor: Dayjs) => void;
  /** "Calendar across Acme" / "Priya's calendar". */
  scopeLabel: string;
  isAdmin: boolean;
  filterValue: string;
  filterOptions: MemberFilterOption[];
  onFilterChange: (value: string) => void;
  onAddAllocation: () => void;
}) {
  const T = useScheduleTokens();
  const today = dayjs();

  const rangeLabel =
    view === "month"
      ? anchor.format("MMMM YYYY")
      : view === "week"
        ? `${anchor.startOf("week").format("MMM D")} – ${anchor
            .endOf("week")
            .format("MMM D, YYYY")}`
        : anchor.format("ddd, MMM D, YYYY");
  // "Today" / "Yesterday" / "Tomorrow" when the anchor is one of them.
  const relativeLabel = anchor.isSame(today, "day")
    ? "Today"
    : anchor.isSame(today.subtract(1, "day"), "day")
      ? "Yesterday"
      : anchor.isSame(today.add(1, "day"), "day")
        ? "Tomorrow"
        : null;

  const renderMemberOption = (value: string, label: string) => {
    const opt = filterOptions.find((o) => o.value === value);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {value === "all" ? (
          <Avatar size={20} style={{ fontSize: 10, flex: "none" }}>
            ∗
          </Avatar>
        ) : (
          <Avatar
            size={20}
            src={opt?.avatarUrl ?? undefined}
            style={{ fontSize: 10, flex: "none" }}
          >
            {memberInitials(label)}
          </Avatar>
        )}
        <span>{label}</span>
      </span>
    );
  };

  return (
    // Single compact row: identity + inline meta (left), controls (right).
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        rowGap: 8,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "-0.4px",
          color: T.textPrimary,
          lineHeight: 1.2,
        }}
      >
        Schedule
      </h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "wrap",
          marginLeft: 2,
        }}
      >
        <MetaChip icon="calendar_month" mono>
          {rangeLabel}
        </MetaChip>
        <MetaChip icon={filterValue === "all" ? "groups" : "person"}>
          {scopeLabel}
        </MetaChip>
      </div>

      {/* Controls, right-aligned. */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          rowGap: 8,
        }}
      >
        {/* Whose-calendar picker is admin-only; members see just their own. */}
        {isAdmin ? (
          <>
            <Select
              value={filterValue}
              onChange={onFilterChange}
              options={filterOptions}
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 180 }}
              optionRender={(o) =>
                renderMemberOption(o.value as string, String(o.label))
              }
              labelRender={(p) =>
                renderMemberOption(p.value as string, String(p.label))
              }
              aria-label="Whose calendar"
            />
            <div style={{ width: 1, height: 22, background: T.hairline }} />
          </>
        ) : null}
        <Segmented
          value={view}
          onChange={(v) => onViewChange(v as ScheduleView)}
          options={[
            { label: "Day", value: "day" },
            { label: "Week", value: "week" },
            { label: "Month", value: "month" },
          ]}
          aria-label="Calendar view"
        />
        <div style={{ width: 1, height: 22, background: T.hairline }} />
        <NavButton
          ariaLabel={`Previous ${view}`}
          onClick={() => onAnchorChange(anchor.subtract(1, view))}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
            chevron_left
          </span>
        </NavButton>
        {view === "day" ? (
          <>
            <NavButton
              active={relativeLabel === "Yesterday"}
              onClick={() => onAnchorChange(dayjs().subtract(1, "day"))}
            >
              Yesterday
            </NavButton>
            <NavButton
              active={relativeLabel === "Today"}
              onClick={() => onAnchorChange(dayjs())}
            >
              Today
            </NavButton>
            <NavButton
              active={relativeLabel === "Tomorrow"}
              onClick={() => onAnchorChange(dayjs().add(1, "day"))}
            >
              Tomorrow
            </NavButton>
          </>
        ) : (
          <NavButton onClick={() => onAnchorChange(dayjs())}>Today</NavButton>
        )}
        <NavButton
          ariaLabel={`Next ${view}`}
          onClick={() => onAnchorChange(anchor.add(1, view))}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
            chevron_right
          </span>
        </NavButton>
        {/* Allocating capacity to people is a management action — admin-only. */}
        {isAdmin ? (
          <>
            <div style={{ width: 1, height: 22, background: T.hairline }} />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onAddAllocation}
              style={{ height: 32, borderRadius: 8 }}
            >
              Add allocation
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
