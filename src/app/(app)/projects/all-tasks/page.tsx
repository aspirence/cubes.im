"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Avatar, Empty, Skeleton, Tooltip } from "antd";
import { useTaskDrawer } from "@/store/task-drawer-store";
import {
  useAllTeamTasks,
  type TeamTaskWithProject,
  type AllTaskStatusEmbed,
} from "@/features/tasks/use-all-tasks";

/* -------------------------------------------------------------------------- */
/* Design tokens (canonical handoff).                                         */
/* -------------------------------------------------------------------------- */

const T = {
  accent: "#4a4ad0",
  panel: "#ffffff",
  hairline: "#ececf0",
  innerDivider: "#f0f0f3",
  textPrimary: "#17171c",
  textSecondary: "#6a6d78",
  textTertiary: "#9a9da8",
  textFaint: "#a2a5af",
  overdue: "#c0453c",
  rowHover: "#fafafb",
  mono: "var(--font-geist-mono)",
} as const;

// Grid: NAME / PROJECT / ASSIGNEE / DUE DATE / PRIORITY
const GRID_COLUMNS = "minmax(0,1fr) 172px 118px 128px 118px";
const MIN_ROW_WIDTH = 820;

// Solid avatar/category palette for pills/avatars without a colour of their own.
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

/** A status-category glyph name for the status circle icon. */
function statusGlyph(cat: AllTaskStatusEmbed["category"] | null | undefined): string {
  if (!cat) return "radio_button_unchecked";
  if (cat.is_done) return "check_circle";
  if (cat.is_doing) return "change_circle";
  if (cat.is_todo) return "radio_button_unchecked";
  return "pending";
}

/* ---- priority colour mapping (by name, with color_code fallback) --------- */

function priorityColor(
  name: string | null | undefined,
  fallback?: string | null,
): string {
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

/** A project chip: colour dot + project name. */
function ProjectChip({ project }: { project: TeamTaskWithProject["project"] }) {
  const dot = project.color_code || paletteFor(project.id);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        maxWidth: "100%",
      }}
      title={project.name}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dot,
          flex: "0 0 auto",
        }}
      />
      <span
        style={{
          fontSize: 12.5,
          color: T.textSecondary,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {project.name}
      </span>
    </span>
  );
}

function AssigneeAvatars({
  assignees,
}: {
  assignees: TeamTaskWithProject["assignees"];
}) {
  if (!assignees || assignees.length === 0) {
    return <span style={{ fontSize: 12.5, color: T.textTertiary }}>—</span>;
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
function DueDateCell({ task }: { task: TeamTaskWithProject }) {
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
      {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </span>
  );
}

/** A priority cell: filled flag glyph coloured by priority + label. */
function PriorityCell({ task }: { task: TeamTaskWithProject }) {
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

function ColumnHeader() {
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
      <span style={cellStyle}>Project</span>
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
  task: TeamTaskWithProject;
  groupColor: string;
  onOpen: (task: TeamTaskWithProject) => void;
}

function TaskRowItem({ task, groupColor, onOpen }: TaskRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
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
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
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
            #{task.task_no}
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

      {/* PROJECT */}
      <div style={{ minWidth: 0 }}>
        <ProjectChip project={task.project} />
      </div>

      {/* ASSIGNEE */}
      <div style={{ minWidth: 0 }}>
        <AssigneeAvatars assignees={task.assignees} />
      </div>

      {/* DUE DATE */}
      <div style={{ minWidth: 0 }}>
        <DueDateCell task={task} />
      </div>

      {/* PRIORITY */}
      <div style={{ minWidth: 0 }}>
        <PriorityCell task={task} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A collapsible group (one status category / status).                        */
/* -------------------------------------------------------------------------- */

interface TaskGroup {
  key: string;
  title: string;
  color: string;
  glyph: string;
  sortOrder: number;
  tasks: TeamTaskWithProject[];
}

function TaskGroupSection({
  group,
  onOpen,
}: {
  group: TaskGroup;
  onOpen: (task: TeamTaskWithProject) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

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

        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.textFaint }}>
          {group.tasks.length}
        </span>
      </div>

      {!collapsed && (
        <>
          <ColumnHeader />
          {group.tasks.map((task) => (
            <TaskRowItem
              key={task.id}
              task={task}
              groupColor={group.color}
              onOpen={onOpen}
            />
          ))}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page.                                                                      */
/* -------------------------------------------------------------------------- */

export default function AllTasksPage() {
  App.useApp();
  const router = useRouter();
  const openDrawer = useTaskDrawer((s) => s.open);

  const { data, isLoading } = useAllTeamTasks();
  const tasks = useMemo(() => data ?? [], [data]);

  /* ----- grouping by status (folded to category order) ----- */
  const groups: TaskGroup[] = useMemo(() => {
    const byStatus = new Map<string, TaskGroup>();
    const noStatus: TeamTaskWithProject[] = [];

    for (const t of tasks) {
      const cat = t.status?.category;
      if (!cat) {
        noStatus.push(t);
        continue;
      }
      // Aggregate across projects: bucket by status CATEGORY (To Do / Doing /
      // Done) so all projects' same-category statuses fold into one group.
      const key = cat.id;
      const existing = byStatus.get(key);
      if (existing) {
        existing.tasks.push(t);
      } else {
        byStatus.set(key, {
          key,
          title: cat.name,
          color: cat.color_code ?? paletteFor(key),
          glyph: statusGlyph(cat),
          sortOrder: cat.sort_order ?? 99,
          tasks: [t],
        });
      }
    }

    const result = Array.from(byStatus.values()).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );

    if (noStatus.length > 0) {
      result.push({
        key: "__no_status__",
        title: "No status",
        color: "#8a8d98",
        glyph: "radio_button_unchecked",
        sortOrder: Number.MAX_SAFE_INTEGER,
        tasks: noStatus,
      });
    }
    return result;
  }, [tasks]);

  /* ----- row click: open shared drawer, fall back to project ----- */
  const handleOpen = (task: TeamTaskWithProject) => {
    if (openDrawer) {
      openDrawer(task.id);
    } else {
      router.push(`/projects/${task.project.id}`);
    }
  };

  /* ----- header ----- */
  const header = (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <h1
        style={{
          margin: 0,
          fontSize: 21,
          fontWeight: 600,
          color: T.textPrimary,
          letterSpacing: -0.2,
        }}
      >
        All Tasks
      </h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: T.textSecondary,
        }}
      >
        <span>Every task across your team&apos;s projects</span>
        <span aria-hidden style={{ color: T.textFaint }}>
          ·
        </span>
        <span style={{ fontFamily: T.mono, color: T.textFaint }}>
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
      </div>
    </div>
  );

  /* ----- loading skeleton ----- */
  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {header}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                background: T.panel,
                border: `1px solid ${T.hairline}`,
                borderRadius: 12,
                padding: 18,
              }}
            >
              <Skeleton active paragraph={{ rows: 3 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ----- empty state ----- */
  if (tasks.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {header}
        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.hairline}`,
            borderRadius: 12,
            padding: 48,
          }}
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No tasks across your projects yet"
          />
        </div>
      </div>
    );
  }

  /* ----- grouped list ----- */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {header}
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
              onOpen={handleOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
