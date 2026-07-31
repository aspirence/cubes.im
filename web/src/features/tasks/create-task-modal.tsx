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
  Segmented,
  Select,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import {
  UserOutlined,
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
import {
  useCreateTask,
  useTasks,
  useUpdateTask,
} from "@/features/tasks/use-tasks";
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
  /**
   * Open as a subtask composer: preselects this parent task. The parent stays
   * changeable (or clearable — clearing creates a normal top-level task).
   */
  defaultParentTaskId?: string;
  /** Label for the seeded parent, shown until the project's task list loads. */
  defaultParentTaskName?: string;
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
  defaultParentTaskId,
  defaultParentTaskName,
  onCreated,
}: CreateTaskModalProps) {
  const { message } = App.useApp();
  const { data: projects } = useProjects();
  const { data: members } = useTeamMembers();
  const isAdmin = useIsTeamAdmin();
  const { data: priorities } = useTaskPriorities();
  const { data: templates } = useTaskTemplates();
  const createTask = useCreateTaskWithTemplate();
  // Subtasks go through the plain create_task RPC — the only one that takes a
  // parent (and it invalidates the parent's subtask list on success).
  const createSubtask = useCreateTask();
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
  const [parentTaskId, setParentTaskId] = useState<string | undefined>(
    defaultParentTaskId,
  );
  const [deliverableType, setDeliverableType] = useState<string | undefined>();
  // Start date defaults to today — clearable if the task shouldn't have one.
  const [start, setStart] = useState<Dayjs | null>(() => dayjs());
  const [due, setDue] = useState<Dayjs | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [seededOpen, setSeededOpen] = useState(false);

  const projectList = useMemo(() => projects ?? [], [projects]);
  const templateList = useMemo(() => templates ?? [], [templates]);

  // Task vs Subtask is the header toggle. Opening from a task's Subtasks
  // section seeds Subtask with that parent auto-selected; the global modal
  // starts on Task and can switch. The parent picker offers the project's
  // top-level tasks; the seeded parent stays listed even when it is itself a
  // subtask (so its label renders).
  const [kind, setKind] = useState<"task" | "subtask">(
    defaultParentTaskId ? "subtask" : "task",
  );
  const { data: projectTasks } = useTasks(
    kind === "subtask" ? projectId : undefined,
    { includeSubtasks: true },
  );
  const parentOptions = useMemo(() => {
    const list = (projectTasks ?? [])
      .filter((t) => t.parent_task_id == null || t.id === parentTaskId)
      .map((t) => ({
        value: t.id,
        label: t.task_no != null ? `#${t.task_no} · ${t.name}` : t.name,
      }));
    // Until the task list loads, the seeded parent still needs a label —
    // without one the Select would flash its raw id.
    if (
      defaultParentTaskId &&
      defaultParentTaskName &&
      !list.some((o) => o.value === defaultParentTaskId)
    ) {
      list.unshift({ value: defaultParentTaskId, label: defaultParentTaskName });
    }
    return list;
  }, [projectTasks, parentTaskId, defaultParentTaskId, defaultParentTaskName]);
  const priorityByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of priorities ?? []) m.set(p.name.toLowerCase(), p.id);
    return m;
  }, [priorities]);

  // Statuses for the chosen project. Default to a status literally named
  // "To Do" (Todo / To-Do all match); otherwise the first Not-Started status,
  // then the first status by order.
  const { data: statusList } = useTaskStatuses(projectId);
  const defaultStatusId = useMemo(() => {
    const list = statusList ?? [];
    if (list.length === 0) return undefined;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    const named = list.find((s) => norm(s.name) === "todo");
    if (named) return named.id;
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
    setKind(defaultParentTaskId ? "subtask" : "task");
    setParentTaskId(defaultParentTaskId);
    setDeliverableType(undefined);
    setStart(dayjs());
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
    // To Do default takes over. Same for the parent: it lives in the old
    // project, so it can't stay selected.
    setStatusId(undefined);
    setParentTaskId(undefined);
    const proj = projectList.find((p) => p.id === id);
    const defTpl = proj?.default_task_template_id ?? undefined;
    // Templates are top-level-only, so subtask mode skips the auto-apply.
    if (defTpl && !templateId && kind === "task") applyTemplate(defTpl);
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
    if (kind === "subtask" && !parentTaskId) {
      message.warning("Pick a parent task (or switch back to Task).");
      return;
    }
    try {
      // With a parent picked, create_task is the path (the template RPC has no
      // parent param); the description joins the follow-up write below.
      const taskId = parentTaskId
        ? await createSubtask.mutateAsync({
            projectId,
            name: name.trim(),
            statusId: effectiveStatusId ?? undefined,
            priorityId: priorityId ?? undefined,
            parentTaskId,
            assignees,
          })
        : await createTask.mutateAsync({
            projectId,
            name: name.trim(),
            templateId: templateId ?? null,
            description: description.trim() || null,
            priorityId: priorityId ?? null,
            statusId: effectiveStatusId ?? null,
            assignees,
          });
      const subtaskDescription = parentTaskId ? description.trim() : "";
      if (start || due || deliverableType || subtaskDescription) {
        await updateTask.mutateAsync({
          id: taskId,
          ...(start ? { start_date: start.toISOString() } : {}),
          ...(due ? { end_date: due.toISOString() } : {}),
          ...(deliverableType ? { deliverable_type: deliverableType } : {}),
          ...(subtaskDescription ? { description: subtaskDescription } : {}),
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
        parentTaskId
          ? "Subtask created."
          : stepCount > 0
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
  const pending =
    createTask.isPending || createSubtask.isPending || updateTask.isPending;

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
        <Segmented
          size="small"
          value={kind}
          onChange={(v) => {
            const next = v as "task" | "subtask";
            setKind(next);
            if (next === "task") setParentTaskId(undefined);
            // Templates are top-level-only — switching to Subtask clears one.
            else applyTemplate(undefined);
          }}
          options={[
            { value: "task", label: "Task" },
            { value: "subtask", label: "Subtask" },
          ]}
        />
      </div>

      {/* Subtask mode: the parent pill — changeable. */}
      {kind === "subtask" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 24px 0",
          }}
        >
          <span
            className="material-symbols-rounded"
            aria-hidden
            style={{ fontSize: 16, color: "#9a9da8" }}
          >
            subdirectory_arrow_right
          </span>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12.5, flex: "none" }}
          >
            Subtask of
          </Typography.Text>
          <Select
            size="small"
            variant="filled"
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="Select parent task"
            value={parentTaskId}
            onChange={(v) => setParentTaskId(v ?? undefined)}
            popupMatchSelectWidth={false}
            style={{ flex: 1, minWidth: 0, maxWidth: 380 }}
            options={parentOptions}
            disabled={!projectId}
          />
        </div>
      ) : null}

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

      {/* Properties — status/assignee/priority on one line, schedule below. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "12px 24px",
          margin: "8px 0 0",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
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

        {/* Schedule reads as one range: start → due. The pickers keep their
            own clear affordance; the Property icon replaces the suffix icon. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Property
            icon={
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                calendar_today
              </span>
            }
          >
            <DatePicker
              size="small"
              variant="borderless"
              suffixIcon={null}
              placeholder="Start date"
              format="MMM D, YYYY"
              value={start}
              onChange={setStart}
              disabledDate={(d) => (due ? d.isAfter(due, "day") : false)}
              style={{ width: 122 }}
            />
          </Property>
          <span aria-hidden style={{ color: "#9a9da8", fontSize: 12 }}>
            →
          </span>
          <Property
            icon={
              <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                event
              </span>
            }
          >
            <DatePicker
              size="small"
              variant="borderless"
              suffixIcon={null}
              placeholder="Due date"
              format="MMM D, YYYY"
              value={due}
              onChange={setDue}
              disabledDate={(d) => (start ? d.isBefore(start, "day") : false)}
              style={{ width: 122 }}
            />
          </Property>
        </div>
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
          disabled={kind === "subtask"}
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
          <Button
            icon={<ProfileOutlined />}
            disabled={kind === "subtask"}
            title={
              kind === "subtask"
                ? "Templates apply to top-level tasks"
                : undefined
            }
          >
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
