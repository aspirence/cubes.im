"use client";

import { Avatar, Card, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useTasks, type TaskWithRelations } from "@/features/tasks/use-tasks";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Table view: a dense spreadsheet-style list of the project's tasks. */
export function TableTab({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading } = useTasks(projectId);

  const columns: ColumnsType<TaskWithRelations> = [
    {
      title: "Task",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Status",
      key: "status",
      width: 150,
      render: (_, t) => (t.status ? <Tag>{t.status.name}</Tag> : "—"),
    },
    {
      title: "Priority",
      key: "priority",
      width: 120,
      render: (_, t) =>
        t.priority ? (
          <Tag color={t.priority.color_code}>{t.priority.name}</Tag>
        ) : (
          "—"
        ),
    },
    {
      title: "Assignees",
      key: "assignees",
      width: 140,
      render: (_, t) =>
        t.assignees.length > 0 ? (
          <Avatar.Group max={{ count: 3 }} size="small">
            {t.assignees.map((a) => (
              <Avatar
                key={a.team_member_id}
                src={a.team_member?.user?.avatar_url ?? undefined}
              >
                {initials(a.team_member?.user?.name ?? "?")}
              </Avatar>
            ))}
          </Avatar.Group>
        ) : (
          "—"
        ),
    },
    {
      title: "Due",
      key: "due",
      width: 110,
      sorter: (a, b) =>
        (a.end_date ? dayjs(a.end_date).valueOf() : 0) -
        (b.end_date ? dayjs(b.end_date).valueOf() : 0),
      render: (_, t) => (t.end_date ? dayjs(t.end_date).format("MMM D") : "—"),
    },
  ];

  return (
    <Card styles={{ body: { padding: 0 } }}>
      <Table<TaskWithRelations>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={tasks ?? []}
        scroll={{ x: "max-content" }}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
      />
    </Card>
  );
}
