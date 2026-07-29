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
  const [range, setRange] = useState<RangeValue>(null);

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

  // Daily bars for the trailing 14 days (or the picked range when it is
  // narrower than that) — the "how were my days spent" strip.
  const dailyOption = useMemo(() => {
    const end = range?.[1] ?? dayjs();
    const start =
      range?.[0] && end.diff(range[0], "day") < 14
        ? range[0]
        : end.subtract(13, "day");
    const days: dayjs.Dayjs[] = [];
    for (
      let d = start.startOf("day");
      !d.isAfter(end, "day");
      d = d.add(1, "day")
    ) {
      days.push(d);
    }
    const perDay = new Map<string, number>();
    for (const l of logs) {
      const key = dayjs(l.logged_at).format("YYYY-MM-DD");
      perDay.set(key, (perDay.get(key) ?? 0) + l.seconds);
    }
    const values = days.map((d) =>
      Math.round(((perDay.get(d.format("YYYY-MM-DD")) ?? 0) / 3600) * 100) / 100,
    );
    return {
      grid: { left: 8, right: 8, top: 20, bottom: 4, containLabel: true },
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
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { name?: string; value?: number };
          return `${p.name}: ${formatSeconds((p.value ?? 0) * 3600)}`;
        },
      },
      series: [
        {
          type: "bar" as const,
          data: values,
          barWidth: 14,
          itemStyle: { color: CHART_PALETTE[0], borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [logs, range, token.colorTextSecondary, token.colorSplit]);

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

  return (
    <div>
      <PageHeader
        title="Time analytics"
        subtitle={
          isTeamAdmin
            ? "Where time goes, task by task — for you, any member, or the whole team."
            : "Where your time goes, task by task. Only you (and workspace admins) can see this."
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
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
            <KpiTile
              label="Entries"
              value={logs.length}
              icon="history"
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
              <SectionTitle>Time per day</SectionTitle>
              <EChart option={dailyOption} height={200} />
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
