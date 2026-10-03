"use client";

import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  MAX_NOTE_LENGTH,
  normalizeHost,
  type HttpHostRow,
} from "@/app/api/workflows/http-hosts/host-rules";
import {
  useAddHttpHost,
  useCanManageHttpHosts,
  useHttpHosts,
  useRemoveHttpHost,
} from "./use-http-hosts";

/**
 * The admin surface for the workflow HTTP step's host allowlist.
 *
 * The step is deny-by-default: with an empty list every http step fails on
 * every run and every test, so this page is what turns "call any other tool"
 * from a promise into a feature. It is also an SSRF control, which is why the
 * copy is explicit about what an entry does and does not buy.
 */

interface HostFormValues {
  host: string;
  note?: string;
}

/** What will actually be stored — the trap this page exists to make visible. */
function HostPreview({ typed }: { typed: string }) {
  if (!typed.trim()) return null;
  const result = normalizeHost(typed);
  return result.ok ? (
    <Typography.Text type="secondary">
      Stored as <Typography.Text code>{result.host}</Typography.Text>
    </Typography.Text>
  ) : (
    <Typography.Text type="danger">{result.error}</Typography.Text>
  );
}

export default function HttpHostsSettingsPage() {
  const { message } = App.useApp();
  const { data: hosts, isLoading } = useHttpHosts();
  const { data: canManage } = useCanManageHttpHosts();
  const addHost = useAddHttpHost();
  const removeHost = useRemoveHttpHost();

  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<HostFormValues>();
  const typedHost = Form.useWatch("host", form) ?? "";

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      const stored = await addHost.mutateAsync({
        host: values.host,
        ...(values.note?.trim() ? { note: values.note.trim() } : {}),
      });
      message.success(`${stored} can now be called from a workflow.`);
      closeModal();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to add the host.");
    }
  };

  const handleRemove = async (host: string) => {
    try {
      await removeHost.mutateAsync(host);
      message.success(`${host} removed.`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to remove the host.");
    }
  };

  const columns: ColumnsType<HttpHostRow> = [
    {
      title: "Host",
      dataIndex: "host",
      key: "host",
      render: (host: string) => <Typography.Text code>{host}</Typography.Text>,
    },
    {
      title: "Note",
      dataIndex: "note",
      key: "note",
      render: (note: string | null) =>
        note ? note : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: "Added",
      key: "added",
      width: 220,
      render: (_, record) => (
        <Typography.Text type="secondary">
          {new Date(record.created_at).toLocaleDateString()}
          {record.created_by_name ? ` · ${record.created_by_name}` : ""}
        </Typography.Text>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 110,
      align: "right",
      render: (_, record) =>
        canManage ? (
          <Popconfirm
            title={`Remove ${record.host}?`}
            description="Workflow steps calling it will start failing."
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleRemove(record.host)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} aria-label="Remove host" />
          </Popconfirm>
        ) : (
          <Typography.Text type="secondary">Read-only</Typography.Text>
        ),
    },
  ];

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Allowed HTTP hosts
          </Typography.Title>
          <Typography.Text type="secondary">
            A workflow&rsquo;s HTTP step can only call a host on this list.
            {canManage ? "" : " Only workspace admins can change it."}
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => setModalOpen(true)}
        >
          Add host
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="What an entry allows"
        description={
          <>
            An entry covers its subdomains: <Typography.Text code>acme.com</Typography.Text> also
            allows <Typography.Text code>api.acme.com</Typography.Text>, but never{" "}
            <Typography.Text code>notacme.com</Typography.Text>. Calls are https only, and a host
            that resolves to a private, loopback or link-local address is still refused — being on
            this list does not overrule that.
          </>
        }
      />

      {(hosts?.length ?? 0) === 0 && !isLoading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No hosts yet — every HTTP step will fail until one is added."
          style={{ padding: "24px 0" }}
        />
      ) : (
        <Table<HttpHostRow>
          rowKey="host"
          loading={isLoading}
          columns={columns}
          dataSource={hosts ?? []}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
        />
      )}

      <Modal
        title="Add an allowed host"
        open={modalOpen}
        onOk={handleSubmit}
        okText="Add host"
        confirmLoading={addHost.isPending}
        onCancel={closeModal}
        destroyOnHidden
      >
        <Form<HostFormValues> form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Host"
            name="host"
            extra={<HostPreview typed={typedHost} />}
            rules={[
              {
                validator: (_rule, value: string) => {
                  const result = normalizeHost(value ?? "");
                  return result.ok ? Promise.resolve() : Promise.reject(new Error(result.error));
                },
              },
            ]}
          >
            <Input placeholder="api.acme.com" autoFocus />
          </Form.Item>
          <Form.Item
            label="Note (optional)"
            name="note"
            rules={[{ max: MAX_NOTE_LENGTH, message: `At most ${MAX_NOTE_LENGTH} characters.` }]}
          >
            <Input.TextArea
              rows={2}
              maxLength={MAX_NOTE_LENGTH}
              showCount
              placeholder="Why this host is allowed — the team that owns it, the ticket, the expiry."
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
