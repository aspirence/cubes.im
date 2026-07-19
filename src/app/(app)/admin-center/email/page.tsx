"use client";

import { useEffect, useState } from "react";
import {
  App,
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Result,
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
import dayjs from "dayjs";
import { useIsPlatformAdmin } from "@/features/billing/use-pricing";
import { useAuth } from "@/features/auth/use-auth";
import {
  useEmailTriggers,
  useSetEmailTrigger,
  usePlatformSender,
  useSavePlatformSender,
  useSavePlatformKey,
  useDeletePlatformKey,
  useTestPlatformSender,
  usePlatformEmailLog,
  useEmailTemplate,
  useSaveEmailTemplate,
  useResetEmailTemplate,
  type EmailTrigger,
  type EmailLogEntry,
} from "@/features/email/use-email";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  PREVIEW_VARS,
  renderEmail,
} from "@/lib/email/templates";

const { Title, Text } = Typography;

function MIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/** Human labels + glyphs per seeded category. Unknown keys fall back gracefully. */
const CATEGORY_META: Record<string, { label: string; icon: string; blurb: string }> = {
  account: {
    label: "Account & access",
    icon: "key",
    blurb: "Sent when someone gains, changes, or is invited to access.",
  },
};

function categoryMeta(key: string) {
  return (
    CATEGORY_META[key] ?? {
      label: key.charAt(0).toUpperCase() + key.slice(1),
      icon: "mail",
      blurb: "",
    }
  );
}

/** The editable half of the template drawer — remounted (via key) whenever the
 *  stored override changes, so state initializes from props without effects. */
function TemplateEditorBody({
  trigger,
  initialSubject,
  initialBody,
  hasOverride,
  onClose,
}: {
  trigger: EmailTrigger;
  initialSubject: string;
  initialBody: string;
  hasOverride: boolean;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const saveTemplate = useSaveEmailTemplate();
  const resetTemplate = useResetEmailTemplate();
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);

  const variables = TEMPLATE_VARIABLES[trigger.event_key] ?? ["name", "email", "app_url"];
  const preview = renderEmail({ subject, body }, PREVIEW_VARS);

  const handleSave = async () => {
    if (!subject.trim() || !body.trim()) {
      message.warning("Subject and body are both required.");
      return;
    }
    try {
      await saveTemplate.mutateAsync({
        eventKey: trigger.event_key,
        subject,
        bodyHtml: body,
      });
      message.success("Template saved.");
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't save the template.");
    }
  };

  const handleReset = async () => {
    try {
      await resetTemplate.mutateAsync({ eventKey: trigger.event_key });
      message.success("Reset to the default template.");
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't reset the template.");
    }
  };

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 340px", minWidth: 320 }}>
        <Text type="secondary" style={{ display: "block", marginBottom: 6, fontSize: 12.5 }}>
          Subject
        </Text>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        <Text type="secondary" style={{ display: "block", margin: "14px 0 6px", fontSize: 12.5 }}>
          Body (HTML — wrapped in the branded shell automatically)
        </Text>
        <Input.TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          autoSize={{ minRows: 14, maxRows: 24 }}
          style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}
        />
        <div style={{ marginTop: 10 }}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>
            Variables:
          </Text>
          {variables.map((v) => (
            <Tag
              key={v}
              style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, cursor: "pointer" }}
              onClick={() => setBody((b) => `${b}{{${v}}}`)}
            >{`{{${v}}}`}</Tag>
          ))}
        </div>
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" loading={saveTemplate.isPending} onClick={() => void handleSave()}>
            Save template
          </Button>
          {hasOverride ? (
            <Popconfirm
              title="Reset to default?"
              description="Your customized subject and body are discarded."
              okText="Reset"
              onConfirm={() => void handleReset()}
            >
              <Button loading={resetTemplate.isPending}>Reset to default</Button>
            </Popconfirm>
          ) : null}
        </Space>
      </div>
      <div style={{ flex: "1 1 380px", minWidth: 340 }}>
        <Text type="secondary" style={{ display: "block", marginBottom: 6, fontSize: 12.5 }}>
          Live preview · subject: <Text strong style={{ fontSize: 12.5 }}>{preview.subject || "—"}</Text>
        </Text>
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={preview.html}
          style={{
            width: "100%",
            height: 480,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
            background: "#f4f5f8",
          }}
        />
      </div>
    </div>
  );
}

/** Drawer wrapper: loads the stored override, then mounts the editor. */
function TemplateEditor({
  trigger,
  open,
  onClose,
}: {
  trigger: EmailTrigger;
  open: boolean;
  onClose: () => void;
}) {
  const { data: override, isLoading } = useEmailTemplate(
    open ? trigger.event_key : undefined,
  );
  const defaults = DEFAULT_TEMPLATES[trigger.event_key];

  return (
    <Drawer
      title={`Template — ${trigger.label}`}
      open={open}
      onClose={onClose}
      width={960}
      destroyOnHidden
    >
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <TemplateEditorBody
          key={`${trigger.event_key}:${override?.updated_at ?? "default"}`}
          trigger={trigger}
          initialSubject={override?.subject ?? defaults?.subject ?? trigger.label}
          initialBody={override?.body_html ?? defaults?.body ?? "<p>…</p>"}
          hasOverride={Boolean(override)}
          onClose={onClose}
        />
      )}
    </Drawer>
  );
}

function TriggerRow({ trigger }: { trigger: EmailTrigger }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [editingTemplate, setEditingTemplate] = useState(false);
  const setTrigger = useSetEmailTrigger();

  const onToggle = async (enabled: boolean) => {
    try {
      await setTrigger.mutateAsync({ eventKey: trigger.event_key, enabled });
      message.success(
        enabled
          ? `"${trigger.label}" can now send.`
          : `"${trigger.label}" is off for every workspace.`,
      );
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Couldn't update this scenario.",
      );
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "14px 2px",
        borderTop: `1px solid ${token.colorSplit}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
          {trigger.label}
        </div>
        <div style={{ marginTop: 2, fontSize: 12.5, color: token.colorTextSecondary }}>
          {trigger.description}
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            color: token.colorTextQuaternary,
          }}
        >
          {trigger.event_key}
          {trigger.updated_at
            ? ` · updated ${dayjs(trigger.updated_at).format("MMM D, YYYY")}`
            : null}
        </div>
      </div>
      <Button
        type="text"
        size="small"
        style={{ color: token.colorTextSecondary }}
        icon={<MIcon name="edit_note" size={16} />}
        onClick={() => setEditingTemplate(true)}
      >
        Template
      </Button>
      <Switch
        checked={trigger.enabled}
        loading={setTrigger.isPending && setTrigger.variables?.eventKey === trigger.event_key}
        onChange={onToggle}
        aria-label={`${trigger.label} — ${trigger.enabled ? "on" : "off"}`}
      />
      <TemplateEditor
        trigger={trigger}
        open={editingTemplate}
        onClose={() => setEditingTemplate(false)}
      />
    </div>
  );
}

const LOG_STATUS_COLOR: Record<EmailLogEntry["status"], string> = {
  sent: "green",
  failed: "red",
  skipped: "orange",
};

interface PlatformSenderFormValues {
  from_email: string;
  from_name?: string;
  reply_to?: string;
}

/**
 * Cubes' OWN sender — the identity platform-scope emails (signup welcome, …)
 * go out from, independent of any workspace's Resend account. Includes its own
 * test send so a super admin can verify the platform pipe end-to-end.
 */
function PlatformSenderCard() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { user } = useAuth();
  const { data: sender, isLoading } = usePlatformSender();
  const saveSender = useSavePlatformSender();
  const saveKey = useSavePlatformKey();
  const deleteKey = useDeletePlatformKey();
  const testSender = useTestPlatformSender();
  const { data: log, isLoading: logLoading } = usePlatformEmailLog();

  const [form] = Form.useForm<PlatformSenderFormValues>();
  const [apiKey, setApiKey] = useState("");
  const [testTo, setTestTo] = useState("");
  const effectiveTestTo = testTo || user?.email || "";

  useEffect(() => {
    form.setFieldsValue({
      from_email: sender?.from_email ?? "",
      from_name: sender?.from_name ?? "",
      reply_to: sender?.reply_to ?? "",
    });
  }, [sender, form]);

  const handleSave = async () => {
    let values: PlatformSenderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      await saveSender.mutateAsync({
        from_email: values.from_email,
        from_name: values.from_name || null,
        reply_to: values.reply_to || null,
        enabled: sender?.enabled ?? true,
      });
      message.success("Platform sender saved.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't save the sender.");
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!sender) return;
    try {
      await saveSender.mutateAsync({
        from_email: sender.from_email,
        from_name: sender.from_name,
        reply_to: sender.reply_to,
        enabled,
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't update the sender.");
    }
  };

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    try {
      await saveKey.mutateAsync({ apiKey: apiKey.trim() });
      setApiKey("");
      message.success("API key stored. It can't be viewed again — only replaced.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't save the API key.");
    }
  };

  const handleTest = async () => {
    if (!effectiveTestTo.trim()) return;
    try {
      const result = await testSender.mutateAsync({ to: effectiveTestTo.trim() });
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
      width: 165,
      render: (v: string) => dayjs(v).format("MMM D, YYYY HH:mm"),
    },
    {
      title: "Scenario",
      dataIndex: "event_key",
      key: "event_key",
      width: 200,
      render: (v: string) => (
        <Text style={{ fontSize: 12, fontFamily: "var(--font-geist-mono), monospace" }}>{v}</Text>
      ),
    },
    { title: "To", dataIndex: "to_email", key: "to_email" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v: EmailLogEntry["status"], record) => (
        <Tooltip title={record.detail ?? undefined}>
          <Tag color={LOG_STATUS_COLOR[v]}>{v}</Tag>
        </Tooltip>
      ),
    },
  ];

  if (isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 3 }} />
      </Card>
    );
  }

  const canSend = Boolean(sender?.has_key && sender?.enabled);

  return (
    <Card
      title={
        <Space size={8}>
          <MIcon name="forward_to_inbox" size={18} color={token.colorPrimary} />
          <span>Platform sender</span>
          {sender?.has_key ? <Tag color="green">Key stored</Tag> : <Tag>No key</Tag>}
        </Space>
      }
      extra={
        sender ? (
          <Space size={8}>
            <Switch
              size="small"
              checked={sender.enabled}
              disabled={saveSender.isPending}
              onChange={(checked) => void handleToggle(checked)}
            />
            <Text type="secondary" style={{ fontSize: 12.5 }}>
              {sender.enabled ? "Enabled" : "Disabled"}
            </Text>
          </Space>
        ) : null
      }
    >
      <Text type="secondary" style={{ display: "block", marginBottom: 14, fontSize: 12.5 }}>
        Cubes&apos; own from-address for platform emails — the signup welcome and
        anything else sent before a user has a workspace sender.
      </Text>

      <Form<PlatformSenderFormValues> form={form} layout="vertical" requiredMark={false}>
        <Space style={{ display: "flex", flexWrap: "wrap" }} align="start">
          <Form.Item
            label="From address"
            name="from_email"
            rules={[
              { required: true, message: "Required." },
              { type: "email", message: "Enter a valid email." },
            ]}
            style={{ minWidth: 240 }}
          >
            <Input placeholder="no-reply@cubes.im" />
          </Form.Item>
          <Form.Item label="From name" name="from_name" style={{ minWidth: 180 }}>
            <Input placeholder="Cubes" />
          </Form.Item>
          <Form.Item label="Reply-to (optional)" name="reply_to" style={{ minWidth: 220 }}>
            <Input placeholder="support@cubes.im" />
          </Form.Item>
        </Space>
        <Button
          type="primary"
          loading={saveSender.isPending}
          onClick={() => void handleSave()}
        >
          Save sender
        </Button>
      </Form>

      <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Space.Compact style={{ flex: 1, minWidth: 280, maxWidth: 420 }}>
          <Input.Password
            placeholder={sender?.has_key ? "Replace the stored key (re_…)" : "Resend API key (re_…)"}
            value={apiKey}
            disabled={!sender}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
          />
          <Button
            disabled={!sender || !apiKey.trim()}
            loading={saveKey.isPending}
            onClick={() => void handleSaveKey()}
          >
            Save key
          </Button>
        </Space.Compact>
        <Space.Compact style={{ flex: 1, minWidth: 280, maxWidth: 420 }}>
          <Input
            placeholder="test recipient"
            value={effectiveTestTo}
            onChange={(e) => setTestTo(e.target.value)}
          />
          <Button
            type="primary"
            disabled={!canSend || !effectiveTestTo.trim()}
            loading={testSender.isPending}
            onClick={() => void handleTest()}
          >
            Send test
          </Button>
        </Space.Compact>
        {sender?.has_key ? (
          <Popconfirm
            title="Remove the platform API key?"
            description="Platform emails (incl. signup welcome) stop immediately."
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => void deleteKey.mutateAsync().catch((err: unknown) => {
              message.error(err instanceof Error ? err.message : "Couldn't remove the key.");
            })}
          >
            <Button danger loading={deleteKey.isPending}>Remove key</Button>
          </Popconfirm>
        ) : null}
      </div>
      {sender?.last_test_at ? (
        <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          Last test: {sender.last_test_ok ? "OK" : (sender.last_test_error ?? "failed")} ·{" "}
          {dayjs(sender.last_test_at).format("MMM D, YYYY HH:mm")}
        </Text>
      ) : null}
      {!sender ? (
        <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          Save the sender first, then add the key.
        </Text>
      ) : null}

      <Table<EmailLogEntry>
        rowKey="id"
        size="small"
        style={{ marginTop: 18 }}
        loading={logLoading}
        columns={logColumns}
        dataSource={log ?? []}
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        scroll={{ x: "max-content" }}
        locale={{
          emptyText: (
            <Empty description="No platform emails yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ),
        }}
      />
    </Card>
  );
}

/**
 * The platform-wide email console.
 *
 * This is the OUTER of two switches. Turning a scenario off here stops it for
 * every workspace on the platform, no matter how each is configured. Turning it
 * on only *permits* the send — each workspace still needs its own Resend key and
 * from-address before anything actually goes out. The two are AND-ed at send
 * time and neither can override the other, so the copy below says exactly that
 * rather than implying this page alone controls delivery.
 *
 * `useIsPlatformAdmin` here is convenience only — RLS (`is_platform_admin()`)
 * on platform_email_triggers is the real gate.
 */
export default function AdminEmailPage() {
  const { token } = theme.useToken();
  const { data: isPlatformAdmin, isLoading: adminLoading } = useIsPlatformAdmin();
  const { data: triggers, isLoading, isError, error } = useEmailTriggers();

  if (adminLoading) {
    return (
      <div style={{ padding: 4 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <Result
        status="403"
        title="Superadmins only"
        subTitle="This email console is for Cubes platform administrators."
      />
    );
  }

  const byCategory = new Map<string, EmailTrigger[]>();
  for (const t of triggers ?? []) {
    byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  }
  const enabledCount = (triggers ?? []).filter((t) => t.enabled).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          Email
        </Title>
        <Text type="secondary">
          Decide which emails Cubes is allowed to send, across every workspace on
          the platform.
        </Text>
      </div>

      <PlatformSenderCard />

      {isError ? (
        <Alert
          type="error"
          showIcon
          message="Couldn't load the email scenarios"
          description={error instanceof Error ? error.message : "Please try again."}
        />
      ) : isLoading ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (triggers ?? []).length === 0 ? (
        <Card>
          <Text type="secondary">No email scenarios are registered yet.</Text>
        </Card>
      ) : (
        <>
          <Text style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
            {enabledCount} of {triggers?.length} scenarios are allowed to send.
          </Text>
          {[...byCategory.entries()].map(([category, rows]) => {
            const meta = categoryMeta(category);
            return (
              <Card key={category} styles={{ body: { padding: "16px 18px 6px" } }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      background: token.colorPrimaryBg,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    <MIcon name={meta.icon} size={18} color="#4a4ad0" />
                  </span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>
                      {meta.label}
                    </div>
                    {meta.blurb ? (
                      <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                        {meta.blurb}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  {rows.map((t) => (
                    <TriggerRow key={t.event_key} trigger={t} />
                  ))}
                </div>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
