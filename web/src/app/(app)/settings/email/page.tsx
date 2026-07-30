"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Popconfirm,
  Skeleton,
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
  useResendConnection,
  useSaveResendConnection,
  useSaveResendKey,
  useDeleteResendKey,
  useTestResend,
  useEmailLog,
  type EmailLogEntry,
} from "@/features/email/use-email";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { useAuth } from "@/features/auth/use-auth";

const { Title, Text } = Typography;

const STATUS_COLOR: Record<EmailLogEntry["status"], string> = {
  sent: "green",
  failed: "red",
  skipped: "orange",
};

interface SenderFormValues {
  from_email: string;
  from_name?: string;
  reply_to?: string;
}

/**
 * Workspace email sender (Resend app): the from-address, the write-only API
 * key, a real test send, and the delivery log. Platform-wide scenario toggles
 * live in Admin → Email — both switches must agree before anything sends.
 */
export default function EmailSettingsPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { user } = useAuth();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const isAdmin = useIsTeamAdmin();

  const { data: connection, isLoading } = useResendConnection(teamId);
  const saveConnection = useSaveResendConnection();
  const saveKey = useSaveResendKey();
  const deleteKey = useDeleteResendKey();
  const testSend = useTestResend();
  const { data: log, isLoading: logLoading } = useEmailLog(
    isAdmin ? teamId : undefined,
  );

  const [form] = Form.useForm<SenderFormValues>();
  const [apiKey, setApiKey] = useState("");
  const [testTo, setTestTo] = useState("");

  // Hydrate the form when the stored sender arrives (or changes team).
  useEffect(() => {
    form.setFieldsValue({
      from_email: connection?.from_email ?? "",
      from_name: connection?.from_name ?? "",
      reply_to: connection?.reply_to ?? "",
    });
  }, [connection, form]);

  // Default the test recipient to the caller without an effect: state holds
  // only explicit edits; empty means "use my own email".
  const effectiveTestTo = testTo || user?.email || "";

  const handleSaveSender = async () => {
    if (!teamId) return;
    let values: SenderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // inline errors already shown
    }
    try {
      await saveConnection.mutateAsync({
        teamId,
        from_email: values.from_email,
        from_name: values.from_name || null,
        reply_to: values.reply_to || null,
        enabled: connection?.enabled ?? true,
      });
      message.success("Sender saved.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't save the sender.");
    }
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!teamId || !connection) return;
    try {
      await saveConnection.mutateAsync({
        teamId,
        from_email: connection.from_email,
        from_name: connection.from_name,
        reply_to: connection.reply_to,
        enabled,
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't update the sender.");
    }
  };

  const handleSaveKey = async () => {
    if (!teamId || !apiKey.trim()) return;
    try {
      await saveKey.mutateAsync({ teamId, apiKey: apiKey.trim() });
      setApiKey("");
      message.success("API key stored. It can't be viewed again — only replaced.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't save the API key.");
    }
  };

  const handleDeleteKey = async () => {
    if (!teamId) return;
    try {
      await deleteKey.mutateAsync({ teamId });
      message.success("API key removed. Sending is stopped.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't remove the API key.");
    }
  };

  const handleTest = async () => {
    if (!teamId || !effectiveTestTo.trim()) return;
    try {
      const result = await testSend.mutateAsync({ teamId, to: effectiveTestTo.trim() });
      if (result.ok) message.success("Test email sent — check the inbox.");
      else message.warning(result.reason ?? "The test didn't go through.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "The test couldn't run.");
    }
  };

  const logColumns: ColumnsType<EmailLogEntry> = [
    {
      title: "When",
      dataIndex: "created_at",
      key: "created_at",
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Scenario",
      dataIndex: "event_key",
      key: "event_key",
      width: 200,
      render: (v: string) => (
        <Text style={{ fontSize: 12, fontFamily: "monospace" }}>{v}</Text>
      ),
    },
    { title: "To", dataIndex: "to_email", key: "to_email" },
    { title: "Subject", dataIndex: "subject", key: "subject", ellipsis: true },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v: EmailLogEntry["status"], record) => (
        <Tooltip title={record.detail ?? undefined}>
          <Tag color={STATUS_COLOR[v]}>{v}</Tag>
        </Tooltip>
      ),
    },
  ];

  if (isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  const canSend = Boolean(connection?.has_key && connection?.enabled);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          Email sender
        </Title>
        <Text type="secondary">
          Connect your workspace&apos;s Resend account so Cubes can send email on
          its behalf. Which scenarios are allowed to send is decided platform-wide
          in Admin → Email.
          {isAdmin ? "" : " Only workspace admins can change these settings."}
        </Text>
      </div>

      <Card title="Sender" styles={{ body: { paddingTop: 16 } }}>
        <Form<SenderFormValues> form={form} layout="vertical" requiredMark={false} disabled={!isAdmin}>
          <Space style={{ display: "flex", flexWrap: "wrap" }} align="start">
            <Form.Item
              label="From address"
              name="from_email"
              rules={[
                { required: true, message: "Required." },
                { type: "email", message: "Enter a valid email." },
              ]}
              extra="The domain must be verified in Resend."
              style={{ minWidth: 260 }}
            >
              <Input placeholder="team@cubes.im" />
            </Form.Item>
            <Form.Item label="From name" name="from_name" style={{ minWidth: 200 }}>
              <Input placeholder="Cubes" />
            </Form.Item>
            <Form.Item label="Reply-to (optional)" name="reply_to" style={{ minWidth: 240 }}>
              <Input placeholder="support@cubes.im" />
            </Form.Item>
          </Space>
          <Space>
            <Button
              type="primary"
              loading={saveConnection.isPending}
              onClick={() => void handleSaveSender()}
            >
              Save sender
            </Button>
            {connection ? (
              <Space size={8}>
                <Switch
                  size="small"
                  checked={connection.enabled}
                  disabled={!isAdmin || saveConnection.isPending}
                  onChange={(checked) => void handleToggleEnabled(checked)}
                />
                <Text type="secondary">
                  {connection.enabled ? "Sending enabled" : "Sending disabled"}
                </Text>
              </Space>
            ) : null}
          </Space>
        </Form>
      </Card>

      <Card title="Resend API key" styles={{ body: { paddingTop: 16 } }}>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Space size={8} wrap>
            {connection?.has_key ? (
              <Tag color="green">Key stored</Tag>
            ) : (
              <Tag>No key</Tag>
            )}
            {connection?.last_test_at ? (
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                Last test:{" "}
                {connection.last_test_ok ? "OK" : (connection.last_test_error ?? "failed")}{" "}
                · {new Date(connection.last_test_at).toLocaleString()}
              </Text>
            ) : null}
          </Space>
          <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
            <Input.Password
              placeholder={connection?.has_key ? "Replace the stored key (re_…)" : "re_…"}
              value={apiKey}
              disabled={!isAdmin || !connection}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="new-password"
            />
            <Button
              type="primary"
              disabled={!isAdmin || !connection || !apiKey.trim()}
              loading={saveKey.isPending}
              onClick={() => void handleSaveKey()}
            >
              Save key
            </Button>
          </Space.Compact>
          {!connection ? (
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              Save the sender first, then add the key.
            </Text>
          ) : null}
          {connection?.has_key && isAdmin ? (
            <Popconfirm
              title="Remove the API key?"
              description="Sending stops immediately for this workspace."
              okText="Remove"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDeleteKey()}
            >
              <Button danger size="small" loading={deleteKey.isPending}>
                Remove key
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      </Card>

      <Card title="Send a test" styles={{ body: { paddingTop: 16 } }}>
        <Space.Compact style={{ width: "100%", maxWidth: 520 }}>
          <Input
            placeholder="you@company.com"
            value={effectiveTestTo}
            disabled={!isAdmin}
            onChange={(e) => setTestTo(e.target.value)}
          />
          <Button
            type="primary"
            disabled={!isAdmin || !canSend || !effectiveTestTo.trim()}
            loading={testSend.isPending}
            onClick={() => void handleTest()}
          >
            Send test
          </Button>
        </Space.Compact>
        {!canSend ? (
          <Text
            type="secondary"
            style={{ display: "block", marginTop: 8, fontSize: 12.5, color: token.colorTextTertiary }}
          >
            Needs a saved sender, a stored API key, and sending enabled.
          </Text>
        ) : null}
      </Card>

      {isAdmin ? (
        <Card title="Delivery log" styles={{ body: { paddingTop: 0 } }}>
          <Table<EmailLogEntry>
            rowKey="id"
            size="small"
            loading={logLoading}
            columns={logColumns}
            dataSource={log ?? []}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <Empty description="Nothing sent yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
            }}
          />
        </Card>
      ) : null}
    </Space>
  );
}
