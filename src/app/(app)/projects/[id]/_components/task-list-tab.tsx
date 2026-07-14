"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Empty,
  Input,
  Segmented,
  Skeleton,
  Space,
  theme,
  Tooltip,
} from "antd";
import { useTaskDrawer } from "@/store/task-drawer-store";
import {
  useTasks,
  useCreateTask,
  type TaskWithRelations,
} from "@/features/tasks/use-tasks";
import {
  useTaskStatuses,
  useTaskPriorities,
  type TaskStatusWithCategory,
} from "@/features/tasks/use-task-statuses";
import { useTasksRealtime } from "@/features/tasks/use-tasks-realtime";
import { useTeamLabels } from "@/features/settings/use-labels";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { TaskIdLabel } from "@/features/tasks/task-id-label";
import {
  FilterControl,
  type FilterField,
  type FilterValues,
} from "@/components/filters/filter-control";

type GroupBy = "status" | "priority" | "assignee";

/* -------------------------------------------------------------------------- */
/* Design tokens (canonical handoff).                                         */
/* -------------------------------------------------------------------------- */

function useListTokens() {
  const { token } = theme.useToken();
  return useMemo(
    () => ({
      accent: "#4a4ad0",
      canvas: token.colorBgLayout,
      panel: token.colorBgContainer,
      hairline: token.colorBorderSecondary,
      innerDivider: token.colorSplit,
      chip: token.colorFillTertiary,
      textPrimary: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      textFaint: token.colorTextQuaternary,
      overdue: "#c0453c",
      rowHover: token.colorFillQuaternary,
      mono: "var(--font-geist-mono)",
    }),
    [token],
  );
}

type ListTokens = ReturnType<typeof useListTokens>;

// Grid: NAME / ASSIGNEE / DUE DATE / PRIORITY
const GRID_COLUMNS = "minmax(0,1fr) 118px 150px 130px";
const MIN_ROW_WIDTH = 660;

// Solid avatar/category palette for group pills w/o a colour of their own.
const PALETTE = [
  "#5a5ad6",
  "#e0a83e",
  "#3a9d6e",
  "#8b6fd6",
  "#2f9c9c",
  "#d96a8f",
  "#e0663f",
  "#8a8d98",
] as const;

function paletteFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * A status-category glyph name for the status circle icon. Falls back to
 * a neutral radio when the category flags aren't loaded.
 */
function statusGlyph(cat: TaskStatusWithCategory["category"] | undefined): string {
  if (!cat) return "radio_button_unchecked";
  if (cat.is_done) return "check_circle";
  if (cat.is_doing) return "change_circle";
  if (cat.is_todo) return "radio_button_unchecked";
  return "pending";
}

/* ---- priority colour mapping (by name, with color_code fallback) --------- */

function priorityColor(name: string | null | undefined, fallback?: string | null): string {
  switch ((name ?? "").toLowerCase()) {
    case "urgent":
    case "high":
      return "#e0574e";
    case "medium":
      return "#e0a83e";
    case "low":
      return "#b0b3bc";
    default:
      return fallback ?? "#b0b3bc";
  }
}

/* -------------------------------------------------------------------------- */
/* Small presentational helpers.                                              */
/* -------------------------------------------------------------------------- */

function MSIcon({
  name,
  size = 18,
  color,
  fill = false,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  fill?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{
        fontSize: size,
        lineHeight: 1,
        color,
        fontVariationSettings: fill ? "'FILL' 1" : "'FILL' 0",
        ...style,
      }}
    >
      {name}
    </span>
  );
}

function AssigneeAvatars({
  assignees,
  t: T,
}: {
  assignees: TaskWithRelations["assignees"];
  t: ListTokens;
}) {
  if (!assignees || assignees.length === 0) {
    return (
      <span style={{ fontSize: 12.5, color: T.textTertiary }}>—</span>
    );
  }
  return (
    <Avatar.Group
      max={{ count: 3, style: { backgroundColor: "#8a8d98", fontSize: 11 } }}
      size={24}
    >
      {assignees.map((a) => {
        const user = a.team_member?.user;
        const name = user?.name ?? "Member";
        return (
          <Tooltip key={a.team_member_id} title={name}>
            <Avatar
              size={24}
              src={user?.avatar_url ?? undefined}
              style={{
                backgroundColor: paletteFor(a.team_member_id),
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {name.charAt(0).toUpperCase()}
            </Avatar>
          </Tooltip>
        );
      })}
    </Avatar.Group>
  );
}

/** A due-date cell: mono, red when overdue (and not done). */
function DueDateCell({ task, t: T }: { task: TaskWithRelations; t: ListTokens }) {
  const iso = task.end_date;
  if (!iso) {
    return <span style={{ fontSize: 12.5, color: T.textTertiary }}>—</span>;
  }
  const due = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const overdue = !task.done && due.getTime() < startOfToday.getTime();
  return (
    <span
      style={{
        fontFamily: T.mono,
        fontSize: 12.5,
        color: overdue ? T.overdue : T.textSecondary,
        fontWeight: overdue ? 600 : 400,
      }}
    >
      {due.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}
    </span>
  );
}

/** A priority cell: filled flag glyph coloured by priority + label. */
function PriorityCell({ task, t: T }: { task: TaskWithRelations; t: ListTokens }) {
  const p = task.priority;
  if (!p?.name) {
    return <span style={{ fontSize: 12.5, color: T.textTertiary }}>—</span>;
  }
  const color = priorityColor(p.name, p.color_code);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <MSIcon name="flag" size={16} color={color} fill />
      <span style={{ fontSize: 12.5, color: T.textSecondary }}>{p.name}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Column header row.                                                         */
/* -------------------------------------------------------------------------- */

function ColumnHeader({ t: T }: { t: ListTokens }) {
  const cellStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: T.textFaint,
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLUMNS,
        alignItems: "center",
        gap: 12,
        padding: "6px 16px",
        borderBottom: `1px solid ${T.innerDivider}`,
      }}
    >
      <span style={cellStyle}>Name</span>
      <span style={cellStyle}>Assignee</span>
      <span style={cellStyle}>Due date</span>
      <span style={cellStyle}>Priority</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A single task row.                                                         */
/* -------------------------------------------------------------------------- */

interface TaskRowProps {
  task: TaskWithRelations;
  groupColor: string;
  onOpen: (taskId: string) => void;
  t: ListTokens;
}

function TaskRowItem({ task, groupColor, onOpen, t: T }: TaskRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLUMNS,
        alignItems: "center",
        gap: 12,
        padding: "9px 16px",
        borderBottom: `1px solid ${T.innerDivider}`,
        background: hover ? T.rowHover : T.panel,
        cursor: "pointer",
        transition: "background 120ms ease",
      }}
    >
      {/* NAME (status circle + #key + name) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
        }}
      >
        <MSIcon
          name={task.done ? "check_circle" : "radio_button_unchecked"}
          size={18}
          color={groupColor}
          fill={Boolean(task.done)}
        />
        {task.task_no != null ? (
          <span
            style={{
              fontFamily: T.mono,
              fontSize: 11.5,
              color: T.textTertiary,
              flex: "0 0 auto",
            }}
          >
            <TaskIdLabel projectId={task.project_id} taskNo={task.task_no} />
          </span>
        ) : null}
        <span
          style={{
            fontSize: 13,
            color: task.done ? T.textTertiary : T.textPrimary,
            textDecoration: task.done ? "line-through" : undefined,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={task.name}
        >
          {task.name}
        </span>
      </div>

      {/* ASSIGNEE */}
      <div style={{ minWidth: 0 }}>
        <AssigneeAvatars assignees={task.assignees} t={T} />
      </div>

      {/* DUE DATE */}
      <div style={{ minWidth: 0 }}>
        <DueDateCell task={task} t={T} />
      </div>

      {/* PRIORITY */}
      <div style={{ minWidth: 0 }}>
        <PriorityCell task={task} t={T} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A collapsible group (one task_status, one priority, or one assignee).      */
/* -------------------------------------------------------------------------- */

interface TaskGroup {
  key: string;
  title: string;
  /** Solid pill colour + status-circle colour for this group. */
  color: string;
  /** Material glyph used inside the solid pill. */
  glyph: string;
  tasks: TaskWithRelations[];
  /** The status id to create new tasks into (only set when grouping by status). */
  createStatusId?: string;
}

interface TaskGroupSectionProps {
  group: TaskGroup;
  onOpen: (taskId: string) => void;
  onAddTask: (name: string, statusId: string | undefined) => Promise<void>;
  addDisabled: boolean;
  t: ListTokens;
}

function TaskGroupSection({
  group,
  onOpen,
  onAddTask,
  addDisabled,
  t: T,
}: TaskGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addHover, setAddHover] = useState(false);

  const submitDraft = async () => {
    const name = draftName.trim();
    if (!name || adding) return;
    setAdding(true);
    try {
      await onAddTask(name, group.createStatusId);
      setDraftName("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      style={{
        background: T.panel,
        border: `1px solid ${T.hairline}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(16,24,40,.04)",
        overflow: "hidden",
      }}
    >
      {/* Group header: caret + solid pill + count */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 16px",
          borderBottom: collapsed ? "none" : `1px solid ${T.innerDivider}`,
        }}
      >
        <button
          type="button"
          aria-label={collapsed ? "Expand group" : "Collapse group"}
          onClick={() => setCollapsed((c) => !c)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            color: T.textTertiary,
          }}
        >
          <MSIcon name={collapsed ? "chevron_right" : "expand_more"} size={20} />
        </button>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 10px 3px 8px",
            borderRadius: 6,
            background: group.color,
            color: "#ffffff",
          }}
        >
          <MSIcon name={group.glyph} size={14} color="#ffffff" fill />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.2,
              textTransform: "uppercase",
            }}
          >
            {group.title}
          </span>
        </span>

        <span
          style={{
            fontFamily: T.mono,
            fontSize: 12,
            color: T.textFaint,
          }}
        >
          {group.tasks.length}
        </span>
      </div>

      {!collapsed && (
        <>
          <ColumnHeader t={T} />

          {group.tasks.map((task) => (
            <TaskRowItem
              key={task.id}
              task={task}
              groupColor={group.color}
              onOpen={onOpen}
              t={T}
            />
          ))}

          {/* Add-task ghost row */}
          <div
            onMouseEnter={() => setAddHover(true)}
            onMouseLeave={() => setAddHover(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 16px",
              background: addHover ? T.rowHover : T.panel,
              transition: "background 120ms ease",
            }}
          >
            <MSIcon name="add" size={18} color={T.textTertiary} />
            <Input
              variant="borderless"
              placeholder="Add Task"
              value={draftName}
              disabled={addDisabled || adding}
              onChange={(e) => setDraftName(e.target.value)}
              onPressEnter={submitDraft}
              onBlur={submitDraft}
              style={{
                fontSize: 13,
                padding: 0,
                color: T.textSecondary,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared select-option dot.                                                  */
/* -------------------------------------------------------------------------- */



/* -------------------------------------------------------------------------- */
/* The tab.                                                                   */
/* -------------------------------------------------------------------------- */

export function TaskListTab({ projectId }: { projectId: string }) {
  const { message } = App.useApp();
  const T = useListTokens();

  // Live updates: re-fetch tasks when the project's tasks change.
  useTasksRealtime(projectId);

  const tasksQuery = useTasks(projectId);
  const statusesQuery = useTaskStatuses(projectId);
  const prioritiesQuery = useTaskPriorities();
  const labelsQuery = useTeamLabels();
  const membersQuery = useTeamMembers();

  const createTask = useCreateTask();

  const allTasks = tasksQuery.data ?? [];
  const statuses = statusesQuery.data ?? [];
  const priorities = prioritiesQuery.data ?? [];
  const labels = labelsQuery.data ?? [];

  const members = useMemo(
    () =>
      (membersQuery.data ?? [])
        .filter((m) => m.user)
        .map((m) => ({ id: m.id, name: m.user?.name ?? "Member" })),
    [membersQuery.data],
  );

  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [filters, setFilters] = useState<FilterValues>({});

  const filterFields = useMemo<FilterField[]>(
    () => [
      {
        key: "status",
        label: "Status",
        icon: "adjust",
        options: statuses.map((s) => ({
          value: s.id,
          label: s.name,
          dot: s.category?.color_code ?? "#d9d9d9",
        })),
      },
      {
        key: "priority",
        label: "Priority",
        icon: "flag",
        options: priorities.map((p) => ({
          value: p.id,
          label: p.name,
          dot: priorityColor(p.name, p.color_code),
        })),
      },
      {
        key: "label",
        label: "Label",
        icon: "sell",
        options: labels.map((l) => ({ value: l.id, label: l.name, dot: l.color_code })),
      },
      {
        key: "assignee",
        label: "Assignee",
        icon: "person",
        options: members.map((m) => ({ value: m.id, label: m.name })),
      },
    ],
    [statuses, priorities, labels, members],
  );

  /* ----- client-side filtering (multi-value, AND across fields) ----- */
  const tasks = useMemo(() => {
    const st = filters.status,
      pr = filters.priority,
      lb = filters.label,
      asg = filters.assignee;
    if (!st?.length && !pr?.length && !lb?.length && !asg?.length) return allTasks;
    return allTasks.filter((t) => {
      if (st?.length && (!t.status_id || !st.includes(t.status_id))) return false;
      if (pr?.length && (!t.priority_id || !pr.includes(t.priority_id))) return false;
      if (lb?.length && !(t.labels ?? []).some((l) => lb.includes(l.label_id))) return false;
      if (asg?.length && !(t.assignees ?? []).some((a) => asg.includes(a.team_member_id)))
        return false;
      return true;
    });
  }, [allTasks, filters]);

  const open = useTaskDrawer((s) => s.open);

  /* ----- grouping ----- */
  const groups: TaskGroup[] = useMemo(() => {
    if (groupBy === "status") {
      const byStatus = new Map<string, TaskWithRelations[]>();
      const noStatus: TaskWithRelations[] = [];
      for (const t of tasks) {
        if (t.status_id) {
          const arr = byStatus.get(t.status_id) ?? [];
          arr.push(t);
          byStatus.set(t.status_id, arr);
        } else {
          noStatus.push(t);
        }
      }
      const result: TaskGroup[] = statuses.map((s) => ({
        key: s.id,
        title: s.name,
        color: s.category?.color_code ?? paletteFor(s.id),
        glyph: statusGlyph(s.category),
        tasks: byStatus.get(s.id) ?? [],
        createStatusId: s.id,
      }));
      if (noStatus.length > 0) {
        result.push({
          key: "__no_status__",
          title: "No status",
          color: T.textTertiary,
          glyph: "radio_button_unchecked",
          tasks: noStatus,
          createStatusId: undefined,
        });
      }
      return result;
    }

    if (groupBy === "priority") {
      const byPriority = new Map<string, TaskWithRelations[]>();
      const noPriority: TaskWithRelations[] = [];
      for (const t of tasks) {
        if (t.priority_id) {
          const arr = byPriority.get(t.priority_id) ?? [];
          arr.push(t);
          byPriority.set(t.priority_id, arr);
        } else {
          noPriority.push(t);
        }
      }
      const result: TaskGroup[] = priorities.map((p) => ({
        key: p.id,
        title: p.name,
        color: priorityColor(p.name, p.color_code),
        glyph: "flag",
        tasks: byPriority.get(p.id) ?? [],
        createStatusId: undefined,
      }));
      if (noPriority.length > 0) {
        result.push({
          key: "__no_priority__",
          title: "No priority",
          color: T.textTertiary,
          glyph: "flag",
          tasks: noPriority,
          createStatusId: undefined,
        });
      }
      return result;
    }

    // group by assignee (a task appears under each of its assignees;
    // unassigned tasks go to a dedicated group)
    const byMember = new Map<string, TaskWithRelations[]>();
    const unassigned: TaskWithRelations[] = [];
    for (const t of tasks) {
      const assignees = t.assignees ?? [];
      if (assignees.length === 0) {
        unassigned.push(t);
        continue;
      }
      for (const a of assignees) {
        const arr = byMember.get(a.team_member_id) ?? [];
        arr.push(t);
        byMember.set(a.team_member_id, arr);
      }
    }
    const result: TaskGroup[] = members
      .filter((m) => (byMember.get(m.id) ?? []).length > 0)
      .map((m) => ({
        key: m.id,
        title: m.name,
        color: paletteFor(m.id),
        glyph: "person",
        tasks: byMember.get(m.id) ?? [],
        createStatusId: undefined,
      }));
    if (unassigned.length > 0) {
      result.push({
        key: "__unassigned__",
        title: "Unassigned",
        color: T.textTertiary,
        glyph: "person",
        tasks: unassigned,
        createStatusId: undefined,
      });
    }
    return result;
  }, [groupBy, tasks, statuses, priorities, members, T]);

  /* ----- mutations ----- */
  const handleAddTask = async (name: string, statusId: string | undefined) => {
    try {
      await createTask.mutateAsync({ name, projectId, statusId });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to create task.",
      );
    }
  };

  /* ----- render ----- */
  const isLoading = tasksQuery.isLoading || statusesQuery.isLoading;

  if (isLoading) {
    return (
      <div
        style={{
          background: T.panel,
          border: `1px solid ${T.hairline}`,
          borderRadius: 12,
          padding: 18,
        }}
      >
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Toolbar: group-by + count */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Space size={10} wrap>
          <span style={{ fontSize: 13, color: T.textSecondary }}>Group by</span>
          <Segmented<GroupBy>
            value={groupBy}
            onChange={(value) => setGroupBy(value)}
            options={[
              { label: "Status", value: "status" },
              { label: "Priority", value: "priority" },
              { label: "Assignee", value: "assignee" },
            ]}
          />
          <FilterControl
            fields={filterFields}
            value={filters}
            onChange={setFilters}
            buttonSize="small"
          />
        </Space>
        <span style={{ fontSize: 13, color: T.textSecondary }}>
          <span style={{ fontFamily: T.mono }}>
            {tasks.length === allTasks.length
              ? tasks.length
              : `${tasks.length}/${allTasks.length}`}
          </span>{" "}
          {tasks.length === 1 && tasks.length === allTasks.length
            ? "task"
            : "tasks"}
        </span>
      </div>

      {groups.length === 0 ? (
        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.hairline}`,
            borderRadius: 12,
            padding: 32,
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No tasks yet"
          />
        </div>
      ) : (
        // Horizontal scroll region so the grid stays readable under ~660px.
        <div className="wl-hscroll" style={{ overflowX: "auto" }}>
          <div
            style={{
              minWidth: MIN_ROW_WIDTH,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {groups.map((group) => (
              <TaskGroupSection
                key={group.key}
                group={group}
                onOpen={open}
                onAddTask={handleAddTask}
                addDisabled={createTask.isPending}
                t={T}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
