"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  App,
  Avatar,
  DatePicker,
  Input,
  Segmented,
  Select,
  Skeleton,
  Tooltip,
  theme,
} from "antd";
import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  useAllTeamTasks,
  allTeamTasksKey,
  type TeamTaskWithProject,
  type AllTaskStatusEmbed,
} from "@/features/tasks/use-all-tasks";
import {
  useMyTaskStatuses,
  type MyTaskStatusOption,
} from "@/features/home/use-home";
import { useTaskPriorities } from "@/features/tasks/use-task-statuses";
import { useUpdateTask } from "@/features/tasks/use-tasks";
import { TaskTimerButton } from "@/features/tasks/timer-widget";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { TaskDrawer } from "@/app/(app)/projects/[id]/_components/task-drawer";
import {
  FilterControl,
  type FilterField,
  type FilterValues,
} from "@/components/filters/filter-control";
import { GroupControl } from "@/components/filters/group-control";
import { useCelebrateTaskDone } from "@/features/celebrations/use-celebrations";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function MIcon({
  name,
  size = 18,
  color,
  fill = false,
}: {
  name: string;
  size?: number;
  color?: string;
  fill?: boolean;
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
      }}
    >
      {name}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: color, flex: "none" }}
    />
  );
}

const PRIORITY_TONE: Record<string, string> = {
  urgent: "#c0453c",
  high: "#c0453c",
  medium: "#c98a1b",
  low: "#2f8f5f",
};

type Bucket = "overdue" | "today" | "week" | "later" | "none";
const DUE_BUCKETS: { key: Bucket; label: string; icon: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", icon: "warning", tone: "#c0453c" },
  { key: "today", label: "Today", icon: "today", tone: "#c98a1b" },
  { key: "week", label: "This week", icon: "date_range", tone: "#3d7de0" },
  { key: "later", label: "Later", icon: "event_upcoming", tone: "#7a7f8c" },
  { key: "none", label: "No due date", icon: "event_busy", tone: "#9aa0ad" },
];

function bucketOf(end: string | null | undefined): Bucket {
  if (!end) return "none";
  const due = dayjs(end);
  if (!due.isValid()) return "none";
  const today = dayjs().startOf("day");
  if (due.isBefore(today)) return "overdue";
  if (due.isSame(today, "day")) return "today";
  if (due.isBefore(today.add(7, "day"))) return "week";
  return "later";
}

function dueLabel(end: string): { text: string; overdue: boolean } {
  const d = dayjs(end).startOf("day");
  const today = dayjs().startOf("day");
  const diff = d.diff(today, "day");
  const overdue = diff < 0;
  let text: string;
  if (diff === 0) text = "Today";
  else if (diff === 1) text = "Tomorrow";
  else if (diff === -1) text = "Yesterday";
  else text = d.format(d.year() === today.year() ? "MMM D" : "MMM D, YYYY");
  return { text, overdue };
}

function statusGlyph(cat: AllTaskStatusEmbed["category"] | null | undefined): string {
  if (!cat) return "radio_button_unchecked";
  if (cat.is_done) return "check_circle";
  if (cat.is_doing) return "change_circle";
  if (cat.is_todo) return "radio_button_unchecked";
  return "pending";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

const UNASSIGNED = "__none";
type GroupMode = "status" | "project" | "priority" | "assignee";

interface Group {
  key: string;
  label: string;
  tone: string;
  glyph: string;
  tasks: TeamTaskWithProject[];
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Full-page "All Tasks": every top-level task across the team's projects,
 * fully manageable in place — inline status / priority / due edits, mark done,
 * with search, unified filters and grouping, and a List ⇆ Board switch. Unlike
 * My Tasks it keeps an Assignee column (and a group-by-Assignee mode) so a lead
 * can see who is carrying what across every project.
 */
export default function AllTasksPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  const { data, isLoading } = useAllTeamTasks();
  const tasks = useMemo(() => data ?? [], [data]);

  const projectIds = useMemo(
    () => [...new Set(tasks.map((t) => t.project.id))],
    [tasks],
  );
  const { data: statusMap } = useMyTaskStatuses(projectIds);
  const { data: priorities } = useTaskPriorities();
  const updateTask = useUpdateTask();
  const { open: openTask } = useTaskDrawer();
  const celebrateTaskDone = useCelebrateTaskDone();

  const [filters, setFilters] = useState<FilterValues>({});
  const [search, setSearch] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("status");
  const [view, setView] = useState<"list" | "board">("list");
  const [busyId, setBusyId] = useState<string | null>(null);

  /* ----- lookups ----- */
  const priorityById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const p of priorities ?? [])
      m.set(p.id, {
        name: p.name,
        color: p.color_code ?? PRIORITY_TONE[p.name.toLowerCase()] ?? token.colorTextTertiary,
      });
    return m;
  }, [priorities, token]);

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of tasks) seen.set(t.project.id, t.project.name);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [tasks]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, { name: string; avatar: string | null }>();
    for (const t of tasks) {
      for (const a of t.assignees ?? []) {
        const u = a.team_member?.user;
        if (u) seen.set(a.team_member_id, { name: u.name, avatar: u.avatar_url });
      }
    }
    return [...seen.entries()]
      .map(([value, v]) => ({ value, label: v.name, avatarUrl: v.avatar }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  /* ----- inline edits ----- */
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: allTeamTasksKey(teamId) });
  }, [queryClient, teamId]);

  const patch = async (id: string, p: Record<string, unknown>, label: string): Promise<boolean> => {
    setBusyId(id);
    try {
      await updateTask.mutateAsync({ id, ...p });
      refresh();
      return true;
    } catch {
      message.error(`Couldn't update ${label}.`);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const patchStatus = async (t: TeamTaskWithProject, statusId: string) => {
    const options = statusMap?.[t.project.id] ?? [];
    const target = options.find((s) => s.id === statusId);
    const current = options.find((s) => s.id === t.status_id);
    const ok = await patch(t.id, { status_id: statusId }, "status");
    if (ok && target?.isDone && !current?.isDone) {
      celebrateTaskDone({ taskId: t.id, taskName: t.name });
    }
  };

  /* ----- filtering ----- */
  const priorityKeyOf = useCallback(
    (t: TeamTaskWithProject) => (t.priority?.name ?? "").toLowerCase(),
    [],
  );

  const filterFields = useMemo<FilterField[]>(() => {
    const fields: FilterField[] = [];
    if (projectOptions.length > 1) {
      fields.push({
        key: "project",
        label: "Project",
        icon: "folder",
        options: projectOptions,
      });
    }
    if (assigneeOptions.length > 0) {
      fields.push({
        key: "assignee",
        label: "Assignee",
        icon: "group",
        options: [
          ...assigneeOptions,
          { value: UNASSIGNED, label: "Unassigned", avatarUrl: null },
        ],
      });
    }
    fields.push({
      key: "due",
      label: "Due",
      icon: "event",
      options: DUE_BUCKETS.map((b) => ({ value: b.key, label: b.label, dot: b.tone })),
    });
    if ((priorities ?? []).length) {
      fields.push({
        key: "priority",
        label: "Priority",
        icon: "flag",
        options: (priorities ?? []).map((p) => ({
          value: p.name.toLowerCase(),
          label: p.name,
          dot: p.color_code ?? PRIORITY_TONE[p.name.toLowerCase()] ?? token.colorTextTertiary,
        })),
      });
    }
    return fields;
  }, [projectOptions, assigneeOptions, priorities, token]);

  const applyFilters = useCallback(
    (list: TeamTaskWithProject[]) => {
      const proj = filters.project;
      const prio = filters.priority;
      const asg = filters.assignee;
      const due = filters.due;
      if (proj?.length) list = list.filter((t) => proj.includes(t.project.id));
      if (prio?.length) list = list.filter((t) => prio.includes(priorityKeyOf(t)));
      if (due?.length) list = list.filter((t) => due.includes(bucketOf(t.end_date)));
      if (asg?.length)
        list = list.filter((t) => {
          const ids = (t.assignees ?? []).map((a) => a.team_member_id);
          return (asg.includes(UNASSIGNED) && ids.length === 0) || ids.some((id) => asg.includes(id));
        });
      return list;
    },
    [filters, priorityKeyOf],
  );

  const visible = useMemo(() => {
    let list = applyFilters(tasks);
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.project.name.toLowerCase().includes(q),
      );
    return list;
  }, [tasks, applyFilters, search]);

  /* ----- grouping ----- */
  const groups = useMemo<Group[]>(() => {
    if (groupMode === "project") {
      const map = new Map<string, Group>();
      for (const t of visible) {
        const g = map.get(t.project.id) ?? {
          key: t.project.id,
          label: t.project.name,
          tone: token.colorPrimary,
          glyph: "folder",
          tasks: [],
        };
        g.tasks.push(t);
        map.set(t.project.id, g);
      }
      return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    }

    if (groupMode === "priority") {
      const order = ["urgent", "high", "medium", "low", ""];
      const map = new Map<string, Group>();
      for (const t of visible) {
        const name = t.priority?.name ?? "No priority";
        const key = name.toLowerCase() === "no priority" ? "" : name.toLowerCase();
        const tone = t.priority?.color_code ?? PRIORITY_TONE[key] ?? token.colorTextTertiary;
        const g = map.get(key) ?? { key: key || "__np", label: name, tone, glyph: "flag", tasks: [] };
        g.tasks.push(t);
        map.set(key, g);
      }
      return [...map.entries()]
        .sort((a, b) => {
          const ai = order.indexOf(a[0]);
          const bi = order.indexOf(b[0]);
          return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        })
        .map(([, g]) => g);
    }

    if (groupMode === "assignee") {
      // A task appears under EACH of its assignees, plus an Unassigned bucket —
      // this is a "who's carrying what" view, so per-group counts may overlap.
      const map = new Map<string, Group>();
      const unassigned: Group = {
        key: UNASSIGNED,
        label: "Unassigned",
        tone: token.colorTextTertiary,
        glyph: "person_off",
        tasks: [],
      };
      for (const t of visible) {
        const as = t.assignees ?? [];
        if (as.length === 0) {
          unassigned.tasks.push(t);
          continue;
        }
        for (const a of as) {
          const name = a.team_member?.user?.name ?? "Member";
          const g = map.get(a.team_member_id) ?? {
            key: a.team_member_id,
            label: name,
            tone: token.colorPrimary,
            glyph: "person",
            tasks: [],
          };
          g.tasks.push(t);
          map.set(a.team_member_id, g);
        }
      }
      const named = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
      return unassigned.tasks.length ? [...named, unassigned] : named;
    }

    // status (default): fold by status category across projects.
    const byCat = new Map<string, Group & { sortOrder: number }>();
    const noStatus: TeamTaskWithProject[] = [];
    for (const t of visible) {
      const cat = t.status?.category;
      if (!cat) {
        noStatus.push(t);
        continue;
      }
      const existing = byCat.get(cat.id);
      if (existing) existing.tasks.push(t);
      else
        byCat.set(cat.id, {
          key: cat.id,
          label: cat.name,
          tone: cat.color_code ?? token.colorPrimary,
          glyph: statusGlyph(cat),
          sortOrder: cat.sort_order ?? 99,
          tasks: [t],
        });
    }
    const result: Group[] = [...byCat.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({ key: g.key, label: g.label, tone: g.tone, glyph: g.glyph, tasks: g.tasks }));
    if (noStatus.length)
      result.push({
        key: "__no_status__",
        label: "No status",
        tone: token.colorTextTertiary,
        glyph: "radio_button_unchecked",
        tasks: noStatus,
      });
    return result;
  }, [visible, groupMode, token]);

  const priorityOptions = useMemo(
    () =>
      (priorities ?? []).map((p) => ({
        value: p.id,
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <MIcon name="flag" size={13} color={p.color_code ?? PRIORITY_TONE[p.name.toLowerCase()] ?? token.colorTextTertiary} />
            {p.name}
          </span>
        ),
      })),
    [priorities, token],
  );

  /* ----- render helpers (plain functions, NOT components — calling them keeps
     the AntD control identities stable so open dropdowns survive re-renders) - */
  const assignees = (t: TeamTaskWithProject) => {
    const as = t.assignees ?? [];
    if (as.length === 0) return <span className="at-none">—</span>;
    const tint: React.CSSProperties = {
      backgroundColor: token.colorPrimaryBg,
      color: token.colorPrimary,
      fontSize: 10,
      fontWeight: 700,
    };
    return (
      <Avatar.Group max={{ count: 3, style: tint }} size={24}>
        {as.map((a) => {
          const u = a.team_member?.user;
          const name = u?.name ?? "Member";
          return (
            <Tooltip key={a.team_member_id} title={name}>
              <Avatar size={24} src={u?.avatar_url ?? undefined} style={tint}>
                {initials(name)}
              </Avatar>
            </Tooltip>
          );
        })}
      </Avatar.Group>
    );
  };

  const statusSelect = (t: TeamTaskWithProject, block?: boolean) => {
    const statuses: MyTaskStatusOption[] = statusMap?.[t.project.id] ?? [];
    const current = statuses.find((s) => s.id === t.status_id) ?? null;
    const busy = busyId === t.id;
    return (
      <Select
        size="small"
        variant="filled"
        value={t.status_id ?? undefined}
        placeholder={t.status?.name ?? "Status"}
        options={statuses.map((s) => ({
          value: s.id,
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Dot color={s.color ?? token.colorTextTertiary} />
              {s.name}
            </span>
          ),
        }))}
        disabled={busy || statuses.length === 0}
        onChange={(v) => patchStatus(t, v)}
        style={block ? { flex: 1, minWidth: 110 } : { minWidth: 128 }}
        popupMatchSelectWidth={false}
        suffixIcon={null}
        labelRender={() =>
          current ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Dot color={current.color ?? token.colorTextTertiary} />
              <span style={{ color: token.colorText }}>{current.name}</span>
            </span>
          ) : (
            <span style={{ color: token.colorTextTertiary }}>{t.status?.name ?? "Status"}</span>
          )
        }
      />
    );
  };

  const prioritySelect = (t: TeamTaskWithProject, width: number) => {
    const prio = t.priority_id ? priorityById.get(t.priority_id) : undefined;
    const busy = busyId === t.id;
    return (
      <Select
        size="small"
        variant="filled"
        value={t.priority_id ?? undefined}
        placeholder="Priority"
        options={priorityOptions}
        disabled={busy}
        onChange={(v) => patch(t.id, { priority_id: v }, "priority")}
        style={{ width }}
        popupMatchSelectWidth={false}
        suffixIcon={null}
        labelRender={() =>
          prio ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <MIcon name="flag" size={13} color={prio.color} />
              <span style={{ color: token.colorText }}>{prio.name}</span>
            </span>
          ) : (
            <span style={{ color: token.colorTextTertiary, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <MIcon name="outlined_flag" size={13} /> Priority
            </span>
          )
        }
      />
    );
  };

  const duePicker = (t: TeamTaskWithProject, width: number) => {
    const end = t.end_date;
    const due = end ? dueLabel(end) : null;
    return (
      <DatePicker
        size="small"
        variant="filled"
        value={end ? dayjs(end) : null}
        onChange={(d) =>
          patch(t.id, { end_date: d ? d.startOf("day").toISOString() : null }, "due date")
        }
        format={(v) => dueLabel(v.toISOString()).text}
        placeholder="Due"
        allowClear
        suffixIcon={<MIcon name="event" size={14} color={due?.overdue ? token.colorError : token.colorTextTertiary} />}
        style={{ width }}
        rootClassName={due?.overdue ? "at-due-overdue" : undefined}
      />
    );
  };

  const doneToggle = (t: TeamTaskWithProject) => {
    const statuses: MyTaskStatusOption[] = statusMap?.[t.project.id] ?? [];
    const doneStatus = statuses.find((s) => s.isDone);
    const busy = busyId === t.id;
    const isDone = Boolean(t.done);
    return (
      <Tooltip title={doneStatus ? (isDone ? "Done" : "Mark done") : "No done status in this project"}>
        <button
          type="button"
          className="at-check"
          disabled={!doneStatus || busy}
          data-done={isDone ? "1" : "0"}
          onClick={() => doneStatus && patchStatus(t, doneStatus.id)}
          aria-label="Mark done"
        >
          <span className="at-check-off"><MIcon name={isDone ? "check_circle" : "radio_button_unchecked"} size={20} fill={isDone} /></span>
          <span className="at-check-on"><MIcon name="check_circle" size={20} fill /></span>
        </button>
      </Tooltip>
    );
  };

  const currentDoing = (t: TeamTaskWithProject) =>
    (statusMap?.[t.project.id] ?? []).find((s) => s.id === t.status_id)?.isDoing ?? false;

  /* ----- row (list) ----- */
  const renderRow = (t: TeamTaskWithProject) => {
    const busy = busyId === t.id;
    return (
      <div key={t.id} className="at-row" style={{ opacity: busy ? 0.55 : 1 }}>
        {doneToggle(t)}
        <div className="at-main">
          {t.task_no != null ? <span className="at-no">#{t.task_no}</span> : null}
          <span
            className="at-name"
            role="button"
            tabIndex={0}
            onClick={() => openTask(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openTask(t.id);
            }}
            title={t.name}
            style={{
              textDecoration: t.done ? "line-through" : undefined,
              color: t.done ? token.colorTextTertiary : token.colorText,
            }}
          >
            {t.name}
          </span>
        </div>

        <div className="at-ctrls">
          <Link href={`/projects/${t.project.id}`} title={`Open ${t.project.name}`}>
            <span className="at-chip at-project">
              <MIcon name="folder_open" size={13} color={token.colorTextTertiary} />
              {t.project.name}
            </span>
          </Link>
          <span className="at-assignees">{assignees(t)}</span>
          {prioritySelect(t, 104)}
          {statusSelect(t)}
          {currentDoing(t) ? <TaskTimerButton taskId={t.id} size={24} /> : null}
          {duePicker(t, 116)}
          <Tooltip title="Open task">
            <button type="button" className="at-open" aria-label="Open task" onClick={() => openTask(t.id)}>
              <MIcon name="open_in_full" size={15} />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  };

  /* ----- card (board) ----- */
  const renderCard = (t: TeamTaskWithProject) => {
    const busy = busyId === t.id;
    return (
      <div key={t.id} className="at-gcard" style={{ opacity: busy ? 0.55 : 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          {doneToggle(t)}
          <span
            className="at-gname"
            role="button"
            tabIndex={0}
            onClick={() => openTask(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openTask(t.id);
            }}
            title={t.name}
          >
            {t.task_no != null ? <span className="at-no" style={{ marginRight: 5 }}>#{t.task_no}</span> : null}
            {t.name}
          </span>
          <Tooltip title="Open task">
            <button type="button" className="at-open" aria-label="Open task" onClick={() => openTask(t.id)}>
              <MIcon name="open_in_full" size={14} />
            </button>
          </Tooltip>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Link href={`/projects/${t.project.id}`} title={`Open ${t.project.name}`}>
            <span className="at-chip at-project">
              <MIcon name="folder_open" size={13} color={token.colorTextTertiary} />
              {t.project.name}
            </span>
          </Link>
          <span className="at-assignees">{assignees(t)}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {statusSelect(t, true)}
          {prioritySelect(t, 96)}
          {currentDoing(t) ? <TaskTimerButton taskId={t.id} size={24} /> : null}
          {duePicker(t, 108)}
        </div>
      </div>
    );
  };

  const total = tasks.length;

  return (
    <div style={{ width: "100%" }}>
      <style>{STYLE(token)}</style>

      {/* Header */}
      <div className="at-head">
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-.4px",
              color: token.colorText,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            All Tasks
            {total > 0 ? <span className="at-count">{total}</span> : null}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
            Every task across your team&apos;s projects — manage it right here.
          </p>
        </div>
        <div className="at-tools">
          <Input
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
            style={{ width: 200 }}
          />
          <GroupControl
            value={groupMode}
            onChange={(v) => setGroupMode(v as GroupMode)}
            options={[
              { value: "status", label: "Status", icon: "adjust" },
              { value: "assignee", label: "Assignee", icon: "group" },
              { value: "project", label: "Project", icon: "folder" },
              { value: "priority", label: "Priority", icon: "flag" },
            ]}
          />
          {filterFields.length ? (
            <FilterControl fields={filterFields} value={filters} onChange={setFilters} />
          ) : null}
          <Segmented
            value={view}
            onChange={(v) => setView(v as "list" | "board")}
            options={[
              { value: "list", icon: <MIcon name="format_list_bulleted" size={16} /> },
              { value: "board", icon: <MIcon name="view_kanban" size={16} /> },
            ]}
            aria-label="Switch between list and board view"
          />
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : total === 0 ? (
        <div className="at-empty">
          <span className="at-empty-ic"><MIcon name="task_alt" size={22} color={token.colorPrimary} /></span>
          <div className="at-empty-t">No tasks yet</div>
          <div className="at-empty-s">Tasks from every project across your team will show up here.</div>
        </div>
      ) : visible.length === 0 ? (
        <div className="at-empty">
          <span className="at-empty-ic"><MIcon name="filter_alt_off" size={22} color={token.colorPrimary} /></span>
          <div className="at-empty-t">No tasks match your filters</div>
          <div className="at-empty-s">Clear the search or filters to see everything.</div>
        </div>
      ) : view === "board" ? (
        <div className="at-board wl-hscroll">
          {groups.map((g) => (
            <div key={g.key} className="at-col">
              <div className="at-group-head" style={{ margin: "0 0 10px" }}>
                <span className="at-group-ic" style={{ background: `color-mix(in srgb, ${g.tone} 14%, transparent)` }}>
                  <MIcon name={g.glyph} size={14} color={g.tone} fill />
                </span>
                <span className="at-group-l" style={{ color: g.tone }}>{g.label}</span>
                <span className="at-group-n">{g.tasks.length}</span>
              </div>
              <div className="at-col-body">{g.tasks.map((t) => renderCard(t))}</div>
            </div>
          ))}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} style={{ marginBottom: 20 }}>
            <div className="at-group-head">
              <span className="at-group-ic" style={{ background: `color-mix(in srgb, ${g.tone} 14%, transparent)` }}>
                <MIcon name={g.glyph} size={14} color={g.tone} fill />
              </span>
              <span className="at-group-l" style={{ color: g.tone }}>{g.label}</span>
              <span className="at-group-n">{g.tasks.length}</span>
            </div>
            <div className="at-card">{g.tasks.map((t) => renderRow(t))}</div>
          </div>
        ))
      )}

      {/* Opens in place on this screen instead of navigating to the project. */}
      <TaskDrawer />
    </div>
  );
}

function STYLE(token: ReturnType<typeof theme.useToken>["token"]): string {
  return `
  .at-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
  .at-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .at-count{font-size:13px;font-weight:600;color:${token.colorTextSecondary};background:${token.colorFillSecondary};border-radius:999px;padding:1px 10px;}
  .at-none{font-size:12.5px;color:${token.colorTextTertiary};}

  .at-empty{text-align:center;padding:56px 24px;background:${token.colorBgContainer};border:1px solid ${token.colorBorderSecondary};border-radius:12px;}
  .at-empty-ic{width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;background:${token.colorPrimaryBg};}
  .at-empty-t{margin-top:12px;font-size:14.5px;font-weight:600;color:${token.colorText};}
  .at-empty-s{margin-top:4px;font-size:13px;color:${token.colorTextTertiary};}

  .at-group-head{display:flex;align-items:center;gap:8px;margin:0 0 8px;padding-inline:6px;}
  .at-group-ic{width:22px;height:22px;flex:none;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;}
  .at-group-l{font-size:12.5px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;}
  .at-group-n{font-size:11px;font-weight:600;color:${token.colorTextTertiary};background:${token.colorFillTertiary};border-radius:999px;padding:0 7px;line-height:17px;}
  .at-card{background:${token.colorBgContainer};border:1px solid ${token.colorBorderSecondary};border-radius:12px;padding:5px;box-shadow:0 1px 2px rgba(16,24,40,0.03);}

  .at-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;transition:background 120ms;flex-wrap:wrap;}
  .at-row:hover{background:${token.colorFillQuaternary};}

  .at-board{display:flex;gap:12px;overflow-x:auto;align-items:flex-start;padding-bottom:10px;}
  .at-col{flex:0 0 306px;background:${token.colorFillQuaternary};border:1px solid ${token.colorBorderSecondary};border-radius:12px;padding:10px;}
  .at-col-body{display:flex;flex-direction:column;gap:8px;max-height:64vh;overflow-y:auto;padding:1px;}
  .at-gcard{display:flex;flex-direction:column;gap:9px;background:${token.colorBgContainer};border:1px solid ${token.colorBorderSecondary};border-radius:12px;padding:12px;box-shadow:0 1px 2px rgba(16,24,40,0.03);transition:border-color .12s,box-shadow .12s;}
  .at-gcard:hover{border-color:${token.colorPrimaryBorder};box-shadow:0 4px 14px -6px rgba(74,74,208,.18);}
  .at-gname{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:${token.colorText};line-height:1.35;cursor:pointer;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .at-gname:hover{color:${token.colorPrimary};}

  .at-check{border:none;background:transparent;padding:0;flex:none;cursor:pointer;display:flex;color:${token.colorTextTertiary};position:relative;}
  .at-check[data-done="1"]{color:${token.colorSuccess};}
  .at-check:disabled{cursor:not-allowed;}
  .at-check-on{display:none;color:${token.colorSuccess};position:absolute;inset:0;}
  .at-check:hover .at-check-off{opacity:0;}
  .at-check:hover .at-check-on{display:flex;}

  .at-main{flex:1 1 220px;min-width:150px;display:flex;align-items:center;gap:8px;min-height:24px;}
  .at-no{font-size:11.5px;color:${token.colorTextQuaternary};flex:none;font-variant-numeric:tabular-nums;}
  .at-name{font-weight:500;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
  .at-name:hover{color:${token.colorPrimary} !important;}
  .at-ctrls{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;}
  .at-assignees{display:inline-flex;align-items:center;min-width:26px;}
  .at-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:${token.colorTextSecondary};background:${token.colorFillQuaternary};border:1px solid ${token.colorBorderSecondary};border-radius:999px;padding:2px 9px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;}
  .at-project:hover{border-color:${token.colorPrimaryBorder};color:${token.colorPrimary};}
  .at-open{border:none;background:transparent;color:${token.colorTextQuaternary};cursor:pointer;padding:4px;border-radius:7px;display:inline-flex;opacity:0;transition:opacity .12s,background .12s,color .12s;}
  .at-row:hover .at-open,.at-gcard:hover .at-open{opacity:1;}
  .at-open:hover{background:${token.colorFillSecondary};color:${token.colorText};}
  .at-due-overdue .ant-picker-input>input{color:${token.colorError} !important;}

  @media(max-width:720px){
    .at-tools{width:100%;}
    .at-tools .ant-input-affix-wrapper{flex:1 1 160px;width:auto !important;}
    .at-ctrls{width:100%;padding-left:30px;justify-content:flex-start;}
    .at-open{opacity:1;margin-left:auto;}
  }
  `;
}
