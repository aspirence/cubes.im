"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Avatar,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  theme,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

// `relativeTime` powers the "x ago" labels in the Activity timeline. Extending
// dayjs is idempotent, so calling it here is safe even though other modules
// (the home page, notifications bell) also extend with the same plugin.
dayjs.extend(relativeTime);

import { createClient } from "@/lib/supabase/client";
import { useTaskDrawer } from "@/store/task-drawer-store";
import {
  useUpdateTask,
  useCreateTask,
  useSubtasks,
  useTasks,
} from "@/features/tasks/use-tasks";
import { useProject } from "@/features/projects/use-projects";
import { useAuth } from "@/features/auth/use-auth";
import { RichDescription } from "@/features/tasks/rich-description";
import {
  useTaskDependencies,
  useAddDependency,
  useRemoveDependency,
} from "@/features/tasks/use-task-dependencies";
import {
  useProjectPhases,
  useTaskPhase,
  useSetTaskPhase,
  useClearTaskPhase,
} from "@/features/tasks/use-task-phase";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  TeamMentionInput,
  extractMentionUserIds,
} from "@/features/team-members/team-mention-input";
import { TaskIdLabel } from "@/features/tasks/task-id-label";
import {
  useTaskStatuses,
  useTaskPriorities,
  type TaskStatusWithCategory,
} from "@/features/tasks/use-task-statuses";
import {
  useTaskAssignees,
  useSetTaskAssignees,
  useTaskLabels,
  useSetTaskLabels,
  useTaskComments,
  useAddTaskComment,
} from "@/features/tasks/use-task-details";
import { useProjectMembers } from "@/features/projects/use-project-members";
import {
  useProjectAvailability,
  buildAvailabilityIndex,
  formatLeaveDays,
} from "@/features/schedule/use-availability";
import { useTeamLabels } from "@/features/settings/use-labels";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  useTaskAttachments,
  useUploadAttachment,
  useDeleteAttachment,
  getAttachmentSignedUrl,
  type TaskAttachment,
} from "@/features/storage/use-storage";
import { useTaskActivity } from "@/features/activity/use-activity";
import {
  useTaskReferenceLinks,
  useAddTaskReferenceLink,
  useDeleteTaskReferenceLink,
  useReorderTaskReferenceLinks,
} from "@/features/tasks/use-task-references";
import {
  useAiBreakdown,
  type AiSubtaskSuggestion,
} from "@/features/ai/use-ai";
import {
  VIDEO_STATUS_META,
  useTaskVideoReviews,
} from "@/features/app-video-review/use-video-review";
import { NewReviewModal } from "@/features/app-video-review/new-review-modal";

/* -------------------------------------------------------------------------- */
/* Local types.                                                               */
/*                                                                            */
/* The detail/list shapes come from Agent A's exported hook types. The drawer */
/* only fetches the small set of columns it edits, so it has its own narrow   */
/* row type for the single-row read.                                          */
/* -------------------------------------------------------------------------- */

interface DrawerTask {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  task_no: number | null;
  status_id: string | null;
  priority_id: string | null;
  start_date: string | null;
  end_date: string | null;
  parent_task_id: string | null;
  done: boolean | null;
  deliverable_type: string | null;
  submission_content: string | null;
  submission_status: string | null;
}

const { Text, Title } = Typography;

const drawerRowKey = (taskId: string) => ["task-drawer-row", taskId] as const;

/* -------------------------------------------------------------------------- */
/* Design tokens (canonical handoff).                                         */
/* -------------------------------------------------------------------------- */

function useDrawerTokens() {
  const { token } = theme.useToken();
  return useMemo(
    () => ({
      accent: "#4a4ad0",
      panel: token.colorBgContainer,
      hairline: token.colorBorderSecondary,
      innerDivider: token.colorSplit,
      chip: token.colorFillTertiary,
      textPrimary: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      textFaint: token.colorTextQuaternary,
      overdue: "#c0453c",
      mono: "var(--font-geist-mono)",
    }),
    [token],
  );
}

// Solid avatar palette (white text).
const AVATAR_PALETTE = [
  "#5a5ad6",
  "#e0a83e",
  "#3a9d6e",
  "#8b6fd6",
  "#2f9c9c",
  "#d96a8f",
  "#e0663f",
  "#8a8d98",
] as const;

function avatarColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/**
 * A semantic pill (always light bg + saturated text). Palette per handoff.
 */
type SemanticTone = "green" | "amber" | "red" | "orange" | "slate" | "indigo";

const SEMANTIC: Record<SemanticTone, { fg: string; bg: string }> = {
  green: { fg: "#2f8f5f", bg: "#e9f6ef" },
  amber: { fg: "#b8842a", bg: "#fdf5e6" },
  red: { fg: "#c0453c", bg: "#fbeceb" },
  orange: { fg: "#c07d2e", bg: "#fdf2e6" },
  slate: { fg: "#6a6d78", bg: "#eef1f5" },
  indigo: { fg: "#4a4ad0", bg: "#eceefb" },
};

function SemanticPill({
  tone,
  children,
  icon,
}: {
  tone: SemanticTone;
  children: React.ReactNode;
  icon?: string;
}) {
  const c = SEMANTIC[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 9px",
        borderRadius: 6,
        background: c.bg,
        color: c.fg,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.5,
      }}
    >
      {icon ? (
        <span
          className="material-symbols-rounded"
          aria-hidden
          style={{ fontSize: 14, lineHeight: 1, fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

/** Map a status category to a semantic tone + glyph for the pill. */
function statusTone(status: TaskStatusWithCategory | undefined): {
  tone: SemanticTone;
  glyph: string;
} {
  const cat = status?.category;
  if (cat?.is_done) return { tone: "green", glyph: "check_circle" };
  if (cat?.is_doing) return { tone: "amber", glyph: "change_circle" };
  return { tone: "slate", glyph: "radio_button_unchecked" };
}

/** Map a priority name to a semantic tone. */
function priorityTone(name: string | null | undefined): SemanticTone {
  switch ((name ?? "").toLowerCase()) {
    case "urgent":
    case "high":
      return "red";
    case "medium":
      return "amber";
    case "low":
      return "slate";
    default:
      return "slate";
  }
}

/** A labelled row inside the bordered meta table. */
/** An icon-labeled property cell (ClickUp-style). Lives in the 2-column
 *  property grid; `wide` spans both columns for multi-value fields. */
function MetaRow({
  label,
  icon,
  children,
  wide,
}: {
  label: string;
  icon?: string;
  children: React.ReactNode;
  wide?: boolean;
  /** Legacy no-op (removed border table). */
  last?: boolean;
}) {
  const DT = useDrawerTokens();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        minHeight: 34,
        padding: "5px 0",
        gridColumn: wide ? "1 / -1" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: 104,
          flex: "none",
          paddingTop: 6,
          color: DT.textSecondary,
        }}
      >
        {icon ? (
          <span
            className="material-symbols-rounded"
            aria-hidden
            style={{ fontSize: 17, color: DT.textTertiary, lineHeight: 1 }}
          >
            {icon}
          </span>
        ) : null}
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** A small solid avatar (white text) matching the handoff palette. */
function SolidAvatar({
  name,
  avatarUrl,
  seed,
  size = 22,
}: {
  name: string;
  avatarUrl?: string | null;
  seed: string;
  size?: number;
}) {
  return (
    <Avatar
      size={size}
      src={avatarUrl ?? undefined}
      style={{
        backgroundColor: avatarColor(seed),
        fontSize: Math.round(size * 0.46),
        fontWeight: 600,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </Avatar>
  );
}

/* -------------------------------------------------------------------------- */

export function TaskDrawer() {
  const { taskId, close } = useTaskDrawer();
  const DT = useDrawerTokens();
  const open = taskId != null;

  return (
    <Drawer
      width={980}
      open={open}
      onClose={close}
      destroyOnHidden
      maskClosable
      title={null}
      closable={false}
      styles={{ body: { padding: 0, background: DT.panel } }}
    >
      {taskId ? (
        <TaskDrawerContent taskId={taskId} variant="drawer" onClose={close} />
      ) : null}
    </Drawer>
  );
}

/**
 * Full-page task view — the same detail content the drawer renders, but
 * expanded to fill the app content area (no drawer chrome). Backing the
 * `/projects/[id]/tasks/[taskId]` route.
 */
export function TaskDetailPage({ taskId }: { taskId: string }) {
  const DT = useDrawerTokens();
  return (
    <div
      style={{
        // Cancel the app shell's content padding so the detail goes edge to
        // edge, and fill the viewport below the top bar.
        margin: "-22px -24px -48px",
        height: "calc(100vh - 58px)",
        background: DT.panel,
      }}
    >
      <TaskDrawerContent taskId={taskId} variant="page" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Reads the drawer's task row directly by id.
 *
 * The drawer is opened with only a task id, but `useTasks` is project-scoped.
 * Rather than guess the project id, we fetch the single row (it is small and
 * usually already warm in the page). This also yields the `project_id` the rest
 * of the drawer needs for project-scoped lookups. RLS restricts the row to
 * projects whose team the caller belongs to.
 */
function useDrawerTask(taskId: string) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: drawerRowKey(taskId),
    enabled: Boolean(taskId),
    staleTime: 0,
    queryFn: async (): Promise<DrawerTask> => {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, project_id, name, description, task_no, status_id, priority_id, start_date, end_date, parent_task_id, done, deliverable_type, submission_content, submission_status",
        )
        .eq("id", taskId)
        .single();
      if (error) throw error;
      return data as DrawerTask;
    },
  });
}

/* -------------------------------------------------------------------------- */

function TaskDrawerContent({
  taskId,
  variant = "drawer",
  onClose,
}: {
  taskId: string;
  variant?: "drawer" | "page";
  onClose?: () => void;
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const DT = useDrawerTokens();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { open: openTaskInDrawer, close: closeTaskDrawer } = useTaskDrawer();
  const isPage = variant === "page";
  const { profile } = useAuth();

  const { data: task } = useDrawerTask(taskId);
  const projectId = task?.project_id ?? undefined;
  const { data: projectRow } = useProject(projectId);
  const projectName = projectRow?.name;

  /** Open a (sub)task: navigate in page mode, swap the drawer otherwise. */
  const openTaskDetail = (id: string) => {
    if (isPage && projectId) router.push(`/projects/${projectId}/tasks/${id}`);
    else openTaskInDrawer(id);
  };
  /** The full-view button: go to the dedicated full-page route + close drawer. */
  const openFullView = () => {
    if (!projectId) return;
    closeTaskDrawer();
    router.push(`/projects/${projectId}/tasks/${taskId}`);
  };

  const updateTask = useUpdateTask();

  // ---- Lookups -------------------------------------------------------------
  const { data: statusesRaw } = useTaskStatuses(projectId);
  const { data: prioritiesRaw } = useTaskPriorities();
  const statuses = statusesRaw ?? [];
  const priorities = prioritiesRaw ?? [];

  const { data: membersRaw } = useProjectMembers(projectId);
  const { data: teamLabelsRaw } = useTeamLabels();
  const { data: teamMembersRaw } = useTeamMembers();

  // ---- Details -------------------------------------------------------------
  const { data: assigneesRaw } = useTaskAssignees(taskId);
  const setAssignees = useSetTaskAssignees();
  const { data: taskLabelsRaw } = useTaskLabels(taskId);
  const setLabels = useSetTaskLabels();
  const { data: commentsRaw } = useTaskComments(taskId);
  const addComment = useAddTaskComment();
  const { data: referencesRaw } = useTaskReferenceLinks(taskId);
  const addReference = useAddTaskReferenceLink();
  const deleteReference = useDeleteTaskReferenceLink();
  const reorderReferences = useReorderTaskReferenceLinks();
  const { data: linkedReviewsRaw } = useTaskVideoReviews(taskId);

  const { data: subtasksRaw } = useSubtasks(taskId);
  const createTask = useCreateTask();

  const assignees = assigneesRaw ?? [];
  const taskLabels = taskLabelsRaw ?? [];
  const comments = commentsRaw ?? [];
  const references = referencesRaw ?? [];
  const linkedReviews = linkedReviewsRaw ?? [];
  const subtasks = subtasksRaw ?? [];

  // ---- Availability (HR leave / holidays) ----------------------------------
  // Window: [start, end] when both dates exist; due-only tasks cover the
  // lead-up (today -> due); start-only tasks cover a two-week execution ramp;
  // undated tasks use a two-week look-ahead so assigning someone who is about
  // to go on leave still warns.
  const taskStartDate = task?.start_date ?? null;
  const taskEndDate = task?.end_date ?? null;
  const availabilityWindow = useMemo(() => {
    const today = dayjs().startOf("day");
    const todayIso = today.format("YYYY-MM-DD");
    // Task dates are timestamps; their calendar day can differ between the
    // viewer's zone and UTC (HR leave/holidays are org-absolute DATEs). Cover
    // both candidate days so the window always contains the intended one.
    const band = (ts: string): [string, string] => {
      const local = dayjs(ts).format("YYYY-MM-DD");
      const utc = ts.slice(0, 10);
      return local <= utc ? [local, utc] : [utc, local];
    };
    const start = taskStartDate ? band(taskStartDate) : null;
    const end = taskEndDate ? band(taskEndDate) : null;

    let from: string;
    let to: string;
    if (start && end) {
      from = start[0];
      to = end[1];
    } else if (end) {
      from = todayIso < end[0] ? todayIso : end[0];
      to = end[1];
    } else if (start) {
      from = start[0];
      const rampAnchor = start[1] > todayIso ? start[1] : todayIso;
      to = dayjs(rampAnchor).add(13, "day").format("YYYY-MM-DD");
    } else {
      from = todayIso;
      to = today.add(13, "day").format("YYYY-MM-DD");
    }
    if (to < from) [from, to] = [to, from];
    return { from, to };
  }, [taskStartDate, taskEndDate]);

  const { data: availabilityRaw } = useProjectAvailability(
    projectId,
    availabilityWindow.from,
    availabilityWindow.to,
  );
  const availability = useMemo(
    () => buildAvailabilityIndex(availabilityRaw),
    [availabilityRaw],
  );

  // Selected assignees who have approved leave inside the window.
  const assigneeLeaveWarnings = useMemo(() => {
    const out: { key: string; name: string; days: string; type: string }[] = [];
    for (const a of assigneesRaw ?? []) {
      const days = availability.leaveByMember.get(a.team_member_id);
      if (!days || days.size === 0) continue;
      const user = a.team_member?.user;
      // Only name the leave type when it's unambiguous; mixed types (e.g.
      // sick + annual inside one window) fall back to a generic label.
      const types = new Set(days.values());
      out.push({
        key: a.team_member_id,
        name: user?.name ?? user?.email ?? "Member",
        days: formatLeaveDays([...days.keys()]),
        type: types.size === 1 ? ([...types][0] ?? "Leave") : "Leave",
      });
    }
    return out;
  }, [assigneesRaw, availability]);

  // ---- Local editable text fields -----------------------------------------
  // `name`/`description` are locally controlled so typing feels instant and we
  // only persist on blur. They are re-seeded from the server row whenever a
  // *different* task loads (or its persisted text changes), using React's
  // "adjust state during render" pattern keyed by the row identity — this
  // avoids a setState-in-effect and stays correct across drawer re-targets.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submissionText, setSubmissionText] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  // AI subtask suggestions: null = none requested; keyed selection by index.
  const aiBreakdown = useAiBreakdown();
  const [aiSuggestions, setAiSuggestions] = useState<
    AiSubtaskSuggestion[] | null
  >(null);
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set());
  const [aiAdding, setAiAdding] = useState(false);
  const [commentText, setCommentText] = useState("");
  // Right panel: switch between Comments and Activity.
  const [rightTab, setRightTab] = useState<"comments" | "activity">("comments");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceTitle, setReferenceTitle] = useState("");
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const seedKey = task
    ? `${task.id}:${task.name}:${task.description ?? ""}:${task.submission_content ?? ""}`
    : "";
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  if (task && seededFrom !== seedKey) {
    setSeededFrom(seedKey);
    setName(task.name ?? "");
    setDescription(task.description ?? "");
    setSubmissionText(task.submission_content ?? "");
  }

  // AI suggestions belong to one task — drop them when the drawer re-targets
  // (same adjust-state-during-render pattern as the seed above, keyed by id
  // only so a rename doesn't clear an in-progress review).
  const [aiSeededTaskId, setAiSeededTaskId] = useState<string | null>(null);
  if (task && aiSeededTaskId !== task.id) {
    setAiSeededTaskId(task.id);
    setAiSuggestions(null);
    setAiSelected(new Set());
  }

  const memberOptions = useMemo(
    () =>
      (membersRaw ?? []).map((m) => {
        const user = m.team_member?.user;
        const name = user?.name ?? user?.email ?? "Unknown";
        // Flag members with approved leave inside the task's window so the
        // assign dropdown warns before the pick. Labels stay strings so
        // `optionFilterProp="label"` search keeps working.
        const onLeave = availability.leaveByMember.has(m.team_member_id);
        return {
          value: m.team_member_id,
          label: onLeave ? `${name} · On leave` : name,
        };
      }),
    [membersRaw, availability],
  );

  // @mention options are keyed by *user id* (task_comments.mentions is a uuid[]
  // of users), so invited-but-not-joined membership rows (no user) are skipped.
  const mentionMembers = useMemo(
    () =>
      (teamMembersRaw ?? [])
        .filter((m) => m.user != null)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.name ?? m.user!.email ?? "Unknown",
          avatarUrl: m.user!.avatar_url,
          email: m.user!.email,
        })),
    [teamMembersRaw],
  );

  const labelOptions = useMemo(
    () =>
      (teamLabelsRaw ?? []).map((l) => ({
        value: l.id,
        label: l.name,
        color: l.color_code,
      })),
    [teamLabelsRaw],
  );

  const currentStatus = useMemo(
    () => (statusesRaw ?? []).find((s) => s.id === task?.status_id),
    [statusesRaw, task?.status_id],
  );

  if (!task) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  const refreshRow = () =>
    queryClient.invalidateQueries({ queryKey: drawerRowKey(task.id) });

  // ---- Handlers ------------------------------------------------------------
  const patch = async (changes: Record<string, unknown>) => {
    try {
      await updateTask.mutateAsync({ id: task.id, ...changes });
      await refreshRow();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update task.",
      );
    }
  };

  const commitName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === task.name) return;
    await patch({ name: trimmed });
  };

  const commitDescription = async () => {
    const next = description.length ? description : null;
    if ((next ?? "") === (task.description ?? "")) return;
    await patch({ description: next });
  };

  const handleStatusChange = (statusId: string) =>
    patch({ status_id: statusId });

  const commitSubmission = async () => {
    const next = submissionText.length ? submissionText : null;
    if ((next ?? "") === (task.submission_content ?? "")) return;
    await patch({ submission_content: next });
  };

  const handlePriorityChange = (priorityId: string | null) =>
    patch({ priority_id: priorityId });

  const handleDateChange = (
    field: "start_date" | "end_date",
    value: Dayjs | null,
  ) => patch({ [field]: value ? value.toISOString() : null });

  const handleAssigneesChange = async (teamMemberIds: string[]) => {
    try {
      await setAssignees.mutateAsync({ taskId: task.id, teamMemberIds });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to set assignees.",
      );
    }
  };

  const handleLabelsChange = async (labelIds: string[]) => {
    try {
      await setLabels.mutateAsync({ taskId: task.id, labelIds });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to set labels.",
      );
    }
  };

  const handleAddSubtask = async () => {
    const trimmed = newSubtask.trim();
    if (!trimmed) return;
    try {
      await createTask.mutateAsync({
        name: trimmed,
        projectId: task.project_id,
        parentTaskId: task.id,
        statusId: task.status_id ?? undefined,
      });
      setNewSubtask("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to add subtask.",
      );
    }
  };

  const handleAiBreakdown = async () => {
    try {
      const result = await aiBreakdown.mutateAsync({ taskId: task.id });
      if (result.subtasks.length === 0) {
        message.info("The AI thinks this task is already atomic.");
        return;
      }
      setAiSuggestions(result.subtasks);
      setAiSelected(new Set(result.subtasks.map((_, i) => i)));
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "AI breakdown failed.",
      );
    }
  };

  const handleAddAiSelected = async () => {
    if (!aiSuggestions) return;
    const pickedIndexes = aiSuggestions
      .map((_, i) => i)
      .filter((i) => aiSelected.has(i));
    if (pickedIndexes.length === 0) return;
    setAiAdding(true);
    const added = new Set<number>();
    try {
      for (const i of pickedIndexes) {
        await createTask.mutateAsync({
          name: aiSuggestions[i].name,
          projectId: task.project_id,
          parentTaskId: task.id,
          statusId: task.status_id ?? undefined,
        });
        added.add(i);
      }
      message.success(
        `${added.size} subtask${added.size === 1 ? "" : "s"} added.`,
      );
      setAiSuggestions(null);
      setAiSelected(new Set());
    } catch (err) {
      // Drop what was already created so a retry can't duplicate it.
      if (added.size > 0) {
        setAiSuggestions(aiSuggestions.filter((_, i) => !added.has(i)));
        setAiSelected((prev) => {
          const next = new Set<number>();
          const remaining = aiSuggestions
            .map((_, i) => i)
            .filter((i) => !added.has(i));
          remaining.forEach((oldIdx, newIdx) => {
            if (prev.has(oldIdx)) next.add(newIdx);
          });
          return next;
        });
      }
      message.error(
        err instanceof Error
          ? `${err.message}${added.size > 0 ? ` (${added.size} added before the failure)` : ""}`
          : "Failed to add subtasks.",
      );
    } finally {
      setAiAdding(false);
    }
  };

  const handleAddComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    // Mentions are derived from the "@Name" tokens the composer inserted.
    const mentions = extractMentionUserIds(commentText, mentionMembers);
    try {
      await addComment.mutateAsync({
        taskId: task.id,
        content: trimmed,
        // `task_comments.mentions` is a uuid[] of mentioned users; setting it
        // lets the DB trigger notify them. Omitted when empty.
        ...(mentions.length > 0 ? { mentions } : {}),
      });
      setCommentText("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to add comment.",
      );
    }
  };

  const handleAddReference = async () => {
    const url = referenceUrl.trim();
    if (!url) return;
    try {
      await addReference.mutateAsync({
        taskId: task.id,
        url,
        title: referenceTitle.trim() || null,
      });
      setReferenceUrl("");
      setReferenceTitle("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to add reference.",
      );
    }
  };

  const handleMoveReference = async (id: string, dir: -1 | 1) => {
    const orderedIds = references.map((ref) => ref.id);
    const index = orderedIds.indexOf(id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= orderedIds.length) return;
    const [moved] = orderedIds.splice(index, 1);
    orderedIds.splice(target, 0, moved);
    try {
      await reorderReferences.mutateAsync({ taskId: task.id, orderedIds });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to reorder references.",
      );
    }
  };

  const assigneeValue = assignees.map((a) => a.team_member_id);
  const labelValue = taskLabels.map((l) => l.label_id);

  const currentPriority = priorities.find((p) => p.id === task.priority_id);
  const sTone = statusTone(currentStatus);
  const dueOverdue =
    !task.done &&
    task.end_date != null &&
    dayjs(task.end_date).isBefore(dayjs().startOf("day"));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: DT.panel,
      }}
    >
      {/* Sticky header: meta chips row + editable title + view controls -- */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: isPage ? "16px 28px 14px" : "13px 18px 12px",
          borderBottom: `1px solid ${DT.hairline}`,
          flex: "0 0 auto",
          maxWidth: isPage ? 1160 : undefined,
          width: isPage ? "100%" : undefined,
          margin: isPage ? "0 auto" : undefined,
        }}
      >
        {isPage ? (
          <Button
            onClick={() => router.push(`/projects/${task.project_id}`)}
            icon={
              <span className="material-symbols-rounded" style={{ fontSize: 17 }}>
                arrow_back
              </span>
            }
            style={{ flex: "none", marginTop: 2 }}
          >
            Back
          </Button>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Chips row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 7,
            }}
          >
            {task.parent_task_id ? (
              <button
                type="button"
                onClick={() => openTaskDetail(task.parent_task_id as string)}
                title="Go to parent task"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: DT.accent,
                  background: "transparent",
                  border: `1px solid ${DT.hairline}`,
                  borderRadius: 999,
                  padding: "1px 9px 1px 7px",
                  cursor: "pointer",
                }}
              >
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14 }}>
                  subdirectory_arrow_right
                </span>
                Subtask
              </button>
            ) : null}
            <span
              style={{
                fontFamily: DT.mono,
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: 0.3,
                color: DT.textTertiary,
              }}
            >
              {task.task_no != null ? (
                <TaskIdLabel projectId={task.project_id} taskNo={task.task_no} />
              ) : (
                "TASK"
              )}
            </span>
            <a
              href={`/projects/${task.project_id}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11.5,
                fontWeight: 600,
                color: DT.textSecondary,
                border: `1px solid ${DT.hairline}`,
                borderRadius: 999,
                padding: "2px 10px",
                textDecoration: "none",
              }}
            >
              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 13 }}>
                folder_open
              </span>
              {projectName ?? "Project"}
            </a>
          </div>
          {/* Editable title */}
          <Input.TextArea
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onPressEnter={(e) => {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }}
            placeholder="Task name"
            autoSize={{ minRows: 1, maxRows: 3 }}
            variant="borderless"
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: DT.textPrimary,
              padding: 0,
              lineHeight: 1.3,
            }}
          />
        </div>
        {!isPage ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2, flex: "none", paddingTop: 2 }}>
            <Tooltip title="Open in full page">
              <button
                type="button"
                aria-label="Open in full page"
                onClick={openFullView}
                className="td-hdr-btn"
              >
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 19 }}>
                  open_in_full
                </span>
              </button>
            </Tooltip>
            <Tooltip title="Close">
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="td-hdr-btn"
              >
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 20 }}>
                  close
                </span>
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>

      {/* Workspace body -------------------------------------------------- */}
      <div
        className="td-body"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: `minmax(0, 1fr) ${isPage ? "400px" : "320px"}`,
          maxWidth: isPage ? 1160 : undefined,
          width: isPage ? "100%" : undefined,
          margin: isPage ? "0 auto" : undefined,
        }}
      >
        <div style={{ overflowY: "auto", padding: isPage ? "22px 28px 32px" : "18px 18px 24px" }}>
          <style>{`.td-hdr-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:8px;background:transparent;cursor:pointer;color:${DT.textSecondary};transition:background .12s;}.td-hdr-btn:hover{background:${DT.hairline};}`}</style>
          {/* Property grid (2-column, ClickUp-style) -------------------- */}
          <style>{`@media (max-width: 640px){ .td-props { grid-template-columns: 1fr !important; } .td-body{ grid-template-columns:1fr !important; } }`}</style>
          <div
            className="td-props"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "2px 28px",
              marginBottom: 18,
            }}
          >
          <MetaRow icon="radio_button_checked" label="Status">
            <Select
              value={task.status_id ?? undefined}
              onChange={handleStatusChange}
              placeholder="Select status"
              variant="borderless"
              style={{ width: "100%" }}
              styles={{ popup: { root: { minWidth: 200 } } }}
              labelRender={() =>
                currentStatus ? (
                  <SemanticPill tone={sTone.tone} icon={sTone.glyph}>
                    {currentStatus.name}
                  </SemanticPill>
                ) : (
                  <span style={{ color: DT.textTertiary }}>Select status</span>
                )
              }
              options={statuses.map((s) => {
                const t = statusTone(s);
                return {
                  value: s.id,
                  label: (
                    <SemanticPill tone={t.tone} icon={t.glyph}>
                      {s.name}
                    </SemanticPill>
                  ),
                };
              })}
            />
          </MetaRow>

          <MetaRow icon="flag" label="Priority">
            <Select
              value={task.priority_id ?? undefined}
              onChange={(v) => handlePriorityChange(v ?? null)}
              placeholder="Select priority"
              allowClear
              variant="borderless"
              style={{ width: "100%" }}
              labelRender={() =>
                currentPriority ? (
                  <SemanticPill
                    tone={priorityTone(currentPriority.name)}
                    icon="flag"
                  >
                    {currentPriority.name}
                  </SemanticPill>
                ) : (
                  <span style={{ color: DT.textTertiary }}>Select priority</span>
                )
              }
              options={priorities.map((p) => ({
                value: p.id,
                label: (
                  <SemanticPill tone={priorityTone(p.name)} icon="flag">
                    {p.name}
                  </SemanticPill>
                ),
              }))}
            />
          </MetaRow>

          <MetaRow icon="group" label="Assignees" wide>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {assignees.length > 0 ? (
                  <Avatar.Group
                    max={{
                      count: 4,
                      style: { backgroundColor: "#8a8d98", fontSize: 11 },
                    }}
                    size={22}
                  >
                    {assignees.map((a) => {
                      const user = a.team_member?.user;
                      const nm = user?.name ?? "Member";
                      return (
                        <Tooltip key={a.team_member_id} title={nm}>
                          <SolidAvatar
                            name={nm}
                            avatarUrl={user?.avatar_url}
                            seed={a.team_member_id}
                          />
                        </Tooltip>
                      );
                    })}
                  </Avatar.Group>
                ) : null}
                <Select
                  mode="multiple"
                  value={assigneeValue}
                  onChange={handleAssigneesChange}
                  placeholder="Assign"
                  variant="borderless"
                  style={{ flex: 1, minWidth: 0 }}
                  optionFilterProp="label"
                  loading={setAssignees.isPending}
                  options={memberOptions}
                  maxTagCount={0}
                  maxTagPlaceholder={() =>
                    assignees.length > 0 ? "Edit" : "Assign"
                  }
                  suffixIcon={
                    <span
                      className="material-symbols-rounded"
                      aria-hidden
                      style={{ fontSize: 16, color: DT.textTertiary }}
                    >
                      person_add
                    </span>
                  }
                />
              </div>
              {assigneeLeaveWarnings.map((w) => (
                <Tooltip
                  key={w.key}
                  title={`${w.type} — approved in HR. Dates within ${
                    task.start_date || task.end_date
                      ? "this task's schedule"
                      : "the next two weeks"
                  }.`}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      color: SEMANTIC.amber.fg,
                      lineHeight: 1.4,
                    }}
                  >
                    <span
                      className="material-symbols-rounded"
                      aria-hidden
                      style={{ fontSize: 15, lineHeight: 1 }}
                    >
                      event_busy
                    </span>
                    {w.name} is on leave {w.days}
                  </span>
                </Tooltip>
              ))}
            </div>
          </MetaRow>

          <MetaRow icon="event" label="Due date">
            <DatePicker
              value={task.end_date ? dayjs(task.end_date) : null}
              onChange={(v) => handleDateChange("end_date", v)}
              variant="filled"
              placeholder="No due date"
              allowClear
              style={{ width: "100%" }}
              styles={{
                root: {
                  color: dueOverdue ? DT.overdue : DT.textSecondary,
                },
              }}
              suffixIcon={
                <span
                  className="material-symbols-rounded"
                  aria-hidden
                  style={{ fontSize: 15, color: dueOverdue ? DT.overdue : DT.textTertiary }}
                >
                  event
                </span>
              }
            />
          </MetaRow>

          <MetaRow icon="calendar_today" label="Start date">
            <DatePicker
              variant="filled"
              style={{ width: "100%" }}
              value={task.start_date ? dayjs(task.start_date) : null}
              onChange={(v) => handleDateChange("start_date", v)}
              placeholder="No start date"
            />
          </MetaRow>

          <MetaRow icon="sell" label="Labels" wide>
            <Select
              mode="multiple"
              value={labelValue}
              onChange={handleLabelsChange}
              placeholder="Add labels"
              variant="filled"
              style={{ width: "100%" }}
              optionFilterProp="label"
              loading={setLabels.isPending}
              options={labelOptions.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              tagRender={(props) => {
                const opt = labelOptions.find((l) => l.value === props.value);
                return (
                  <Tag
                    color={opt?.color ?? undefined}
                    closable={props.closable}
                    onClose={props.onClose}
                    style={{ marginInlineEnd: 4, borderRadius: 6 }}
                  >
                    {props.label}
                  </Tag>
                );
              }}
            />
          </MetaRow>

          <MetaRow icon="account_tree" label="Phase">
            <TaskPhaseSelect taskId={task.id} projectId={task.project_id} />
          </MetaRow>

          <MetaRow icon="inventory_2" label="Deliverable">
            <Select
              value={task.deliverable_type ?? undefined}
              onChange={(v) => patch({ deliverable_type: v ?? null })}
              placeholder="None"
              allowClear
              variant="filled"
              style={{ width: "100%" }}
              options={[
                {
                  value: "video",
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 15 }}>movie</span>
                      Video review
                    </span>
                  ),
                },
                {
                  value: "text",
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 15 }}>notes</span>
                      Text
                    </span>
                  ),
                },
              ]}
            />
          </MetaRow>
          </div>

          <SectionDivider />

          {/* Description (rich, doc-like) -------------------------------- */}
          <SectionHeading>Description</SectionHeading>
          <RichDescription
            value={description}
            onChange={setDescription}
            onCommit={commitDescription}
            minRows={isPage ? 6 : 3}
            maxRows={isPage ? 24 : 12}
          />

          {/* Submission (deliverable-dependent) ------------------------- */}
          {task.deliverable_type ? (
            <>
              <SectionDivider />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <SectionHeading>Submission</SectionHeading>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      submission_status:
                        task.submission_status === "submitted" ? "pending" : "submitted",
                    })
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "3px 11px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border: `1px solid ${task.submission_status === "submitted" ? SEMANTIC.green.fg : DT.hairline}`,
                    background:
                      task.submission_status === "submitted" ? SEMANTIC.green.bg : "transparent",
                    color:
                      task.submission_status === "submitted" ? SEMANTIC.green.fg : DT.textSecondary,
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 15 }}>
                    {task.submission_status === "submitted" ? "task_alt" : "radio_button_unchecked"}
                  </span>
                  {task.submission_status === "submitted" ? "Submitted" : "Mark submitted"}
                </button>
              </div>

              {task.deliverable_type === "video" ? (
                <div
                  style={{
                    border: `1px dashed ${DT.hairline}`,
                    borderRadius: 12,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        flex: "none",
                        borderRadius: 9,
                        background: SEMANTIC.indigo.bg,
                        color: SEMANTIC.indigo.fg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span className="material-symbols-rounded" style={{ fontSize: 20 }}>movie</span>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: DT.textPrimary }}>
                        Video review deliverable
                      </div>
                      <div style={{ fontSize: 12, color: DT.textTertiary }}>
                        {linkedReviews.length > 0
                          ? `${linkedReviews.length} review${linkedReviews.length === 1 ? "" : "s"} submitted`
                          : "Submit the deliverable as a video review."}
                      </div>
                    </div>
                    <Button
                      type="primary"
                      icon={<span className="material-symbols-rounded" style={{ fontSize: 15 }}>add</span>}
                      onClick={() => setReviewModalOpen(true)}
                      style={{ background: DT.accent }}
                    >
                      New review
                    </Button>
                  </div>
                  {linkedReviews.map((review) => (
                    <button
                      key={review.id}
                      type="button"
                      onClick={() => (window.location.href = `/apps/video-review/${review.id}`)}
                      style={{
                        border: `1px solid ${DT.hairline}`,
                        borderRadius: 10,
                        background: DT.panel,
                        padding: "10px 12px",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span className="material-symbols-rounded" style={{ fontSize: 17, color: DT.textTertiary }}>play_circle</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600, color: DT.textPrimary, fontSize: 13 }}>
                          {review.title}
                        </span>
                        <span style={{ fontSize: 11.5, color: DT.textTertiary }}>
                          {VIDEO_STATUS_META[review.status]?.label ?? review.status}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="td-desc">
                  <style>{`
                    .td-desc{border:1px solid ${DT.hairline};border-radius:12px;background:${DT.panel};padding:12px 14px;transition:border-color .14s,box-shadow .14s;}
                    .td-desc:focus-within{border-color:${DT.textTertiary};}
                    .td-desc .ant-input{background:transparent !important;font-size:14px;line-height:1.65;color:${DT.textPrimary};}
                  `}</style>
                  <Input.TextArea
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    onBlur={commitSubmission}
                    placeholder="Write the deliverable here… (saved when you click away)"
                    autoSize={{ minRows: 4, maxRows: 16 }}
                    variant="borderless"
                    style={{ padding: 0 }}
                  />
                </div>
              )}
            </>
          ) : null}

          <SectionDivider />

          <SectionHeading
            count={references.length > 0 ? references.length : undefined}
          >
            References
          </SectionHeading>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {references.length > 0 ? (
              references.map((reference, index) => (
                <div
                  key={reference.id}
                  style={{
                    border: `1px solid ${DT.hairline}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <a
                    href={reference.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "block",
                      color: DT.textPrimary,
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    {reference.title || reference.domain || reference.url}
                  </a>
                  <div style={{ fontSize: 12, color: DT.textTertiary, marginTop: 4 }}>
                    {reference.domain || reference.url}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Button
                      size="small"
                      onClick={() => handleMoveReference(reference.id, -1)}
                      disabled={index === 0 || reorderReferences.isPending}
                    >
                      Move up
                    </Button>
                    <Button
                      size="small"
                      onClick={() => handleMoveReference(reference.id, 1)}
                      disabled={index === references.length - 1 || reorderReferences.isPending}
                    >
                      Move down
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        void deleteReference.mutateAsync({
                          id: reference.id,
                          taskId: task.id,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>
                No references yet.
              </Text>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px auto",
                gap: 8,
              }}
            >
              <Input
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder="https://example.com"
              />
              <Input
                value={referenceTitle}
                onChange={(e) => setReferenceTitle(e.target.value)}
                placeholder="Optional title"
              />
              <Button
                type="primary"
                onClick={handleAddReference}
                loading={addReference.isPending}
                disabled={!referenceUrl.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Standalone video-review linking — hidden when the task's
              deliverable IS a video review (that lives in Submission above). */}
          {task.deliverable_type !== "video" ? (
            <>
              <SectionDivider />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <SectionHeading
                  count={linkedReviews.length > 0 ? linkedReviews.length : undefined}
                >
                  Linked Video Reviews
                </SectionHeading>
                <div style={{ display: "flex", gap: 6 }}>
                  {linkedReviews[0] ? (
                    <Button
                      size="small"
                      onClick={() =>
                        (window.location.href = `/apps/video-review/${linkedReviews[0].id}`)
                      }
                    >
                      Open latest
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    type="primary"
                    icon={<span className="material-symbols-rounded" style={{ fontSize: 15 }}>add</span>}
                    onClick={() => setReviewModalOpen(true)}
                    style={{ background: DT.accent }}
                  >
                    New review
                  </Button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {linkedReviews.length > 0 ? (
                  linkedReviews.map((review) => (
                    <button
                      key={review.id}
                      type="button"
                      onClick={() =>
                        (window.location.href = `/apps/video-review/${review.id}`)
                      }
                      style={{
                        border: `1px solid ${DT.hairline}`,
                        borderRadius: 10,
                        background: DT.panel,
                        padding: "12px 14px",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: DT.textPrimary }}>
                        {review.title}
                      </div>
                      <div style={{ fontSize: 12, color: DT.textTertiary, marginTop: 4 }}>
                        {review.project?.name ?? "No project"} · {VIDEO_STATUS_META[review.status]?.label ?? review.status}
                      </div>
                    </button>
                  ))
                ) : (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    No reviews linked to this task yet.
                  </Text>
                )}
              </div>
            </>
          ) : null}

          <SectionDivider />

          {/* Subtasks ---------------------------------------------------- */}
          <SectionHeading
            count={subtasks.length > 0 ? subtasks.length : undefined}
          >
            Subtasks
          </SectionHeading>
        {subtasks.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              marginBottom: 4,
            }}
          >
            <style>{`.td-subtask{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid ${DT.hairline};border-radius:10px;background:${DT.panel};cursor:pointer;transition:border-color .12s,box-shadow .12s;width:100%;text-align:left;}.td-subtask:hover{border-color:${DT.accent};box-shadow:0 2px 10px -6px rgba(40,30,110,.3);}.td-subtask:hover .td-subtask-open{opacity:1;}`}</style>
            {subtasks.map((st) => (
              <button
                key={st.id}
                type="button"
                className="td-subtask"
                onClick={() => openTaskDetail(st.id)}
                title={`Open subtask${st.task_no != null ? ` #${st.task_no}` : ""}`}
              >
                {/* Subtask branch icon */}
                <span
                  aria-hidden
                  className="material-symbols-rounded"
                  style={{ fontSize: 16, color: DT.textTertiary, flex: "none" }}
                >
                  subdirectory_arrow_right
                </span>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: `2px solid ${st.done ? DT.accent : DT.textTertiary}`,
                    background: st.done ? DT.accent : "transparent",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                  }}
                >
                  {st.done ? (
                    <span
                      className="material-symbols-rounded"
                      aria-hidden
                      style={{ fontSize: 12, color: "#fff" }}
                    >
                      check
                    </span>
                  ) : null}
                </span>
                {st.task_no != null ? (
                  <span
                    style={{
                      fontFamily: DT.mono,
                      fontSize: 11,
                      color: DT.textTertiary,
                      flex: "none",
                    }}
                  >
                    #{st.task_no}
                  </span>
                ) : null}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    fontWeight: 500,
                    color: st.done ? DT.textTertiary : DT.textPrimary,
                    textDecoration: st.done ? "line-through" : undefined,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {st.name}
                </span>
                <span
                  aria-hidden
                  className="material-symbols-rounded td-subtask-open"
                  style={{ fontSize: 15, color: DT.textTertiary, flex: "none", opacity: 0, transition: "opacity .12s" }}
                >
                  open_in_full
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 13 }}>
            No subtasks yet.
          </Text>
        )}
        <Space.Compact style={{ width: "100%", marginTop: 10 }}>
          <Input
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onPressEnter={handleAddSubtask}
            placeholder="Add a subtask"
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={createTask.isPending}
            onClick={handleAddSubtask}
            disabled={!newSubtask.trim()}
            style={{ background: DT.accent }}
          >
            Add
          </Button>
        </Space.Compact>

        {/* AI breakdown: suggest subtasks, user picks which to create. */}
        {aiSuggestions === null ? (
          <Button
            size="small"
            type="text"
            icon={<ThunderboltOutlined />}
            loading={aiBreakdown.isPending}
            onClick={handleAiBreakdown}
            style={{ marginTop: 8, color: DT.accent, paddingInline: 4 }}
          >
            Break down with AI
          </Button>
        ) : (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              background: token.colorFillTertiary,
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Text strong style={{ fontSize: 12.5 }}>
              AI suggestions
            </Text>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {aiSuggestions.map((s, i) => (
                <Checkbox
                  key={`${i}-${s.name}`}
                  checked={aiSelected.has(i)}
                  onChange={(e) => {
                    setAiSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    });
                  }}
                >
                  <span style={{ fontSize: 13 }}>{s.name}</span>
                  {s.description ? (
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, marginInlineStart: 6 }}
                    >
                      — {s.description}
                    </Text>
                  ) : null}
                </Checkbox>
              ))}
            </div>
            <Space size={8}>
              <Button
                size="small"
                type="primary"
                loading={aiAdding}
                disabled={aiSelected.size === 0}
                onClick={handleAddAiSelected}
                style={{ background: DT.accent }}
              >
                Add {aiSelected.size} selected
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => {
                  setAiSuggestions(null);
                  setAiSelected(new Set());
                }}
              >
                Dismiss
              </Button>
            </Space>
          </div>
        )}

          <SectionDivider />

          {/* Dependencies ------------------------------------------------ */}
          <TaskDependencies taskId={task.id} projectId={task.project_id} />

          <SectionDivider />

          {/* Attachments ------------------------------------------------- */}
          <TaskAttachments taskId={task.id} projectId={task.project_id} />
        </div>

        <div
          style={{
            borderLeft: `1px solid ${DT.hairline}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: token.colorBgLayout,
          }}
        >
          {/* Comments / Activity tab switch */}
          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              gap: 4,
              padding: "12px 16px 0",
            }}
          >
            {(
              [
                { key: "comments" as const, label: "Comments", count: comments.length },
                { key: "activity" as const, label: "Activity" },
              ]
            ).map((t) => {
              const active = rightTab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setRightTab(t.key)}
                  style={{
                    border: "none",
                    background: active ? DT.panel : "transparent",
                    color: active ? DT.textPrimary : DT.textTertiary,
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "6px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    boxShadow: active ? `inset 0 0 0 1px ${DT.hairline}` : "none",
                    transition: "background .14s, color .14s",
                  }}
                >
                  {t.label}
                  {t.count ? (
                    <span
                      style={{
                        fontFamily: DT.mono,
                        fontSize: 11,
                        color: DT.textTertiary,
                        background: DT.innerDivider,
                        borderRadius: 999,
                        padding: "0 6px",
                        lineHeight: "16px",
                      }}
                    >
                      {t.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "12px 16px 12px" }}>
            {rightTab === "activity" ? (
              <TaskActivity taskId={task.id} />
            ) : comments.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {comments.map((c) => (
                  <div key={c.id} style={{ display: "flex", gap: 10 }}>
                    <SolidAvatar
                      name={c.author?.name ?? "Unknown"}
                      avatarUrl={c.author?.avatar_url}
                      seed={c.author?.id ?? c.id}
                      size={28}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: DT.textPrimary,
                          }}
                        >
                          {c.author?.name ?? "Unknown"}
                        </span>
                        <span
                          style={{
                            fontFamily: DT.mono,
                            fontSize: 11.5,
                            color: DT.textTertiary,
                          }}
                        >
                          {dayjs(c.created_at).format("MMM D, h:mm A")}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: DT.textPrimary,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {c.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No comments yet"
                style={{ margin: "12px 0" }}
              />
            )}
          </div>

          {/* Composer belongs to the Comments tab only. */}
          <div
            style={{
              flex: "0 0 auto",
              borderTop: `1px solid ${DT.hairline}`,
              padding: "12px 16px 14px",
              background: DT.panel,
              display: rightTab === "comments" ? "block" : "none",
            }}
          >
            <div className="td-composer">
              <style>{`
                .td-composer{border:1px solid ${DT.hairline};border-radius:14px;background:${DT.panel};padding:10px 10px 8px;transition:border-color .14s,box-shadow .14s;}
                .td-composer:focus-within{border-color:${DT.textTertiary};}
                .td-composer .ant-input{background:transparent !important;}
              `}</style>
              <div style={{ display: "flex", gap: 9 }}>
                <SolidAvatar
                  name={profile?.name ?? "You"}
                  avatarUrl={profile?.avatar_url}
                  seed={profile?.id ?? "me"}
                  size={26}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TeamMentionInput
                    value={commentText}
                    onChange={setCommentText}
                    members={mentionMembers}
                    placeholder="Write a comment…  (type @ to mention)"
                    autoSize={{ minRows: 1, maxRows: 5 }}
                  />
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: `1px solid ${DT.innerDivider}`,
                }}
              >
                <span style={{ fontSize: 11.5, color: DT.textTertiary, display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14 }}>alternate_email</span>
                  Type @ to mention
                </span>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={addComment.isPending}
                  onClick={handleAddComment}
                  disabled={!commentText.trim()}
                  aria-label="Send comment"
                  style={{ background: commentText.trim() ? DT.accent : undefined, borderRadius: 9, fontWeight: 600 }}
                >
                  Comment
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <NewReviewModal
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        defaultProjectId={task.project_id}
        defaultTaskId={task.id}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section chrome helpers.                                                    */
/* -------------------------------------------------------------------------- */

function SectionDivider() {
  const DT = useDrawerTokens();
  return (
    <div
      aria-hidden
      style={{ height: 1, background: DT.hairline, margin: "18px 0" }}
    />
  );
}

function SectionHeading({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  const DT = useDrawerTokens();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 10,
      }}
    >
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: DT.textPrimary,
        }}
      >
        {children}
      </span>
      {count != null ? (
        <span
          style={{
            fontFamily: DT.mono,
            fontSize: 11.5,
            fontWeight: 600,
            color: DT.textSecondary,
            background: DT.chip,
            borderRadius: 999,
            padding: "1px 8px",
          }}
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* Attachments                                                                */
/* -------------------------------------------------------------------------- */

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function TaskAttachments({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const { message } = App.useApp();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  const { data: attachmentsRaw, isLoading } = useTaskAttachments(taskId);
  const uploadAttachment = useUploadAttachment();
  const deleteAttachment = useDeleteAttachment();

  const attachments: TaskAttachment[] = attachmentsRaw ?? [];

  // Defer antd's default XHR upload to the storage hook by returning false.
  const beforeUpload: UploadProps["beforeUpload"] = (file) => {
    if (!teamId) {
      message.error("No active team selected.");
      return Upload.LIST_IGNORE;
    }
    void (async () => {
      try {
        await uploadAttachment.mutateAsync({
          file: file as File,
          taskId,
          projectId,
          teamId,
        });
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : "Failed to upload attachment.",
        );
      }
    })();
    return false;
  };

  const handleDownload = async (att: TaskAttachment) => {
    if (!att.storage_path) return;
    try {
      const url = await getAttachmentSignedUrl(att.storage_path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to open attachment.",
      );
    }
  };

  const handleDelete = async (att: TaskAttachment) => {
    try {
      await deleteAttachment.mutateAsync(att);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete attachment.",
      );
    }
  };

  return (
    <>
      <Title level={5} style={{ marginBottom: 8 }}>
        Attachments
      </Title>

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
          <Spin size="small" />
        </div>
      ) : attachments.length > 0 ? (
        <List
          size="small"
          dataSource={attachments}
          renderItem={(att) => (
            <List.Item
              key={att.id}
              style={{ paddingInline: 0 }}
              actions={[
                <Button
                  key="download"
                  type="text"
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={() => handleDownload(att)}
                  aria-label="Download attachment"
                />,
                <Popconfirm
                  key="delete"
                  title="Delete this attachment?"
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => handleDelete(att)}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Delete attachment"
                  />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                avatar={<PaperClipOutlined />}
                title={
                  <Text
                    style={{ fontSize: 13, cursor: "pointer" }}
                    onClick={() => handleDownload(att)}
                  >
                    {att.name ?? "Attachment"}
                  </Text>
                }
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatBytes(att.size)}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <Text type="secondary" style={{ fontSize: 13 }}>
          No attachments yet.
        </Text>
      )}

      <Upload
        showUploadList={false}
        beforeUpload={beforeUpload}
        disabled={!teamId}
      >
        <Button
          icon={<UploadOutlined />}
          loading={uploadAttachment.isPending}
          disabled={!teamId}
          style={{ marginTop: 8 }}
        >
          Upload file
        </Button>
      </Upload>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Phase                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A project phase as rendered by the drawer. Mirrors the `project_phases` row
 * shape exported by Agent A's `useProjectPhases`. Typed structurally so the
 * drawer stays decoupled from the hook's exact export.
 */
interface ProjectPhase {
  id: string;
  name: string;
  color_code: string | null;
  sort_index: number;
}

function TaskPhaseSelect({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const { message } = App.useApp();

  const { data: phasesRaw } = useProjectPhases(projectId);
  const { data: taskPhaseRaw } = useTaskPhase(taskId);
  const setTaskPhase = useSetTaskPhase();
  const clearTaskPhase = useClearTaskPhase();

  const phases = (phasesRaw ?? []) as unknown as ProjectPhase[];
  const value = taskPhaseRaw ?? undefined;

  const busy = setTaskPhase.isPending || clearTaskPhase.isPending;

  const handleChange = async (phaseId: string | undefined) => {
    try {
      if (!phaseId) {
        await clearTaskPhase.mutateAsync(taskId);
      } else {
        await setTaskPhase.mutateAsync({ taskId, phaseId });
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to set phase.",
      );
    }
  };

  return (
    <Select
      value={value}
      onChange={(v) => handleChange(v ?? undefined)}
      placeholder="Select phase"
      allowClear
      style={{ width: "100%" }}
      loading={busy}
      optionFilterProp="label"
      options={phases.map((p) => ({
        value: p.id,
        label: (
          <Space size={6}>
            {p.color_code ? (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: p.color_code,
                }}
              />
            ) : null}
            {p.name}
          </Space>
        ),
      }))}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Dependencies                                                               */
/* -------------------------------------------------------------------------- */

type DependencyRelation = "blocked_by" | "blocks";

/**
 * A dependency row as rendered by the drawer. Mirrors the shape exported by
 * Agent A's `useTaskDependencies` (a `task_dependencies` row, optionally joined
 * to the depended-on task for display). Typed structurally so the drawer stays
 * decoupled from the hook's exact export.
 */
interface DependencyEntry {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  relation_type: string;
  depends_on_task?: {
    id: string;
    name: string;
    task_no: number | null;
  } | null;
}

const RELATION_OPTIONS: { value: DependencyRelation; label: string }[] = [
  { value: "blocked_by", label: "Blocked by" },
  { value: "blocks", label: "Blocks" },
];

function relationLabel(relation: string): string {
  return RELATION_OPTIONS.find((r) => r.value === relation)?.label ?? relation;
}

function TaskDependencies({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const { message } = App.useApp();

  const { data: dependenciesRaw, isLoading } = useTaskDependencies(taskId);
  const { data: projectTasksRaw } = useTasks(projectId);
  const addDependency = useAddDependency();
  const removeDependency = useRemoveDependency();

  const dependencies = (dependenciesRaw ?? []) as unknown as DependencyEntry[];
  const projectTasks = projectTasksRaw ?? [];

  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(
    undefined,
  );
  const [relationType, setRelationType] =
    useState<DependencyRelation>("blocked_by");

  // Name lookup for rendering dependency rows whose hook embed may not carry
  // the depended-on task.
  const taskById = useMemo(() => {
    const map = new Map<
      string,
      { name: string; task_no: number | null }
    >();
    for (const t of projectTasks) {
      map.set(t.id, { name: t.name, task_no: t.task_no });
    }
    return map;
  }, [projectTasks]);

  // Candidates exclude the task itself (self-dep rejected by CHECK) and any
  // task it already depends on (UNIQUE constraint).
  const existingDeps = useMemo(
    () => new Set(dependencies.map((d) => d.depends_on_task_id)),
    [dependencies],
  );

  const candidateOptions = useMemo(
    () =>
      projectTasks
        .filter((t) => t.id !== taskId && !existingDeps.has(t.id))
        .map((t) => ({
          value: t.id,
          label:
            t.task_no != null ? `#${t.task_no} ${t.name}` : t.name,
        })),
    [projectTasks, taskId, existingDeps],
  );

  const handleAdd = async () => {
    if (!selectedTaskId) return;
    try {
      await addDependency.mutateAsync({
        taskId,
        dependsOnTaskId: selectedTaskId,
        relationType,
      });
      setSelectedTaskId(undefined);
      setRelationType("blocked_by");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to add dependency.",
      );
    }
  };

  const handleRemove = async (dep: DependencyEntry) => {
    try {
      await removeDependency.mutateAsync(dep.id);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to remove dependency.",
      );
    }
  };

  return (
    <>
      <Title level={5} style={{ marginBottom: 8 }}>
        Dependencies
      </Title>

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
          <Spin size="small" />
        </div>
      ) : dependencies.length > 0 ? (
        <List
          size="small"
          dataSource={dependencies}
          renderItem={(dep) => {
            const embed = dep.depends_on_task;
            const fallback = taskById.get(dep.depends_on_task_id);
            const name = embed?.name ?? fallback?.name ?? "Unknown task";
            const taskNo = embed?.task_no ?? fallback?.task_no ?? null;
            return (
              <List.Item
                key={dep.id}
                style={{ paddingInline: 0 }}
                actions={[
                  <Popconfirm
                    key="remove"
                    title="Remove this dependency?"
                    okText="Remove"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => handleRemove(dep)}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="Remove dependency"
                    />
                  </Popconfirm>,
                ]}
              >
                <Space size={8} wrap>
                  <Tag>{relationLabel(dep.relation_type)}</Tag>
                  <span>
                    {taskNo != null ? (
                      <Text type="secondary">#{taskNo} </Text>
                    ) : null}
                    <Text>{name}</Text>
                  </span>
                </Space>
              </List.Item>
            );
          }}
        />
      ) : (
        <Text type="secondary" style={{ fontSize: 13 }}>
          No dependencies yet.
        </Text>
      )}

      <Space.Compact style={{ width: "100%", marginTop: 8 }}>
        <Select
          value={relationType}
          onChange={(v) => setRelationType(v)}
          options={RELATION_OPTIONS}
          style={{ width: 140 }}
          aria-label="Relation type"
        />
        <Select
          showSearch
          value={selectedTaskId}
          onChange={setSelectedTaskId}
          placeholder="Select a task"
          style={{ flex: 1, minWidth: 0 }}
          optionFilterProp="label"
          options={candidateOptions}
          notFoundContent="No other tasks available."
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={addDependency.isPending}
          onClick={handleAdd}
          disabled={!selectedTaskId}
        >
          Add
        </Button>
      </Space.Compact>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * An activity-log row as rendered in the drawer. Mirrors the shape exported by
 * Agent A's `useTaskActivity` (a `task_activity_logs` row with the acting user
 * embedded). Typed structurally so the drawer stays decoupled from the hook's
 * exact export.
 */
interface ActivityEntry {
  id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  user: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  } | null;
}

/** Build a human sentence describing one activity entry. */
function describeActivity(entry: ActivityEntry): string {
  const from = entry.old_value?.trim();
  const to = entry.new_value?.trim();
  const field = entry.field?.trim();

  switch (entry.action) {
    case "created":
      return "created this task";
    case "completed":
      return "marked this task complete";
    case "assigned":
      return to ? `was assigned to ${to}` : "was assigned";
    case "renamed":
      return from && to
        ? `renamed this task from “${from}” to “${to}”`
        : to
          ? `renamed this task to “${to}”`
          : "renamed this task";
    case "status_changed":
      return from && to
        ? `changed status from ${from} to ${to}`
        : to
          ? `changed status to ${to}`
          : "changed the status";
    case "priority_changed":
      return from && to
        ? `changed priority from ${from} to ${to}`
        : to
          ? `changed priority to ${to}`
          : "changed the priority";
    default: {
      const label = field ?? entry.action.replace(/_/g, " ");
      if (from && to) return `changed ${label} from ${from} to ${to}`;
      if (to) return `changed ${label} to ${to}`;
      return `updated ${label}`;
    }
  }
}

function TaskActivity({ taskId }: { taskId: string }) {
  const { data: activityRaw, isLoading } = useTaskActivity(taskId);
  const activity = (activityRaw ?? []) as unknown as ActivityEntry[];

  return (
    <>
      <Title level={5} style={{ marginBottom: 8 }}>
        Activity
      </Title>

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
          <Spin size="small" />
        </div>
      ) : activity.length > 0 ? (
        <Timeline
          style={{ marginTop: 8 }}
          items={activity.map((entry) => ({
            key: entry.id,
            dot: (
              <Avatar
                size="small"
                src={entry.user?.avatar_url ?? undefined}
                icon={<UserOutlined />}
              />
            ),
            children: (
              <Space direction="vertical" size={0}>
                <Text style={{ fontSize: 13 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    {entry.user?.name ?? "Someone"}
                  </Text>{" "}
                  {describeActivity(entry)}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(entry.created_at).fromNow()}
                </Text>
              </Space>
            ),
          }))}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No activity yet"
          style={{ margin: "12px 0" }}
        />
      )}
    </>
  );
}
