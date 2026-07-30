"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  DatePicker,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { PlusOutlined, UserOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useQueryClient } from "@tanstack/react-query";
import {
  useTasks,
  useCreateTask,
  useUpdateTask,
  useReorderTasks,
  applyTaskOrder,
  tasksListKey,
  type TaskWithRelations,
  type TaskAssigneeEmbed,
  type TaskOrderPatch,
} from "@/features/tasks/use-tasks";
import {
  useTaskStatuses,
  useUpdateTaskStatus,
  useTaskPriorities,
  type TaskStatusWithCategory,
} from "@/features/tasks/use-task-statuses";
import { useTasksRealtime } from "@/features/tasks/use-tasks-realtime";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { useCelebrateTaskDone } from "@/features/celebrations/use-celebrations";
import { useTeamMembers, useCanCreateTasks, useIsTeamAdmin } from "@/features/team-members/use-team-members";
import {
  MemberSelect,
  type MemberOption,
} from "@/features/team-members/member-select";
import { useTeamLabels } from "@/features/settings/use-labels";
import { useSetTaskLabels } from "@/features/tasks/use-task-details";
import { TaskIdLabel } from "@/features/tasks/task-id-label";
import { descriptionSnippet } from "@/features/tasks/description-text";
import { TaskTimerButton } from "@/features/tasks/timer-widget";
import { StatusManagerModal } from "@/features/tasks/status-manager-modal";
import { useUIStore } from "@/store/ui-store";

/** What the column quick-composer collects for a new task. */
interface QuickDraft {
  name: string;
  description: string;
  assignees: string[];
  priorityId?: string;
  labelIds: string[];
  due: Dayjs | null;
}

/** 14% tint of a hex color for the status pill background. */
function tint(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "rgba(128,128,140,0.14)";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.14)`;
}

/**
 * The board imports the SHARED CONTRACT types from the tasks feature (agent A):
 * `useTasks` returns `TaskWithRelations` (task row + embedded status / priority /
 * assignees / labels) and `useTaskStatuses` returns `TaskStatusWithCategory`
 * (status row + its global category, used for the column accent).
 */

type BoardStatus = TaskStatusWithCategory;
type BoardTask = TaskWithRelations;

const COLUMN_WIDTH = 288;

/** Normalises an assignee embed (team_members -> users) for display. */
function resolveAssignee(a: TaskAssigneeEmbed): {
  key: string;
  name: string;
  avatarUrl: string | null;
} {
  const user = a.team_member?.user ?? null;
  return {
    key: a.team_member_id,
    name: user?.name ?? "Member",
    avatarUrl: user?.avatar_url ?? null,
  };
}

function AssigneeAvatars({ assignees }: { assignees: TaskAssigneeEmbed[] }) {
  const { token } = theme.useToken();
  if (assignees.length === 0) {
    return (
      <Avatar
        size={24}
        icon={<UserOutlined />}
        style={{ background: "transparent", color: token.colorTextQuaternary, border: "1px dashed currentColor" }}
      />
    );
  }
  return (
    <Avatar.Group
      max={{ count: 3, style: { backgroundColor: token.colorTextTertiary, fontSize: 11 } }}
      size={24}
    >
      {assignees.map((a) => {
        const r = resolveAssignee(a);
        return (
          <Tooltip key={r.key} title={r.name}>
            <Avatar size={24} src={r.avatarUrl ?? undefined} icon={<UserOutlined />}>
              {r.name.charAt(0).toUpperCase()}
            </Avatar>
          </Tooltip>
        );
      })}
    </Avatar.Group>
  );
}

/** Small material glyph helper. */
function Glyph({ name, size = 13 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {name}
    </span>
  );
}

/** A rounded meta pill (status / priority / label) with an icon. */
function Pill({
  icon,
  color,
  tinted,
  children,
}: {
  icon?: React.ReactNode;
  color?: string;
  /** Fill the pill with a soft tint of `color` (else neutral surface). */
  tinted?: boolean;
  children: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 20,
        padding: "0 8px",
        borderRadius: 6,
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        color: tinted && color ? color : token.colorTextSecondary,
        background: tinted && color ? tint(color) : token.colorFillTertiary,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

/** A compact circular progress ring with the percentage beside it. */
function ProgressRing({ value }: { value: number }) {
  const { token } = theme.useToken();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = 7;
  const c = 2 * Math.PI * r;
  const done = pct >= 100;
  const stroke = done ? token.colorSuccess : token.colorPrimary;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: token.colorTextTertiary }}>
      <svg width={18} height={18} viewBox="0 0 18 18">
        <circle cx="9" cy="9" r={r} fill="none" stroke={token.colorFillSecondary} strokeWidth="2.5" />
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          transform="rotate(-90 9 9)"
        />
      </svg>
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{pct}%</span>
    </span>
  );
}

/** Human-friendly relative due label ("Today"/"Tomorrow"/"Jun 21"). */
function dueLabel(end: string): { text: string; overdue: boolean } {
  const d = dayjs(end);
  const today = dayjs().startOf("day");
  const diff = d.startOf("day").diff(today, "day");
  const overdue = diff < 0;
  let text: string;
  if (diff === 0) text = "Today";
  else if (diff === 1) text = "Tomorrow";
  else if (diff === -1) text = "Yesterday";
  else text = d.format(d.year() === today.year() ? "MMM D" : "MMM D, YYYY");
  return { text, overdue };
}

interface TaskCardProps {
  task: BoardTask;
  onOpen: (id: string) => void;
  /** The column's status pill display (name + category accent). */
  statusName?: string;
  statusAccent?: string;
  /** Render as a static (non-sortable) overlay copy when true. */
  overlay?: boolean;
  /** True when the card's column is an ACTIVE-stage status — shows the timer. */
  activeStage?: boolean;
}

/** The inner visual of a card, shared by the sortable card and drag overlay. */
function TaskCardBody({ task, onOpen, statusName, statusAccent, overlay, activeStage }: TaskCardProps) {
  const { token } = theme.useToken();
  const priority = task.priority;
  const assignees = task.assignees ?? [];
  const labels = (task.labels ?? []).map((l) => l.label).filter(Boolean) as {
    id: string;
    name: string;
    color_code: string;
  }[];
  const commentCount = task.comments?.[0]?.count ?? 0;
  const progress = task.progress_value;
  const due = task.end_date ? dueLabel(task.end_date) : null;
  const overdue = due?.overdue && !task.done;

  return (
    <Card
      size="small"
      hoverable={!overlay}
      styles={{ body: { padding: "11px 12px" } }}
      style={{
        marginBottom: 10,
        cursor: overlay ? "grabbing" : "grab",
        borderRadius: 12,
        boxShadow: overlay
          ? "0 14px 30px -6px rgba(16, 24, 40, 0.24)"
          : "0 1px 2px rgba(16,24,40,0.05)",
      }}
    >
      {/* Meta pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {statusName ? (
          <Pill
            icon={
              <span
                aria-hidden
                style={{
                  width: 3,
                  height: 11,
                  borderRadius: 2,
                  background: statusAccent ?? token.colorTextTertiary,
                  display: "inline-block",
                }}
              />
            }
          >
            {statusName}
          </Pill>
        ) : null}
        {priority?.name ? (
          <Pill icon={<Glyph name="flag" />} color={priority.color_code ?? undefined} tinted>
            {priority.name}
          </Pill>
        ) : null}
        {labels.slice(0, 2).map((l) => (
          <Pill key={l.id} icon={<Glyph name="label" />} color={l.color_code} tinted>
            {l.name}
          </Pill>
        ))}
        {labels.length > 2 ? <Pill>+{labels.length - 2}</Pill> : null}
      </div>

      {/* Title */}
      <Typography.Link
        strong
        onClick={(e) => {
          // The link sits inside a draggable; stop the drag listeners from
          // swallowing the click so opening the drawer still works.
          e.stopPropagation();
          onOpen(task.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          color: token.colorText,
          fontSize: 14,
          fontWeight: 650,
          letterSpacing: "-0.1px",
          lineHeight: 1.3,
          display: "block",
        }}
      >
        {task.name}
      </Typography.Link>

      {/* Description */}
      {task.description ? (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginTop: 3,
            fontSize: 12.5,
            color: token.colorTextTertiary,
            lineHeight: 1.4,
          }}
        >
          <span aria-hidden style={{ flex: "none", opacity: 0.7 }}>
            <Glyph name="subdirectory_arrow_right" size={14} />
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {descriptionSnippet(task.description, 120)}
          </span>
        </div>
      ) : null}

      {/* Divider */}
      <div
        style={{
          height: 1,
          background: token.colorBorderSecondary,
          margin: "10px 0 9px",
        }}
      />

      {/* Footer: avatars + meta */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <AssigneeAvatars assignees={assignees} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            fontSize: 11.5,
            fontWeight: 600,
            color: token.colorTextTertiary,
          }}
        >
          {activeStage && !overlay && !task.done ? (
            <span onPointerDown={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
              <TaskTimerButton taskId={task.id} size={24} />
            </span>
          ) : null}
          {task.task_no != null ? (
            <span style={{ display: "inline-flex", alignItems: "center", opacity: 0.85 }}>
              <TaskIdLabel projectId={task.project_id} taskNo={task.task_no} />
            </span>
          ) : null}
          {commentCount > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Glyph name="chat_bubble_outline" size={13} /> {commentCount}
            </span>
          ) : null}
          {due ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                color: overdue ? token.colorError : token.colorTextTertiary,
              }}
            >
              <Glyph name="event" size={13} /> {due.text}
            </span>
          ) : null}
          {progress != null ? <ProgressRing value={progress} /> : null}
        </div>
      </div>
    </Card>
  );
}

/** A sortable, draggable task card. */
function SortableTaskCard({
  task,
  onOpen,
  statusName,
  statusAccent,
  activeStage,
}: {
  task: BoardTask;
  onOpen: (id: string) => void;
  statusName: string;
  statusAccent: string;
  activeStage?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", statusId: task.status_id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCardBody
        task={task}
        onOpen={onOpen}
        statusName={statusName}
        statusAccent={statusAccent}
        activeStage={activeStage}
      />
    </div>
  );
}

interface ColumnProps {
  status: BoardStatus;
  tasks: BoardTask[];
  onOpen: (id: string) => void;
  onAddTask: (statusId: string, draft: QuickDraft) => Promise<void>;
  adding: boolean;
  memberOptions: MemberOption[];
  priorityOptions: { value: string; label: string }[];
  labelOptions: { value: string; label: string }[];
  onRenameStatus: () => void;
  onManageStatuses: () => void;
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  /** Effective create-permission — hides all add-task affordances when false. */
  canAdd: boolean;
}

/** A single board column for one task_status. */
/**
 * Which board columns the user has collapsed, remembered per project.
 *
 * Kept in localStorage rather than the database on purpose: collapsing a column
 * is a personal viewing preference, and storing it on the project would hide
 * the column for every teammate too.
 */
function useCollapsedColumns(projectId: string) {
  const storageKey = `cubes.board.collapsed:${projectId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
    } catch {
      // A corrupt entry must not wedge the board — start clean.
      return new Set();
    }
  });

  const toggle = (statusId: string, next: boolean) => {
    setCollapsed((prev) => {
      const out = new Set(prev);
      if (next) out.add(statusId);
      else out.delete(statusId);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...out]));
      } catch {
        // Private mode / quota — the session still works, it just won't persist.
      }
      return out;
    });
  };

  return [collapsed, toggle] as const;
}

function BoardColumn({
  status,
  tasks,
  onOpen,
  onAddTask,
  adding,
  memberOptions,
  priorityOptions,
  labelOptions,
  onRenameStatus,
  onManageStatuses,
  canAdd,
  collapsed,
  onCollapsedChange,
}: ColumnProps) {
  const isTeamAdmin = useIsTeamAdmin();
  const { token } = theme.useToken();
  const dark = useUIStore((s) => s.themeMode === "dark");
  const colBg = token.colorFillQuaternary;
  const colBorder = token.colorBorderSecondary;
  const muted = token.colorTextTertiary;
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAssignees, setDraftAssignees] = useState<string[]>([]);
  const [draftPriority, setDraftPriority] = useState<string | undefined>();
  const [draftLabels, setDraftLabels] = useState<string[]>([]);
  const [draftDue, setDraftDue] = useState<Dayjs | null>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status.id}`,
    data: { type: "column", statusId: status.id },
  });

  const accent = status.category?.color_code ?? "#8a8d98";
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  const resetDraft = () => {
    setDraftName("");
    setDraftDescription("");
    setDraftAssignees([]);
    setDraftPriority(undefined);
    setDraftLabels([]);
    setDraftDue(null);
  };

  const submitDraft = async () => {
    const name = draftName.trim();
    if (!name) {
      setComposerOpen(false);
      return;
    }
    await onAddTask(status.id, {
      name,
      description: draftDescription.trim(),
      assignees: draftAssignees,
      priorityId: draftPriority,
      labelIds: draftLabels,
      due: draftDue,
    });
    // Keep the composer open (name/description cleared) for rapid entry; the
    // other fields stick so several similar tasks are quick to add.
    setDraftName("");
    setDraftDescription("");
  };

  const groupMenu: MenuProps = {
    items: [
      {
        key: "collapse",
        label: "Collapse group",
        icon: (
          <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
            unfold_less
          </span>
        ),
        onClick: () => onCollapsedChange(true),
      },
      // Status editing is workspace-admin surface — members/limited only get
      // the view controls.
      ...(isTeamAdmin
        ? [
            {
              key: "rename",
              label: "Rename status…",
              icon: (
                <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                  edit
                </span>
              ),
              onClick: onRenameStatus,
            },
            {
              key: "manage",
              label: "Edit statuses…",
              icon: (
                <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                  tune
                </span>
              ),
              onClick: onManageStatuses,
            },
          ]
        : []),
      ...(canAdd
        ? [
            { type: "divider" as const },
            {
              key: "add",
              label: "Add task",
              icon: <PlusOutlined style={{ fontSize: 13 }} />,
              onClick: () => setComposerOpen(true),
            },
          ]
        : []),
    ],
  };

  // Collapsed: a slim vertical strip (still a drop target so drags can expand
  // into it later if needed; clicking re-expands).
  if (collapsed) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onCollapsedChange(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onCollapsedChange(false);
        }}
        title={`${status.name} — click to expand`}
        style={{
          width: 44,
          flex: "0 0 44px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          background: colBg,
          borderRadius: 12,
          border: `1px solid ${colBorder}`,
          maxHeight: "100%",
          overflow: "hidden",
          cursor: "pointer",
          padding: "10px 0",
        }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: "50%", background: accent }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-geist-mono)",
            color: muted,
            background: token.colorBgContainer,
            border: `1px solid ${colBorder}`,
            borderRadius: 999,
            padding: "0 6px",
            lineHeight: "18px",
          }}
        >
          {tasks.length}
        </span>
        <Typography.Text
          strong
          style={{
            fontSize: 12.5,
            writingMode: "vertical-rl",
            whiteSpace: "nowrap",
            color: token.colorText,
          }}
        >
          {status.name}
        </Typography.Text>
      </div>
    );
  }

  return (
    <div
      style={{
        width: COLUMN_WIDTH,
        flex: `0 0 ${COLUMN_WIDTH}px`,
        display: "flex",
        flexDirection: "column",
        background: colBg,
        borderRadius: 12,
        border: `1px solid ${colBorder}`,
        maxHeight: "100%",
        overflow: "hidden",
      }}
    >
      <div
        className="wl-board-col-head"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px 8px",
          // Soft per-status wash instead of a hard top border strip.
          background: `linear-gradient(180deg, ${tint(accent)}, transparent)`,
          borderRadius: "12px 12px 0 0",
        }}
      >
        {/* Status pill */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: tint(accent),
            color: accent,
            borderRadius: 6,
            padding: "2px 9px",
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            maxWidth: 170,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: accent,
              flex: "none",
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status.name}
          </span>
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-geist-mono)",
            color: muted,
          }}
        >
          {tasks.length}
        </span>
        <span style={{ marginInlineStart: "auto" }} />
        <Dropdown menu={groupMenu} trigger={["click"]}>
          <Button
            type="text"
            size="small"
            className="wl-board-col-tools"
            aria-label={`${status.name} group options`}
            icon={
              <span className="material-symbols-rounded" style={{ fontSize: 16, color: muted }}>
                more_horiz
              </span>
            }
          />
        </Dropdown>
        {canAdd ? (
          <Button
            type="text"
            size="small"
            className="wl-board-col-tools"
            aria-label={`Add task to ${status.name}`}
            icon={<PlusOutlined style={{ fontSize: 12, color: muted }} />}
            onClick={() => setComposerOpen(true)}
          />
        ) : null}
      </div>

      {/* Quick composer (top of column) */}
      {composerOpen && canAdd ? (
        <div
          style={{
            margin: "0 10px 8px",
            background: token.colorBgContainer,
            border: `1.5px solid ${token.colorPrimaryBorder}`,
            borderRadius: 10,
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <Space.Compact style={{ width: "100%" }}>
            <Input
              autoFocus
              size="small"
              value={draftName}
              placeholder="Task Name…"
              onChange={(e) => setDraftName(e.target.value)}
              onPressEnter={(e) => {
                e.preventDefault();
                void submitDraft();
              }}
            />
            <Button
              type="primary"
              size="small"
              loading={adding}
              onClick={() => void submitDraft()}
            >
              Save
            </Button>
          </Space.Compact>
          <Input.TextArea
            size="small"
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Add description…"
            autoSize={{ minRows: 1, maxRows: 3 }}
          />
          <MemberSelect
            value={draftAssignees}
            onChange={setDraftAssignees}
            options={memberOptions}
            placeholder="Add assignee"
          />
          <div style={{ display: "flex", gap: 6 }}>
            <DatePicker
              size="small"
              placeholder="Add dates"
              value={draftDue}
              onChange={setDraftDue}
              style={{ flex: 1 }}
            />
            <Select
              size="small"
              allowClear
              placeholder="Priority"
              value={draftPriority}
              onChange={setDraftPriority}
              options={priorityOptions}
              style={{ flex: 1 }}
            />
          </div>
          {labelOptions.length > 0 ? (
            <Select
              size="small"
              mode="multiple"
              allowClear
              placeholder="Add labels"
              value={draftLabels}
              onChange={setDraftLabels}
              options={labelOptions}
              optionFilterProp="label"
              maxTagCount="responsive"
            />
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="text"
              size="small"
              onClick={() => {
                setComposerOpen(false);
                resetDraft();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* Scroll area (scrollbar hidden) with a soft fade under the footer. */}
      <div style={{ position: "relative", flex: 1, minHeight: 80, overflow: "hidden" }}>
        <div
          ref={setNodeRef}
          className="wl-board-scroll"
          style={{
            height: "100%",
            overflowY: "auto",
            padding: "0 12px 6px",
            background: isOver ? token.colorPrimaryBg : undefined,
            transition: "background 120ms ease",
          }}
        >
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onOpen={onOpen}
                statusName={status.name}
                statusAccent={accent}
                activeStage={Boolean(status.category?.is_doing)}
              />
            ))}
          </SortableContext>

          {tasks.length === 0 && !composerOpen ? (
            <div style={{ padding: "16px 0" }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No tasks"
                styles={{ image: { height: 40 } }}
              />
            </div>
          ) : null}
        </div>
        {/* Fade so scrolled cards dissolve into the footer instead of a hard cut. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 26,
            pointerEvents: "none",
            background: `linear-gradient(to bottom, transparent, ${colBg})`,
          }}
        />
      </div>

      {/* Glassmorphism footer */}
      <div
        style={{
          padding: 8,
          background: dark ? "rgba(20,23,31,0.55)" : "rgba(255,255,255,0.45)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderTop: `1px solid ${colBorder}`,
          borderRadius: "0 0 12px 12px",
        }}
      >
        {!composerOpen ? (
          <Button
            type="text"
            block
            icon={<PlusOutlined />}
            style={{ textAlign: "left", color: muted }}
            onClick={() => setComposerOpen(true)}
          >
            Add Task
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function BoardTab({ projectId }: { projectId: string }) {
  const canCreate = useCanCreateTasks(projectId);
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  // Live sync: subscribes to postgres_changes on tasks for this project and
  // invalidates the tasks query keys, then cleans up on unmount.
  useTasksRealtime(projectId);

  const { open } = useTaskDrawer();

  const statusesQuery = useTaskStatuses(projectId);
  const celebrateTaskDone = useCelebrateTaskDone();
  const tasksQuery = useTasks(projectId);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const reorderTasks = useReorderTasks();
  const updateStatus = useUpdateTaskStatus();
  const setTaskLabels = useSetTaskLabels();
  const { data: prioritiesRaw } = useTaskPriorities();
  const { data: membersRaw } = useTeamMembers();
  const { data: labelsRaw } = useTeamLabels();
  // Rename-status modal target (from a column's ⋯ menu).
  const [renamingStatus, setRenamingStatus] = useState<BoardStatus | null>(null);
  const [statusManagerOpen, setStatusManagerOpen] = useState(false);
  const [collapsedColumns, setColumnCollapsed] = useCollapsedColumns(projectId);
  const [statusDraft, setStatusDraft] = useState("");

  const memberOptions = useMemo<MemberOption[]>(
    () =>
      (membersRaw ?? [])
        .filter((m) => m.user)
        .map((m) => ({
          value: m.id, // team_members.id — what create_task expects
          label: m.user!.name,
          avatarUrl: m.user!.avatar_url,
          email: m.user!.email,
        })),
    [membersRaw],
  );
  const priorityOptions = useMemo(
    () => (prioritiesRaw ?? []).map((p) => ({ value: p.id, label: p.name })),
    [prioritiesRaw],
  );
  const labelOptions = useMemo(
    () => (labelsRaw ?? []).map((l) => ({ value: l.id, label: l.name })),
    [labelsRaw],
  );

  const statuses = useMemo<BoardStatus[]>(() => {
    const raw = statusesQuery.data ?? [];
    return [...raw].sort((a, b) => a.sort_order - b.sort_order);
  }, [statusesQuery.data]);

  const allTasks = useMemo<BoardTask[]>(
    () => tasksQuery.data ?? [],
    [tasksQuery.data],
  );

  // Group tasks by status_id, each group ordered by sort_order. Tasks whose
  // status_id is null (or points at an unknown status) bucket under the first
  // column so they remain reachable.
  const tasksByStatus = useMemo(() => {
    const map = new Map<string, BoardTask[]>();
    for (const s of statuses) map.set(s.id, []);

    const fallbackId = statuses[0]?.id;
    for (const task of allTasks) {
      const key =
        task.status_id && map.has(task.status_id)
          ? task.status_id
          : fallbackId;
      if (!key) continue;
      map.get(key)!.push(task);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order);
    }
    return map;
  }, [statuses, allTasks]);

  const taskById = useMemo(() => {
    const m = new Map<string, BoardTask>();
    for (const t of allTasks) m.set(t.id, t);
    return m;
  }, [allTasks]);

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  // Local per-column ordering of task ids, live ONLY during a drag. dnd-kit
  // needs the dragged card to actually live in the target column while dragging
  // (via onDragOver) or it animates back to its origin on drop. When idle we
  // render straight from server grouping; the drag seeds this on drag start.
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const dragging = activeId != null;

  // Columns rendered from the local order while dragging, else from the server
  // grouping (which the reorder mutation updates optimistically).
  const displayByStatus = useMemo(() => {
    const m = new Map<string, BoardTask[]>();
    for (const s of statuses) {
      const ids = dragging ? order[s.id] : undefined;
      const list = ids
        ? (ids.map((id) => taskById.get(id)).filter(Boolean) as BoardTask[])
        : tasksByStatus.get(s.id) ?? [];
      m.set(s.id, list);
    }
    return m;
  }, [dragging, order, statuses, taskById, tasksByStatus]);

  /** Which column (status id) currently holds `id`, or the column id itself. */
  const findContainer = (id: string): string | null => {
    if (id.startsWith("column:")) return id.slice("column:".length);
    if (order[id]) return id;
    for (const [statusId, ids] of Object.entries(order)) {
      if (ids.includes(id)) return statusId;
    }
    return null;
  };

  const activeTask = activeId ? taskById.get(String(activeId)) ?? null : null;
  const activeStatus = activeTask
    ? statuses.find((s) => s.id === (findContainer(String(activeId)) ?? activeTask.status_id)) ??
      statuses.find((s) => s.id === activeTask.status_id) ??
      statuses[0]
    : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A small activation distance so card clicks (open drawer) aren't
      // misread as drags.
      activationConstraint: { distance: 6 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    // Seed the live drag order from the current server grouping.
    const seed: Record<string, string[]> = {};
    for (const s of statuses) {
      seed[s.id] = (tasksByStatus.get(s.id) ?? []).map((t) => t.id);
    }
    setOrder(seed);
    setActiveId(event.active.id);
  };

  // Move the dragged card between columns DURING the drag so it visually
  // follows the pointer into the target column (no snap-back on drop).
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    const from = findContainer(activeIdStr);
    const to = findContainer(overIdStr);
    if (!from || !to || from === to) return;

    setOrder((prev) => {
      const fromItems = prev[from] ?? [];
      const toItems = prev[to] ?? [];
      if (!fromItems.includes(activeIdStr)) return prev;
      const overIndex = toItems.indexOf(overIdStr);
      const insertIndex = overIndex >= 0 ? overIndex : toItems.length;
      return {
        ...prev,
        [from]: fromItems.filter((i) => i !== activeIdStr),
        [to]: [
          ...toItems.slice(0, insertIndex),
          activeIdStr,
          ...toItems.slice(insertIndex),
        ],
      };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const movedId = String(active.id);
    const movedTask = taskById.get(movedId);
    if (!over || !movedTask) {
      setActiveId(null);
      return;
    }

    const overIdStr = String(over.id);
    const targetColumnId = findContainer(overIdStr);
    if (!targetColumnId) {
      setActiveId(null);
      return;
    }

    // onDragOver already moved the card into the target column; finalize its
    // slot within that column, then persist from that order.
    const items = order[targetColumnId] ?? [];
    const fromIndex = items.indexOf(movedId);
    const overIndex = overIdStr.startsWith("column:")
      ? items.length - 1
      : items.indexOf(overIdStr);
    const finalItems =
      fromIndex >= 0 && overIndex >= 0 && fromIndex !== overIndex
        ? arrayMove(items, fromIndex, overIndex)
        : items;

    // persistOrder updates the cache synchronously; clearing activeId then hands
    // rendering to that (already-moved) server grouping in the same batch.
    persistOrder(movedId, targetColumnId, finalItems);
    setActiveId(null);
  };

  /** Writes integer sort orders for the target column + the moved card's status. */
  const persistOrder = (
    movedId: string,
    targetColumnId: string,
    orderedIds: string[],
  ) => {
    const sourceColumnId = taskById.get(movedId)?.status_id ?? null;
    const statusChangedForMoved = targetColumnId !== sourceColumnId;

    const updates: TaskOrderPatch[] = [];
    orderedIds.forEach((id, index) => {
      const t = taskById.get(id);
      if (!t) return;
      const statusChanged = id === movedId && statusChangedForMoved;
      if (t.sort_order !== index || statusChanged) {
        updates.push({
          id,
          sort_order: index,
          ...(statusChanged ? { status_id: targetColumnId } : {}),
        });
      }
    });
    if (updates.length === 0) return;

    // Apply the move to the cache SYNCHRONOUSLY (same tick as clearing
    // activeId), so the server grouping already shows the card in the target
    // column — no flash back to the origin before the server confirms.
    const key = tasksListKey(projectId);
    const rollback = queryClient.getQueryData<TaskWithRelations[]>(key);
    queryClient.setQueryData<TaskWithRelations[]>(key, (old) =>
      applyTaskOrder(old, updates),
    );

    // Dragging into a done column is a completion — celebrate once the write
    // lands (the cube award commits in the same transaction).
    const statusList = statusesQuery.data ?? [];
    const targetDone = Boolean(
      statusList.find((st) => st.id === targetColumnId)?.category?.is_done,
    );
    const sourceDone = Boolean(
      statusList.find((st) => st.id === sourceColumnId)?.category?.is_done,
    );

    reorderTasks.mutate(
      { projectId, updates, rollback },
      {
        onError: (err) =>
          message.error(
            err instanceof Error ? err.message : "Couldn't move the task.",
          ),
        onSuccess: () => {
          if (statusChangedForMoved && targetDone && !sourceDone) {
            celebrateTaskDone({
              taskId: movedId,
              taskName: taskById.get(movedId)?.name,
            });
          }
        },
      },
    );
  };

  const handleAddTask = async (statusId: string, draft: QuickDraft) => {
    try {
      const taskId = await createTask.mutateAsync({
        name: draft.name,
        projectId,
        statusId,
        priorityId: draft.priorityId,
        // create_task expects team_members.id values for assignees.
        assignees: draft.assignees.length > 0 ? draft.assignees : undefined,
      });
      // Fields create_task doesn't take get a follow-up write each.
      if (draft.due || draft.description) {
        await updateTask.mutateAsync({
          id: taskId,
          ...(draft.due ? { end_date: draft.due.toISOString() } : {}),
          ...(draft.description ? { description: draft.description } : {}),
        });
      }
      if (draft.labelIds.length > 0) {
        await setTaskLabels.mutateAsync({ taskId, labelIds: draft.labelIds });
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Couldn't create the task.",
      );
      throw err;
    }
  };

  const handleRenameStatus = async () => {
    if (!renamingStatus) return;
    const name = statusDraft.trim();
    if (!name) return;
    try {
      await updateStatus.mutateAsync({ id: renamingStatus.id, name });
      setRenamingStatus(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't rename the status.");
    }
  };

  if (statusesQuery.isLoading || tasksQuery.isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  if (statuses.length === 0) {
    return (
      <Card style={{ minHeight: 280 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="This project has no statuses yet."
        />
      </Card>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div
        className="wl-hscroll"
        style={{
          display: "flex",
          gap: 16,
          alignItems: "stretch",
          overflowX: "auto",
          paddingBottom: 8,
          minHeight: 480,
          height: "calc(100vh - 260px)",
        }}
      >
        {statuses.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            tasks={displayByStatus.get(status.id) ?? []}
            onOpen={open}
            onAddTask={handleAddTask}
            adding={createTask.isPending}
            canAdd={canCreate}
            memberOptions={memberOptions}
            priorityOptions={priorityOptions}
            labelOptions={labelOptions}
            onRenameStatus={() => {
              setRenamingStatus(status);
              setStatusDraft(status.name);
            }}
            onManageStatuses={() => setStatusManagerOpen(true)}
            collapsed={collapsedColumns.has(status.id)}
            onCollapsedChange={(next) => setColumnCollapsed(status.id, next)}
          />
        ))}
      </div>

      {/* Column header tools are always visible (like the reference). */}
      <style>{`
        .wl-board-col-head .wl-board-col-tools { opacity: .7; transition: opacity .12s ease; }
        .wl-board-col-head:hover .wl-board-col-tools,
        .wl-board-col-head .wl-board-col-tools.ant-dropdown-open { opacity: 1; }
        /* Hide the column scrollbar (still scrollable). */
        .wl-board-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .wl-board-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
      `}</style>

      <StatusManagerModal
        projectId={projectId}
        open={statusManagerOpen}
        onClose={() => setStatusManagerOpen(false)}
      />

      <DragOverlay>
        {activeTask ? (
          <div style={{ width: COLUMN_WIDTH - 24 }}>
            <TaskCardBody
              task={activeTask}
              onOpen={open}
              statusName={activeStatus?.name}
              statusAccent={activeStatus?.category?.color_code ?? "#8a8d98"}
              overlay
            />
          </div>
        ) : null}
      </DragOverlay>

      {/* Rename status (from a column's ⋯ menu) */}
      <Modal
        title="Rename status"
        open={Boolean(renamingStatus)}
        okText="Save"
        confirmLoading={updateStatus.isPending}
        onOk={() => void handleRenameStatus()}
        onCancel={() => setRenamingStatus(null)}
        destroyOnHidden
      >
        <Input
          value={statusDraft}
          onChange={(e) => setStatusDraft(e.target.value)}
          placeholder="Status name"
          maxLength={50}
          autoFocus
          onPressEnter={() => void handleRenameStatus()}
        />
      </Modal>
    </DndContext>
  );
}
