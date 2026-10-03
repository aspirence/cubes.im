"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Tooltip,
  theme,
  type TableColumnsType,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  useCreateCrmTask,
  useCrmTasks,
  useDeleteCrmTask,
  useUpdateCrmTask,
  type CrmTaskPatch,
} from "@/features/app-crm/use-crm-tasks";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import {
  CRM_TASK_STATUSES,
  crmPersonName,
  type CrmTargetRef,
  type CrmTaskStatus,
  type CrmTaskWithTargets,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import {
  TargetPicker,
  decodeTarget,
  encodeTarget,
} from "../_components/target-picker";
import { CrmToggle } from "../_components/crm-toggle";
import { FormSection } from "../_components/form-section";
import { entityMeta } from "../_components/entity-meta";
import {
  CRM_DRAWER_BODY_STYLE,
  CRM_DRAWER_FORM_STYLE,
  CRM_DRAWER_WIDTH,
  CrmDrawerFields,
  CrmDrawerFooter,
} from "../_components/drawer-footer";
import { ScopedEmptyState } from "../_components/crm-scope-bar";
import {
  useCrmScope,
  useCrmScopeResolver,
  useResetOnScopeChange,
} from "../_lib/crm-scope";
import {
  CrmPageHeader,
  EmptyState,
  ErrorState,
  EntityAvatar,
  RowActions,
  SoftChip,
  crmPageStyle,
  tint,
} from "../_lib/ui";
import {
  CrmTable,
  CrmTableCard,
  DateCell,
  FilterButton,
  ManageColumns,
  TableSearch,
  TagPill,
  ToolbarSpacer,
  UpdatedCell,
  useColumnLayout,
  type ColumnChoice,
  type CrmMenuItem,
} from "../_components/data-table";

type TaskFormValues = {
  title: string;
  body?: string;
  status?: CrmTaskStatus;
  due_at?: Dayjs | null;
  assignee_id?: string | null;
  targets?: string[];
};

/**
 * Status accents are *data* (they live next to the status enum), so the hexes
 * stay literal here — everything else on this page reads from the theme token.
 */
const STATUS_META: Record<
  CrmTaskStatus,
  { label: string; color: string; icon: string }
> = {
  TODO: {
    label: "To do",
    color: CRM_TASK_STATUSES[0].color,
    icon: "radio_button_unchecked",
  },
  IN_PROGRESS: {
    label: "In progress",
    color: CRM_TASK_STATUSES[1].color,
    icon: "pending",
  },
  DONE: {
    label: "Done",
    color: CRM_TASK_STATUSES[2].color,
    icon: "check_circle",
  },
};

const statusMeta = (value: unknown) =>
  STATUS_META[value as CrmTaskStatus] ?? STATUS_META.TODO;

/** Workflow order (To do → In progress → Done) — what a Status sort means. */
const statusRank = (value: string) =>
  CRM_TASK_STATUSES.findIndex((s) => s.value === value);

type DueFilter = "ALL" | "OVERDUE" | "TODAY" | "WEEK" | "NONE";

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "ALL", label: "Any due date" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "TODAY", label: "Due today" },
  { value: "WEEK", label: "Due this week" },
  { value: "NONE", label: "No due date" },
];

/** The Assignee filter's value for "nobody" — never a user id. */
const UNASSIGNED = "__unassigned__";

/**
 * The columns "Manage columns" can hide and reorder — every data column, Task
 * included, in their default left-to-right order. Only the row actions (and
 * the selection checkbox) always show.
 */
const COLUMN_CHOICES: ColumnChoice[] = [
  { key: "title", title: "Task" },
  { key: "status", title: "Status" },
  { key: "due", title: "Due" },
  { key: "assignee", title: "Assignee" },
  { key: "targets", title: "Linked to" },
  { key: "created", title: "Date created" },
  { key: "updated", title: "Last update" },
];
/**
 * The room each column takes; `scroll.x` is the sum over the visible ones, so
 * hiding one hands its space back instead of leaving a scrollbar behind. Task
 * and "Linked to" have no fixed width (they share what is left), so their
 * figures are only minimums. Date created starts hidden: on a task list the
 * date that matters is the due date, and with it the table fits a desktop page
 * without scrolling.
 */
const COLUMN_WIDTHS: Record<string, number> = {
  title: 240,
  status: 156,
  due: 136,
  assignee: 180,
  targets: 220,
  created: 124,
  updated: 124,
};
const DEFAULT_HIDDEN = ["created"];
const colWidth = (key: string) => COLUMN_WIDTHS[key];
/** Selection checkbox + the row actions. */
const ALWAYS_WIDTH = 48 + 84;

/**
 * A due date set from the right-click menu lands at the END of that day: the
 * table and the dashboard call a task overdue once `due_at` is in the past,
 * so "Today" stamped with the current time would turn red a second later.
 */
const dueBy = (day: Dayjs) => day.endOf("day").toISOString();

/** A name in a right-click menu, clipped so a long one can't stretch the menu. */
function MenuName({ children }: { children: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        maxWidth: 220,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }}
    >
      {children}
    </span>
  );
}

export default function CrmTasksPage() {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const { user } = useAuth();
  const {
    data: tasks,
    isLoading,
    isError,
    error,
    refetch,
  } = useCrmTasks();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
  const { data: members } = useTeamMembers();
  const createTask = useCreateCrmTask();
  const updateTask = useUpdateCrmTask();
  const deleteTask = useDeleteCrmTask();
  const { projectId, project, isScoped, isNoProject } = useCrmScope();
  const { ready: scopeReady, targetsInScope } = useCrmScopeResolver();

  const [statusFilter, setStatusFilter] = useState<"ALL" | CrmTaskStatus>(
    "ALL",
  );
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState("");
  const [dueFilter, setDueFilter] = useState<DueFilter>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const layout = useColumnLayout("tasks", COLUMN_CHOICES, DEFAULT_HIDDEN);
  const [selected, setSelected] = useState<string[]>([]);
  // The selection preserves keys across pages, so without this a scope flip
  // would keep rows ticked that the list no longer shows — and the bulk bar
  // would act on them.
  useResetOnScopeChange(() => setSelected([]));
  const [bulkBusy, setBulkBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmTaskWithTargets | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form] = Form.useForm<TaskFormValues>();

  const recordName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? [])
      map.set(`person:${p.id}`, crmPersonName(p) || "Unnamed person");
    for (const c of companies ?? []) map.set(`company:${c.id}`, c.name);
    for (const d of deals ?? []) map.set(`deal:${d.id}`, d.name);
    return (type: string, id: string) => map.get(`${type}:${id}`) ?? null;
  }, [people, companies, deals]);

  /**
   * Records not in the Deleted bin — the ones "New task…" may pre-link (the
   * form's record picker only offers live records).
   */
  const liveRecords = useMemo(() => {
    const set = new Set<string>();
    for (const p of people ?? []) if (!p.deleted_at) set.add(`person:${p.id}`);
    for (const c of companies ?? [])
      if (!c.deleted_at) set.add(`company:${c.id}`);
    for (const d of deals ?? []) if (!d.deleted_at) set.add(`deal:${d.id}`);
    return set;
  }, [people, companies, deals]);

  const memberById = useMemo(() => {
    const map = new Map<string, { name: string; avatar: string | null }>();
    for (const m of members ?? [])
      if (m.user)
        map.set(m.user.id, { name: m.user.name, avatar: m.user.avatar_url });
    return map;
  }, [members]);

  /**
   * The current project's tasks: one counts when ANY of its targets resolves
   * to that project (a person, company or deal filed under it), so untargeted
   * tasks and tasks on unfiled records drop out — under "No project" those
   * are exactly the ones that stay. Unscoped (a workspace with no projects)
   * this is every task — the resolver passes everything.
   */
  const inScopeTasks = useMemo(
    () => (tasks ?? []).filter((t) => targetsInScope(t.targets)),
    [tasks, targetsInScope],
  );

  /** Everything the "My tasks" switch keeps — the basis for the stat tiles. */
  const scoped = useMemo(
    () => inScopeTasks.filter((t) => !onlyMine || t.assignee_id === user?.id),
    [inScopeTasks, onlyMine, user?.id],
  );

  // Scoped, the resolver needs people, companies and deals before it can
  // place a task; until then the list is loading, not "No tasks in <project>".
  const listLoading = isLoading || (isScoped && !scopeReady);

  /**
   * Applies one change to every selected task. Partial failure is the normal
   * failure here (a row someone else deleted, an RLS refusal), so it reports
   * how many landed rather than pretending the whole batch died.
   */
  const runBulk = async (
    label: string,
    apply: (id: string) => Promise<unknown>,
  ) => {
    const ids = selected;
    setBulkBusy(true);
    const results = await Promise.allSettled(ids.map(apply));
    setBulkBusy(false);
    setSelected([]);
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      message.success(`${label} · ${ids.length} task${ids.length === 1 ? "" : "s"}`);
    } else {
      message.warning(`${label} · ${ids.length - failed} done, ${failed} failed`);
    }
  };

  /** Overdue / today / this week — the question a task list is actually asked. */
  const matchesDue = (t: CrmTaskWithTargets): boolean => {
    if (dueFilter === "ALL") return true;
    if (!t.due_at) return dueFilter === "NONE";
    if (dueFilter === "NONE") return false;
    const at = dayjs(t.due_at);
    const now = dayjs();
    if (dueFilter === "OVERDUE") return at.isBefore(now) && t.status !== "DONE";
    if (dueFilter === "TODAY") return at.isSame(now, "day");
    // WEEK: anything landing between now and seven days out.
    return !at.isBefore(now, "day") && !at.isAfter(now.add(7, "day"), "day");
  };

  /**
   * The Assignee filter's key for a task. "Unassigned" means what the column
   * shows as Unassigned: no assignee, or one who is no longer on the team
   * (removing a member deletes their team_members row, the task keeps the id).
   */
  const assigneeKey = (t: CrmTaskWithTargets): string =>
    t.assignee_id && memberById.has(t.assignee_id)
      ? t.assignee_id
      : UNASSIGNED;

  const matchesAssignee = (t: CrmTaskWithTargets): boolean =>
    assigneeFilter.length === 0 || assigneeFilter.includes(assigneeKey(t));

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return scoped
      .filter((t) => statusFilter === "ALL" || t.status === statusFilter)
      .filter(matchesDue)
      .filter(matchesAssignee)
      .filter((t) => {
        if (!needle) return true;
        // Searching a task list means searching what it is ATTACHED to as
        // much as its title — "everything on Acme" is the real question.
        const linked = t.targets
          .map((x) => recordName(x.target_type, x.target_id) ?? "")
          .join(" ");
        return `${t.title} ${t.body ?? ""} ${linked}`
          .toLowerCase()
          .includes(needle);
      });
    // `matchesDue` / `matchesAssignee` close over dueFilter, assigneeFilter
    // and memberById, which are in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scoped,
    statusFilter,
    dueFilter,
    assigneeFilter,
    memberById,
    search,
    recordName,
  ]);

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
  );

  /**
   * The Assignee filter lists everyone who can hold a task — inactive members
   * too, since their old tasks are still on the list — plus "Unassigned".
   */
  const assigneeFilterOptions = useMemo(
    () => [
      { value: UNASSIGNED, label: "Unassigned" },
      ...(members ?? []).flatMap((m) =>
        m.user
          ? [
              {
                value: m.user.id,
                label:
                  m.user.id === user?.id ? `${m.user.name} (you)` : m.user.name,
              },
            ]
          : [],
      ),
    ],
    [members, user?.id],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: "TODO" });
    setFormOpen(true);
  };

  const openEdit = (task: CrmTaskWithTargets) => {
    setEditing(task);
    form.setFieldsValue({
      title: task.title,
      body: task.body ?? undefined,
      status: task.status as CrmTaskStatus,
      due_at: task.due_at ? dayjs(task.due_at) : null,
      assignee_id: task.assignee_id,
      targets: task.targets.map((t) =>
        encodeTarget({
          type: t.target_type as CrmTargetRef["type"],
          id: t.target_id,
        }),
      ),
    });
    setFormOpen(true);
  };

  /**
   * After a create: a task shows under the current project only when one of
   * its records is filed there. One linked to nothing in it is saved all the
   * same, it just will not be in this list — say so, so it does not look lost.
   */
  const noteIfHidden = (targets: CrmTargetRef[]) => {
    if (!project) return;
    const saved = targets.map((t) => ({ target_type: t.type, target_id: t.id }));
    if (targetsInScope(saved)) return;
    message.open({
      key: "crm-scope-mismatch",
      type: "info",
      duration: 6,
      content: isNoProject
        ? "Linked only to records filed under a project — it will not show here."
        : `Linked to no record in ${project.name} — it will not show here.`,
    });
  };

  const handleSubmit = async (values: TaskFormValues) => {
    const patch = {
      title: values.title.trim(),
      body: values.body?.trim() || null,
      status: values.status ?? "TODO",
      due_at: values.due_at ? values.due_at.toISOString() : null,
      assignee_id: values.assignee_id ?? null,
    };
    try {
      if (editing) {
        await updateTask.mutateAsync({ id: editing.id, patch });
        message.success("Task updated.");
      } else {
        const targets = (values.targets ?? []).map(decodeTarget);
        await createTask.mutateAsync({ ...patch, targets });
        message.success("Task created.");
        noteIfHidden(targets);
      }
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save task."));
    }
  };

  const changeStatus = async (id: string, status: CrmTaskStatus) => {
    try {
      await updateTask.mutateAsync({ id, patch: { status } });
    } catch (err) {
      message.error(errMsg(err, "Failed to update status."));
    }
  };

  /** Hard delete — the row's confirm and the right-click menu's both land here. */
  const removeTask = async (id: string) => {
    try {
      await deleteTask.mutateAsync(id);
      message.success("Task deleted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to delete task."));
    }
  };

  /* ------------------------------------------------ right-click menu */

  /** One field change from the menu (due date, assignee), with a toast. */
  const saveTask = async (id: string, patch: CrmTaskPatch, done: string) => {
    try {
      await updateTask.mutateAsync({ id, patch });
      message.success(done);
    } catch (err) {
      message.error(errMsg(err, "Couldn't update the task."));
    }
  };

  /** "New task…" from a task: the create form, linked to the same records. */
  const openCreateLike = (task: CrmTaskWithTargets) => {
    openCreate();
    const targets = task.targets
      .filter((x) => liveRecords.has(`${x.target_type}:${x.target_id}`))
      .map((x) =>
        encodeTarget({
          type: x.target_type as CrmTargetRef["type"],
          id: x.target_id,
        }),
      );
    if (targets.length > 0) form.setFieldsValue({ targets });
  };

  /** A fresh To do copy: same details, due date, assignee and records. */
  const duplicateTask = async (task: CrmTaskWithTargets) => {
    try {
      await createTask.mutateAsync({
        title: `${task.title} (copy)`,
        body: task.body,
        status: "TODO",
        due_at: task.due_at,
        assignee_id: task.assignee_id,
        targets: task.targets.map((x) => ({
          type: x.target_type as CrmTargetRef["type"],
          id: x.target_id,
        })),
      });
      message.success("Task duplicated.");
    } catch (err) {
      message.error(errMsg(err, "Couldn't duplicate the task."));
    }
  };

  const copyTitle = (task: CrmTaskWithTargets) => {
    void navigator.clipboard.writeText(task.title).then(
      () => message.success("Title copied."),
      () => message.error("Couldn't copy the title."),
    );
  };

  const confirmDelete = (task: CrmTaskWithTargets) => {
    modal.confirm({
      title: "Delete this task?",
      content: `“${task.title}” will be deleted. This cannot be undone — tasks have no Deleted bin.`,
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () => removeTask(task.id),
    });
  };

  /**
   * A row's right-click menu, built from the task as it is now:
   *
   *   Edit… · Open linked record ▸
   *   Status ▸ · Due date ▸ · Assign to ▸
   *   New task… · Duplicate
   *   Copy title
   *   Delete
   */
  const taskMenu = (t: CrmTaskWithTargets): CrmMenuItem[] => {
    const status = statusMeta(t.status);
    const due = t.due_at ? dayjs(t.due_at) : null;
    const today = dayjs();
    const dueChoice = (
      key: string,
      label: string,
      day: Dayjs,
      extra: string,
    ) => {
      const current = Boolean(due?.isSame(day, "day"));
      return {
        key,
        label,
        extra,
        checked: current,
        onSelect: current
          ? undefined
          : () =>
              void saveTask(
                t.id,
                { due_at: dueBy(day) },
                `Due ${day.format("ddd D MMM")}.`,
              ),
      };
    };

    // Assign to: you first, then the rest of the active team. A current
    // assignee who is no longer active is still listed, so the tick shows.
    const current = assigneeKey(t);
    const assignees: { id: string; name: string; avatar: string | null }[] = [];
    for (const m of members ?? [])
      if (m.active && m.user)
        assignees.push({
          id: m.user.id,
          name: m.user.name,
          avatar: m.user.avatar_url,
        });
    const meIndex = assignees.findIndex((p) => p.id === user?.id);
    if (meIndex > 0) assignees.unshift(...assignees.splice(meIndex, 1));
    const held = current === UNASSIGNED ? undefined : memberById.get(current);
    if (held && !assignees.some((p) => p.id === current))
      assignees.push({ id: current, name: held.name, avatar: held.avatar });
    const nameOf = (p: { id: string; name: string }) =>
      p.id === user?.id ? "Me" : p.name;

    const linked: CrmMenuItem[] = t.targets.flatMap((x) => {
      const name = recordName(x.target_type, x.target_id);
      if (!name) return [];
      const meta = entityMeta(x.target_type);
      return [
        {
          key: x.id,
          label: <MenuName>{name}</MenuName>,
          icon: meta.icon,
          extra: meta.label,
          onSelect: () =>
            setViewTarget({
              type: x.target_type as CrmTargetRef["type"],
              id: x.target_id,
            }),
        },
      ];
    });

    return [
      {
        key: "edit",
        label: "Edit…",
        icon: "edit",
        onSelect: () => openEdit(t),
      },
      ...(linked.length > 0
        ? [
            {
              key: "linked",
              label: "Open linked record",
              icon: "link",
              children: linked,
            },
          ]
        : []),
      { type: "divider" },
      {
        key: "status",
        label: "Status",
        icon: "flag",
        extra: status.label,
        children: CRM_TASK_STATUSES.map((s) => ({
          key: s.value,
          label: s.label,
          icon: STATUS_META[s.value].icon,
          checked: s.value === t.status,
          onSelect:
            s.value === t.status
              ? undefined
              : () => void changeStatus(t.id, s.value),
        })),
      },
      {
        key: "due",
        label: "Due date",
        icon: "event",
        extra: due ? due.format("D MMM") : "None",
        children: [
          dueChoice("today", "Today", today, today.format("ddd")),
          dueChoice(
            "tomorrow",
            "Tomorrow",
            today.add(1, "day"),
            today.add(1, "day").format("ddd"),
          ),
          dueChoice(
            "week",
            "Next week",
            today.add(7, "day"),
            today.add(7, "day").format("ddd D MMM"),
          ),
          { type: "divider" },
          {
            key: "pick",
            label: "Pick a date…",
            icon: "edit_calendar",
            onSelect: () => openEdit(t),
          },
          ...(due
            ? [
                {
                  key: "clear",
                  label: "Clear due date",
                  icon: "event_busy",
                  onSelect: () =>
                    void saveTask(t.id, { due_at: null }, "Due date cleared."),
                },
              ]
            : []),
        ],
      },
      {
        key: "assignee",
        label: "Assign to",
        icon: "person",
        extra:
          current === UNASSIGNED
            ? "Unassigned"
            : current === user?.id
              ? "Me"
              : held?.name,
        children: [
          ...assignees.map((p) => ({
            key: p.id,
            label: (
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <EntityAvatar
                  name={p.name}
                  kind="person"
                  src={p.avatar}
                  size={20}
                />
                <MenuName>{nameOf(p)}</MenuName>
              </span>
            ),
            checked: p.id === current,
            onSelect:
              p.id === current
                ? undefined
                : () =>
                    void saveTask(
                      t.id,
                      { assignee_id: p.id },
                      p.id === user?.id
                        ? "Assigned to you."
                        : `Assigned to ${p.name}.`,
                    ),
          })),
          { type: "divider" },
          {
            key: UNASSIGNED,
            label: "Unassigned",
            icon: "person_off",
            checked: current === UNASSIGNED,
            onSelect:
              current === UNASSIGNED
                ? undefined
                : () =>
                    void saveTask(
                      t.id,
                      { assignee_id: null },
                      "Task unassigned.",
                    ),
          },
        ],
      },
      { type: "divider" },
      {
        key: "new",
        label: "New task…",
        icon: "add_task",
        onSelect: () => openCreateLike(t),
      },
      {
        key: "duplicate",
        label: "Duplicate",
        icon: "control_point_duplicate",
        onSelect: () => void duplicateTask(t),
      },
      { type: "divider" },
      {
        key: "copy",
        label: "Copy title",
        icon: "content_copy",
        onSelect: () => copyTitle(t),
      },
      { type: "divider" },
      {
        key: "delete",
        label: "Delete…",
        icon: "delete",
        danger: true,
        onSelect: () => confirmDelete(t),
      },
    ];
  };

  /** The page's one create action — in the header, and in the empty states. */
  const newTaskButton = (
    <Button
      type="primary"
      icon={<MIcon name="add" size={16} />}
      onClick={openCreate}
    >
      New task
    </Button>
  );

  const emptyState = (() => {
    // Error first: a dropped connection rendered as "No tasks yet" tells the
    // user their follow-ups are gone, which is the one thing it never means.
    if (isError) {
      return (
        <ErrorState
          compact
          title="Couldn't load tasks"
          error={error}
          onRetry={() => void refetch()}
        />
      );
    }
    if ((tasks ?? []).length === 0) {
      return (
        <EmptyState
          compact
          icon="task_alt"
          accent={token.colorPrimary}
          title="No tasks yet"
          description="Tasks are the follow-ups attached to your people, companies and deals — the next call, the contract to chase, the demo to prep."
          action={newTaskButton}
        />
      );
    }
    // The team has tasks, just none in the current project. Sits before the
    // filter branches: no local filter is hiding anything here, the scope is.
    // (`project` is non-null exactly when scoped — narrowing on it types the name.)
    if (project && inScopeTasks.length === 0) {
      return (
        <ScopedEmptyState
          compact
          nouns="tasks"
          onCreate={openCreate}
          description={`A task shows here when it is linked to a person, company or deal in ${project.name}. Create one, or pick another project in the bar above.`}
        />
      );
    }
    const label =
      statusFilter === "ALL" ? null : statusMeta(statusFilter).label;
    // A search that finds nothing is its own thing — offering "create a task"
    // there answers a question nobody asked.
    if (search.trim()) {
      return (
        <EmptyState
          compact
          icon="search_off"
          title="No tasks match that search"
          description="Searches cover a task's title, its notes, and the records it is attached to."
          action={<Button onClick={() => setSearch("")}>Clear search</Button>}
        />
      );
    }
    if (dueFilter !== "ALL") {
      return (
        <EmptyState
          compact
          icon="event_available"
          title={
            dueFilter === "OVERDUE"
              ? "Nothing overdue"
              : dueFilter === "TODAY"
                ? "Nothing due today"
                : dueFilter === "WEEK"
                  ? "Nothing due this week"
                  : "Everything here has a due date"
          }
          description="Change the due-date filter to see the rest."
          action={
            <Button onClick={() => setDueFilter("ALL")}>
              Any due date
            </Button>
          }
        />
      );
    }
    const onlyUnassigned =
      assigneeFilter.length === 1 && assigneeFilter[0] === UNASSIGNED;
    // Blame the assignee filter only when it alone leaves nothing in the
    // project. Otherwise another filter (status, "My tasks") is what emptied
    // the list, and those branches below say so.
    if (assigneeFilter.length > 0 && !inScopeTasks.some(matchesAssignee)) {
      return (
        <EmptyState
          compact
          icon="person_search"
          title={
            onlyUnassigned
              ? "Everything here is assigned"
              : assigneeFilter.length === 1
                ? "Nothing assigned to them"
                : "Nothing assigned to these people"
          }
          description="Change the assignee filter to see the rest."
          action={
            <Button onClick={() => setAssigneeFilter([])}>Any assignee</Button>
          }
        />
      );
    }
    if (onlyMine) {
      // "My tasks" plus an assignee filter that leaves the user out can only
      // ever be empty — the switch is hiding everyone the filter picked.
      const hidesPicked =
        assigneeFilter.length > 0 &&
        !assigneeFilter.includes(user?.id ?? "");
      return (
        <EmptyState
          compact
          icon="person_check"
          title={
            hidesPicked
              ? onlyUnassigned
                ? "“My tasks” hides unassigned tasks"
                : "“My tasks” hides the people you picked"
              : label
                ? `Nothing of yours in ${label}`
                : "Nothing assigned to you"
          }
          description="Turn off “My tasks” to see what the rest of the team is working on."
          action={
            <Button onClick={() => setOnlyMine(false)}>Show all tasks</Button>
          }
        />
      );
    }
    return (
      <EmptyState
        compact
        icon="filter_alt_off"
        title={
          !label
            ? "No tasks here"
            : assigneeFilter.length === 0
              ? `No ${label.toLowerCase()} tasks`
              : onlyUnassigned
                ? `No unassigned ${label.toLowerCase()} tasks`
                : `Nothing of theirs in ${label}`
        }
        description="Nothing matches this filter right now."
        action={
          statusFilter === "ALL" ? (
            newTaskButton
          ) : (
            <Button onClick={() => setStatusFilter("ALL")}>
              Clear filter
            </Button>
          )
        }
      />
    );
  })();

  const assigneeName = (t: CrmTaskWithTargets) =>
    (t.assignee_id ? memberById.get(t.assignee_id)?.name : undefined) ?? "";

  const allColumns: TableColumnsType<CrmTaskWithTargets> = [
    {
      title: "Task",
      key: "title",
      dataIndex: "title",
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (v: string, t) => {
        const meta = statusMeta(t.status);
        const done = t.status === "DONE";
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                flex: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: tint(meta.color, 0.12),
              }}
            >
              <MIcon name={meta.icon} size={17} color={meta.color} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 500,
                  lineHeight: 1.35,
                  color: done ? token.colorTextTertiary : token.colorText,
                  textDecoration: done ? "line-through" : undefined,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {v}
              </div>
              {t.body ? (
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.35,
                    color: token.colorTextTertiary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.body}
                </div>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      title: "Status",
      key: "status",
      width: colWidth("status"),
      sorter: (a, b) => statusRank(a.status) - statusRank(b.status),
      render: (_, t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Select<CrmTaskStatus>
            size="small"
            variant="borderless"
            value={t.status as CrmTaskStatus}
            style={{ width: 136, marginInlineStart: -7 }}
            onChange={(status) => changeStatus(t.id, status)}
            suffixIcon={
              <MIcon
                name="expand_more"
                size={14}
                color={token.colorTextQuaternary}
              />
            }
            labelRender={({ value }) => {
              const meta = statusMeta(value);
              return <TagPill label={meta.label} color={meta.color} />;
            }}
            options={CRM_TASK_STATUSES.map((s) => ({
              value: s.value,
              label: (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: s.color,
                      display: "inline-block",
                      flex: "none",
                    }}
                  />
                  {s.label}
                </span>
              ),
            }))}
          />
        </div>
      ),
    },
    {
      title: "Due",
      key: "due",
      dataIndex: "due_at",
      width: colWidth("due"),
      render: (v: string | null, t) => {
        if (!v)
          return <span style={{ color: token.colorTextQuaternary }}>—</span>;
        const overdue = t.status !== "DONE" && dayjs(v).isBefore(dayjs());
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              color: overdue ? token.colorError : token.colorText,
              fontWeight: overdue ? 500 : 400,
            }}
          >
            {overdue ? (
              <MIcon name="warning" size={14} color={token.colorError} />
            ) : null}
            {dayjs(v).format("MMM D, YYYY")}
          </span>
        );
      },
      sorter: (a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""),
    },
    {
      title: "Assignee",
      key: "assignee",
      width: colWidth("assignee"),
      sorter: (a, b) => assigneeName(a).localeCompare(assigneeName(b)),
      render: (_, t) => {
        const member = t.assignee_id
          ? memberById.get(t.assignee_id)
          : undefined;
        if (!member)
          return (
            <span style={{ color: token.colorTextQuaternary }}>Unassigned</span>
          );
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            <EntityAvatar
              name={member.name}
              kind="person"
              src={member.avatar}
              size={24}
            />
            <span
              style={{
                color: token.colorText,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {member.name}
            </span>
          </div>
        );
      },
    },
    {
      title: "Linked to",
      key: "targets",
      render: (_, t) => {
        const chips = t.targets
          .map((x) => {
            const name = recordName(x.target_type, x.target_id);
            if (!name) return null;
            const meta = entityMeta(x.target_type);
            const open = () =>
              setViewTarget({
                type: x.target_type as CrmTargetRef["type"],
                id: x.target_id,
              });
            return (
              <span
                key={x.id}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                  }
                }}
                style={{
                  cursor: "pointer",
                  display: "inline-flex",
                  maxWidth: 180,
                }}
              >
                <SoftChip tone="custom" color={meta.color} icon={meta.icon}>
                  {name}
                </SoftChip>
              </span>
            );
          })
          .filter(Boolean);
        if (chips.length === 0)
          return <span style={{ color: token.colorTextQuaternary }}>—</span>;
        // No click-swallowing wrapper: each chip is a role="button", which
        // CrmTable's row guard already leaves to the chip, so blank space in
        // this cell still opens the task like the rest of the row.
        return (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              minWidth: 0,
            }}
          >
            {chips}
          </div>
        );
      },
    },
    {
      title: "Date created",
      key: "created",
      dataIndex: "created_at",
      width: colWidth("created"),
      sorter: (a, b) => a.created_at.localeCompare(b.created_at),
      render: (v: string) => <DateCell value={v} />,
    },
    {
      title: "Last update",
      key: "updated",
      dataIndex: "updated_at",
      width: colWidth("updated"),
      sorter: (a, b) => a.updated_at.localeCompare(b.updated_at),
      render: (v: string) => <UpdatedCell value={v} />,
    },
    {
      title: "",
      key: "actions",
      width: 84,
      align: "right",
      fixed: "right",
      render: (_, t) => (
        <RowActions open={confirmId === t.id}>
          <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<MIcon name="edit" size={16} />}
              onClick={() => openEdit(t)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this task?"
            description="This cannot be undone — tasks have no Deleted bin."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onOpenChange={(open) =>
              setConfirmId((current) =>
                open ? t.id : current === t.id ? null : current,
              )
            }
            onConfirm={() => removeTask(t.id)}
          >
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                danger
                icon={<MIcon name="delete" size={16} />}
              />
            </Tooltip>
          </Popconfirm>
        </RowActions>
      ),
    },
  ];
  const columns = layout.arrange(allColumns);
  const scrollX = COLUMN_CHOICES.reduce(
    (x, c) => x + (layout.isVisible(c.key) ? colWidth(c.key) : 0),
    ALWAYS_WIDTH,
  );

  const toolbar = (
    <>
      <TableSearch
        value={search}
        onChange={setSearch}
        placeholder="Search tasks and what they're on…"
        width={260}
      />
      <FilterButton
        icon="donut_large"
        label={
          statusFilter === "ALL" ? "All statuses" : statusMeta(statusFilter).label
        }
        activeCount={statusFilter === "ALL" ? 0 : 1}
        onClear={() => setStatusFilter("ALL")}
        width={200}
      >
        <Radio.Group
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "ALL" | CrmTaskStatus)
          }
        >
          <div style={{ display: "grid", gap: 8 }}>
            <Radio value="ALL">All statuses</Radio>
            {CRM_TASK_STATUSES.map((s) => (
              <Radio key={s.value} value={s.value}>
                <TagPill label={s.label} color={s.color} />
              </Radio>
            ))}
          </div>
        </Radio.Group>
      </FilterButton>
      <FilterButton
        icon="event"
        label={
          DUE_OPTIONS.find((o) => o.value === dueFilter)?.label ??
          "Any due date"
        }
        activeCount={dueFilter === "ALL" ? 0 : 1}
        onClear={() => setDueFilter("ALL")}
        width={200}
      >
        <Radio.Group
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value as DueFilter)}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {DUE_OPTIONS.map((o) => (
              <Radio key={o.value} value={o.value}>
                {o.label}
              </Radio>
            ))}
          </div>
        </Radio.Group>
      </FilterButton>
      <FilterButton
        icon="person"
        label="Assignee"
        activeCount={assigneeFilter.length}
        onClear={() => setAssigneeFilter([])}
      >
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          maxTagCount="responsive"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={assigneeFilterOptions}
          placeholder="Any assignee"
          style={{ width: "100%" }}
        />
      </FilterButton>
      <ToolbarSpacer />
      <CrmToggle checked={onlyMine} onChange={setOnlyMine} label="My tasks" />
      <ManageColumns layout={layout} />
    </>
  );

  /* Bulk bar — a task list is worked in batches ("these six are done"), and
     doing that one row at a time is the whole cost of the screen. */
  const bulkBar =
    selected.length > 0 ? (
      <div
        style={{
          position: "sticky",
          bottom: 16,
          zIndex: 5,
          margin: "0 auto 16px",
          width: "fit-content",
          maxWidth: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "8px 10px",
          borderRadius: 10,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorder}`,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: token.colorText,
          }}
        >
          {selected.length} selected
        </span>
        <span style={{ width: 1, height: 18, background: token.colorSplit }} />
        {CRM_TASK_STATUSES.map((s) => (
          <Button
            key={s.value}
            size="small"
            disabled={bulkBusy}
            icon={<MIcon name={STATUS_META[s.value].icon} size={15} />}
            onClick={() =>
              void runBulk(`Marked ${s.label.toLowerCase()}`, (id) =>
                updateTask.mutateAsync({
                  id,
                  patch: { status: s.value },
                }),
              )
            }
          >
            {s.label}
          </Button>
        ))}
        <Popconfirm
          title={`Delete ${selected.length} task${selected.length === 1 ? "" : "s"}?`}
          okText="Delete"
          okButtonProps={{ danger: true }}
          onConfirm={() =>
            void runBulk("Deleted", (id) => deleteTask.mutateAsync(id))
          }
        >
          <Button
            size="small"
            danger
            disabled={bulkBusy}
            icon={<MIcon name="delete" size={15} />}
          >
            Delete
          </Button>
        </Popconfirm>
        <Tooltip title="Clear selection">
          <Button
            size="small"
            type="text"
            aria-label="Clear selection"
            onClick={() => setSelected([])}
            icon={<MIcon name="close" size={15} />}
          />
        </Tooltip>
      </div>
    ) : null;

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="Tasks"
        subtitle="Follow-ups and to-dos linked to the people, companies and deals you work."
        count={listLoading || isError ? null : rows.length}
        right={newTaskButton}
      />

      <CrmTableCard toolbar={toolbar} footer={bulkBar}>
        <CrmTable<CrmTaskWithTargets>
          rowKey="id"
          loading={listLoading}
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as string[]),
            preserveSelectedRowKeys: true,
          }}
          pagination={{ pageSize: 25, hideOnSinglePage: true }}
          // Task + "Linked to" need room to breathe next to the fixed-width
          // columns; without this the chips wrap to three rows.
          scroll={{ x: scrollX }}
          locale={{
            emptyText: listLoading ? <div style={{ height: 120 }} /> : emptyState,
          }}
          onRow={(t) => ({ onClick: () => openEdit(t) })}
          rowContextMenu={taskMenu}
          columns={columns}
        />
      </CrmTableCard>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit task" : "New task"}
        width={CRM_DRAWER_WIDTH}
        destroyOnHidden
        styles={{ body: CRM_DRAWER_BODY_STYLE }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          style={CRM_DRAWER_FORM_STYLE}
        >
          <CrmDrawerFields>
            <FormSection label="Task" first>
              <Form.Item
                name="title"
                label="Title"
                rules={[{ required: true, message: "Task title is required" }]}
              >
                <Input placeholder="What needs doing?" />
              </Form.Item>
              <Form.Item name="body" label="Details">
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
              </Form.Item>
            </FormSection>

            <FormSection label="Tracking">
              <Form.Item name="status" label="Status">
                <Select
                  options={CRM_TASK_STATUSES.map((s) => ({
                    value: s.value,
                    label: s.label,
                  }))}
                />
              </Form.Item>
              <Form.Item name="due_at" label="Due date">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="assignee_id" label="Assignee">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={memberOptions}
                  placeholder="Team member"
                />
              </Form.Item>
            </FormSection>

            {!editing && (
              <FormSection label="Relations">
                <Form.Item name="targets" label="Linked records">
                  <TargetPicker preferProjectId={projectId} />
                </Form.Item>
              </FormSection>
            )}
          </CrmDrawerFields>

          <CrmDrawerFooter>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createTask.isPending || updateTask.isPending}
            >
              {editing ? "Save changes" : "Create task"}
            </Button>
          </CrmDrawerFooter>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
