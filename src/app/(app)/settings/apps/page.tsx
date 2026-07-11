"use client";

import { useState } from "react";
import type { ReactNode } from "react";
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
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  MailOutlined,
  SendOutlined,
  SlackOutlined,
  WhatsAppOutlined,
} from "@ant-design/icons";
import {
  useAppConnections,
  useCreateConnection,
  useUpdateConnection,
  useDeleteConnection,
  useSaveSecrets,
  useTestConnection,
  useIsOrgAdmin,
  type AppConnection,
  type AppProvider,
} from "@/features/apps/use-apps";

/* -------------------------------------------------------------------------- */
/* Provider registry (Phase A: webhook + slack live; email/whatsapp deferred). */
/* -------------------------------------------------------------------------- */

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
}

interface ProviderDef {
  key: AppProvider;
  label: string;
  icon: ReactNode;
  blurb: string;
  available: boolean;
  /** Non-secret metadata, stored on the connection row. */
  configFields: FieldDef[];
  /** Write-only credentials, stored in the service-role-only secrets table. */
  secretFields: FieldDef[];
}

const PROVIDERS: ProviderDef[] = [
  {
    key: "webhook",
    label: "Webhook",
    icon: <ApiOutlined />,
    blurb: "POST events to any HTTPS endpoint, optionally HMAC-signed.",
    available: true,
    configFields: [
      {
        key: "url",
        label: "Endpoint URL",
        placeholder: "https://example.com/hooks/cubes",
        required: true,
      },
    ],
    secretFields: [
      {
        key: "signing_secret",
        label: "Signing secret (optional)",
        placeholder: "used to sign the X-Signature header",
        help: "If set, test and delivery POSTs include an HMAC-SHA256 X-Signature header.",
      },
    ],
  },
  {
    key: "slack",
    label: "Slack",
    icon: <SlackOutlined />,
    blurb: "Post messages to a channel via an incoming webhook.",
    available: true,
    configFields: [
      { key: "channel", label: "Channel label (optional)", placeholder: "#ops" },
    ],
    secretFields: [
      {
        key: "webhook_url",
        label: "Incoming webhook URL",
        placeholder: "https://hooks.slack.com/services/…",
        required: true,
        help: "Stored securely and never shown again after saving.",
      },
    ],
  },
  {
    key: "email",
    label: "Email",
    icon: <MailOutlined />,
    blurb: "Send email via Resend.",
    available: false,
    configFields: [],
    secretFields: [],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: <WhatsAppOutlined />,
    blurb: "Deliver template messages via the Meta Cloud API.",
    available: false,
    configFields: [],
    secretFields: [],
  },
];

const providerDef = (key: string): ProviderDef | undefined =>
  PROVIDERS.find((p) => p.key === key);

/* -------------------------------------------------------------------------- */
/* Health dot.                                                                */
/* -------------------------------------------------------------------------- */

function HealthDot({ connection }: { connection: AppConnection }) {
  const status = connection.last_test_status;
  const color =
    status === "ok" ? "#22a06b" : status === "failed" ? "#e0556a" : "#c2c5cf";
  const title =
    status === "ok"
      ? `Last test OK${connection.last_tested_at ? ` · ${new Date(connection.last_tested_at).toLocaleString()}` : ""}`
      : status === "failed"
        ? `Last test failed: ${connection.last_test_error ?? "unknown error"}`
        : "Not tested yet";
  return (
    <Tooltip title={title}>
      <span
        aria-label={title}
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: 999,
          background: color,
        }}
      />
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* Page.                                                                      */
/* -------------------------------------------------------------------------- */

interface ConnFormValues {
  name: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

export default function AppsSettingsPage() {
  const { message } = App.useApp();
  const { data: connections, isLoading } = useAppConnections();
  const { data: isAdmin } = useIsOrgAdmin();
  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();
  const saveSecrets = useSaveSecrets();
  const testConnection = useTestConnection();

  const [modal, setModal] = useState<{
    provider: AppProvider;
    editing: AppConnection | null;
  } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm<ConnFormValues>();

  const canManage = Boolean(isAdmin);
  const activeDef = modal ? providerDef(modal.provider) : undefined;

  const openCreate = (provider: AppProvider) => {
    const def = providerDef(provider);
    setModal({ provider, editing: null });
    form.setFieldsValue({
      name: def ? `${def.label} connection` : "",
      config: {},
      secrets: {},
    });
  };

  const openEdit = (connection: AppConnection) => {
    setModal({ provider: connection.provider as AppProvider, editing: connection });
    const cfg = (connection.config as Record<string, string>) ?? {};
    // Credentials are write-only: never prefilled.
    form.setFieldsValue({ name: connection.name, config: cfg, secrets: {} });
  };

  const closeModal = () => {
    setModal(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    if (!modal || !activeDef) return;
    const values = await form.validateFields();
    const config: Record<string, string> = {};
    for (const f of activeDef.configFields) {
      const v = values.config?.[f.key]?.trim() ?? "";
      if (v) config[f.key] = v;
    }
    const credentials: Record<string, string> = {};
    for (const f of activeDef.secretFields) {
      const v = values.secrets?.[f.key]?.trim() ?? "";
      if (v) credentials[f.key] = v;
    }

    try {
      let id: string;
      if (modal.editing) {
        await updateConnection.mutateAsync({
          id: modal.editing.id,
          name: values.name.trim(),
          config,
        });
        id = modal.editing.id;
      } else {
        const created = await createConnection.mutateAsync({
          provider: modal.provider,
          name: values.name.trim(),
          config,
        });
        id = created.id;
        // The row now exists — promote the modal to edit mode so that if the
        // secrets save below fails, a retry UPDATES this connection instead of
        // inserting a duplicate and orphaning the first one.
        setModal({ provider: modal.provider, editing: created });
      }
      if (Object.keys(credentials).length > 0) {
        await saveSecrets.mutateAsync({ id, credentials });
      }
      message.success(modal.editing ? "Connection updated." : "Connection created.");
      closeModal();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save connection.",
      );
    }
  };

  const handleToggle = async (connection: AppConnection, enabled: boolean) => {
    try {
      await updateConnection.mutateAsync({ id: connection.id, enabled });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update connection.",
      );
    }
  };

  const handleTest = async (connection: AppConnection) => {
    setTestingId(connection.id);
    try {
      const result = await testConnection.mutateAsync(connection.id);
      if (result.ok) message.success(result.detail || "Test succeeded.");
      else message.warning(result.detail || "Test failed.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteConnection.mutateAsync(id);
      message.success("Connection deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete connection.",
      );
    }
  };

  const columns: ColumnsType<AppConnection> = [
    {
      title: "",
      key: "health",
      width: 36,
      render: (_, record) => <HealthDot connection={record} />,
    },
      {
        title: "Name",
        dataIndex: "name",
        key: "name",
        render: (name: string, record) => (
          <Space>
            <span style={{ color: "#8a8d98" }}>
              {providerDef(record.provider)?.icon}
            </span>
            <span>{name}</span>
          </Space>
        ),
      },
      {
        title: "Provider",
        dataIndex: "provider",
        key: "provider",
        width: 130,
        render: (provider: string) => (
          <Tag>{providerDef(provider)?.label ?? provider}</Tag>
        ),
      },
      {
        title: "Enabled",
        key: "enabled",
        width: 90,
        render: (_, record) => (
          <Switch
            size="small"
            checked={record.enabled}
            disabled={!canManage || updateConnection.isPending}
            onChange={(checked) => void handleToggle(record, checked)}
          />
        ),
      },
      {
        title: "Actions",
        key: "actions",
        width: 190,
        align: "right",
        render: (_, record) =>
          canManage ? (
            <Space>
              <Button
                size="small"
                icon={<SendOutlined />}
                loading={testingId === record.id}
                onClick={() => void handleTest(record)}
              >
                Test
              </Button>
              <Button
                type="text"
                icon={<EditOutlined />}
                aria-label="Edit connection"
                onClick={() => openEdit(record)}
              />
              <Popconfirm
                title="Delete this connection?"
                description="Workflows using it will stop delivering."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDelete(record.id)}
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="Delete connection"
                />
              </Popconfirm>
            </Space>
          ) : (
            <Typography.Text type="secondary">Read-only</Typography.Text>
          ),
      },
    ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          App Center
        </Typography.Title>
        <Typography.Text type="secondary">
          Connect external services so workflows can deliver notifications and
          reports. {canManage ? "" : "Only organization admins can manage connections."}
        </Typography.Text>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 12,
            marginTop: 16,
          }}
        >
          {PROVIDERS.map((p) => (
            <Card key={p.key} size="small" styles={{ body: { padding: 14 } }}>
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Space>
                  <span style={{ fontSize: 18, color: "#6a6d78" }}>{p.icon}</span>
                  <Typography.Text strong>{p.label}</Typography.Text>
                  {!p.available ? <Tag>Coming soon</Tag> : null}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {p.blurb}
                </Typography.Text>
                <Button
                  size="small"
                  block
                  disabled={!p.available || !canManage}
                  onClick={() => openCreate(p.key)}
                >
                  {p.available ? "Connect" : "Coming soon"}
                </Button>
              </Space>
            </Card>
          ))}
        </div>
      </Card>

      <Card
        title="Connected"
        styles={{ body: { paddingTop: 0 } }}
      >
        {(connections?.length ?? 0) === 0 && !isLoading ? (
          <Empty
            description="No connections yet"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ padding: "24px 0" }}
          />
        ) : (
          <Table<AppConnection>
            rowKey="id"
            loading={isLoading}
            columns={columns}
            dataSource={connections ?? []}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: "max-content" }}
          />
        )}
      </Card>

      <Modal
        title={
          modal?.editing
            ? `Edit ${activeDef?.label} connection`
            : `Connect ${activeDef?.label ?? ""}`
        }
        open={modal !== null}
        onOk={handleSubmit}
        okText={modal?.editing ? "Save" : "Connect"}
        confirmLoading={
          createConnection.isPending ||
          updateConnection.isPending ||
          saveSecrets.isPending
        }
        onCancel={closeModal}
        destroyOnHidden
      >
        <Form<ConnFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[
              { required: true, message: "Please enter a name." },
              { max: 200, message: "Name must be 200 characters or fewer." },
            ]}
          >
            <Input placeholder="Connection name" autoFocus />
          </Form.Item>

          {activeDef?.configFields.map((f) => (
            <Form.Item
              key={f.key}
              label={f.label}
              name={["config", f.key]}
              extra={f.help}
              rules={
                f.required
                  ? [{ required: true, message: `${f.label} is required.` }]
                  : undefined
              }
            >
              <Input placeholder={f.placeholder} />
            </Form.Item>
          ))}

          {activeDef?.secretFields.map((f) => (
            <Form.Item
              key={f.key}
              label={f.label}
              name={["secrets", f.key]}
              extra={f.help}
              rules={
                f.required && !modal?.editing
                  ? [{ required: true, message: `${f.label} is required.` }]
                  : undefined
              }
            >
              <Input.Password
                placeholder={modal?.editing ? "unchanged" : f.placeholder}
                autoComplete="new-password"
              />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </Space>
  );
}
