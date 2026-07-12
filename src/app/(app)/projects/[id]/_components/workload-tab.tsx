"use client";

import { useMemo, useState } from "react";
import { Avatar, Button, Empty, Segmented, Tooltip, Typography, theme } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useTasks } from "@/features/tasks/use-tasks";
import { useProjectMembers } from "@/features/projects/use-project-members";

const { Text } = Typography;

const DAY_W = 92; // px per day column
const NAME_W = 232; // px for the sticky member column

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function isWeekend(d: Dayjs): boolean {
  const day = d.day();
  return day === 0 || day === 6;
}

/** Round to one decimal, dropping a trailing ".0". */
function fmtH(hours: number): string {
  const r = Math.round(hours * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}h`;
}

interface MemberRow {
  id: string; // team_member_id, or "__unassigned"
  name: string;
  avatarUrl: string | null;
  perDay: number[]; // hours per window day
  total: number; // hours over the window
}

/**
 * Workload view — estimated hours per person per day across a scrollable date
 * window. A task's time estimate (total_minutes) is spread evenly across its
 * scheduled span (start→due) and attributed to each assignee; done tasks and
 * unestimated/unscheduled tasks are excluded. Sticky member column + day header
 * make it comfortable to scroll a big team over many days.
 */
export function WorkloadTab({
  projectId,
  hoursPerDay,
}: {
  projectId: string;
  hoursPerDay: number;
}) {
  const { token } = theme.useToken();
  const { data: tasks, isLoading } = useTasks(projectId);
  const { data: members } = useProjectMembers(projectId);

  const [windowSize, setWindowSize] = useState<number>(14);
  const [anchor, setAnchor] = useState<Dayjs>(() =>
    dayjs().startOf("week"),
  );

  const days = useMemo(
    () => Array.from({ length: windowSize }, (_, i) => anchor.add(i, "day")),
    [anchor, windowSize],
  );
  const workingDays = useMemo(
    () => days.filter((d) => !isWeekend(d)).length,
    [days],
  );
  const capacity = Math.round(hoursPerDay * workingDays);
  const dayIndex = useMemo(() => {
    const m = new Map<string, number>();
    days.forEach((d, i) => m.set(d.format("YYYY-MM-DD"), i));
    return m;
  }, [days]);

  // team_member_id -> minutes[windowDay]; plus an unassigned bucket.
  const { byMember, unassigned } = useMemo(() => {
    const byMember = new Map<string, number[]>();
    const unassigned = new Array<number>(windowSize).fill(0);
    const windowStart = days[0];
    const windowEnd = days[days.length - 1];
    const add = (arr: number[], idx: number, mins: number) => {
      arr[idx] += mins;
    };
    for (const t of tasks ?? []) {
      if (t.done) continue;
      const est = t.total_minutes ?? 0;
      if (est <= 0) continue;
      const s = t.start_date
        ? dayjs(t.start_date)
        : t.end_date
          ? dayjs(t.end_date)
          : null;
      const e = t.end_date
        ? dayjs(t.end_date)
        : t.start_date
          ? dayjs(t.start_date)
          : null;
      if (!s || !e) continue;
      const startD = s.startOf("day");
      const endD = e.startOf("day");
      const span = Math.max(1, endD.diff(startD, "day") + 1);
      const perDay = est / span;
      for (let i = 0; i < span; i++) {
        const d = startD.add(i, "day");
        if (d.isBefore(windowStart, "day") || d.isAfter(windowEnd, "day")) continue;
        const idx = dayIndex.get(d.format("YYYY-MM-DD"));
        if (idx === undefined) continue;
        if (t.assignees.length > 0) {
          for (const a of t.assignees) {
            let arr = byMember.get(a.team_member_id);
            if (!arr) {
              arr = new Array<number>(windowSize).fill(0);
              byMember.set(a.team_member_id, arr);
            }
            add(arr, idx, perDay);
          }
        } else {
          add(unassigned, idx, perDay);
        }
      }
    }
    return { byMember, unassigned };
  }, [tasks, days, dayIndex, windowSize]);

  const rows = useMemo<MemberRow[]>(() => {
    const list: MemberRow[] = (members ?? []).map((m) => {
      const mins = byMember.get(m.team_member_id) ?? [];
      const perDay = days.map((_, i) => (mins[i] ?? 0) / 60);
      return {
        id: m.team_member_id,
        name: m.team_member?.user?.name ?? "Unknown",
        avatarUrl: m.team_member?.user?.avatar_url ?? null,
        perDay,
        total: perDay.reduce((a, b) => a + b, 0),
      };
    });
    // Any assignee with load who isn't a listed project member (e.g. left the
    // project but still has tasks) shouldn't silently vanish.
    const memberIds = new Set((members ?? []).map((m) => m.team_member_id));
    for (const [tmId, mins] of byMember) {
      if (memberIds.has(tmId)) continue;
      const perDay = days.map((_, i) => (mins[i] ?? 0) / 60);
      list.push({
        id: tmId,
        name: "Former member",
        avatarUrl: null,
        perDay,
        total: perDay.reduce((a, b) => a + b, 0),
      });
    }
    list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const unassignedPerDay = days.map((_, i) => (unassigned[i] ?? 0) / 60);
    list.push({
      id: "__unassigned",
      name: "Unassigned",
      avatarUrl: null,
      perDay: unassignedPerDay,
      total: unassignedPerDay.reduce((a, b) => a + b, 0),
    });
    return list;
  }, [members, byMember, unassigned, days]);

  // Cell background/text by load ratio against the daily capacity.
  const cellStyle = (hours: number, weekend: boolean): React.CSSProperties => {
    if (hours <= 0.001) {
      return {
        background: weekend ? token.colorFillQuaternary : "transparent",
        color: token.colorTextQuaternary,
      };
    }
    const ratio = hours / (hoursPerDay || 8);
    let bg = "rgba(63,166,122,0.16)";
    let fg = "#2f8f5f";
    if (ratio > 1.25) {
      bg = "rgba(208,90,82,0.18)";
      fg = "#c0453c";
    } else if (ratio > 1) {
      bg = "rgba(217,154,43,0.20)";
      fg = "#a9781f";
    }
    return { background: bg, color: fg, fontWeight: 600 };
  };

  const th: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 2,
    background: token.colorBgContainer,
    borderBottom: `1px solid ${token.colorBorderSecondary}`,
  };
  const stickyLeft: React.CSSProperties = {
    position: "sticky",
    left: 0,
    zIndex: 1,
    background: token.colorBgContainer,
    borderRight: `1px solid ${token.colorBorderSecondary}`,
  };

  const rangeLabel = `${days[0].format("MMM D")} – ${days[days.length - 1].format("MMM D")}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Button size="small" onClick={() => setAnchor(dayjs().startOf("week"))}>
          Today
        </Button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Button
            size="small"
            type="text"
            aria-label="Previous"
            icon={<LeftOutlined />}
            onClick={() => setAnchor((a) => a.subtract(windowSize, "day"))}
          />
          <Text strong style={{ minWidth: 128, textAlign: "center" }}>
            {rangeLabel}
          </Text>
          <Button
            size="small"
            type="text"
            aria-label="Next"
            icon={<RightOutlined />}
            onClick={() => setAnchor((a) => a.add(windowSize, "day"))}
          />
        </div>
        <span style={{ flex: 1 }} />
        <Segmented
          size="small"
          value={windowSize}
          onChange={(v) => setWindowSize(v as number)}
          options={[
            { label: "7 days", value: 7 },
            { label: "14 days", value: 14 },
            { label: "30 days", value: 30 },
          ]}
        />
        <Tooltip title={`Daily capacity per person: ${hoursPerDay}h`}>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {hoursPerDay}h/day
          </Text>
        </Tooltip>
      </div>

      {/* Grid */}
      {isLoading ? null : rows.length === 0 ? (
        <div
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 12,
            background: token.colorBgContainer,
            padding: 32,
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No members on this project yet."
          />
        </div>
      ) : (
        <div
          style={{
            overflow: "auto",
            maxHeight: "calc(100vh - 250px)",
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 12,
            background: token.colorBgContainer,
          }}
        >
          <table
            style={{
              borderCollapse: "separate",
              borderSpacing: 0,
              width: "max-content",
              minWidth: "100%",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    ...th,
                    ...stickyLeft,
                    zIndex: 3,
                    width: NAME_W,
                    minWidth: NAME_W,
                    textAlign: "left",
                    padding: "10px 14px",
                    fontWeight: 600,
                    color: token.colorTextSecondary,
                  }}
                >
                  {rows.length - 1} member{rows.length - 1 === 1 ? "" : "s"}
                </th>
                {days.map((d) => {
                  const today = d.isSame(dayjs(), "day");
                  const weekend = isWeekend(d);
                  return (
                    <th
                      key={d.format("YYYY-MM-DD")}
                      style={{
                        ...th,
                        width: DAY_W,
                        minWidth: DAY_W,
                        padding: "6px 4px",
                        textAlign: "center",
                        background: today
                          ? token.colorPrimaryBg
                          : weekend
                            ? token.colorFillQuaternary
                            : token.colorBgContainer,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: 0.4,
                          textTransform: "uppercase",
                          color: today
                            ? token.colorPrimary
                            : token.colorTextTertiary,
                        }}
                      >
                        {d.format("ddd")}
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: today ? token.colorPrimary : token.colorText,
                        }}
                      >
                        {d.format("D")}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const over = row.total > capacity && capacity > 0;
                return (
                  <tr key={row.id}>
                    <td
                      style={{
                        ...stickyLeft,
                        width: NAME_W,
                        minWidth: NAME_W,
                        padding: "8px 14px",
                        borderBottom: `1px solid ${token.colorFillQuaternary}`,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 10 }}
                      >
                        {row.id === "__unassigned" ? (
                          <Avatar
                            size={28}
                            style={{
                              background: token.colorFillSecondary,
                              color: token.colorTextTertiary,
                              flex: "none",
                            }}
                            icon={
                              <span
                                className="material-symbols-rounded"
                                style={{ fontSize: 16 }}
                              >
                                help
                              </span>
                            }
                          />
                        ) : (
                          <Avatar
                            size={28}
                            src={row.avatarUrl ?? undefined}
                            style={{ flex: "none", fontSize: 12 }}
                          >
                            {initials(row.name)}
                          </Avatar>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: token.colorText,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.name}
                          </div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: over
                                ? "#c0453c"
                                : token.colorTextTertiary,
                              fontWeight: over ? 600 : 400,
                            }}
                          >
                            {fmtH(row.total)}
                            {row.id === "__unassigned"
                              ? ""
                              : ` / ${capacity}h`}
                          </div>
                        </div>
                      </div>
                    </td>
                    {days.map((d, i) => {
                      const hours = row.perDay[i] ?? 0;
                      const weekend = isWeekend(d);
                      return (
                        <td
                          key={d.format("YYYY-MM-DD")}
                          style={{
                            width: DAY_W,
                            minWidth: DAY_W,
                            padding: 4,
                            textAlign: "center",
                            verticalAlign: "middle",
                            borderBottom: `1px solid ${token.colorFillQuaternary}`,
                          }}
                        >
                          <div
                            style={{
                              height: 34,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 8,
                              ...cellStyle(hours, weekend),
                            }}
                          >
                            {hours > 0.001 ? fmtH(hours) : ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Text type="secondary" style={{ fontSize: 12 }}>
        Hours come from each task&apos;s time estimate, spread across its
        scheduled dates and counted for every assignee. Done, unestimated, and
        undated tasks are excluded.
      </Text>
    </div>
  );
}
