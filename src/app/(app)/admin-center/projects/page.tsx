"use client";

import { Card, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useAdminProjects } from "@/features/admin/use-admin";
import type { Database } from "@/types/database";
import { AdminError, isForbiddenError } from "../_components/admin-error";

type AdminProjectRow =
  Database["public"]["Functions"]["admin_list_projects"]["Returns"][number];

export default function AdminProjectsPage() {
  const { data, isLoading, isError, error } = useAdminProjects();

  const columns: ColumnsType<AdminProjectRow> = [
    {
      title: "Project",
      dataIndex: "project_name",
      key: "project_name",
      sorter: (a, b) =>
        (a.project_name ?? "").localeCompare(b.project_name ?? ""),
    },
    {
      title: "Team",
      dataIndex: "team_name",
      key: "team_name",
      sorter: (a, b) => (a.team_name ?? "").localeCompare(b.team_name ?? ""),
    },
    {
      title: "Owner",
      dataIndex: "owner_name",
      key: "owner_name",
      sorter: (a, b) => (a.owner_name ?? "").localeCompare(b.owner_name ?? ""),
    },
    {
      title: "Tasks",
      dataIndex: "task_count",
      key: "task_count",
      align: "right",
      width: 130,
      sorter: (a, b) => a.task_count - b.task_count,
    },
  ];

  const showForbidden = isError && isForbiddenError(error);

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Projects
      </Typography.Title>
      <Typography.Text type="secondary">
        Every project across the teams in your organization.
      </Typography.Text>

      {isError ? (
        <AdminError error={error} title="Failed to load projects" />
      ) : null}

      {!showForbidden ? (
        <Table<AdminProjectRow>
          rowKey="project_id"
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
