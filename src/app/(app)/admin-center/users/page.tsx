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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Users
        </Typography.Title>
        <Typography.Text type="secondary">
          {data && !isError
            ? `${data.length} ${data.length === 1 ? "person" : "people"} across the teams in your organization.`
            : "Everyone across the teams in your organization."}
        </Typography.Text>
      </div>

      <Card>
        {isError ? (
          <AdminError error={error} title="Failed to load users" />
        ) : null}

        {!showForbidden ? (
          <Table<AdminUserRow>
            rowKey="user_id"
            loading={isLoading}
            columns={columns}
            dataSource={isError ? [] : (data ?? [])}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: "max-content" }}
          />
        ) : null}
      </Card>
    </div>
  );
}
