"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Avatar, Skeleton, theme, Tooltip } from "antd";
import { useTaskDrawer } from "@/store/task-drawer-store";
import {
  useAllTeamTasks,
  type TeamTaskWithProject,
  type AllTaskStatusEmbed,
} from "@/features/tasks/use-all-tasks";

/* -------------------------------------------------------------------------- */
/* Design tokens (canonical handoff).                                         */
/* -------------------------------------------------------------------------- */

type Tokens = {
  accent: string;
  panel: string;
  hairline: string;
  innerDivider: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textFaint: string;
  overdue: string;
  chipFill: string;
  countFill: string;
  primaryBg: string;
  mono: string;
};

// Grid: NAME / PROJECT / ASSIGNEE / DUE DATE / PRIORITY
const GRID_COLUMNS = "minmax(0,1fr) 172px 118px 128px 118px";
const MIN_ROW_WIDTH = 820;

// Colour is reserved for meaning: priority tones match My Tasks exactly so the
// same priority reads the same everywhere.
const PRIORITY_TONE: Record<string, string> = {
  urgent: "#c0453c",
  high: "#c0453c",
  medium: "#c98a1b",
  low: "#2f8f5f",
};

/** A status-category glyph name for the status circle icon. */
function statusGlyph(cat: AllTaskStatusEmbed["category"] | null | undefined): string {
  if (!cat) return "radio_button_unchecked";
  if (cat.is_done) return "check_circle";
  if (cat.is_doing) return "change_circle";
  if (cat.is_todo) return "radio_button_unchecked";
  return "pending";
}

/** Up to two initials for the brand-tinted avatar circles. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
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

/** A project chip: folder icon + name pill, matching the My Tasks chip. */
function ProjectChip({
  project,
  T,
}: {
  project: TeamTaskWithProject["project"];
  T: Tokens;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: "100%",
        fontSize: 11.5,
        color: T.textSecondary,
        background: T.chipFill,
        border: `1px solid ${T.hairline}`,
        borderRadius: 999,
        padding: "2px 9px",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
      title={project.name}
    >
      <MSIcon name="folder_open" size={13} color={T.textTertiary} style={{ flex: "none" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
        {project.name}
      </span>
    </span>
  );
}

function AssigneeAvatars({
  assignees,
  T,
}: {
  assignees: TeamTaskWithProject["assignees"];
  T: Tokens;
}) {
  if (!assignees || assignees.length === 0) {
    return <span style={{ fontSize: 12.5, color: T.textTertiary }}>—</span>;
  }
  // Uniform brand-tinted initials — people don't get their own colours.
  const tintStyle: React.CSSProperties = {
    backgroundColor: T.primaryBg,
    color: T.accent,
    fontSize: 10.5,
    fontWeight: 700,
  };
  return (
    <Avatar.Group max={{ count: 3, style: tintStyle }} size={26}>
      {assignees.map((a) => {
        const user = a.team_member?.user;
        const name = user?.name ?? "Member";
        return (
          <Tooltip key={a.team_member_id} title={name}>
            <Avatar size={26} src={user?.avatar_url ?? undefined} style={tintStyle}>
              {initials(name)}
            </Avatar>
          </Tooltip>
        );
      })}
    </Avatar.Group>
  );
}

/** A due-date cell: mono, error tone when overdue (and not done). */
function DueDateCell({ task, T }: { task: TeamTaskWithProject; T: Tokens }) {
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
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: T.mono,
        fontSize: 12.5,
        color: overdue ? T.overdue : T.textSecondary,
        fontWeight: overdue ? 600 : 400,
      }}
    >
      {overdue ? <MSIcon name="warning" size={13} color={T.overdue} /> : null}
      {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
    </span>
  );
}

/** A priority cell: filled flag glyph coloured by priority + label. */
function PriorityCell({ task, T }: { task: TeamTaskWithProject; T: Tokens }) {
  const p = task.priority;
  if (!p?.name) {
    return <span style={{ fontSize: 12.5, color: T.textTertiary }}>—</span>;
  }
  const color = PRIORITY_TONE[p.name.toLowerCase()] ?? p.color_code ?? T.textTertiary;
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

function ColumnHeader({ T }: { T: Tokens }) {
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
  T: Tokens;
}

function TaskRowItem({ task, groupColor, onOpen, T }: TaskRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="at-row"
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
        }
      }}
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLUMNS,
        alignItems: "center",
        gap: 12,
        padding: "9px 16px",
        borderBottom: `1px solid ${T.innerDivider}`,
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
            fontWeight: 500,
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
        {/* Hover affordance: same open action as the row click. */}
        <span className="at-open" aria-hidden>
          <MSIcon name="open_in_full" size={14} color={T.textTertiary} />
        </span>
      </div>

      {/* PROJECT */}
      <div style={{ minWidth: 0 }}>
        <ProjectChip project={task.project} T={T} />
      </div>

      {/* ASSIGNEE */}
      <div style={{ minWidth: 0 }}>
        <AssigneeAvatars assignees={task.assignees} T={T} />
      </div>

      {/* DUE DATE */}
      <div style={{ minWidth: 0 }}>
        <DueDateCell task={task} T={T} />
      </div>

      {/* PRIORITY */}
      <div style={{ minWidth: 0 }}>
        <PriorityCell task={task} T={T} />
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
  T,
}: {
  group: TaskGroup;
  onOpen: (task: TeamTaskWithProject) => void;
  T: Tokens;
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
      {/* Group header: caret + tinted status chip + tone label + count pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: collapsed ? "none" : `1px solid ${T.innerDivider}`,
        }}
      >
        <button
          type="button"
          aria-label={collapsed ? "Expand group" : "Collapse group"}
          onClick={() => setCollapsed((c) => !c)}
          className="at-caret"
        >
          <MSIcon name={collapsed ? "chevron_right" : "expand_more"} size={20} />
        </button>

        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            flex: "none",
            borderRadius: 7,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // Status tone stays meaningful; tint keeps it quiet in both themes.
            background: `color-mix(in srgb, ${group.color} 14%, transparent)`,
          }}
        >
          <MSIcon name={group.glyph} size={14} color={group.color} fill />
        </span>

        <span
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            color: group.color,
          }}
        >
          {group.title}
        </span>

        <span className="at-group-n">{group.tasks.length}</span>
      </div>

      {!collapsed && (
        <>
          <ColumnHeader T={T} />
          {group.tasks.map((task) => (
            <TaskRowItem
              key={task.id}
              task={task}
              groupColor={group.color}
              onOpen={onOpen}
              T={T}
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
  const { token } = theme.useToken();

  const T = useMemo<Tokens>(
    () => ({
      accent: "#4a4ad0",
      panel: token.colorBgContainer,
      hairline: token.colorBorderSecondary,
      innerDivider: token.colorSplit,
      textPrimary: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      textFaint: token.colorTextQuaternary,
      overdue: token.colorError,
      chipFill: token.colorFillQuaternary,
      countFill: token.colorFillSecondary,
      primaryBg: token.colorPrimaryBg,
      mono: "var(--font-geist-mono)",
    }),
    [token],
  );

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
          color: cat.color_code ?? T.accent,
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
        color: T.textTertiary,
        glyph: "radio_button_unchecked",
        sortOrder: Number.MAX_SAFE_INTEGER,
        tasks: noStatus,
      });
    }
    return result;
  }, [tasks, T]);

  /* ----- row click: open shared drawer, fall back to project ----- */
  const handleOpen = (task: TeamTaskWithProject) => {
    if (openDrawer) {
      openDrawer(task.id);
    } else {
      router.push(`/projects/${task.project.id}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{STYLE(token)}</style>

      {/* Header */}
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: 21,
            fontWeight: 600,
            color: T.textPrimary,
            letterSpacing: "-.4px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          All Tasks
          {tasks.length > 0 ? <span className="at-count">{tasks.length}</span> : null}
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: T.textSecondary }}>
          Every task across your team&apos;s projects, grouped by status.
        </p>
      </div>

      {isLoading ? (
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
      ) : tasks.length === 0 ? (
        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.hairline}`,
            borderRadius: 12,
            padding: "56px 24px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: T.primaryBg,
            }}
          >
            <MSIcon name="task_alt" size={20} color={T.accent} />
          </span>
          <div style={{ marginTop: 12, fontSize: 14.5, fontWeight: 600, color: T.textPrimary }}>
            No tasks yet
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: T.textTertiary }}>
            Tasks from every project across your team will show up here.
          </div>
        </div>
      ) : (
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
                T={T}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function STYLE(token: ReturnType<typeof theme.useToken>["token"]): string {
  return `
  .at-count{font-size:13px;font-weight:600;color:${token.colorTextSecondary};background:${token.colorFillSecondary};border-radius:999px;padding:1px 10px;}
  .at-group-n{font-size:11px;font-weight:600;color:${token.colorTextTertiary};background:${token.colorFillTertiary};border-radius:999px;padding:0 7px;line-height:17px;}
  .at-caret{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;padding:0;cursor:pointer;color:${token.colorTextTertiary};}
  .at-caret:hover{color:${token.colorText};}
  .at-row{cursor:pointer;transition:background 120ms ease;}
  .at-row:hover{background:${token.colorFillQuaternary};}
  .at-open{display:inline-flex;flex:none;opacity:0;transition:opacity .12s;}
  .at-row:hover .at-open{opacity:1;}
  `;
}
