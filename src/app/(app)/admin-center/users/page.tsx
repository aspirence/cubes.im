"use client";

import { Card, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useAdminUsers } from "@/features/admin/use-admin";
import type { Database } from "@/types/database";
import { AdminError, isForbiddenError } from "../_components/admin-error";

type AdminUserRow =
  Database["public"]["Functions"]["admin_list_users"]["Returns"][number];

export default function AdminUsersPage() {
  const { data, isLoading, isError, error } = useAdminUsers();

  const columns: ColumnsType<AdminUserRow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""),
    },
    {
      title: "Email",
      dataIndex: "email",
      key: "email",
      sorter: (a, b) => (a.email ?? "").localeCompare(b.email ?? ""),
    },
    {
      title: "Workspaces",
      dataIndex: "team_count",
      key: "team_count",
      align: "right",
      width: 130,
      sorter: (a, b) => a.team_count - b.team_count,
    },
  ];

  const showForbidden = isError && isForbiddenError(error);

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Users
      </Typography.Title>
      <Typography.Text type="secondary">
        Everyone across the teams in your organization.
      </Typography.Text>

      {isError ? (
        <AdminError error={error} title="Failed to load users" />
      ) : null}

      {!showForbidden ? (
        <Table<AdminUserRow>
          rowKey="user_id"
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
