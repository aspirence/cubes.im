"use client";

import { ConfigProvider, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useReportMembers } from "@/features/reporting/use-reporting";
import type { Database } from "@/types/database";
import { minutesToHours } from "../_lib/format-duration";
import { T } from "../_lib/tokens";
import { PageHeader, Panel, ErrorBanner, AvatarChip } from "../_lib/ui";
import { reportingTableTheme } from "../_lib/table-theme";

type MemberReportRow =
  Database["public"]["Functions"]["report_members"]["Returns"][number];

const mono = (v: React.ReactNode) => (
  <span className="font-mono" style={{ color: T.textPrimary }}>
    {v}
  </span>
);

export default function ReportingMembersPage() {
  const { data, isLoading, isError, error } = useReportMembers();

  const columns: ColumnsType<MemberReportRow> = [
    {
      title: "Member",
      dataIndex: "user_name",
      key: "user_name",
      sorter: (a, b) => a.user_name.localeCompare(b.user_name),
      render: (name: string, row) => (
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
        >
          <AvatarChip name={name} size={26} colorKey={row.team_member_id} />
          <span style={{ color: T.textPrimary, fontWeight: 500 }}>{name}</span>
        </span>
      ),
    },
    {
      title: "Assigned",
      dataIndex: "assigned_tasks",
      key: "assigned_tasks",
      align: "right",
      width: 130,
      sorter: (a, b) => a.assigned_tasks - b.assigned_tasks,
      render: (v: number) => mono(v),
    },
    {
      title: "Completed",
      dataIndex: "completed_tasks",
      key: "completed_tasks",
      align: "right",
      width: 130,
      sorter: (a, b) => a.completed_tasks - b.completed_tasks,
      render: (v: number) => mono(v),
    },
    {
      title: "Logged hours",
      dataIndex: "logged_minutes",
      key: "logged_minutes",
      align: "right",
      width: 150,
      sorter: (a, b) => a.logged_minutes - b.logged_minutes,
      render: (value: number) => mono(`${minutesToHours(value)}h`),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle="Task assignment and time logged per team member."
      />
      {isError ? (
        <ErrorBanner
          title="Failed to load member report"
          message={error instanceof Error ? error.message : "Please try again."}
        />
      ) : (
        <Panel padding={0} style={{ overflow: "hidden" }}>
          <ConfigProvider theme={reportingTableTheme}>
            <Table<MemberReportRow>
              rowKey="team_member_id"
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
