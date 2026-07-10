"use client";

import { useMemo, useState } from "react";
import { Button, ConfigProvider, DatePicker, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useReportTimeLogs } from "@/features/reporting/use-reporting";
import type { Database } from "@/types/database";
import { formatMinutes } from "../_lib/format-duration";
import { T, SEMANTIC } from "../_lib/tokens";
import { PageHeader, Panel, ErrorBanner, AvatarChip } from "../_lib/ui";
import { reportingTableTheme } from "../_lib/table-theme";

type TimeLogRow =
  Database["public"]["Functions"]["report_time_logs"]["Returns"][number];

type RangeValue = [dayjs.Dayjs | null, dayjs.Dayjs | null] | null;

/** Wraps a CSV field, escaping quotes and commas per RFC 4180. */
function csvCell(value: string | number | boolean): string {
  const text = String(value);
  if (/["\n,]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(rows: TimeLogRow[]) {
  const header = [
    "Task",
    "Project",
    "User",
    "Minutes",
    "Billable",
    "Logged at",
  ];
  const lines = rows.map((row) =>
    [
      csvCell(row.task_name),
      csvCell(row.project_name),
      csvCell(row.user_name),
      csvCell(row.minutes),
      csvCell(row.is_billable ? "Yes" : "No"),
      csvCell(dayjs(row.logged_at).format("YYYY-MM-DD HH:mm")),
    ].join(","),
  );
  const csv = [header.map(csvCell).join(","), ...lines].join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `time-sheets-${dayjs().format("YYYY-MM-DD")}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Semantic pill (light bg + saturated text). */
function Pill({
  fg,
  bg,
  children,
}: {
  fg: string;
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 22,
        padding: "0 9px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        color: fg,
        background: bg,
      }}
    >
      {children}
    </span>
  );
}

export default function ReportingTimeSheetsPage() {
  const [range, setRange] = useState<RangeValue>(null);

  const from = range?.[0] ? range[0].startOf("day").toISOString() : undefined;
  const to = range?.[1] ? range[1].endOf("day").toISOString() : undefined;

  const { data, isLoading, isError, error } = useReportTimeLogs(from, to);

  const rows = useMemo(() => data ?? [], [data]);

  const columns: ColumnsType<TimeLogRow> = [
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
      render: (v: string) => (
        <span style={{ color: T.textSecondary }}>{v}</span>
      ),
    },
    {
      title: "User",
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
    {
      title: "Time",
      dataIndex: "minutes",
      key: "minutes",
      align: "right",
      width: 120,
      sorter: (a, b) => a.minutes - b.minutes,
      render: (value: number) => (
        <span className="font-mono" style={{ color: T.textPrimary }}>
          {formatMinutes(value)}
        </span>
      ),
    },
    {
      title: "Billable",
      dataIndex: "is_billable",
      key: "is_billable",
      width: 130,
      filters: [
        { text: "Billable", value: true },
        { text: "Non-billable", value: false },
      ],
      onFilter: (value, record) => record.is_billable === value,
      render: (billable: boolean) =>
        billable ? (
          <Pill fg={SEMANTIC.green.fg} bg={SEMANTIC.green.bg}>
            Billable
          </Pill>
        ) : (
          <Pill fg={SEMANTIC.slate.fg} bg={SEMANTIC.slate.bg}>
            Non-billable
          </Pill>
        ),
    },
    {
      title: "Date",
      dataIndex: "logged_at",
      key: "logged_at",
      width: 190,
      defaultSortOrder: "descend",
      sorter: (a, b) =>
        dayjs(a.logged_at).valueOf() - dayjs(b.logged_at).valueOf(),
      render: (value: string) => (
        <span className="font-mono" style={{ color: T.textSecondary }}>
          {dayjs(value).format("MMM D, YYYY HH:mm")}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Time sheets"
        subtitle="Detailed time logs across the active team."
        right={
          <Space wrap>
            <DatePicker.RangePicker
              value={range}
              onChange={(value) => setRange(value as RangeValue)}
              allowClear
              style={{ height: 34 }}
            />
            <Button
              icon={<DownloadOutlined />}
              onClick={() => downloadCsv(rows)}
              disabled={rows.length === 0}
              style={{ height: 34 }}
            >
              Export CSV
            </Button>
          </Space>
        }
      />

      {isError ? (
        <ErrorBanner
          title="Failed to load time logs"
          message={error instanceof Error ? error.message : "Please try again."}
        />
      ) : (
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <ConfigProvider theme={reportingTableTheme}>
            <Table<TimeLogRow>
              rowKey="log_id"
              loading={isLoading}
              columns={columns}
              dataSource={rows}
              pagination={{
                pageSize: 15,
                hideOnSinglePage: true,
                style: { padding: "0 16px", marginBottom: 0 },
              }}
              scroll={{ x: "max-content" }}
            />
          </ConfigProvider>
        </Panel>
      )}
    </div>
  );
}
