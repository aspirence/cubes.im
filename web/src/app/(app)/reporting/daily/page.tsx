"use client";

import { useState } from "react";
import {
  App,
  Button,
  Checkbox,
  ConfigProvider,
  DatePicker,
  Popover,
  Segmented,
  Space,
  Table,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DownloadOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useDailyReport } from "@/features/reporting/use-reporting";
import {
  ALL_SECTIONS,
  MAX_REPORT_DAYS,
  REPORT_SECTIONS,
  type DailyReport,
  type ReportSections,
  type ReportTaskRow,
} from "@/features/reporting/daily-report";
import {
  deltaLabel,
  formatMinutesLabel,
  formatMoney,
  reportHeadline,
} from "@/features/reporting/daily-report-pdf";
import { T, SEMANTIC, MONO } from "../_lib/tokens";
import {
  PageHeader,
  Panel,
  SectionTitle,
  AvatarChip,
  ErrorBanner,
  Icon,
} from "../_lib/ui";
import { reportingTableTheme } from "../_lib/table-theme";

type Preset = "today" | "yesterday" | "week" | "last7" | "month" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This week" },
  { value: "last7", label: "Last 7 days" },
  { value: "month", label: "This month" },
];

function presetRange(p: Preset): [Dayjs, Dayjs] | null {
  const today = dayjs().startOf("day");
  switch (p) {
    case "today":
      return [today, today];
    case "yesterday":
      return [today.subtract(1, "day"), today.subtract(1, "day")];
    case "week":
      return [today.startOf("week"), today];
    case "last7":
      return [today.subtract(6, "day"), today];
    case "month":
      return [today.startOf("month"), today];
    default:
      return null;
  }
}

const SECTIONS_STORAGE = "cubes.reporting.daily.sections";

function loadSections(): ReportSections {
  if (typeof window === "undefined") return ALL_SECTIONS;
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE);
    if (raw) return { ...ALL_SECTIONS, ...JSON.parse(raw) };
  } catch {
    /* storage blocked or malformed — fall back to everything */
  }
  return ALL_SECTIONS;
}

/** How many rows each on-screen list shows; downloads carry the rest. */
const PREVIEW_ROWS = 8;

export default function ReportingDailyPage() {
  const { message } = App.useApp();
  const [preset, setPreset] = useState<Preset>("today");
  const [range, setRange] = useState<[Dayjs, Dayjs]>(
    () => presetRange("today")!,
  );
  // The preview (the only place sections show) renders after the report
  // loads on the client, so reading storage up front can't mismatch SSR.
  const [sections, setSections] = useState<ReportSections>(loadSections);
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);

  const saveSections = (next: ReportSections) => {
    setSections(next);
    try {
      localStorage.setItem(SECTIONS_STORAGE, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const [from, to] = range;
  const singleDay = from.isSame(to, "day");
  const { data, isLoading, isFetching, isError, error, refetch } =
    useDailyReport(from, to);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) setRange(r);
  };

  /** ‹ › step by the window's own length (a day, a week…). */
  const step = (dir: -1 | 1) => {
    const len = to.diff(from, "day") + 1;
    const next: [Dayjs, Dayjs] = [
      from.add(dir * len, "day"),
      to.add(dir * len, "day"),
    ];
    if (next[0].isAfter(dayjs(), "day")) return;
    setPreset("custom");
    setRange(next);
  };

  const download = async (kind: "pdf" | "xlsx") => {
    if (!data) return;
    setBusy(kind);
    try {
      if (kind === "pdf") {
        const { downloadReportPdf } = await import(
          "@/features/reporting/daily-report-pdf"
        );
        await downloadReportPdf(data, sections);
      } else {
        const { downloadReportXlsx } = await import(
          "@/features/reporting/daily-report-xlsx"
        );
        downloadReportXlsx(data, sections);
      }
      message.success(kind === "pdf" ? "PDF downloaded." : "Excel downloaded.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Couldn't build the report.",
      );
    } finally {
      setBusy(null);
    }
  };

  const sectionPicker = (
    <div style={{ display: "grid", gap: 6, minWidth: 190 }}>
      <span style={{ fontSize: 12, color: T.textTertiary }}>
        Include in downloads
      </span>
      {REPORT_SECTIONS.map((s) => {
        const unavailable =
          (s.key === "crm" && data && !data.crm) ||
          (s.key === "attendance" && data && !data.attendance);
        return (
          <Checkbox
            key={s.key}
            checked={sections[s.key] && !unavailable}
            disabled={Boolean(unavailable)}
            onChange={(e) =>
              saveSections({ ...sections, [s.key]: e.target.checked })
            }
          >
            {s.label}
            {unavailable ? (
              <span style={{ color: T.textFaint }}> · not in use</span>
            ) : null}
          </Checkbox>
        );
      })}
    </div>
  );

  return (
    <div>
      <PageHeader
        title={singleDay ? "Daily report" : "Company report"}
        subtitle="Everything that happened across the team — work done, time, what's slipping, leads and attendance — ready to download."
        right={
          <Space wrap>
            <Popover content={sectionPicker} trigger="click" placement="bottomRight">
              <Button icon={<SettingOutlined />}>Sections</Button>
            </Popover>
            <Button
              icon={<FileExcelOutlined />}
              loading={busy === "xlsx"}
              disabled={!data || isFetching}
              onClick={() => download("xlsx")}
            >
              Excel
            </Button>
            <Button
              type="primary"
              icon={<FilePdfOutlined />}
              loading={busy === "pdf"}
              disabled={!data || isFetching}
              onClick={() => download("pdf")}
            >
              Download PDF
            </Button>
          </Space>
        }
      />

      {/* Window picker */}
      <Panel padding={12} style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Space wrap>
            <Button icon={<LeftOutlined />} onClick={() => step(-1)} aria-label="Previous period" />
            {singleDay ? (
              <DatePicker
                value={from}
                allowClear={false}
                format="ddd, D MMM YYYY"
                disabledDate={(d) => d.isAfter(dayjs(), "day")}
                onChange={(d) => {
                  if (!d) return;
                  setPreset("custom");
                  setRange([d.startOf("day"), d.startOf("day")]);
                }}
              />
            ) : (
              <DatePicker.RangePicker
                value={range}
                allowClear={false}
                format="D MMM YYYY"
                disabledDate={(d, info) =>
                  d.isAfter(dayjs(), "day") ||
                  Boolean(
                    info?.from &&
                      Math.abs(d.diff(info.from, "day")) >= MAX_REPORT_DAYS,
                  )
                }
                onChange={(r) => {
                  if (!r?.[0] || !r[1]) return;
                  setPreset("custom");
                  setRange([r[0].startOf("day"), r[1].startOf("day")]);
                }}
              />
            )}
            <Button
              icon={<RightOutlined />}
              onClick={() => step(1)}
              disabled={!to.isBefore(dayjs(), "day")}
              aria-label="Next period"
            />
            <Tooltip title="Refresh">
              <Button
                type="text"
                icon={<ReloadOutlined spin={isFetching && !isLoading} />}
                onClick={() => refetch()}
              />
            </Tooltip>
          </Space>
          <Segmented
            value={preset === "custom" ? (undefined as unknown as Preset) : preset}
            options={PRESETS}
            onChange={(v) => pickPreset(v as Preset)}
          />
        </div>
      </Panel>

      {isError ? (
        <ErrorBanner
          title="Couldn't build the report"
          message={error instanceof Error ? error.message : "Please try again."}
        />
      ) : !data || isLoading ? (
        <ReportSkeleton />
      ) : (
        <ReportPreview report={data} sections={sections} onDownload={download} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------ preview */

function ReportPreview({
  report,
  sections,
  onDownload,
}: {
  report: DailyReport;
  sections: ReportSections;
  onDownload: (kind: "pdf" | "xlsx") => void;
}) {
  const k = report.kpis;
  const quiet =
    k.completed === 0 && k.created === 0 && k.minutes === 0 && k.comments === 0;

  const tiles = [
    {
      label: "Tasks completed",
      value: k.completed.toLocaleString(),
      icon: "task_alt",
      delta: deltaLabel(k.completed, report.previous.completed, report.days),
    },
    {
      label: "New tasks",
      value: k.created.toLocaleString(),
      icon: "add_task",
      delta: deltaLabel(k.created, report.previous.created, report.days),
    },
    {
      label: "Time logged",
      value: formatMinutesLabel(k.minutes),
      icon: "schedule",
      delta: deltaLabel(k.minutes, report.previous.minutes, report.days, true),
    },
    {
      label: "Billable",
      value: formatMinutesLabel(k.billableMinutes),
      icon: "payments",
      note: k.minutes
        ? `${Math.round((k.billableMinutes / k.minutes) * 100)}% of logged time`
        : undefined,
    },
    {
      label: "Active people",
      value: `${k.activePeople}`,
      icon: "group",
      note: `of ${report.people.length} members`,
    },
    {
      label: "Overdue (open)",
      value: k.overdue.toLocaleString(),
      icon: "warning",
      danger: k.overdue > 0,
    },
    {
      label: report.days === 1 ? "Due today" : "Due in period",
      value: k.dueInWindow.toLocaleString(),
      icon: "event",
    },
    ...(report.crm
      ? [
          {
            label: "New leads",
            value: report.crm.newLeads.toLocaleString(),
            icon: "person_add",
            note: report.crm.converted
              ? `${report.crm.converted} converted`
              : undefined,
          },
        ]
      : [{ label: "Comments", value: k.comments.toLocaleString(), icon: "chat" }]),
  ];

  return (
    <>
      {/* Headline */}
      <Panel padding={18} style={{ marginBottom: 16, background: T.accentSoft, borderColor: "transparent" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Icon name="summarize" size={22} color={T.accent} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: T.accent, fontWeight: 600, marginBottom: 4 }}>
              {report.teamName} · {report.label}
            </div>
            <div style={{ fontSize: 14, color: T.textPrimary, lineHeight: 1.55 }}>
              {quiet
                ? "A quiet period — no tasks were completed or opened and no time was logged."
                : reportHeadline(report)}
            </div>
          </div>
        </div>
      </Panel>

      {/* KPI grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {tiles.map((t) => (
          <Panel key={t.label} padding={16}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name={t.icon} size={16} color={T.textTertiary} />
              <span style={{ fontSize: 12, color: T.textSecondary }}>{t.label}</span>
            </div>
            <div
              style={{
                marginTop: 8,
                fontFamily: MONO,
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-0.5px",
                color: "danger" in t && t.danger ? SEMANTIC.red.fg : T.textPrimary,
              }}
            >
              {t.value}
            </div>
            <div style={{ marginTop: 2, fontSize: 11.5, minHeight: 16 }}>
              {"delta" in t && t.delta ? (
                <span
                  style={{
                    color:
                      t.delta.tone === "up"
                        ? SEMANTIC.green.fg
                        : t.delta.tone === "down"
                          ? SEMANTIC.red.fg
                          : T.textTertiary,
                  }}
                >
                  {t.delta.text}
                </span>
              ) : "note" in t && t.note ? (
                <span style={{ color: T.textTertiary }}>{t.note}</span>
              ) : null}
            </div>
          </Panel>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: 16,
        }}
      >
        {sections.projects ? (
          <Panel padding={0}>
            <div style={{ padding: "16px 18px 8px" }}>
              <SectionTitle right={<Count n={report.projects.length} />}>Projects</SectionTitle>
            </div>
            <ProjectsTable report={report} />
          </Panel>
        ) : null}

        {sections.people ? (
          <Panel padding={0}>
            <div style={{ padding: "16px 18px 8px" }}>
              <SectionTitle right={<Count n={report.people.length} />}>People</SectionTitle>
            </div>
            <PeopleTable report={report} />
          </Panel>
        ) : null}

        {sections.completed ? (
          <TaskList
            title="Completed"
            rows={report.completedTasks}
            empty="Nothing was completed in this period."
            multiDay={report.days > 1}
            done
          />
        ) : null}

        {sections.attention ? (
          <TaskList
            title="Needs attention"
            rows={report.attention}
            empty="Nothing is overdue. Nice."
            multiDay={report.days > 1}
          />
        ) : null}

        {sections.crm && report.crm ? <CrmPanel report={report} /> : null}
        {sections.attendance && report.attendance ? (
          <AttendancePanel report={report} />
        ) : null}
      </div>

      <div
        style={{
          marginTop: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "center",
          color: T.textTertiary,
          fontSize: 12.5,
        }}
      >
        <span>
          The preview shows the top rows — downloads include every task, time
          entry and lead.
        </span>
        <Button size="small" icon={<DownloadOutlined />} onClick={() => onDownload("pdf")}>
          PDF
        </Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={() => onDownload("xlsx")}>
          Excel
        </Button>
      </div>
    </>
  );
}

function Count({ n, label }: { n: number; label?: string }) {
  return (
    <span className="font-mono" style={{ fontSize: 12, color: T.textTertiary }}>
      {n.toLocaleString()}
      {label ? ` ${label}` : ""}
    </span>
  );
}

const muted = (v: string | number) => (
  <span style={{ color: v ? T.textPrimary : T.textFaint, fontFamily: MONO }}>
    {v || "—"}
  </span>
);

function ProjectsTable({ report }: { report: DailyReport }) {
  const columns: ColumnsType<DailyReport["projects"][number]> = [
    {
      title: "Project",
      dataIndex: "name",
      render: (name: string, r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: r.color }} />
          <span style={{ fontWeight: 500 }}>{name}</span>
        </span>
      ),
    },
    { title: "Done", dataIndex: "completed", align: "right", width: 70, render: muted },
    { title: "New", dataIndex: "created", align: "right", width: 60, render: muted },
    {
      title: "Time",
      dataIndex: "minutes",
      align: "right",
      width: 80,
      render: (m: number) => muted(m ? formatMinutesLabel(m) : 0),
    },
    {
      title: "Overdue",
      dataIndex: "overdue",
      align: "right",
      width: 80,
      render: (n: number) => (
        <span style={{ color: n ? SEMANTIC.red.fg : T.textFaint, fontFamily: MONO }}>
          {n || "—"}
        </span>
      ),
    },
  ];
  return (
    <ConfigProvider theme={reportingTableTheme}>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={report.projects}
        pagination={report.projects.length > PREVIEW_ROWS ? { pageSize: PREVIEW_ROWS, size: "small" } : false}
        locale={{ emptyText: "No project activity in this period." }}
      />
    </ConfigProvider>
  );
}

function PeopleTable({ report }: { report: DailyReport }) {
  const showAttendance =
    report.days === 1 && report.people.some((p) => p.attendance);
  const columns: ColumnsType<DailyReport["people"][number]> = [
    {
      title: "Member",
      dataIndex: "name",
      render: (name: string, r) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <AvatarChip name={name} colorKey={r.teamMemberId} size={22} />
          <span style={{ fontWeight: 500 }}>{name}</span>
        </span>
      ),
    },
    { title: "Done", dataIndex: "completed", align: "right", width: 64, render: muted },
    {
      title: "Time",
      dataIndex: "minutes",
      align: "right",
      width: 80,
      render: (m: number) => muted(m ? formatMinutesLabel(m) : 0),
    },
    ...(showAttendance
      ? [
          {
            title: "Attendance",
            dataIndex: "attendance",
            width: 120,
            render: (a: string | null, r: DailyReport["people"][number]) =>
              a ? (
                <span style={{ fontSize: 12 }}>
                  {a}
                  {r.clockIn ? (
                    <span style={{ color: T.textTertiary }}>
                      {" "}
                      · {dayjs(r.clockIn).format("h:mm A")}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span style={{ color: T.textFaint }}>—</span>
              ),
          },
        ]
      : [{ title: "Notes", dataIndex: "comments", align: "right" as const, width: 70, render: muted }]),
  ];
  return (
    <ConfigProvider theme={reportingTableTheme}>
      <Table
        rowKey="teamMemberId"
        size="small"
        columns={columns}
        dataSource={report.people}
        pagination={report.people.length > PREVIEW_ROWS ? { pageSize: PREVIEW_ROWS, size: "small" } : false}
      />
    </ConfigProvider>
  );
}

function TaskList({
  title,
  rows,
  empty,
  multiDay,
  done = false,
}: {
  title: string;
  rows: ReportTaskRow[];
  empty: string;
  multiDay: boolean;
  done?: boolean;
}) {
  const shown = rows.slice(0, PREVIEW_ROWS);
  return (
    <Panel padding={18}>
      <SectionTitle right={<Count n={rows.length} />}>{title}</SectionTitle>
      {rows.length === 0 ? (
        <div style={{ padding: "18px 0 6px", color: T.textTertiary, fontSize: 13 }}>{empty}</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {shown.map((t, i) => (
            <div
              key={`${t.code}-${i}`}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                padding: "8px 0",
                borderTop: i === 0 ? "none" : `1px solid ${T.dividerSoft}`,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: T.textPrimary,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {t.code ? (
                    <span style={{ fontFamily: MONO, color: T.textTertiary, marginRight: 6, fontSize: 12 }}>
                      {t.code}
                    </span>
                  ) : null}
                  {t.name}
                </div>
                <div style={{ fontSize: 11.5, color: T.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.project}
                  {t.assignees ? ` · ${t.assignees}` : done ? "" : " · Unassigned"}
                </div>
              </div>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 11.5,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: t.daysLate ? SEMANTIC.red.bg : done ? SEMANTIC.green.bg : SEMANTIC.slate.bg,
                  color: t.daysLate ? SEMANTIC.red.fg : done ? SEMANTIC.green.fg : SEMANTIC.slate.fg,
                }}
              >
                {t.daysLate
                  ? `${t.daysLate}d late`
                  : done
                    ? dayjs(t.at).format(multiDay ? "D MMM" : "h:mm A")
                    : t.due
                      ? `Due ${dayjs(t.due).format("D MMM")}`
                      : "Due"}
              </span>
            </div>
          ))}
          {rows.length > shown.length ? (
            <div style={{ paddingTop: 8, fontSize: 12, color: T.textTertiary }}>
              + {rows.length - shown.length} more in the download
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function Breakdown({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.slice(0, 6).map((r) => (
        <div key={r.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span style={{ color: T.textSecondary }}>{r.label}</span>
            <span style={{ fontFamily: MONO, color: T.textPrimary }}>{r.count}</span>
          </div>
          <div style={{ height: 5, marginTop: 4, borderRadius: 999, background: T.divider }}>
            <div
              style={{
                width: `${(r.count / max) * 100}%`,
                height: "100%",
                borderRadius: 999,
                background: T.chart,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function CrmPanel({ report }: { report: DailyReport }) {
  const c = report.crm!;
  return (
    <Panel padding={18}>
      <SectionTitle
        right={
          <span style={{ fontSize: 12, color: T.textTertiary }}>
            {formatMoney(c.pipelineValue, c.currency)} new pipeline
          </span>
        }
      >
        CRM
      </SectionTitle>
      <div style={{ display: "flex", gap: 18, margin: "12px 0 14px" }}>
        <Stat label="New leads" value={c.newLeads} />
        <Stat label="Converted" value={c.converted} tone="green" />
        <Stat label="Status updates" value={c.statusChanges} />
        <Stat label="Junk" value={c.junk} tone={c.junk ? "red" : undefined} />
      </div>
      {c.bySource.length ? (
        <>
          <div style={{ fontSize: 12, color: T.textTertiary, marginBottom: 8 }}>New leads by source</div>
          <Breakdown rows={c.bySource} />
        </>
      ) : (
        <div style={{ color: T.textTertiary, fontSize: 13 }}>No new leads in this period.</div>
      )}
    </Panel>
  );
}

function AttendancePanel({ report }: { report: DailyReport }) {
  const a = report.attendance!;
  return (
    <Panel padding={18}>
      <SectionTitle right={<Count n={a.rows.length} label="records" />}>Attendance</SectionTitle>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, margin: "12px 0 14px" }}>
        {a.counts.map((c) => (
          <Stat
            key={c.label}
            label={c.label}
            value={c.count}
            tone={c.label === "Absent" ? "red" : c.label === "Present" ? "green" : undefined}
          />
        ))}
      </div>
      {a.leaves.length ? (
        <>
          <div style={{ fontSize: 12, color: T.textTertiary, marginBottom: 6 }}>On leave</div>
          {a.leaves.slice(0, 6).map((l, i) => (
            <div
              key={`${l.name}-${i}`}
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}
            >
              <span style={{ color: T.textPrimary }}>{l.name}</span>
              <span style={{ color: T.textTertiary }}>
                {l.type} · {l.status}
              </span>
            </div>
          ))}
        </>
      ) : null}
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "red";
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 20,
          fontWeight: 600,
          color: tone ? SEMANTIC[tone].fg : T.textPrimary,
        }}
      >
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 11.5, color: T.textTertiary }}>{label}</div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
        gap: 12,
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <Panel key={i} padding={16}>
          <div style={{ width: "50%", height: 11, borderRadius: 4, background: T.divider }} />
          <div style={{ width: "35%", height: 22, marginTop: 12, borderRadius: 4, background: T.divider }} />
        </Panel>
      ))}
    </div>
  );
}
