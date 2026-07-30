"use client";

import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ApiOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  useAttendanceWebhooks,
  useCreateAttendanceWebhook,
  useUpdateAttendanceWebhook,
  useDeleteAttendanceWebhook,
  useRotateAttendanceWebhook,
  useAttendanceWebhookEvents,
  type AttendanceWebhookRow,
  type AttendanceWebhookEventRow,
} from "@/features/attendance-webhook/use-attendance-webhooks";
import {
  DEFAULT_ATTENDANCE_WEBHOOK_CONFIG,
  isValidTimezone,
  resolveAttendanceWebhookConfig,
  type AttendanceWebhookConfig,
} from "@/lib/attendance-webhook/config";

const { Text } = Typography;

/** The public URL an external system POSTs punches to. */
function endpointUrl(id: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? "");
  return `${origin}/api/webhooks/attendance/${id}`;
}

/**
 * Copies with an honest result. navigator.clipboard is undefined on non-secure
 * contexts (plain-HTTP LAN deployments) and writeText can reject — a false
 * "copied" toast on the shown-once credentials modal would lose the secret for
 * good, so fall back to the legacy path and report failure truthfully.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Credentials modal — token + secret are visible exactly once.               */
/* -------------------------------------------------------------------------- */

interface MintedCredentials {
  webhookId: string;
  token: string;
  signingSecret: string;
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const { message } = App.useApp();
  return (
    <div style={{ marginBottom: 12 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <Space.Compact style={{ width: "100%" }}>
        <Input readOnly value={value} style={{ fontFamily: "monospace", fontSize: 12 }} />
        <Tooltip title="Copy">
          <Button
            icon={<CopyOutlined />}
            onClick={() => {
              void copyText(value).then((ok) =>
                ok
                  ? message.success(`${label} copied.`)
                  : message.error("Copy failed — select the value and copy it manually."),
              );
            }}
          />
        </Tooltip>
      </Space.Compact>
    </div>
  );
}

function CredentialsModal({
  minted,
  onClose,
}: {
  minted: MintedCredentials | null;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Webhook credentials"
      open={minted !== null}
      onCancel={onClose}
      footer={<Button type="primary" onClick={onClose}>Done</Button>}
      destroyOnHidden
    >
      {minted ? (
        <>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Shown once"
            description="Copy the token and signing secret now — they are stored hashed and cannot be retrieved again. Rotating issues new ones."
          />
          <CredentialRow label="Endpoint URL" value={endpointUrl(minted.webhookId)} />
          <CredentialRow label="Token" value={minted.token} />
          <CredentialRow label="Signing secret" value={minted.signingSecret} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Send the token as an <code>x-webhook-token</code> header,{" "}
            <code>Authorization: Bearer</code>, or <code>?token=</code> query
            param. Signatures (optional) are HMAC-SHA256 over{" "}
            <code>{"<unix_ts>.<body>"}</code> in an <code>X-Signature</code>{" "}
            header.
          </Text>
        </>
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Create / edit modal — the fully customizable payload mapping.              */
/* -------------------------------------------------------------------------- */

interface WebhookFormValues {
  name: string;
  employee_match: AttendanceWebhookConfig["employee_match"];
  employee_field: string;
  event_field: string;
  in_values: string[];
  out_values: string[];
  default_direction: AttendanceWebhookConfig["default_direction"];
  timestamp_field: string;
  events_field: string;
  timezone: string;
  require_signature: boolean;
}

function configFromValues(v: WebhookFormValues): AttendanceWebhookConfig {
  return resolveAttendanceWebhookConfig({
    employee_match: v.employee_match,
    employee_field: v.employee_field,
    event_field: v.event_field,
    in_values: v.in_values,
    out_values: v.out_values,
    default_direction: v.default_direction,
    timestamp_field: v.timestamp_field,
    events_field: v.events_field,
    timezone: v.timezone,
    require_signature: v.require_signature,
  });
}

/* -------------------------------------------------------------------------- */
/* Delivery log drawer.                                                        */
/* -------------------------------------------------------------------------- */

const OUTCOME_COLOR: Record<string, string> = {
  processed: "green",
  ignored: "orange",
  error: "red",
};

function EventsDrawer({
  webhook,
  onClose,
}: {
  webhook: AttendanceWebhookRow | null;
  onClose: () => void;
}) {
  const { data: events, isLoading } = useAttendanceWebhookEvents(webhook?.id);

  const columns: ColumnsType<AttendanceWebhookEventRow> = [
    {
      title: "Received",
      dataIndex: "received_at",
      key: "received_at",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Employee key",
      dataIndex: "employee_key",
      key: "employee_key",
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: "Punch",
      dataIndex: "direction",
      key: "direction",
      width: 80,
      render: (v: string | null) =>
        v ? <Tag>{v.toUpperCase()}</Tag> : <Text type="secondary">auto</Text>,
    },
    {
      title: "Outcome",
      dataIndex: "outcome",
      key: "outcome",
      width: 110,
      render: (v: string, record) => (
        <Tooltip title={record.error ?? undefined}>
          <Tag color={OUTCOME_COLOR[v] ?? "default"}>{v}</Tag>
        </Tooltip>
      ),
    },
  ];

  return (
    <Drawer
      title={webhook ? `Deliveries — ${webhook.name}` : "Deliveries"}
      open={webhook !== null}
      onClose={onClose}
      width={640}
      destroyOnHidden
    >
      <Table<AttendanceWebhookEventRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={events ?? []}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        expandable={{
          expandedRowRender: (record) => (
            <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(record.payload, null, 2)}
            </pre>
          ),
          rowExpandable: (record) => record.payload !== null,
        }}
        locale={{
          emptyText: (
            <Empty
              description="No deliveries yet"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
      />
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab.                                                                        */
/* -------------------------------------------------------------------------- */

export default function WebhooksTab() {
  const { token: themeToken } = theme.useToken();
  const { message } = App.useApp();
  const { data: webhooks, isLoading } = useAttendanceWebhooks();
  const createWebhook = useCreateAttendanceWebhook();
  const updateWebhook = useUpdateAttendanceWebhook();
  const deleteWebhook = useDeleteAttendanceWebhook();
  const rotateWebhook = useRotateAttendanceWebhook();

  const [modal, setModal] = useState<{ editing: AttendanceWebhookRow | null } | null>(null);
  const [minted, setMinted] = useState<MintedCredentials | null>(null);
  const [logFor, setLogFor] = useState<AttendanceWebhookRow | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [form] = Form.useForm<WebhookFormValues>();

  const openCreate = () => {
    setModal({ editing: null });
    form.setFieldsValue({
      name: "Attendance device",
      ...DEFAULT_ATTENDANCE_WEBHOOK_CONFIG,
    });
  };

  const openEdit = (webhook: AttendanceWebhookRow) => {
    setModal({ editing: webhook });
    form.setFieldsValue({
      name: webhook.name,
      ...resolveAttendanceWebhookConfig(webhook.config),
    });
  };

  const closeModal = () => {
    setModal(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    if (!modal) return;
    let values: WebhookFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd already renders the inline field errors
    }
    const config = configFromValues(values);
    try {
      if (modal.editing) {
        await updateWebhook.mutateAsync({
          id: modal.editing.id,
          patch: { name: values.name.trim(), config },
        });
        message.success("Webhook updated.");
      } else {
        const result = await createWebhook.mutateAsync({
          name: values.name.trim(),
          config,
        });
        setMinted({
          webhookId: result.webhook.id,
          token: result.token,
          signingSecret: result.signingSecret,
        });
      }
      closeModal();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save webhook.");
    }
  };

  const handleRotate = async (webhook: AttendanceWebhookRow) => {
    setRotatingId(webhook.id);
    try {
      const result = await rotateWebhook.mutateAsync(webhook.id);
      setMinted({
        webhookId: webhook.id,
        token: result.token,
        signingSecret: result.signingSecret,
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to rotate credentials.");
    } finally {
      setRotatingId(null);
    }
  };

  const handleToggle = async (webhook: AttendanceWebhookRow, enabled: boolean) => {
    try {
      await updateWebhook.mutateAsync({ id: webhook.id, patch: { enabled } });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to update webhook.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhook.mutateAsync(id);
      message.success("Webhook deleted.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to delete webhook.");
    }
  };

  const columns: ColumnsType<AttendanceWebhookRow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string, record) => (
        <Space direction="vertical" size={0}>
          <Space>
            <ApiOutlined style={{ color: themeToken.colorTextTertiary }} />
            <Text strong>{name}</Text>
          </Space>
          <Text type="secondary" style={{ fontSize: 12, fontFamily: "monospace" }}>
            {record.token_prefix}…
          </Text>
        </Space>
      ),
    },
    {
      title: "Endpoint",
      key: "endpoint",
      render: (_, record) => (
        <Space>
          <Text
            type="secondary"
            style={{ fontSize: 12, fontFamily: "monospace" }}
            ellipsis
          >
            /api/webhooks/attendance/{record.id.slice(0, 8)}…
          </Text>
          <Tooltip title="Copy full URL">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                void copyText(endpointUrl(record.id)).then((ok) =>
                  ok
                    ? message.success("Endpoint URL copied.")
                    : message.error("Copy failed — copy the URL manually."),
                );
              }}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: "Received",
      key: "received",
      width: 160,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.received_count}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.last_received_at
              ? new Date(record.last_received_at).toLocaleString()
              : "never"}
          </Text>
        </Space>
      ),
    },
    {
      title: "Status",
      key: "status",
      width: 100,
      render: (_, record) =>
        record.last_error ? (
          <Tooltip title={record.last_error}>
            <Tag color="red">error</Tag>
          </Tooltip>
        ) : record.last_received_at ? (
          <Tag color="green">ok</Tag>
        ) : (
          <Tag>new</Tag>
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
          disabled={updateWebhook.isPending}
          onChange={(checked) => void handleToggle(record, checked)}
        />
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 190,
      align: "right",
      render: (_, record) => (
        <Space>
          <Tooltip title="Delivery log">
            <Button
              type="text"
              icon={<HistoryOutlined />}
              aria-label="Delivery log"
              onClick={() => setLogFor(record)}
            />
          </Tooltip>
          <Tooltip title="Edit mapping">
            <Button
              type="text"
              icon={<EditOutlined />}
              aria-label="Edit webhook"
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Rotate credentials?"
            description="The current token and signing secret stop working immediately."
            okText="Rotate"
            onConfirm={() => void handleRotate(record)}
          >
            <Tooltip title="Rotate token & secret">
              <Button
                type="text"
                icon={<ReloadOutlined />}
                loading={rotatingId === record.id}
                aria-label="Rotate credentials"
              />
            </Tooltip>
          </Popconfirm>
          <Popconfirm
            title="Delete this webhook?"
            description="Devices using it will stop syncing attendance."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete webhook"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Text type="secondary">
          Receive clock punches from biometric devices, door controllers, or
          any external system — with a fully customizable payload mapping.
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New webhook
        </Button>
      </Space>

      <Table<AttendanceWebhookRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={webhooks ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: "max-content" }}
        locale={{
          emptyText: (
            <Empty
              description="No attendance webhooks yet"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                Create your first webhook
              </Button>
            </Empty>
          ),
        }}
      />

      <Modal
        title={modal?.editing ? "Edit attendance webhook" : "New attendance webhook"}
        open={modal !== null}
        onOk={handleSubmit}
        okText={modal?.editing ? "Save" : "Create"}
        confirmLoading={createWebhook.isPending || updateWebhook.isPending}
        onCancel={closeModal}
        width={560}
        destroyOnHidden
      >
        <Form<WebhookFormValues> form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Name"
            name="name"
            rules={[
              { required: true, message: "Please enter a name." },
              { max: 200, message: "Name must be 200 characters or fewer." },
            ]}
          >
            <Input placeholder="e.g. Office biometric device" autoFocus />
          </Form.Item>

          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Employee matching
          </Typography.Text>
          <Space style={{ display: "flex" }} align="start">
            <Form.Item
              label="Match payload key against"
              name="employee_match"
              style={{ flex: 1, minWidth: 220 }}
            >
              <Select
                options={[
                  { value: "employee_code", label: "Employee code" },
                  { value: "work_email", label: "Work email" },
                  { value: "employee_id", label: "Employee ID (uuid)" },
                ]}
              />
            </Form.Item>
            <Form.Item
              label="Employee field (dot-path)"
              name="employee_field"
              rules={[{ required: true, message: "Required." }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="employee" />
            </Form.Item>
          </Space>

          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Punch type
          </Typography.Text>
          <Form.Item
            label="Event field (dot-path; empty = always use fallback)"
            name="event_field"
          >
            <Input placeholder="event" />
          </Form.Item>
          <Space style={{ display: "flex" }} align="start">
            <Form.Item label="Values meaning IN" name="in_values" style={{ flex: 1 }}>
              <Select mode="tags" tokenSeparators={[","]} placeholder="in, checkin…" />
            </Form.Item>
            <Form.Item label="Values meaning OUT" name="out_values" style={{ flex: 1 }}>
              <Select mode="tags" tokenSeparators={[","]} placeholder="out, checkout…" />
            </Form.Item>
          </Space>
          <Form.Item
            label="Fallback when the event field doesn't match"
            name="default_direction"
            extra="Auto = the day's first punch clocks in, later punches clock out."
          >
            <Select
              options={[
                { value: "auto", label: "Auto (first in, then out)" },
                { value: "in", label: "Always clock IN" },
                { value: "out", label: "Always clock OUT" },
              ]}
            />
          </Form.Item>

          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Timing & payload shape
          </Typography.Text>
          <Space style={{ display: "flex" }} align="start">
            <Form.Item
              label="Timestamp field (dot-path)"
              name="timestamp_field"
              extra="ISO 8601 or unix time; empty = arrival time."
              style={{ flex: 1 }}
            >
              <Input placeholder="timestamp" />
            </Form.Item>
            <Form.Item
              label="Timezone (IANA)"
              name="timezone"
              rules={[
                { required: true, message: "Required." },
                {
                  validator: (_, v: string) =>
                    !v || isValidTimezone(v.trim())
                      ? Promise.resolve()
                      : Promise.reject(new Error("Unknown IANA timezone.")),
                },
              ]}
              extra="Sets which calendar day a punch lands on."
              style={{ flex: 1 }}
            >
              <Input placeholder="Asia/Kolkata" />
            </Form.Item>
          </Space>
          <Form.Item
            label="Events array field (dot-path, for batch payloads)"
            name="events_field"
            extra="Empty = the body itself is the event (or an array of events)."
          >
            <Input placeholder="e.g. data.punches" />
          </Form.Item>

          <Form.Item
            label="Require HMAC signature"
            name="require_signature"
            valuePropName="checked"
            extra="Reject deliveries without a valid X-Signature header."
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <CredentialsModal minted={minted} onClose={() => setMinted(null)} />
      <EventsDrawer webhook={logFor} onClose={() => setLogFor(null)} />
    </Space>
  );
}
