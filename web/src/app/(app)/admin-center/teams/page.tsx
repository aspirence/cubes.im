"use client";

import { Card, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useAdminTeams } from "@/features/admin/use-admin";
import type { Database } from "@/types/database";
import { AdminError, isForbiddenError } from "../_components/admin-error";

type AdminTeamRow =
  Database["public"]["Functions"]["admin_list_teams"]["Returns"][number];

export default function AdminTeamsPage() {
  const { data, isLoading, isError, error } = useAdminTeams();

  const columns: ColumnsType<AdminTeamRow> = [
    {
      title: "Workspace",
      dataIndex: "team_name",
      key: "team_name",
      sorter: (a, b) => (a.team_name ?? "").localeCompare(b.team_name ?? ""),
    },
    {
      title: "Members",
      dataIndex: "member_count",
      key: "member_count",
      align: "right",
      width: 130,
      sorter: (a, b) => a.member_count - b.member_count,
    },
    {
      title: "Projects",
      dataIndex: "project_count",
      key: "project_count",
      align: "right",
      width: 130,
      sorter: (a, b) => a.project_count - b.project_count,
    },
  ];

  const showForbidden = isError && isForbiddenError(error);

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Workspaces
      </Typography.Title>
      <Typography.Text type="secondary">
        Workspaces in your organization with their headcount and project totals.
      </Typography.Text>

      {isError ? (
        <AdminError error={error} title="Failed to load workspaces" />
      ) : null}

      {!showForbidden ? (
        <Table<AdminTeamRow>
          rowKey="team_id"
          style={{ marginTop: 16 }}
          loading={isLoading}
          columns={columns}
          dataSource={isError ? [] : (data ?? [])}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
        />
      ) : null}
    </Card>
  );
}
