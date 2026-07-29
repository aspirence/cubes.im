"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  useCreateCrmTask,
  useCrmTasks,
  useDeleteCrmTask,
  useUpdateCrmTask,
} from "@/features/app-crm/use-crm-tasks";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import {
  CRM_TASK_STATUSES,
  crmPersonName,
  type CrmTargetRef,
  type CrmTaskStatus,
  type CrmTaskWithTargets,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import {
  TargetPicker,
  decodeTarget,
  encodeTarget,
} from "../_components/target-picker";

type TaskFormValues = {
  title: string;
  body?: string;
  status?: CrmTaskStatus;
  due_at?: Dayjs | null;
  assignee_id?: string | null;
  targets?: string[];
};

export default function CrmTasksPage() {
  const { message } = App.useApp();
  const { user } = useAuth();
  const { data: tasks, isLoading } = useCrmTasks();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
  const { data: members } = useTeamMembers();
  const createTask = useCreateCrmTask();
  const updateTask = useUpdateCrmTask();
  const deleteTask = useDeleteCrmTask();

  const [statusFilter, setStatusFilter] = useState<"ALL" | CrmTaskStatus>(
    "ALL",
  );
  const [onlyMine, setOnlyMine] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmTaskWithTargets | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [form] = Form.useForm<TaskFormValues>();

  const recordName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? [])
      map.set(`person:${p.id}`, crmPersonName(p) || "Unnamed person");
    for (const c of companies ?? []) map.set(`company:${c.id}`, c.name);
    for (const d of deals ?? []) map.set(`deal:${d.id}`, d.name);
    return (type: string, id: string) => map.get(`${type}:${id}`) ?? null;
  }, [people, companies, deals]);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null) => (id && map.get(id)) || "—";
  }, [members]);

  const rows = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => statusFilter === "ALL" || t.status === statusFilter)
        .filter((t) => !onlyMine || t.assignee_id === user?.id),
    [tasks, statusFilter, onlyMine, user?.id],
  );

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "TODO" });
    setFormOpen(true);
  };

  const openEdit = (task: CrmTaskWithTargets) => {
    setEditing(task);
    form.setFieldsValue({
      title: task.title,
      body: task.body ?? undefined,
      status: task.status as CrmTaskStatus,
      due_at: task.due_at ? dayjs(task.due_at) : null,
      assignee_id: task.assignee_id,
      targets: task.targets.map((t) =>
        encodeTarget({
          type: t.target_type as CrmTargetRef["type"],
          id: t.target_id,
        }),
      ),
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: TaskFormValues) => {
    const patch = {
      title: values.title.trim(),
      body: values.body?.trim() || null,
      status: values.status ?? "TODO",
      due_at: values.due_at ? values.due_at.toISOString() : null,
      assignee_id: values.assignee_id ?? null,
    };
    try {
      if (editing) {
        await updateTask.mutateAsync({ id: editing.id, patch });
        message.success("Task updated.");
      } else {
        await createTask.mutateAsync({
          ...patch,
          targets: (values.targets ?? []).map(decodeTarget),
        });
        message.success("Task created.");
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save task."));
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Tasks
          </Typography.Title>
          <Segmented
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as "ALL" | CrmTaskStatus)}
            options={[
              { value: "ALL", label: "All" },
              ...CRM_TASK_STATUSES.map((s) => ({
                value: s.value,
                label: s.label,
              })),
            ]}
          />
        </Space>
        <Space wrap>
          <Space size={6}>
            <Switch size="small" checked={onlyMine} onChange={setOnlyMine} />
            <Typography.Text type="secondary">My tasks</Typography.Text>
          </Space>
          <Button
            type="primary"
            icon={<MIcon name="add" size={16} />}
            onClick={openCreate}
          >
            New task
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        columns={[
          {
            title: "Task",
            dataIndex: "title",
            render: (v: string, t) => (
              <Typography.Text
                delete={t.status === "DONE"}
                style={{ fontWeight: 500 }}
              >
                {v}
              </Typography.Text>
            ),
          },
          {
            title: "Status",
            key: "status",
            width: 150,
            render: (_, t) => (
              <Select
                size="small"
                value={t.status as CrmTaskStatus}
                style={{ width: 130 }}
                onChange={async (status) => {
                  try {
                    await updateTask.mutateAsync({
                      id: t.id,
                      patch: { status },
                    });
                  } catch (err) {
                    message.error(errMsg(err, "Failed to update status."));
                  }
                }}
                options={CRM_TASK_STATUSES.map((s) => ({
                  value: s.value,
                  label: (
                    <Space size={6}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: s.color,
                          display: "inline-block",
                        }}
                      />
                      {s.label}
                    </Space>
                  ),
                }))}
              />
            ),
          },
          {
            title: "Due",
            dataIndex: "due_at",
            render: (v: string | null) => {
              if (!v) return "—";
              const overdue = dayjs(v).isBefore(dayjs());
              return (
                <Typography.Text type={overdue ? "danger" : undefined}>
                  {dayjs(v).format("DD MMM YYYY")}
                </Typography.Text>
              );
            },
            sorter: (a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""),
          },
          {
            title: "Assignee",
            key: "assignee",
            render: (_, t) => memberName(t.assignee_id),
          },
          {
            title: "Linked to",
            key: "targets",
            render: (_, t) => (
              <Space size={4} wrap>
                {t.targets.map((x) => {
                  const name = recordName(x.target_type, x.target_id);
                  if (!name) return null;
                  return (
                    <Tag
                      key={x.id}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setViewTarget({
                          type: x.target_type as CrmTargetRef["type"],
                          id: x.target_id,
                        })
                      }
                    >
                      {name}
                    </Tag>
                  );
                })}
              </Space>
            ),
          },
          {
            title: "",
            key: "actions",
            width: 90,
            render: (_, t) => (
              <Space>
                <Button
                  type="text"
                  size="small"
                  icon={<MIcon name="edit" size={16} />}
                  onClick={() => openEdit(t)}
                />
                <Popconfirm
                  title="Delete this task?"
                  onConfirm={async () => {
                    try {
                      await deleteTask.mutateAsync(t.id);
                      message.success("Task deleted.");
                    } catch (err) {
                      message.error(errMsg(err, "Failed to delete task."));
                    }
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<MIcon name="delete" size={16} />}
                  />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit task" : "New task"}
        width={420}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="title"
            label="Title"
            rules={[{ required: true, message: "Task title is required" }]}
          >
            <Input placeholder="What needs doing?" />
          </Form.Item>
          <Form.Item name="body" label="Details">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="status" label="Status">
            <Select
              options={CRM_TASK_STATUSES.map((s) => ({
                value: s.value,
                label: s.label,
              }))}
            />
          </Form.Item>
          <Form.Item name="due_at" label="Due date">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="assignee_id" label="Assignee">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={memberOptions}
              placeholder="Team member"
            />
          </Form.Item>
          {!editing && (
            <Form.Item name="targets" label="Linked records">
              <TargetPicker />
            </Form.Item>
          )}
          <Space style={{ justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createTask.isPending || updateTask.isPending}
            >
              {editing ? "Save changes" : "Create task"}
            </Button>
          </Space>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
