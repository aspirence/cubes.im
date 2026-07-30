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
  Segmented,
  Select,
  Table,
  Tooltip,
  theme,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  useCreateCrmTask,
  useCrmTasks,
  useDeleteCrmTask,
  useUpdateCrmTask,
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
import { TILE_GRID } from "../_components/layout";
import {
  CRM_DRAWER_BODY_STYLE,
  CRM_DRAWER_FORM_STYLE,
  CRM_DRAWER_WIDTH,
  CrmDrawerFields,
  CrmDrawerFooter,
} from "../_components/drawer-footer";
import {
  CrmPageHeader,
  CrmSearch,
  CrmToolbar,
  EmptyState,
  ErrorState,
  EntityAvatar,
  Panel,
  RowActions,
  SoftChip,
  StatTile,
  crmDate,
  crmPageStyle,
  tint,
} from "../_lib/ui";

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

export default function CrmTasksPage() {
  const { message } = App.useApp();
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

  const [statusFilter, setStatusFilter] = useState<"ALL" | CrmTaskStatus>(
    "ALL",
  );
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState("");
  const [dueFilter, setDueFilter] = useState<
    "ALL" | "OVERDUE" | "TODAY" | "WEEK" | "NONE"
  >("ALL");
  const [selected, setSelected] = useState<string[]>([]);
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

  const memberById = useMemo(() => {
    const map = new Map<string, { name: string; avatar: string | null }>();
    for (const m of members ?? [])
      if (m.user)
        map.set(m.user.id, { name: m.user.name, avatar: m.user.avatar_url });
    return map;
  }, [members]);

  /** Everything the "My tasks" switch keeps — the basis for the stat tiles. */
  const scoped = useMemo(
    () => (tasks ?? []).filter((t) => !onlyMine || t.assignee_id === user?.id),
    [tasks, onlyMine, user?.id],
  );

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

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return scoped
      .filter((t) => statusFilter === "ALL" || t.status === statusFilter)
      .filter(matchesDue)
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
    // `matchesDue` closes over dueFilter, which is in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, statusFilter, dueFilter, search, recordName]);

  const counts = useMemo(() => {
    const now = dayjs();
    const soon = now.add(7, "day");
    let todo = 0;
    let inProgress = 0;
    let done = 0;
    let overdueTodo = 0;
    let dueSoonInProgress = 0;
    for (const t of scoped) {
      if (t.status === "DONE") {
        done += 1;
        continue;
      }
      if (t.status === "IN_PROGRESS") inProgress += 1;
      else todo += 1;
      if (!t.due_at) continue;
      const due = dayjs(t.due_at);
      if (due.isBefore(now)) {
        if (t.status !== "IN_PROGRESS") overdueTodo += 1;
      } else if (t.status === "IN_PROGRESS" && due.isBefore(soon)) {
        dueSoonInProgress += 1;
      }
    }
    return {
      todo,
      inProgress,
      done,
      overdueTodo,
      dueSoonInProgress,
      total: scoped.length,
    };
  }, [scoped]);

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
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
        await createTask.mutateAsync({
          ...patch,
          targets: (values.targets ?? []).map(decodeTarget),
        });
        message.success("Task created.");
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

  /** Tile drill-down: click a status tile to filter, click it again to clear. */
  const toggleStatus = (status: CrmTaskStatus) =>
    setStatusFilter((current) => (current === status ? "ALL" : status));

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
    if (onlyMine) {
      return (
        <EmptyState
          compact
          icon="person_check"
          title={
            label ? `Nothing of yours in ${label}` : "Nothing assigned to you"
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
        title={label ? `No ${label.toLowerCase()} tasks` : "No tasks here"}
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

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="Tasks"
        subtitle="Follow-ups and to-dos linked to the people, companies and deals you work."
        count={isLoading || isError ? null : rows.length}
      />

      <CrmToolbar>
        <Segmented
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "ALL" | CrmTaskStatus)}
          options={[
            { value: "ALL", label: "All" },
            ...CRM_TASK_STATUSES.map((s) => ({
              value: s.value,
              label: s.label,
            })),
          ]}
        />
        <Select
          value={dueFilter}
          onChange={setDueFilter}
          style={{ minWidth: 150 }}
          options={[
            { value: "ALL", label: "Any due date" },
            { value: "OVERDUE", label: "Overdue" },
            { value: "TODAY", label: "Due today" },
            { value: "WEEK", label: "Due this week" },
            { value: "NONE", label: "No due date" },
          ]}
        />
        <CrmSearch
          value={search}
          onChange={setSearch}
          placeholder="Search tasks and what they're on…"
          width={260}
        />
        <CrmToggle
          checked={onlyMine}
          onChange={setOnlyMine}
          label="My tasks"
        />
        <div style={{ marginLeft: "auto" }}>{newTaskButton}</div>
      </CrmToolbar>

      <div style={TILE_GRID}>
        <StatTile
          icon={STATUS_META.TODO.icon}
          color={STATUS_META.TODO.color}
          label="To do"
          value={counts.todo}
          hint={
            counts.overdueTodo > 0
              ? `${counts.overdueTodo} overdue`
              : "Nothing overdue"
          }
          onClick={() => toggleStatus("TODO")}
        />
        <StatTile
          icon={STATUS_META.IN_PROGRESS.icon}
          color={STATUS_META.IN_PROGRESS.color}
          label="In progress"
          value={counts.inProgress}
          hint={
            counts.dueSoonInProgress > 0
              ? `${counts.dueSoonInProgress} due within 7 days`
              : "No deadlines this week"
          }
          onClick={() => toggleStatus("IN_PROGRESS")}
        />
        <StatTile
          icon={STATUS_META.DONE.icon}
          color={STATUS_META.DONE.color}
          label="Done"
          value={counts.done}
          hint={
            counts.total > 0
              ? `${Math.round((counts.done / counts.total) * 100)}% of ${counts.total} tasks`
              : "Nothing completed yet"
          }
          onClick={() => toggleStatus("DONE")}
        />
      </div>

      <Panel padding={0}>
        <Table<CrmTaskWithTargets>
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as string[]),
            preserveSelectedRowKeys: true,
          }}
          pagination={{
            pageSize: 25,
            hideOnSinglePage: true,
            style: { marginInline: 16 },
          }}
          // Title + "Linked to" need room to breathe next to the 590px of
          // fixed columns; without this the chips wrap to three rows.
          scroll={{ x: 1080 }}
          locale={{
            emptyText: isLoading ? <div style={{ height: 120 }} /> : emptyState,
          }}
          onRow={(t) => ({
            onClick: () => openEdit(t),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Task",
              dataIndex: "title",
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
                          color: done
                            ? token.colorTextTertiary
                            : token.colorText,
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
              width: 168,
              render: (_, t) => (
                <div onClick={(e) => e.stopPropagation()}>
                  <Select<CrmTaskStatus>
                    size="small"
                    variant="borderless"
                    value={t.status as CrmTaskStatus}
                    style={{ width: 148 }}
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
                      return (
                        <SoftChip
                          tone="custom"
                          color={meta.color}
                          icon={meta.icon}
                          style={{ height: 20 }}
                        >
                          {meta.label}
                        </SoftChip>
                      );
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
              dataIndex: "due_at",
              width: 148,
              render: (v: string | null, t) => {
                if (!v)
                  return (
                    <span style={{ color: token.colorTextQuaternary }}>—</span>
                  );
                const overdue =
                  t.status !== "DONE" && dayjs(v).isBefore(dayjs());
                return (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: overdue
                        ? token.colorError
                        : token.colorTextSecondary,
                      fontWeight: overdue ? 500 : 400,
                    }}
                  >
                    {overdue ? (
                      <MIcon
                        name="warning"
                        size={14}
                        color={token.colorError}
                      />
                    ) : null}
                    {crmDate(v)}
                  </span>
                );
              },
              sorter: (a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""),
            },
            {
              title: "Assignee",
              key: "assignee",
              width: 190,
              render: (_, t) => {
                const member = t.assignee_id
                  ? memberById.get(t.assignee_id)
                  : undefined;
                if (!member)
                  return (
                    <span style={{ color: token.colorTextQuaternary }}>
                      Unassigned
                    </span>
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
                        color: token.colorTextSecondary,
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
                        <SoftChip
                          tone="custom"
                          color={meta.color}
                          icon={meta.icon}
                        >
                          {name}
                        </SoftChip>
                      </span>
                    );
                  })
                  .filter(Boolean);
                if (chips.length === 0)
                  return (
                    <span style={{ color: token.colorTextQuaternary }}>—</span>
                  );
                return (
                  <div
                    onClick={(e) => e.stopPropagation()}
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
              title: "",
              key: "actions",
              width: 84,
              align: "right",
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
                    onConfirm={async () => {
                      try {
                        await deleteTask.mutateAsync(t.id);
                        message.success("Task deleted.");
                      } catch (err) {
                        message.error(errMsg(err, "Failed to delete task."));
                      }
                    }}
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
          ]}
        />

        {/* Bulk bar — a task list is worked in batches ("these six are done"),
            and doing that one row at a time is the whole cost of the screen. */}
        {selected.length > 0 ? (
          <div
            style={{
              position: "sticky",
              bottom: 16,
              zIndex: 5,
              margin: "0 auto 16px",
              width: "fit-content",
              display: "flex",
              alignItems: "center",
              gap: 8,
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
            <span
              style={{ width: 1, height: 18, background: token.colorSplit }}
            />
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
        ) : null}
      </Panel>

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
                  <TargetPicker />
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
