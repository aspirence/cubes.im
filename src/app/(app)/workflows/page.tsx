"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  useWorkflows,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useIsTeamAdmin,
  type Workflow,
} from "@/features/workflows/use-workflows";
import { useRunNow } from "@/features/workflows/use-workflow-runs";

const triggerLabel = (t: string) =>
  t === "schedule" ? "Schedule" : t === "event" ? "Event" : "Manual";

export default function WorkflowsListPage() {
  const router = useRouter();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: workflows, isLoading } = useWorkflows();
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const runNow = useRunNow();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const canManage = Boolean(isTeamAdmin);

  const [createOpen, setCreateOpen] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [form] = Form.useForm<{ name: string; description?: string }>();

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      const wf = await createWorkflow.mutateAsync({
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
      });
      setCreateOpen(false);
      form.resetFields();
      router.push(`/workflows/${wf.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to create workflow.");
    }
  };

  const handleToggle = async (wf: Workflow, enabled: boolean) => {
    try {
      await updateWorkflow.mutateAsync({ id: wf.id, enabled });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to update.");
    }
  };

  const handleRun = async (wf: Workflow) => {
    setRunningId(wf.id);
    try {
      await runNow.mutateAsync(wf.id);
      message.success("Run started — open the workflow to see its history.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkflow.mutateAsync(id);
      message.success("Workflow deleted.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to delete.");
    }
  };

  const columns: ColumnsType<Workflow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string, record) => (
        <a onClick={() => router.push(`/workflows/${record.id}`)}>{name}</a>
      ),
    },
    {
      title: "Trigger",
      dataIndex: "trigger_type",
      key: "trigger",
      width: 120,
      render: (t: string) => <Tag>{triggerLabel(t)}</Tag>,
    },
    {
      title: "Runs",
      dataIndex: "run_count",
      key: "runs",
      width: 80,
    },
    {
      title: "Enabled",
      key: "enabled",
      width: 90,
      render: (_, record) => (
        <Switch
          size="small"
          checked={record.enabled}
          disabled={!canManage}
          onChange={(checked) => void handleToggle(record, checked)}
        />
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 200,
      align: "right",
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={runningId === record.id}
            onClick={() => void handleRun(record)}
          >
            Run now
          </Button>
          <Button size="small" onClick={() => router.push(`/workflows/${record.id}`)}>
            Open
          </Button>
          {canManage ? (
            <Popconfirm
              title="Delete this workflow?"
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record.id)}
            >
              <Button type="text" danger icon={<DeleteOutlined />} aria-label="Delete" />
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: "-.4px", color: token.colorText }}>
            Workflows
          </h1>
          <div style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
            Automate multi-step sequences. Deterministic runs use zero AI tokens.
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={() => setCreateOpen(true)}>
          New workflow
        </Button>
      </div>

      <Card>
      {(workflows?.length ?? 0) === 0 && !isLoading ? (
        <Empty
          description="No workflows yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ padding: "32px 0" }}
        >
          <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={() => setCreateOpen(true)}>
            New workflow
          </Button>
        </Empty>
      ) : (
        <Table<Workflow>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={workflows ?? []}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
        />
      )}

      <Modal
        title="New workflow"
        open={createOpen}
        onOk={handleCreate}
        okText="Create"
        confirmLoading={createWorkflow.isPending}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder="Weekly HR pulse" autoFocus />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea placeholder="Optional" rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
      </Card>
    </div>
  );
}
