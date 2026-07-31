"use client";

import { useMemo, useState } from "react";
import {
  Button,
  ConfigProvider,
  DatePicker,
  Select,
  Space,
  Table,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { EChart, CHART_FONT, CHART_PALETTE } from "@/features/home/echart";
import { useAuth } from "@/features/auth/use-auth";
import {
  useIsTeamAdmin,
  useTeamMembers,
} from "@/features/team-members/use-team-members";
import { useTimeAnalytics } from "@/features/time/use-time-analytics";
import { formatSeconds } from "@/features/time/use-time";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { T } from "../_lib/tokens";
import {
  PageHeader,
  Panel,
  ErrorBanner,
  AvatarChip,
  KpiTile,
  BarRow,
  SectionTitle,
} from "../_lib/ui";
import { reportingTableTheme } from "../_lib/table-theme";

type RangeValue = [dayjs.Dayjs | null, dayjs.Dayjs | null] | null;

/** Aggregated per task (and per member in the Everyone view). */
interface TaskAgg {
  key: string;
  task_id: string;
  task_name: string;
  project_name: string;
  project_color: string | null;
  user_id: string;
  user_name: string;
  seconds: number;
  billableSeconds: number;
  entries: number;
  lastLogged: string;
}

/** Aggregated per member with a per-day map — feeds the day-wise matrix. */
interface MemberAgg {
  user_id: string;
  name: string;
  seconds: number;
  perDay: Map<string, number>;
}

const ACCENT = "#4a4ad0";

function csvCell(value: string | number): string {
  const text = String(value);
  return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows: TaskAgg[], showMember: boolean) {
  const header = [
    "Task",
    "Project",
    ...(showMember ? ["Member"] : []),
    "Minutes",
    "Billable minutes",
    "Entries",
    "Last logged",
  ];
  const lines = rows.map((r) =>
    [
      csvCell(r.task_name),
      csvCell(r.project_name),
      ...(showMember ? [csvCell(r.user_name)] : []),
      csvCell(Math.round(r.seconds / 60)),
      csvCell(Math.round(r.billableSeconds / 60)),
      csvCell(r.entries),
      csvCell(dayjs(r.lastLogged).format("YYYY-MM-DD HH:mm")),
    ].join(","),
  );
  const csv = [header.map(csvCell).join(","), ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `time-analytics-${dayjs().format("YYYY-MM-DD")}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ReportingTimeAnalyticsPage() {
  const { token } = theme.useToken();
  const { user } = useAuth();
  const isTeamAdmin = useIsTeamAdmin();
  const { data: members } = useTeamMembers();
  const openTask = useTaskDrawer((s) => s.open);

  // null = "everyone" — meaningful only for admins; the server forces
  // non-admins to their own logs no matter what is sent.
  const [memberId, setMemberId] = useState<string | null>(null);
  // Default to the trailing week: "all time" makes every number blur together.
  const [range, setRange] = useState<RangeValue>([
    dayjs().subtract(6, "day"),
    dayjs(),
  ]);

  const from = range?.[0] ? range[0].format("YYYY-MM-DD") : undefined;
  const to = range?.[1] ? range[1].format("YYYY-MM-DD") : undefined;

  const { data, isLoading, isError, error } = useTimeAnalytics({
    userId: isTeamAdmin ? memberId : null,
    from,
    to,
  });
  const logs = useMemo(() => data ?? [], [data]);

  const everyoneView = isTeamAdmin && memberId === null;

  /* -------------------------------------------------------------- KPIs */

  const totalSeconds = useMemo(
    () => logs.reduce((sum, l) => sum + l.seconds, 0),
    [logs],
  );
  const billableSeconds = useMemo(
    () => logs.reduce((sum, l) => sum + (l.is_billable ? l.seconds : 0), 0),
    [logs],
  );
  const distinctTasks = useMemo(
    () => new Set(logs.map((l) => l.task_id)).size,
    [logs],
  );
  const todaySeconds = useMemo(() => {
    const key = dayjs().format("YYYY-MM-DD");
    return logs.reduce(
      (sum, l) =>
        dayjs(l.logged_at).format("YYYY-MM-DD") === key ? sum + l.seconds : sum,
      0,
    );
  }, [logs]);
  const avgPerActiveDay = useMemo(() => {
    const activeDays = new Set(
      logs.map((l) => dayjs(l.logged_at).format("YYYY-MM-DD")),
    ).size;
    return activeDays ? Math.round(totalSeconds / activeDays) : 0;
  }, [logs, totalSeconds]);

  /* ---------------------------------------------------- aggregations */

  const taskRows = useMemo(() => {
    const acc = new Map<string, TaskAgg>();
    for (const l of logs) {
      // In the Everyone view each (task, member) pair is its own row so the
      // "kis member ne kis task pe kitna" question is answered directly.
      const key = everyoneView ? `${l.task_id}:${l.user_id}` : l.task_id;
      const cur = acc.get(key);
      if (cur) {
        cur.seconds += l.seconds;
        cur.billableSeconds += l.is_billable ? l.seconds : 0;
        cur.entries += 1;
        if (l.logged_at > cur.lastLogged) cur.lastLogged = l.logged_at;
      } else {
        acc.set(key, {
          key,
          task_id: l.task_id,
          task_name: l.task_name,
          project_name: l.project_name,
          project_color: l.project_color,
          user_id: l.user_id,
          user_name: l.user_name,
          seconds: l.seconds,
          billableSeconds: l.is_billable ? l.seconds : 0,
          entries: 1,
          lastLogged: l.logged_at,
        });
      }
    }
    return [...acc.values()].sort((a, b) => b.seconds - a.seconds);
  }, [logs, everyoneView]);

  const projectRows = useMemo(() => {
    const acc = new Map<
      string,
      { name: string; color: string | null; seconds: number }
    >();
    for (const l of logs) {
      const cur = acc.get(l.project_id);
      if (cur) cur.seconds += l.seconds;
      else
        acc.set(l.project_id, {
          name: l.project_name,
          color: l.project_color,
          seconds: l.seconds,
        });
    }
    return [...acc.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 10);
  }, [logs]);

  // Per member, with a day-keyed map — powers the matrix and the stacked bars.
  const memberRows = useMemo(() => {
    const acc = new Map<string, MemberAgg>();
    for (const l of logs) {
      let cur = acc.get(l.user_id);
      if (!cur) {
        cur = { user_id: l.user_id, name: l.user_name, seconds: 0, perDay: new Map() };
        acc.set(l.user_id, cur);
      }
      cur.seconds += l.seconds;
      const dk = dayjs(l.logged_at).format("YYYY-MM-DD");
      cur.perDay.set(dk, (cur.perDay.get(dk) ?? 0) + l.seconds);
    }
    return [...acc.values()].sort((a, b) => b.seconds - a.seconds);
  }, [logs]);

  // The day axis both the chart and the matrix share. A cleared range (= all
  // time) or anything wider than a month falls back to the trailing 14 days —
  // day-by-day stops being readable past that.
  const days = useMemo(() => {
    const end = (range?.[1] ?? dayjs()).startOf("day");
    let start = (range?.[0] ?? end.subtract(13, "day")).startOf("day");
    if (end.diff(start, "day") > 30) start = end.subtract(13, "day");
    const out: dayjs.Dayjs[] = [];
    for (let d = start; !d.isAfter(end, "day"); d = d.add(1, "day")) out.push(d);
    return out;
  }, [range]);
  const daysClamped = useMemo(() => {
    if (!range?.[0] || !range?.[1]) return false;
    return range[1].startOf("day").diff(range[0].startOf("day"), "day") > 30;
  }, [range]);

  /* --------------------------------------------------------- daily chart */

  const dailyOption = useMemo(() => {
    const dayKeys = days.map((d) => d.format("YYYY-MM-DD"));
    const toH = (s: number) => Math.round((s / 3600) * 100) / 100;

    // Everyone view stacks the top members so each day answers "kaun kitna".
    let series;
    let legend: string[] | null = null;
    if (everyoneView && memberRows.length > 1) {
      const top = memberRows.slice(0, 5);
      const rest = memberRows.slice(5);
      series = top.map((m, i) => ({
        name: m.name,
        type: "bar" as const,
        stack: "time",
        barWidth: 14,
        itemStyle: { color: CHART_PALETTE[i % CHART_PALETTE.length] },
        data: dayKeys.map((k) => toH(m.perDay.get(k) ?? 0)),
      }));
      if (rest.length > 0) {
        series.push({
          name: "Others",
          type: "bar" as const,
          stack: "time",
          barWidth: 14,
          itemStyle: { color: "#b6b9c6" },
          data: dayKeys.map((k) =>
            toH(rest.reduce((sum, m) => sum + (m.perDay.get(k) ?? 0), 0)),
          ),
        });
      }
      legend = series.map((s) => s.name);
    } else {
      const perDay = new Map<string, number>();
      for (const l of logs) {
        const key = dayjs(l.logged_at).format("YYYY-MM-DD");
        perDay.set(key, (perDay.get(key) ?? 0) + l.seconds);
      }
      series = [
        {
          type: "bar" as const,
          barWidth: 14,
          itemStyle: { color: CHART_PALETTE[0], borderRadius: [4, 4, 0, 0] },
          data: dayKeys.map((k) => toH(perDay.get(k) ?? 0)),
        },
      ];
    }

    return {
      grid: {
        left: 8,
        right: 8,
        top: 20,
        bottom: legend ? 26 : 4,
        containLabel: true,
      },
      ...(legend
        ? {
            legend: {
              bottom: 0,
              itemWidth: 10,
              itemHeight: 10,
              textStyle: {
                color: token.colorTextSecondary,
                fontFamily: CHART_FONT,
                fontSize: 11,
              },
            },
          }
        : {}),
      xAxis: {
        type: "category" as const,
        data: days.map((d) => d.format("DD MMM")),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: token.colorTextSecondary,
          fontFamily: CHART_FONT,
          fontSize: 10.5,
        },
      },
      yAxis: {
        type: "value" as const,
        axisLabel: {
          color: token.colorTextSecondary,
          fontFamily: CHART_FONT,
          fontSize: 10.5,
          formatter: "{value}h",
        },
        splitLine: { lineStyle: { color: token.colorSplit } },
      },
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]) as {
            axisValueLabel?: string;
            seriesName?: string;
            marker?: string;
            value?: number;
          }[];
          const day = items[0]?.axisValueLabel ?? "";
          const lines = items
            .filter((p) => (p.value ?? 0) > 0)
            .map(
              (p) =>
                `${p.marker ?? ""}${p.seriesName && p.seriesName !== "series 0" ? `${p.seriesName}: ` : ""}${formatSeconds((p.value ?? 0) * 3600)}`,
            );
          return [day, ...(lines.length ? lines : ["0m"])].join("<br/>");
        },
      },
      series,
    };
  }, [days, logs, memberRows, everyoneView, token.colorTextSecondary, token.colorSplit]);

  /* -------------------------------------------------------------- table */

  const columns: ColumnsType<TaskAgg> = [
    {
      title: "Task",
      dataIndex: "task_name",
      key: "task_name",
      sorter: (a, b) => a.task_name.localeCompare(b.task_name),
      render: (v: string) => (
        <span style={{ color: T.textPrimary, fontWeight: 500 }}>{v}</span>
      ),
    },
    {
      title: "Project",
      dataIndex: "project_name",
      key: "project_name",
      sorter: (a, b) => a.project_name.localeCompare(b.project_name),
      render: (v: string, r) => (
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: r.project_color ?? "#8a8d98",
            }}
          />
          <span style={{ color: T.textSecondary }}>{v}</span>
        </span>
      ),
    },
    ...(everyoneView
      ? ([
          {
            title: "Member",
            dataIndex: "user_name",
            key: "user_name",
            sorter: (a, b) => a.user_name.localeCompare(b.user_name),
            render: (name: string) => (
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 9 }}
              >
                <AvatarChip name={name} size={24} />
                <span style={{ color: T.textPrimary }}>{name}</span>
              </span>
            ),
          },
        ] as ColumnsType<TaskAgg>)
      : []),
    {
      title: "Time",
      dataIndex: "seconds",
      key: "seconds",
      align: "right",
      width: 110,
      defaultSortOrder: "descend",
      sorter: (a, b) => a.seconds - b.seconds,
      render: (v: number) => (
        <span className="font-mono" style={{ color: T.textPrimary, fontWeight: 600 }}>
          {formatSeconds(v)}
        </span>
      ),
    },
    {
      title: "Billable",
      dataIndex: "billableSeconds",
      key: "billableSeconds",
      align: "right",
      width: 110,
      sorter: (a, b) => a.billableSeconds - b.billableSeconds,
      render: (v: number) => (
        <span className="font-mono" style={{ color: T.textSecondary }}>
          {v > 0 ? formatSeconds(v) : "—"}
        </span>
      ),
    },
    {
      title: "Entries",
      dataIndex: "entries",
      key: "entries",
      align: "right",
      width: 90,
      sorter: (a, b) => a.entries - b.entries,
    },
    {
      title: "Last logged",
      dataIndex: "lastLogged",
      key: "lastLogged",
      width: 150,
      sorter: (a, b) => a.lastLogged.localeCompare(b.lastLogged),
      render: (v: string) => (
        <span className="font-mono" style={{ color: T.textSecondary }}>
          {dayjs(v).format("MMM D, HH:mm")}
        </span>
      ),
    },
  ];

  const memberOptions = useMemo(
    () => [
      { value: "", label: "Everyone" },
      ...(members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({
          value: m.user!.id,
          label: m.user!.id === user?.id ? `${m.user!.name} (you)` : m.user!.name,
        })),
    ],
    [members, user?.id],
  );

  const rangePresets = useMemo(
    () => [
      { label: "Today", value: [dayjs(), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs] },
      {
        label: "Yesterday",
        value: [dayjs().subtract(1, "day"), dayjs().subtract(1, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
      },
      { label: "Last 7 days", value: [dayjs().subtract(6, "day"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs] },
      { label: "This week", value: [dayjs().startOf("week"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs] },
      { label: "This month", value: [dayjs().startOf("month"), dayjs()] as [dayjs.Dayjs, dayjs.Dayjs] },
      {
        label: "Last month",
        value: [
          dayjs().subtract(1, "month").startOf("month"),
          dayjs().subtract(1, "month").endOf("month"),
        ] as [dayjs.Dayjs, dayjs.Dayjs],
      },
    ],
    [],
  );

  /* ---------------------------------------------------- day-wise matrix */

  const todayKey = dayjs().format("YYYY-MM-DD");
  const matrixDayTotals = useMemo(
    () =>
      days.map((d) => {
        const k = d.format("YYYY-MM-DD");
        return memberRows.reduce((sum, m) => sum + (m.perDay.get(k) ?? 0), 0);
      }),
    [days, memberRows],
  );
  // Heat scale: a full 8-hour day is "hot"; anything above just stays hot.
  const heat = (seconds: number) => {
    if (seconds <= 0) return "transparent";
    const alpha = Math.min(0.22, (seconds / (8 * 3600)) * 0.22 + 0.03);
    return `rgba(74, 74, 208, ${alpha})`;
  };

  const matrixCellBase: React.CSSProperties = {
    padding: "8px 10px",
    textAlign: "right",
    fontSize: 12.5,
    whiteSpace: "nowrap",
    borderTop: `1px solid ${token.colorSplit}`,
  };

  return (
    <div>
      <PageHeader
        title="Time analytics"
        subtitle={
          isTeamAdmin
            ? "Kaun, kis task pe, kis din — one look and you know where the time went."
            : "Where your time goes — per task and per day. Only you (and workspace admins) can see this."
        }
        right={
          <Space wrap>
            {isTeamAdmin ? (
              <Select
                showSearch
                optionFilterProp="label"
                value={memberId ?? ""}
                onChange={(v) => setMemberId(v === "" ? null : v)}
                options={memberOptions}
                style={{ minWidth: 170, height: 34 }}
              />
            ) : null}
            <DatePicker.RangePicker
              value={range}
              onChange={(value) => setRange(value as RangeValue)}
              presets={rangePresets}
              allowClear
              style={{ height: 34 }}
            />
            <Button
              icon={<DownloadOutlined />}
              onClick={() => downloadCsv(taskRows, everyoneView)}
              disabled={taskRows.length === 0}
              style={{ height: 34 }}
            >
              Export CSV
            </Button>
          </Space>
        }
      />

      {isError ? (
        <ErrorBanner
          title="Failed to load time analytics"
          message={error instanceof Error ? error.message : "Please try again."}
        />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <KpiTile
              label="Total time"
              value={formatSeconds(totalSeconds)}
              icon="timer"
              loading={isLoading}
            />
            <KpiTile
              label="Today"
              value={formatSeconds(todaySeconds)}
              icon="today"
              loading={isLoading}
            />
            <KpiTile
              label="Avg per active day"
              value={formatSeconds(avgPerActiveDay)}
              icon="speed"
              loading={isLoading}
            />
            <KpiTile
              label="Tasks worked"
              value={distinctTasks}
              icon="task_alt"
              loading={isLoading}
            />
            <KpiTile
              label="Billable time"
              value={formatSeconds(billableSeconds)}
              icon="paid"
              loading={isLoading}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <Panel>
              <SectionTitle>
                {everyoneView ? "Time per day — stacked by member" : "Time per day"}
              </SectionTitle>
              <EChart option={dailyOption} height={everyoneView ? 230 : 200} />
            </Panel>
            <Panel>
              <SectionTitle>Time by project</SectionTitle>
              {projectRows.length === 0 ? (
                <div
                  style={{
                    color: T.textSecondary,
                    fontSize: 13,
                    padding: "18px 0",
                  }}
                >
                  No time logged yet in this range.
                </div>
              ) : (
                projectRows.map((p) => (
                  <BarRow
                    key={p.name}
                    label={p.name}
                    value={formatSeconds(p.seconds)}
                    pct={totalSeconds > 0 ? (p.seconds / totalSeconds) * 100 : 0}
                    color={p.color ?? "#8a8d98"}
                    swatch
                  />
                ))
              )}
            </Panel>
          </div>

          {/* Day-wise timesheet: rows = members, columns = days. The single
              clearest answer to "kis din kisne kitna kaam kiya". */}
          <Panel padding={0} style={{ overflow: "hidden", marginBottom: 16 }}>
            <div style={{ padding: "16px 16px 4px" }}>
              <SectionTitle
                right={
                  daysClamped ? (
                    <span style={{ fontSize: 12, color: T.textSecondary }}>
                      Showing the last 14 days — pick a range up to a month for full detail
                    </span>
                  ) : undefined
                }
              >
                Day-wise timesheet
              </SectionTitle>
            </div>
            {memberRows.length === 0 ? (
              <div style={{ color: T.textSecondary, fontSize: 13, padding: "8px 16px 18px" }}>
                No time logged yet in this range.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "8px 16px",
                          fontSize: 11.5,
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                          color: T.textSecondary,
                          fontWeight: 600,
                        }}
                      >
                        Member
                      </th>
                      {days.map((d) => {
                        const isToday = d.format("YYYY-MM-DD") === todayKey;
                        const weekend = d.day() === 0 || d.day() === 6;
                        return (
                          <th
                            key={d.format("YYYY-MM-DD")}
                            style={{
                              padding: "8px 10px",
                              textAlign: "right",
                              fontSize: 11,
                              fontWeight: isToday ? 800 : 600,
                              color: isToday
                                ? ACCENT
                                : weekend
                                  ? T.textTertiary ?? T.textSecondary
                                  : T.textSecondary,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {d.format("ddd")}
                            <br />
                            {d.format("D MMM")}
                          </th>
                        );
                      })}
                      <th
                        style={{
                          padding: "8px 16px",
                          textAlign: "right",
                          fontSize: 11.5,
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                          color: T.textSecondary,
                          fontWeight: 700,
                        }}
                      >
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberRows.map((m) => (
                      <tr key={m.user_id}>
                        <td
                          style={{
                            padding: "8px 16px",
                            borderTop: `1px solid ${token.colorSplit}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                            <AvatarChip name={m.name} size={24} />
                            <span style={{ color: T.textPrimary, fontSize: 13, fontWeight: 500 }}>
                              {m.name}
                            </span>
                          </span>
                        </td>
                        {days.map((d) => {
                          const k = d.format("YYYY-MM-DD");
                          const secs = m.perDay.get(k) ?? 0;
                          return (
                            <td
                              key={k}
                              className="font-mono"
                              style={{
                                ...matrixCellBase,
                                color: secs > 0 ? T.textPrimary : T.textTertiary ?? T.textSecondary,
                                background: heat(secs),
                              }}
                            >
                              {secs > 0 ? formatSeconds(secs) : "·"}
                            </td>
                          );
                        })}
                        <td
                          className="font-mono"
                          style={{
                            ...matrixCellBase,
                            padding: "8px 16px",
                            fontWeight: 700,
                            color: T.textPrimary,
                          }}
                        >
                          {formatSeconds(m.seconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {memberRows.length > 1 ? (
                    <tfoot>
                      <tr>
                        <td
                          style={{
                            padding: "8px 16px",
                            borderTop: `2px solid ${token.colorSplit}`,
                            fontSize: 12,
                            fontWeight: 700,
                            color: T.textSecondary,
                          }}
                        >
                          Team total
                        </td>
                        {matrixDayTotals.map((secs, i) => (
                          <td
                            key={i}
                            className="font-mono"
                            style={{
                              ...matrixCellBase,
                              borderTop: `2px solid ${token.colorSplit}`,
                              fontWeight: 700,
                              color: secs > 0 ? T.textPrimary : T.textTertiary ?? T.textSecondary,
                            }}
                          >
                            {secs > 0 ? formatSeconds(secs) : "·"}
                          </td>
                        ))}
                        <td
                          className="font-mono"
                          style={{
                            ...matrixCellBase,
                            padding: "8px 16px",
                            borderTop: `2px solid ${token.colorSplit}`,
                            fontWeight: 800,
                            color: T.textPrimary,
                          }}
                        >
                          {formatSeconds(totalSeconds)}
                        </td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            )}
          </Panel>

          <Panel padding={0} style={{ overflow: "hidden" }}>
            <ConfigProvider theme={reportingTableTheme}>
              <Table<TaskAgg>
                rowKey="key"
                loading={isLoading}
                columns={columns}
                dataSource={taskRows}
                onRow={(r) => ({
                  onClick: () => openTask(r.task_id),
                  style: { cursor: "pointer" },
                })}
                pagination={{
                  pageSize: 15,
                  hideOnSinglePage: true,
                  style: { padding: "0 16px", marginBottom: 0 },
                }}
                scroll={{ x: "max-content" }}
              />
            </ConfigProvider>
          </Panel>
        </>
      )}
    </div>
  );
}
