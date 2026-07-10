"use client";

import { ConfigProvider, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useReportProjects } from "@/features/reporting/use-reporting";
import type { Database } from "@/types/database";
import { minutesToHours } from "../_lib/format-duration";
import { T, SEMANTIC } from "../_lib/tokens";
import { PageHeader, Panel, ErrorBanner, AvatarChip } from "../_lib/ui";
import { reportingTableTheme } from "../_lib/table-theme";

type ProjectReportRow =
  Database["public"]["Functions"]["report_projects"]["Returns"][number];

const mono = (v: React.ReactNode) => (
  <span className="font-mono" style={{ color: T.textPrimary }}>
    {v}
  </span>
);

export default function ReportingProjectsPage() {
  const { data, isLoading, isError, error } = useReportProjects();

  const columns: ColumnsType<ProjectReportRow> = [
    {
      title: "Project",
      dataIndex: "project_name",
      key: "project_name",
      sorter: (a, b) => a.project_name.localeCompare(b.project_name),
      render: (name: string, row) => (
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
        >
          <AvatarChip name={name} size={26} colorKey={row.project_id} />
          <span style={{ color: T.textPrimary, fontWeight: 500 }}>{name}</span>
        </span>
      ),
    },
    {
      title: "Tasks",
      dataIndex: "total_tasks",
      key: "total_tasks",
      align: "right",
      width: 100,
      sorter: (a, b) => a.total_tasks - b.total_tasks,
      render: (v: number) => mono(v),
    },
    {
      title: "Completed",
      dataIndex: "completed_tasks",
      key: "completed_tasks",
      align: "right",
      width: 120,
      sorter: (a, b) => a.completed_tasks - b.completed_tasks,
      render: (v: number) => mono(v),
    },
    {
      title: "Completion",
      dataIndex: "completion_pct",
      key: "completion_pct",
      width: 220,
      sorter: (a, b) => a.completion_pct - b.completion_pct,
      render: (value: number) => {
        const pct = Math.max(0, Math.min(100, Math.round(value)));
        const color =
          pct >= 100
            ? SEMANTIC.green.fg
            : pct === 0
              ? T.textTertiary
              : T.chart;
        return (
          <div
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <div
              style={{
                flex: 1,
                height: 8,
                borderRadius: 999,
                background: T.divider,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: color,
                }}
              />
            </div>
            <span
              className="font-mono"
              style={{ fontSize: 12.5, color: T.textSecondary, width: 34 }}
            >
              {pct}%
            </span>
          </div>
        );
      },
    },
    {
      title: "Logged hours",
      dataIndex: "logged_minutes",
      key: "logged_minutes",
      align: "right",
      width: 140,
      sorter: (a, b) => a.logged_minutes - b.logged_minutes,
      render: (value: number) => mono(`${minutesToHours(value)}h`),
    },
    {
      title: "Members",
      dataIndex: "member_count",
      key: "member_count",
      align: "right",
      width: 110,
      sorter: (a, b) => a.member_count - b.member_count,
      render: (v: number) => mono(v),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Task progress and time logged per project."
      />
      {isError ? (
        <ErrorBanner
          title="Failed to load project report"
          message={error instanceof Error ? error.message : "Please try again."}
        />
      ) : (
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <ConfigProvider theme={reportingTableTheme}>
            <Table<ProjectReportRow>
              rowKey="project_id"
              loading={isLoading}
              columns={columns}
              dataSource={data ?? []}
              pagination={{
                pageSize: 10,
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
