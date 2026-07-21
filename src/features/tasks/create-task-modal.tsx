"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Dropdown,
  Input,
  Modal,
  Select,
  Tag,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import {
  UserOutlined,
  CalendarOutlined,
  FlagOutlined,
  ProfileOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import { useProjects } from "@/features/projects/use-projects";
import {
  useTeamMembers,
  useIsTeamAdmin,
} from "@/features/team-members/use-team-members";
import { MemberSelect } from "@/features/team-members/member-select";
import { extractMentionUserIds } from "@/features/team-members/team-mention-input";
import { RichDescription } from "@/features/tasks/rich-description";
import { useNotifyMentions } from "@/features/notifications/use-mention-notify";
import { useAuth } from "@/features/auth/use-auth";
import { useActiveTeam } from "@/features/teams/use-teams";
import { InviteMemberModal } from "@/features/invitations/invite-member-modal";
import {
  useTaskPriorities,
  useTaskStatuses,
} from "@/features/tasks/use-task-statuses";
import { useUpdateTask } from "@/features/tasks/use-tasks";
import {
  useTaskTemplates,
  useCreateTaskWithTemplate,
  useSetProjectDefaultTemplate,
} from "@/features/templates/use-templates";

export interface CreateTaskModalProps {
  open: boolean;
  onClose: () => void;
  /** Preselect a project (e.g. when opened from within a project). */
  defaultProjectId?: string;
  /** Preselect a due date (e.g. when opened from a calendar day). */
  defaultDue?: Dayjs | null;
  /** Called with the new task id after a successful create. */
  onCreated?: (taskId: string) => void;
}

/** A compact "property" control (icon + inline control). */
function Property({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "#9a9da8", display: "inline-flex", fontSize: 13 }}>
        {icon}
      </span>
      {children}
    </div>
  );
}

/**
 * Global create-task modal — reachable from the header quick-create and any
 * "+ Task" affordance. Layout: prominent name, inline description,
 * property pills, and a template that prefills fields + adds subtask steps.
 */
export function CreateTaskModal({
  open,
  onClose,
  defaultProjectId,
  defaultDue,
  onCreated,
}: CreateTaskModalProps) {
  const { message } = App.useApp();
  const { data: projects } = useProjects();
  const { data: members } = useTeamMembers();
  const isAdmin = useIsTeamAdmin();
  const { data: priorities } = useTaskPriorities();
  const { data: templates } = useTaskTemplates();
  const createTask = useCreateTaskWithTemplate();
  const updateTask = useUpdateTask();
  const setDefaultTemplate = useSetProjectDefaultTemplate();

  const { profile } = useAuth();
  const { data: activeTeam } = useActiveTeam();
  const notifyMentions = useNotifyMentions();
  // @-mention picker options — user-keyed (mention fan-out is by user id);
  // invited-but-not-joined rows (no user) are filtered out.
  const mentionMembers = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.user != null)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.name ?? m.user!.email ?? "Unknown",
          avatarUrl: m.user!.avatar_url,
          email: m.user!.email,
        })),
    [members],
  );

  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [description, setDescription] = useState("");
  const [priorityId, setPriorityId] = useState<string | undefined>();
  // Explicit status choice; undefined falls back to the project's To Do status.
  const [statusId, setStatusId] = useState<string | undefined>();
  const [assignees, setAssignees] = useState<string[]>([]);
  const [deliverableType, setDeliverableType] = useState<string | undefined>();
  const [due, setDue] = useState<Dayjs | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [seededOpen, setSeededOpen] = useState(false);

  const projectList = useMemo(() => projects ?? [], [projects]);
  const templateList = useMemo(() => templates ?? [], [templates]);
  const priorityByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of priorities ?? []) m.set(p.name.toLowerCase(), p.id);
    return m;
  }, [priorities]);

  // Statuses for the chosen project. The default is the first "To Do" (Not
  // Started) status, falling back to the first status by order.
  const { data: statusList } = useTaskStatuses(projectId);
  const defaultStatusId = useMemo(() => {
    const list = statusList ?? [];
    if (list.length === 0) return undefined;
    return (list.find((s) => s.category?.is_todo) ?? list[0]).id;
  }, [statusList]);
  const effectiveStatusId = statusId ?? defaultStatusId;
  const statusOptions = useMemo(
    () =>
      (statusList ?? []).map((s) => ({
        value: s.id,
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                flex: "none",
                background: s.category?.color_code ?? "#9a9da8",
              }}
            />
            {s.name}
          </span>
        ),
      })),
    [statusList],
  );

  // Reset the form each time the modal opens (render-time reset idiom).
  if (open && !seededOpen) {
    setSeededOpen(true);
    setProjectId(defaultProjectId);
    setName("");
    setTemplateId(undefined);
    setDescription("");
    setPriorityId(undefined);
    setStatusId(undefined);
    setAssignees([]);
    setDeliverableType(undefined);
    setDue(defaultDue ?? null);
    setMakeDefault(false);
    setInviteOpen(false);
  } else if (!open && seededOpen) {
    setSeededOpen(false);
  }

  const applyTemplate = (id: string | undefined) => {
    setTemplateId(id);
    const tpl = templateList.find((t) => t.id === id);
    // Deliverable comes from the template only (no standalone picker).
    setDeliverableType(tpl?.deliverable_type ?? undefined);
    if (!tpl) return;
    if (tpl.description) setDescription(tpl.description);
    if (tpl.priority) {
      const pid = priorityByName.get(tpl.priority.toLowerCase());
      if (pid) setPriorityId(pid);
    }
  };

  const handleProjectChange = (id: string) => {
    setProjectId(id);
    // Statuses are per-project — drop any prior choice so the new project's
    // To Do default takes over.
    setStatusId(undefined);
    const proj = projectList.find((p) => p.id === id);
    const defTpl = proj?.default_task_template_id ?? undefined;
    if (defTpl && !templateId) applyTemplate(defTpl);
  };

  const stepCount = useMemo(() => {
    const tpl = templateList.find((t) => t.id === templateId);
    const steps = tpl && Array.isArray(tpl.steps) ? tpl.steps : [];
    return steps.length;
  }, [templateList, templateId]);

  const handleSubmit = async () => {
    if (!projectId) {
      message.warning("Pick a project.");
      return;
    }
    if (!name.trim()) {
      message.warning("Enter a task name.");
      return;
    }
    try {
      const taskId = await createTask.mutateAsync({
        projectId,
        name: name.trim(),
        templateId: templateId ?? null,
        description: description.trim() || null,
        priorityId: priorityId ?? null,
        statusId: effectiveStatusId ?? null,
        assignees,
      });
      if (due || deliverableType) {
        await updateTask.mutateAsync({
          id: taskId,
          ...(due ? { end_date: due.toISOString() } : {}),
          ...(deliverableType ? { deliverable_type: deliverableType } : {}),
        });
      }
      if (makeDefault && templateId && projectId) {
        try {
          await setDefaultTemplate.mutateAsync({ projectId, templateId });
        } catch {
          // Non-fatal: the task was still created.
        }
      }
      message.success(
        stepCount > 0
          ? `Task created with ${stepCount} subtask${stepCount === 1 ? "" : "s"}.`
          : "Task created.",
      );
      // Mention fan-out from the description — best-effort, never blocks
      // creation; recipients get a "mention" notification linking to the task.
      const mentioned = extractMentionUserIds(description, mentionMembers);
      if (mentioned.length > 0 && projectId) {
        void notifyMentions({
          text: description,
          members: mentionMembers,
          message: `${profile?.name ?? "Someone"} mentioned you in the task "${name.trim()}"`,
          url: `/projects/${projectId}?task=${taskId}`,
          teamId: activeTeam?.id,
        }).catch(() => {});
      }
      onCreated?.(taskId);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to create task.");
    }
  };

  // create_task expects team_members.id values (not user ids) for assignees.
  const memberOptions = (members ?? [])
    .filter((m) => m.user)
    .map((m) => ({
      value: m.id,
      label: m.user!.name,
      avatarUrl: m.user!.avatar_url,
      email: m.user!.email,
    }));
  const priorityOptions = (priorities ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));
  const pending = createTask.isPending || updateTask.isPending;

  return (
    <>
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      // Never exceed a phone viewport; stays 640 on desktop.
      style={{ maxWidth: "calc(100vw - 32px)" }}
      title={null}
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
    >
      {/* Header: project + type pills */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "18px 24px 0",
        }}
      >
        <Select
          size="small"
          variant="filled"
          showSearch
          optionFilterProp="label"
          placeholder="Select a project"
          value={projectId}
          onChange={handleProjectChange}
          suffixIcon={<FolderOutlined />}
          style={{ minWidth: 180 }}
          options={projectList.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Tag
          style={{
            display: "inline-flex",
            alignItems: "center",
            margin: 0,
            borderRadius: 6,
          }}
        >
          Task
        </Tag>
      </div>

      {/* Name (prominent) + description (inline) */}
      <div style={{ padding: "12px 24px 0" }}>
        <Input
          variant="borderless"
          autoFocus
          placeholder="Task Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={handleSubmit}
          maxLength={500}
          style={{ fontSize: 22, fontWeight: 600, padding: 0 }}
        />
        <div style={{ marginTop: 10 }}>
          <RichDescription
            value={description}
            onChange={setDescription}
            onCommit={() => {}}
            minRows={3}
            maxRows={10}
            mentionMembers={mentionMembers}
          />
        </div>
      </div>

      {/* Property row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 16,
          padding: "12px 24px",
          margin: "8px 0 0",
        }}
      >
        <Property
          icon={
            <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
              adjust
            </span>
          }
        >
          <Select
            size="small"
            variant="borderless"
            placeholder="Status"
            value={effectiveStatusId}
            onChange={setStatusId}
            style={{ minWidth: 120 }}
            popupMatchSelectWidth={false}
            disabled={!projectId || statusOptions.length === 0}
            options={statusOptions}
          />
        </Property>
        <Property icon={<UserOutlined />}>
          <MemberSelect
            popupInParent
            variant="avatar"
            value={assignees}
            onChange={setAssignees}
            options={memberOptions}
            placeholder="Assignee"
            style={{ minWidth: 140 }}
            onInvite={
              isAdmin
                ? (query) => {
                    setInviteQuery(query);
                    setInviteOpen(true);
                  }
                : undefined
            }
          />
        </Property>
        <Property icon={<CalendarOutlined />}>
          <DatePicker
            size="small"
            variant="borderless"
            placeholder="Due date"
            value={due}
            onChange={setDue}
            style={{ width: 130 }}
          />
        </Property>
        <Property icon={<FlagOutlined />}>
          <Select
            size="small"
            variant="borderless"
            allowClear
            placeholder="Priority"
            value={priorityId}
            onChange={setPriorityId}
            style={{ minWidth: 100 }}
            options={priorityOptions}
          />
        </Property>
        {deliverableType ? (
          <Property
            icon={
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                inventory_2
              </span>
            }
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#4a4ad0" }}>
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                {deliverableType === "video" ? "movie" : "notes"}
              </span>
              {deliverableType === "video" ? "Video review" : "Text"} deliverable
            </span>
          </Property>
        ) : null}
      </div>

      {templateId && projectId ? (
        <div style={{ padding: "0 24px 8px" }}>
          <Checkbox
            checked={makeDefault}
            onChange={(e) => setMakeDefault(e.target.checked)}
          >
            <Typography.Text style={{ fontSize: 12.5 }}>
              Make this the default template for this project
            </Typography.Text>
          </Checkbox>
        </div>
      ) : null}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 24px",
          borderTop: "1px solid rgba(128,128,140,0.18)",
        }}
      >
        <Dropdown
          trigger={["click"]}
          menu={{
            items:
              templateList.length === 0
                ? [{ key: "none", label: "No templates yet", disabled: true }]
                : [
                    ...templateList.map((t) => ({
                      key: t.id,
                      label:
                        (Array.isArray(t.steps) ? t.steps.length : 0) > 0
                          ? `${t.name} · ${(t.steps as unknown[]).length} steps`
                          : t.name,
                      onClick: () => applyTemplate(t.id),
                    })),
                    ...(templateId
                      ? [
                          { type: "divider" as const },
                          {
                            key: "clear",
                            label: "Clear template",
                            onClick: () => applyTemplate(undefined),
                          },
                        ]
                      : []),
                  ],
          }}
        >
          <Button icon={<ProfileOutlined />}>
            {templateId
              ? `${templateList.find((t) => t.id === templateId)?.name ?? "Template"}${
                  stepCount > 0 ? ` · ${stepCount} subtask${stepCount === 1 ? "" : "s"}` : ""
                }`
              : "Templates"}
          </Button>
        </Dropdown>
        <Button
          type="primary"
          loading={pending}
          onClick={handleSubmit}
          disabled={!projectId || !name.trim()}
        >
          Create Task
        </Button>
      </div>
    </Modal>

    <InviteMemberModal
      open={inviteOpen}
      initialQuery={inviteQuery}
      onClose={() => setInviteOpen(false)}
    />
    </>
  );
}
