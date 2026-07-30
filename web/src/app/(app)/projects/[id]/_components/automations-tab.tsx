"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

import {
  useProjectAutomations,
  useCreateAutomation,
  useUpdateAutomation,
  useDeleteAutomation,
  type Automation,
  type AutomationTriggerType,
  type AutomationActionType,
} from "@/features/automations/use-automations";
import {
  useTaskStatuses,
  useTaskPriorities,
} from "@/features/tasks/use-task-statuses";
import { useProjectMembers } from "@/features/projects/use-project-members";
import { MemberSingleSelect } from "@/features/team-members/member-select";
import { useTeamLabels } from "@/features/settings/use-labels";

const { Text } = Typography;

/* -------------------------------------------------------------- metadata */

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  task_created: "Task is created",
  status_changed: "Status changes",
  priority_changed: "Priority changes",
  task_completed: "Task is completed",
  assignee_added: "Assignee is added",
};

const ACTION_LABELS: Record<AutomationActionType, string> = {
  set_status: "Set status",
  set_priority: "Set priority",
  assign_member: "Assign member",
  add_label: "Add label",
  notify_member: "Notify member",
  add_comment: "Add comment",
};

const TRIGGER_OPTIONS = (
  Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]
).map((k) => ({ value: k, label: TRIGGER_LABELS[k] }));

const ACTION_OPTIONS = (
  Object.keys(ACTION_LABELS) as AutomationActionType[]
).map((k) => ({ value: k, label: ACTION_LABELS[k] }));

/* ---------------------------------------------------------------- modal */

interface RuleFormValues {
  name: string;
  trigger_type: AutomationTriggerType;
  trigger_status_id?: string;
  trigger_priority_id?: string;
  trigger_team_member_id?: string;
  action_type: AutomationActionType;
  action_status_id?: string;
  action_priority_id?: string;
  action_team_member_id?: string;
  action_label_id?: string;
  action_user_id?: string;
  action_message?: string;
  action_content?: string;
}

function configFromValues(values: RuleFormValues): {
  triggerConfig: Record<string, string>;
  actionConfig: Record<string, string>;
} {
  const triggerConfig: Record<string, string> = {};
  if (values.trigger_type === "status_changed" && values.trigger_status_id) {
    triggerConfig.to_status_id = values.trigger_status_id;
  }
  if (
    values.trigger_type === "priority_changed" &&
    values.trigger_priority_id
  ) {
    triggerConfig.to_priority_id = values.trigger_priority_id;
  }
  if (
    values.trigger_type === "assignee_added" &&
    values.trigger_team_member_id
  ) {
    triggerConfig.team_member_id = values.trigger_team_member_id;
  }

  const actionConfig: Record<string, string> = {};
  switch (values.action_type) {
    case "set_status":
      actionConfig.status_id = values.action_status_id ?? "";
      break;
    case "set_priority":
      actionConfig.priority_id = values.action_priority_id ?? "";
      break;
    case "assign_member":
      actionConfig.team_member_id = values.action_team_member_id ?? "";
      break;
    case "add_label":
      actionConfig.label_id = values.action_label_id ?? "";
      break;
    case "notify_member":
      actionConfig.user_id = values.action_user_id ?? "";
      if (values.action_message?.trim()) {
        actionConfig.message = values.action_message.trim();
      }
      break;
    case "add_comment":
      actionConfig.content = values.action_content?.trim() ?? "";
      break;
  }
  return { triggerConfig, actionConfig };
}

function valuesFromAutomation(a: Automation): RuleFormValues {
  const t = (a.trigger_config ?? {}) as Record<string, string>;
  const c = (a.action_config ?? {}) as Record<string, string>;
  return {
    name: a.name,
    trigger_type: a.trigger_type as AutomationTriggerType,
    trigger_status_id: t.to_status_id,
    trigger_priority_id: t.to_priority_id,
    trigger_team_member_id: t.team_member_id,
    action_type: a.action_type as AutomationActionType,
    action_status_id: c.status_id,
    action_priority_id: c.priority_id,
    action_team_member_id: c.team_member_id,
    action_label_id: c.label_id,
    action_user_id: c.user_id,
    action_message: c.message,
    action_content: c.content,
  };
}

/* ----------------------------------------------------------------- tab */

export function AutomationsTab({ projectId }: { projectId: string }) {
  const { message } = App.useApp();

  const { data: automations, isLoading } = useProjectAutomations(projectId);
  const createAutomation = useCreateAutomation();
  const updateAutomation = useUpdateAutomation();
  const deleteAutomation = useDeleteAutomation();

  // Lookup data for the builder + human-readable rule rendering.
  const { data: statuses } = useTaskStatuses(projectId);
  const { data: priorities } = useTaskPriorities();
  const { data: members } = useProjectMembers(projectId);
  const { data: labels } = useTeamLabels();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [form] = Form.useForm<RuleFormValues>();

  const watchedTrigger = Form.useWatch("trigger_type", form);
  const watchedAction = Form.useWatch("action_type", form);

  const statusOptions = useMemo(
    () => (statuses ?? []).map((s) => ({ value: s.id, label: s.name })),
    [statuses],
  );
  const priorityOptions = useMemo(
    () => (priorities ?? []).map((p) => ({ value: p.id, label: p.name })),
    [priorities],
  );
  const memberOptions = useMemo(
    () =>
      (members ?? []).map((m) => {
        const user = m.team_member?.user;
        return {
          value: m.team_member_id,
          label: user?.name ?? user?.email ?? "Unknown",
          avatarUrl: user?.avatar_url,
          email: user?.email,
        };
      }),
    [members],
  );
  // notify_member targets a *user* id (user_notifications.user_id), not a
  // team_member id — membership rows without a joined user are skipped.
  const memberUserOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.team_member?.user != null)
        .map((m) => ({
          value: m.team_member!.user!.id,
          label:
            m.team_member!.user!.name ??
            m.team_member!.user!.email ??
            "Unknown",
          avatarUrl: m.team_member!.user!.avatar_url,
          email: m.team_member!.user!.email,
        })),
    [members],
  );
  const labelOptions = useMemo(
    () => (labels ?? []).map((l) => ({ value: l.id, label: l.name })),
    [labels],
  );

  const nameOf = (
    options: { value: string; label: string }[],
    id: string | undefined,
  ) => options.find((o) => o.value === id)?.label;

  const describeTrigger = (a: Automation): string => {
    const cfg = (a.trigger_config ?? {}) as Record<string, string>;
    switch (a.trigger_type as AutomationTriggerType) {
      case "status_changed":
        return cfg.to_status_id
          ? `Status changes to "${nameOf(statusOptions, cfg.to_status_id) ?? "…"}"`
          : "Status changes (any)";
      case "priority_changed":
        return cfg.to_priority_id
          ? `Priority changes to "${nameOf(priorityOptions, cfg.to_priority_id) ?? "…"}"`
          : "Priority changes (any)";
      case "assignee_added":
        return cfg.team_member_id
          ? `"${nameOf(memberOptions, cfg.team_member_id) ?? "…"}" is assigned`
          : "Any assignee is added";
      default:
        return TRIGGER_LABELS[a.trigger_type as AutomationTriggerType];
    }
  };

  const describeAction = (a: Automation): string => {
    const cfg = (a.action_config ?? {}) as Record<string, string>;
    switch (a.action_type as AutomationActionType) {
      case "set_status":
        return `Set status to "${nameOf(statusOptions, cfg.status_id) ?? "…"}"`;
      case "set_priority":
        return `Set priority to "${nameOf(priorityOptions, cfg.priority_id) ?? "…"}"`;
      case "assign_member":
        return `Assign "${nameOf(memberOptions, cfg.team_member_id) ?? "…"}"`;
      case "add_label":
        return `Add label "${nameOf(labelOptions, cfg.label_id) ?? "…"}"`;
      case "notify_member":
        return `Notify "${nameOf(memberUserOptions, cfg.user_id) ?? "…"}"`;
      case "add_comment":
        return "Add a comment";
    }
  };

  // The Modal uses destroyOnHidden, so the Form remounts on every open and
  // reads fresh initialValues — no setFieldsValue on an unmounted form.
  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (a: Automation) => {
    setEditing(a);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: RuleFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const { triggerConfig, actionConfig } = configFromValues(values);
    try {
      if (editing) {
        await updateAutomation.mutateAsync({
          id: editing.id,
          projectId,
          name: values.name.trim(),
          triggerType: values.trigger_type,
          triggerConfig,
          actionType: values.action_type,
          actionConfig,
        });
        message.success("Automation updated.");
      } else {
        await createAutomation.mutateAsync({
          projectId,
          name: values.name.trim(),
          triggerType: values.trigger_type,
          triggerConfig,
          actionType: values.action_type,
          actionConfig,
        });
        message.success("Automation created.");
      }
      setModalOpen(false);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save automation.",
      );
    }
  };

  const handleToggle = async (a: Automation, enabled: boolean) => {
    try {
      await updateAutomation.mutateAsync({ id: a.id, projectId, enabled });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to toggle automation.",
      );
    }
  };

  const handleDelete = async (a: Automation) => {
    try {
      await deleteAutomation.mutateAsync({ id: a.id, projectId });
      message.success("Automation deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete automation.",
      );
    }
  };

  const columns: ColumnsType<Automation> = [
    {
      title: "Rule",
      key: "rule",
      render: (_, a) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{a.name}</div>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            When {describeTrigger(a)} → {describeAction(a)}
          </Text>
        </div>
      ),
    },
    {
      title: "Runs",
      key: "runs",
      width: 150,
      render: (_, a) => (
        <Tooltip
          title={
            a.last_run_at
              ? `Last run ${dayjs(a.last_run_at).format("MMM D, YYYY h:mm A")}`
              : "Never run"
          }
        >
          <Space size={6}>
            <Tag
              icon={<ThunderboltOutlined />}
              style={{ borderRadius: 6, marginInlineEnd: 0 }}
            >
              {a.run_count}
            </Tag>
            {a.last_run_at ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {dayjs(a.last_run_at).fromNow()}
              </Text>
            ) : null}
          </Space>
        </Tooltip>
      ),
    },
    {
      title: "Enabled",
      key: "enabled",
      width: 90,
      render: (_, a) => (
        <Switch
          size="small"
          checked={a.enabled}
          onChange={(checked) => handleToggle(a, checked)}
        />
      ),
    },
    {
      title: "",
      key: "actions",
      width: 130,
      align: "right",
      render: (_, a) => (
        <Space size={4}>
          <Button type="text" size="small" onClick={() => openEdit(a)}>
            Edit
          </Button>
          <Popconfirm
            title="Delete this automation?"
            description="Its run history is removed too."
            onConfirm={() => handleDelete(a)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" size="small" danger>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          Rules run automatically inside the database when tasks change.
          Actions never trigger further automations.
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add automation
        </Button>
      </div>

      {(automations ?? []).length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              No automations yet. Try “When status changes to Done → notify the
              project lead”.
            </span>
          }
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add automation
          </Button>
        </Empty>
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={automations ?? []}
          pagination={false}
          size="middle"
          scroll={{ x: "max-content" }}
        />
      )}

      <Modal
        title={editing ? "Edit automation" : "Add automation"}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={createAutomation.isPending || updateAutomation.isPending}
        okText={editing ? "Save" : "Create"}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={editing ? valuesFromAutomation(editing) : undefined}
        >
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, message: "Name the rule" }]}
          >
            <Input placeholder="e.g. Done → notify lead" maxLength={200} />
          </Form.Item>

          <Form.Item
            name="trigger_type"
            label="When"
            rules={[{ required: true, message: "Pick a trigger" }]}
          >
            <Select options={TRIGGER_OPTIONS} placeholder="Select trigger" />
          </Form.Item>

          {watchedTrigger === "status_changed" && (
            <Form.Item name="trigger_status_id" label="To status (optional)">
              <Select
                options={statusOptions}
                placeholder="Any status"
                allowClear
              />
            </Form.Item>
          )}
          {watchedTrigger === "priority_changed" && (
            <Form.Item
              name="trigger_priority_id"
              label="To priority (optional)"
            >
              <Select
                options={priorityOptions}
                placeholder="Any priority"
                allowClear
              />
            </Form.Item>
          )}
          {watchedTrigger === "assignee_added" && (
            <Form.Item
              name="trigger_team_member_id"
              label="Member (optional)"
            >
              <MemberSingleSelect options={memberOptions} placeholder="Any member" />
            </Form.Item>
          )}

          <Form.Item
            name="action_type"
            label="Then"
            rules={[{ required: true, message: "Pick an action" }]}
          >
            <Select options={ACTION_OPTIONS} placeholder="Select action" />
          </Form.Item>

          {watchedAction === "set_status" && (
            <Form.Item
              name="action_status_id"
              label="Status"
              rules={[{ required: true, message: "Pick a status" }]}
            >
              <Select options={statusOptions} placeholder="Select status" />
            </Form.Item>
          )}
          {watchedAction === "set_priority" && (
            <Form.Item
              name="action_priority_id"
              label="Priority"
              rules={[{ required: true, message: "Pick a priority" }]}
            >
              <Select options={priorityOptions} placeholder="Select priority" />
            </Form.Item>
          )}
          {watchedAction === "assign_member" && (
            <Form.Item
              name="action_team_member_id"
              label="Member"
              rules={[{ required: true, message: "Pick a member" }]}
            >
              <MemberSingleSelect options={memberOptions} placeholder="Select member" allowClear={false} />
            </Form.Item>
          )}
          {watchedAction === "add_label" && (
            <Form.Item
              name="action_label_id"
              label="Label"
              rules={[{ required: true, message: "Pick a label" }]}
            >
              <Select
                options={labelOptions}
                placeholder="Select label"
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
          )}
          {watchedAction === "notify_member" && (
            <>
              <Form.Item
                name="action_user_id"
                label="Notify"
                rules={[{ required: true, message: "Pick a member" }]}
              >
                <MemberSingleSelect
                  options={memberUserOptions}
                  placeholder="Select member"
                  allowClear={false}
                />
              </Form.Item>
              <Form.Item name="action_message" label="Message (optional)">
                <Input
                  placeholder="Defaults to the rule name"
                  maxLength={500}
                />
              </Form.Item>
            </>
          )}
          {watchedAction === "add_comment" && (
            <Form.Item
              name="action_content"
              label="Comment"
              rules={[{ required: true, message: "Write the comment" }]}
            >
              <Input.TextArea
                rows={2}
                placeholder="Posted as a system comment"
                maxLength={2000}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
