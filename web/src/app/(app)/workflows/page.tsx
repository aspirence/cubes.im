"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  useCreateWorkflow,
  useDeleteWorkflow,
  useIsTeamAdmin,
  useUpdateWorkflow,
  useWorkflows,
  type Workflow,
} from "@/features/workflows/use-workflows";
import { useRunNow } from "@/features/workflows/use-workflow-runs";
import {
  WORKFLOW_TEMPLATES,
  templateWhen,
  useCreateWorkflowFromTemplate,
  workflowTemplateByKey,
  type WorkflowTemplateKey,
} from "@/features/workflows/workflow-templates";
import { normalizeScheduleConfig } from "@/features/workflows/schedule-trigger-form";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";
import { describeSchedule, workflowEventByKey } from "@/lib/workflows/app-action-catalog";
import { browserTimeZone, formatInZone } from "@/lib/workflows/schedule";

/** Material Symbols Rounded glyph. */
function MIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const APP_NAMES: Record<string, string> = { sheets: "Sheets", crm: "CRM" };

function triggerText(wf: Workflow): string {
  if (wf.trigger_type === "schedule") {
    const cfg = normalizeScheduleConfig(wf.trigger_config);
    return describeSchedule(cfg);
  }
  if (wf.trigger_type === "webhook") return "On a webhook";
  if (wf.trigger_type === "event") {
    const key = ((wf.trigger_config ?? {}) as { event_key?: string }).event_key ?? "";
    return workflowEventByKey(key)?.label ?? "On an event";
  }
  return "Manual";
}

/**
 * "New from template": the ready-made CRM workflows. A template whose apps
 * are not installed is shown but cannot be created.
 */
function TemplateModal({
  open,
  initialKey,
  onClose,
}: {
  open: boolean;
  initialKey: WorkflowTemplateKey | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: installed } = useInstalledApps();
  const create = useCreateWorkflowFromTemplate();
  const [selected, setSelected] = useState<WorkflowTemplateKey | null>(initialKey);
  const tpl = workflowTemplateByKey(selected);
  const zone = browserTimeZone();

  const missingApps = (appKeys: string[]) =>
    appKeys.filter((k) => !installed?.some((i) => i.app_key === k && i.enabled));

  const handleCreate = async () => {
    if (!tpl) return;
    try {
      const { id } = await create.mutateAsync({ templateKey: tpl.key, timezone: zone });
      message.success(
        tpl.trigger.type === "webhook"
          ? `"${tpl.name}" created — copy its URL from the trigger panel and send a test post.`
          : `"${tpl.name}" created — ${templateWhen(tpl, zone).toLowerCase()}.`,
      );
      onClose();
      router.push(`/workflows/${id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not create the workflow.");
    }
  };

  const missing = tpl ? missingApps(tpl.apps) : [];

  return (
    <Modal
      title="New workflow from a template"
      open={open}
      onCancel={onClose}
      width={640}
      okText="Create workflow"
      okButtonProps={{ disabled: !tpl || missing.length > 0 }}
      confirmLoading={create.isPending}
      onOk={() => void handleCreate()}
      destroyOnHidden
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {WORKFLOW_TEMPLATES.map((t) => {
          const needs = missingApps(t.apps);
          const isSel = t.key === selected;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSelected(t.key)}
              style={{
                display: "flex",
                gap: 12,
                textAlign: "left",
                padding: 14,
                borderRadius: 12,
                cursor: "pointer",
                background: token.colorBgContainer,
                border: `1.5px solid ${isSel ? token.colorPrimary : token.colorBorderSecondary}`,
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 36,
                  flex: "none",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: token.colorPrimaryBg,
                  color: token.colorPrimary,
                }}
              >
                <MIcon name={t.icon} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, color: token.colorText }}>
                  {t.name}
                  <Tag style={{ margin: 0, fontWeight: 400 }}>{templateWhen(t, zone)}</Tag>
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: token.colorTextSecondary, marginTop: 3, lineHeight: 1.5 }}>
                  {t.description}
                </span>
                {needs.length ? (
                  <span style={{ display: "block", fontSize: 12, color: token.colorWarningText, marginTop: 4 }}>
                    Needs the {needs.map((k) => APP_NAMES[k] ?? k).join(" and ")} app
                    {needs.length > 1 ? "s" : ""} installed.
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}

        {missing.length > 0 ? (
          <Alert
            type="info"
            showIcon
            message={
              <span>
                Install {missing.map((k) => APP_NAMES[k] ?? k).join(" and ")} from the{" "}
                <Link href="/apps">App Center</Link> to use this template.
              </span>
            }
          />
        ) : null}

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Times are in your time zone ({zone}); you can change the trigger, the mapped fields, and add conditions
          or notifications afterwards.
        </Typography.Text>
      </div>
    </Modal>
  );
}

function WorkflowsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: workflows, isLoading } = useWorkflows();
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const runNow = useRunNow();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const canManage = Boolean(isTeamAdmin);

  // /workflows?template=<key> opens the template picker preselected, so other
  // surfaces can deep-link to a ready-made workflow.
  const templateParam = searchParams.get("template");
  const deepLinkedTemplate = useMemo(
    () => (workflowTemplateByKey(templateParam)?.key ?? null) as WorkflowTemplateKey | null,
    [templateParam],
  );
  const [pickerOpen, setTemplateOpen] = useState(false);
  const [dismissedLink, setDismissedLink] = useState(false);
  const templateOpen = pickerOpen || (Boolean(deepLinkedTemplate) && canManage && !dismissedLink);

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

  const handleRun = async (wf: Workflow) => {
    setRunningId(wf.id);
    try {
      const { status } = await runNow.mutateAsync(wf.id);
      if (status === "error") message.error("The run failed — open the workflow to see which step stopped it.");
      else message.success("Run started — open the workflow to see its history.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setRunningId(null);
    }
  };

  const columns: ColumnsType<Workflow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string, record) => <Link href={`/workflows/${record.id}`}>{name}</Link>,
    },
    {
      title: "Trigger",
      key: "trigger",
      render: (_, wf) => (
        <div style={{ lineHeight: 1.4 }}>
          <Tag style={{ margin: 0 }}>{triggerText(wf)}</Tag>
          {wf.trigger_type === "schedule" && wf.enabled && wf.next_run_at ? (
            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
              Next: {formatInZone(new Date(wf.next_run_at), browserTimeZone())}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "Last run",
      dataIndex: "last_run_at",
      key: "last",
      width: 170,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : "—"),
    },
    { title: "Runs", dataIndex: "run_count", key: "runs", width: 70 },
    {
      title: "Enabled",
      key: "enabled",
      width: 90,
      render: (_, record) => (
        <Switch
          size="small"
          checked={record.enabled}
          disabled={!canManage}
          onChange={(checked) =>
            void updateWorkflow
              .mutateAsync({ id: record.id, enabled: checked })
              .catch((err: unknown) => message.error(err instanceof Error ? err.message : "Failed to update."))
          }
        />
      ),
    },
    {
      title: "",
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
          {canManage ? (
            <Popconfirm
              title="Delete this workflow?"
              description="Its run history goes with it."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() =>
                deleteWorkflow
                  .mutateAsync(record.id)
                  .then(() => message.success("Workflow deleted."))
                  .catch((err: unknown) => message.error(err instanceof Error ? err.message : "Failed to delete."))
              }
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
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: "-.4px", color: token.colorText }}>
            Workflows
          </h1>
          <div style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
            Chain steps across your apps — on a schedule, on an event or on demand. Turn a web form into a CRM
            deal, keep a Google Sheet current, get told when a deal is won.
          </div>
        </div>
        <Space wrap>
          <Tooltip title={canManage ? undefined : "Only workspace admins can create workflows."}>
            <Button icon={<MIcon name="auto_awesome" size={16} />} disabled={!canManage} onClick={() => setTemplateOpen(true)}>
              New from template
            </Button>
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={() => setCreateOpen(true)}>
            New workflow
          </Button>
        </Space>
      </div>

      <Card>
        {(workflows?.length ?? 0) === 0 && !isLoading ? (
          <Empty description="No workflows yet" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: "32px 0" }}>
            <Space>
              <Button disabled={!canManage} onClick={() => setTemplateOpen(true)}>
                Start from a template
              </Button>
              <Button type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={() => setCreateOpen(true)}>
                New workflow
              </Button>
            </Space>
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
      </Card>

      <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
        Looking for agents? They live in <Link href="/workflows/agents">Agents</Link> and can be used as workflow steps.
      </Typography.Text>

      <Modal
        title="New workflow"
        open={createOpen}
        onOk={() => void handleCreate()}
        okText="Create"
        confirmLoading={createWorkflow.isPending}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: "Please enter a name." }]}>
            <Input placeholder="Daily sheet sync" autoFocus maxLength={200} />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea placeholder="Optional" rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      {templateOpen ? (
        <TemplateModal
          open={templateOpen}
          initialKey={deepLinkedTemplate}
          onClose={() => {
            setTemplateOpen(false);
            if (templateParam) {
              setDismissedLink(true);
              router.replace("/workflows");
            }
          }}
        />
      ) : null}
    </div>
  );
}

export default function WorkflowsPage() {
  // useSearchParams needs a Suspense boundary in a client page.
  return (
    <Suspense fallback={null}>
      <WorkflowsList />
    </Suspense>
  );
}
