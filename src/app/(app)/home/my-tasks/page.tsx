"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  App,
  DatePicker,
  Empty,
  Input,
  Segmented,
  Select,
  Skeleton,
  Tooltip,
  Typography,
  theme,
} from "antd";
import { useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  useMyTasks,
  useMyTaskEdits,
  useMyTaskStatuses,
  myTasksKey,
  type MyTask,
  type MyTaskStatusOption,
} from "@/features/home/use-home";
import { useUpdateTask } from "@/features/tasks/use-tasks";
import { useTaskPriorities } from "@/features/tasks/use-task-statuses";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { TaskDrawer } from "@/app/(app)/projects/[id]/_components/task-drawer";

const { Text, Title } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

type Bucket = "overdue" | "today" | "week" | "later" | "none";

const BUCKETS: { key: Bucket; label: string; icon: string; tone: string }[] = [
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

/** Relative due label ("Today"/"Tomorrow"/"Jun 21"). */
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

const PRIORITY_TONE: Record<string, string> = {
  high: "#c0453c",
  medium: "#c98a1b",
  low: "#2f8f5f",
};

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: 999,
        background: color,
        flex: "none",
      }}
    />
  );
}

type GroupMode = "due" | "project" | "priority";

/**
 * Full-page "My Tasks": every open task assigned to me, fully manageable in
 * place — mark done, change status / priority / due date inline, filter by a
 * clickable stat strip, search, and group by due date, project or priority.
 * Clicking a task title opens the drawer on this same screen for deeper edits
 * (assignees, labels, description, comments, subtasks).
 */
export default function MyTasksPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useMyTasks();
  const taskIds = useMemo(() => (tasks ?? []).map((t) => t.task_id), [tasks]);
  const projectIds = useMemo(
    () => [...new Set((tasks ?? []).map((t) => t.project_id))],
    [tasks],
  );
  const { data: edits } = useMyTaskEdits(taskIds);
  const { data: statusMap } = useMyTaskStatuses(projectIds);
  const { data: priorities } = useTaskPriorities();
  const updateTask = useUpdateTask();
  const { open: openTask } = useTaskDrawer();

  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<Bucket | null>(null);
  const [search, setSearch] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("due");
  const [busyId, setBusyId] = useState<string | null>(null);

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
    for (const t of tasks ?? []) seen.set(t.project_id, t.project_name);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [tasks]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: myTasksKey });
    queryClient.invalidateQueries({ queryKey: ["home", "my-task-edits"] });
  };

  const patch = async (id: string, p: Record<string, unknown>, label: string) => {
    setBusyId(id);
    try {
      await updateTask.mutateAsync({ id, ...p });
      refresh();
    } catch {
      message.error(`Couldn't update ${label}.`);
    } finally {
      setBusyId(null);
    }
  };

  const dueOf = useCallback(
    (t: MyTask) => edits?.[t.task_id]?.end_date ?? t.end_date,
    [edits],
  );

  // Counts per bucket over ALL tasks (drive the filter strip; not affected by
  // the active bucket filter, so the strip is stable to click around).
  const bucketCounts = useMemo(() => {
    const base = projectFilter ? (tasks ?? []).filter((t) => t.project_id === projectFilter) : tasks ?? [];
    const c: Record<Bucket, number> = { overdue: 0, today: 0, week: 0, later: 0, none: 0 };
    for (const t of base) c[bucketOf(dueOf(t))] += 1;
    return { counts: c, total: base.length };
  }, [tasks, projectFilter, dueOf]);

  const visible = useMemo(() => {
    let list = tasks ?? [];
    if (projectFilter) list = list.filter((t) => t.project_id === projectFilter);
    if (bucketFilter) list = list.filter((t) => bucketOf(dueOf(t)) === bucketFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q));
    return list;
  }, [tasks, projectFilter, bucketFilter, search, dueOf]);

  /** Ordered groups for the current grouping mode. */
  const groups = useMemo(() => {
    if (groupMode === "project") {
      const map = new Map<string, { label: string; tone: string; icon: string; tasks: MyTask[] }>();
      for (const t of visible) {
        const g = map.get(t.project_id) ?? { label: t.project_name, tone: token.colorPrimary, icon: "folder", tasks: [] };
        g.tasks.push(t);
        map.set(t.project_id, g);
      }
      return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
    if (groupMode === "priority") {
      const order = ["high", "medium", "low", ""];
      const map = new Map<string, { label: string; tone: string; icon: string; tasks: MyTask[] }>();
      for (const t of visible) {
        const pid = edits?.[t.task_id]?.priority_id;
        const pname = (pid ? priorityById.get(pid)?.name : t.priority) ?? "None";
        const key = pname.toLowerCase() === "none" ? "" : pname.toLowerCase();
        const tone = pid ? priorityById.get(pid)?.color ?? token.colorTextTertiary : PRIORITY_TONE[key] ?? token.colorTextTertiary;
        const g = map.get(key) ?? { label: pname, tone, icon: "flag", tasks: [] };
        g.tasks.push(t);
        map.set(key, g);
      }
      return [...map.entries()]
        .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(([, g]) => g);
    }
    // due date
    const map = new Map<Bucket, MyTask[]>();
    for (const t of visible) {
      const b = bucketOf(dueOf(t));
      map.set(b, [...(map.get(b) ?? []), t]);
    }
    return BUCKETS.filter((b) => (map.get(b.key) ?? []).length > 0).map((b) => ({
      label: b.label,
      tone: b.tone,
      icon: b.icon,
      tasks: [...(map.get(b.key) ?? [])].sort((x, y) =>
        (dueOf(x) ?? "9999").localeCompare(dueOf(y) ?? "9999"),
      ),
    }));
  }, [visible, groupMode, edits, priorityById, token, dueOf]);

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

  const renderRow = (t: MyTask) => {
    const meta = edits?.[t.task_id];
    const statuses: MyTaskStatusOption[] = statusMap?.[t.project_id] ?? [];
    const current = statuses.find((s) => s.id === meta?.status_id);
    const doneStatus = statuses.find((s) => s.isDone);
    const busy = busyId === t.task_id;
    const prio = meta?.priority_id ? priorityById.get(meta.priority_id) : undefined;
    const end = meta?.end_date ?? t.end_date;
    const due = end ? dueLabel(end) : null;
    const daysLate =
      due?.overdue && end
        ? dayjs().startOf("day").diff(dayjs(end).startOf("day"), "day")
        : 0;

    const statusOptions = statuses.map((s) => ({
      value: s.id,
      label: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Dot color={s.color ?? token.colorTextTertiary} />
          {s.name}
        </span>
      ),
    }));

    return (
      <div
        key={t.task_id}
        className="mt-row"
        style={{
          opacity: busy ? 0.55 : 1,
          boxShadow: prio ? `inset 3px 0 0 ${prio.color}` : undefined,
        }}
      >
        {/* Done toggle */}
        <Tooltip title={doneStatus ? "Mark done" : "No done status in this project"}>
          <button
            type="button"
            className="mt-check"
            disabled={!doneStatus || busy}
            onClick={() => doneStatus && patch(t.task_id, { status_id: doneStatus.id }, "status")}
            aria-label="Mark done"
          >
            <span className="mt-check-off"><MIcon name="radio_button_unchecked" size={20} /></span>
            <span className="mt-check-on"><MIcon name="check_circle" size={20} /></span>
          </button>
        </Tooltip>

        {/* Title + id (opens drawer) */}
        <div className="mt-main">
          {typeof meta?.task_no === "number" ? (
            <span className="mt-no">#{meta.task_no}</span>
          ) : null}
          <span
            className="mt-name"
            role="button"
            tabIndex={0}
            onClick={() => openTask(t.task_id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openTask(t.task_id);
            }}
            title={t.name}
          >
            {t.name}
          </span>
        </div>

        {/* Controls */}
        <div className="mt-ctrls">
          <Link href={`/projects/${t.project_id}`} title={`Open ${t.project_name}`}>
            <span className="mt-chip mt-project">
              <MIcon name="folder_open" size={13} color={token.colorTextTertiary} />
              {t.project_name}
            </span>
          </Link>

          <Select
            size="small"
            variant="filled"
            value={meta?.priority_id ?? undefined}
            placeholder="Priority"
            options={priorityOptions}
            disabled={busy}
            onChange={(v) => patch(t.task_id, { priority_id: v }, "priority")}
            style={{ minWidth: 104 }}
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

          <Select
            size="small"
            variant="filled"
            value={meta?.status_id ?? undefined}
            placeholder={t.status_name ?? "Status"}
            options={statusOptions}
            disabled={busy || statuses.length === 0}
            onChange={(v) => patch(t.task_id, { status_id: v }, "status")}
            style={{ minWidth: 130 }}
            popupMatchSelectWidth={false}
            suffixIcon={null}
            labelRender={() =>
              current ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Dot color={current.color ?? token.colorTextTertiary} />
                  <span style={{ color: token.colorText }}>{current.name}</span>
                </span>
              ) : (
                <span style={{ color: token.colorTextTertiary }}>{t.status_name ?? "Status"}</span>
              )
            }
          />

          {daysLate > 0 ? (
            <Tooltip title={`${daysLate} day${daysLate === 1 ? "" : "s"} overdue`}>
              <span className="mt-late">{daysLate}d late</span>
            </Tooltip>
          ) : null}

          <DatePicker
            size="small"
            variant="filled"
            value={end ? dayjs(end) : null}
            onChange={(d) =>
              patch(t.task_id, { end_date: d ? d.startOf("day").toISOString() : null }, "due date")
            }
            format={(v) => dueLabel(v.toISOString()).text}
            placeholder="Due"
            allowClear
            suffixIcon={<MIcon name="event" size={14} color={due?.overdue ? token.colorError : token.colorTextTertiary} />}
            style={{ width: 116 }}
            rootClassName={due?.overdue ? "mt-due-overdue" : undefined}
          />

          <Tooltip title="Open task">
            <button type="button" className="mt-open" aria-label="Open task" onClick={() => openTask(t.task_id)}>
              <MIcon name="open_in_full" size={15} />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  };

  const total = bucketCounts.total;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto" }}>
      <style>{STYLE(token)}</style>

      {/* Header */}
      <div className="mt-head">
        <div>
          <Title level={3} style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            My Tasks
            {total > 0 ? <span className="mt-count">{total}</span> : null}
          </Title>
          <Text type="secondary">Every open task assigned to you — manage it right here.</Text>
        </div>
        <div className="mt-tools">
          <Input
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
            style={{ width: 200 }}
          />
          {projectOptions.length > 1 ? (
            <Select
              allowClear
              value={projectFilter ?? undefined}
              onChange={(v) => setProjectFilter(v ?? null)}
              placeholder="All projects"
              options={projectOptions}
              style={{ minWidth: 170 }}
              suffixIcon={<MIcon name="filter_list" size={16} />}
            />
          ) : null}
          <Segmented
            value={groupMode}
            onChange={(v) => setGroupMode(v as GroupMode)}
            options={[
              { value: "due", label: "Due", icon: <MIcon name="event" size={15} /> },
              { value: "project", label: "Project", icon: <MIcon name="folder" size={15} /> },
              { value: "priority", label: "Priority", icon: <MIcon name="flag" size={15} /> },
            ]}
          />
        </div>
      </div>

      {/* Stat / filter strip */}
      {!isLoading && total > 0 ? (
        <div className="mt-strip">
          <button
            type="button"
            className={`mt-stat${bucketFilter === null ? " on" : ""}`}
            onClick={() => setBucketFilter(null)}
            style={{ ["--tone" as string]: token.colorTextSecondary }}
          >
            <span className="mt-stat-ic"><MIcon name="all_inbox" size={15} color={token.colorTextSecondary} /></span>
            <span className="mt-stat-k">{total}</span>
            <span className="mt-stat-l">All</span>
          </button>
          {BUCKETS.map((b) => {
            const n = bucketCounts.counts[b.key];
            if (n === 0) return null;
            return (
              <button
                key={b.key}
                type="button"
                className={`mt-stat${bucketFilter === b.key ? " on" : ""}`}
                onClick={() => setBucketFilter(bucketFilter === b.key ? null : b.key)}
                style={{ ["--tone" as string]: b.tone }}
              >
                <span className="mt-stat-ic"><MIcon name={b.icon} size={15} color={b.tone} /></span>
                <span className="mt-stat-k">{n}</span>
                <span className="mt-stat-l">{b.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* List */}
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : total === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing on your plate. 🎉" />
      ) : visible.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tasks match your filters." />
      ) : (
        groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 20 }}>
            <div className="mt-group-head">
              <span
                className="mt-group-ic"
                style={{ background: `color-mix(in srgb, ${g.tone} 14%, transparent)` }}
              >
                <MIcon name={g.icon} size={14} color={g.tone} />
              </span>
              <span className="mt-group-l" style={{ color: g.tone }}>{g.label}</span>
              <span className="mt-group-n">{g.tasks.length}</span>
            </div>
            <div className="mt-card">{g.tasks.map((t) => renderRow(t))}</div>
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
  .mt-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap;}
  .mt-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .mt-count{font-size:13px;font-weight:600;color:${token.colorTextSecondary};background:${token.colorFillSecondary};border-radius:999px;padding:1px 10px;}

  .mt-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;}
  .mt-stat{display:inline-flex;align-items:center;gap:8px;padding:7px 14px 7px 10px;border-radius:12px;cursor:pointer;background:${token.colorBgContainer};border:1px solid ${token.colorBorderSecondary};transition:background .15s,border-color .15s;}
  .mt-stat:hover{background:${token.colorFillQuaternary};}
  /* Active = neutral filled pill (no blue ring). Tone shows only via the icon dot. */
  .mt-stat.on{background:color-mix(in srgb, var(--tone) 12%, ${token.colorBgContainer});border-color:color-mix(in srgb, var(--tone) 22%, ${token.colorBorderSecondary});}
  .mt-stat.on .mt-stat-l{color:var(--tone);}
  .mt-stat-ic{width:24px;height:24px;flex:none;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--tone) 14%, transparent);}
  .mt-stat-k{font-size:15px;font-weight:700;color:${token.colorText};font-variant-numeric:tabular-nums;line-height:1;}
  .mt-stat-l{font-size:12.5px;font-weight:600;color:${token.colorTextSecondary};}
  .mt-late{display:inline-flex;align-items:center;font-size:10.5px;font-weight:700;color:${token.colorError};background:${token.colorErrorBg};border-radius:999px;padding:1px 7px;white-space:nowrap;flex:none;}

  .mt-group-head{display:flex;align-items:center;gap:8px;margin:0 0 8px;padding-inline:6px;}
  .mt-group-ic{width:22px;height:22px;flex:none;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;}
  .mt-group-l{font-size:12.5px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;}
  .mt-group-n{font-size:11px;font-weight:600;color:${token.colorTextTertiary};background:${token.colorFillTertiary};border-radius:999px;padding:0 7px;line-height:17px;}
  .mt-card{background:${token.colorBgContainer};border:1px solid ${token.colorBorderSecondary};border-radius:14px;padding:5px;box-shadow:0 1px 2px rgba(16,24,40,0.03);}

  .mt-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;transition:background 120ms;flex-wrap:wrap;}
  .mt-row:hover{background:${token.colorFillQuaternary};}
  .mt-check{border:none;background:transparent;padding:0;flex:none;cursor:pointer;display:flex;color:${token.colorTextTertiary};position:relative;}
  .mt-check:disabled{cursor:not-allowed;}
  .mt-check-on{display:none;color:${token.colorSuccess};position:absolute;inset:0;}
  .mt-check:hover .mt-check-off{opacity:0;}
  .mt-check:hover .mt-check-on{display:flex;}
  .mt-main{flex:1 1 220px;min-width:150px;display:flex;align-items:center;gap:8px;min-height:24px;}
  .mt-no{font-size:11.5px;color:${token.colorTextQuaternary};flex:none;font-variant-numeric:tabular-nums;}
  .mt-name{font-weight:500;font-size:13.5px;color:${token.colorText};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
  .mt-name:hover{color:${token.colorPrimary};}
  .mt-ctrls{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap;}
  .mt-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:${token.colorTextSecondary};background:${token.colorFillQuaternary};border:1px solid ${token.colorBorderSecondary};border-radius:999px;padding:2px 9px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;}
  .mt-project:hover{border-color:${token.colorPrimaryBorder};color:${token.colorPrimary};}
  .mt-open{border:none;background:transparent;color:${token.colorTextQuaternary};cursor:pointer;padding:4px;border-radius:7px;display:inline-flex;opacity:0;transition:opacity .12s,background .12s,color .12s;}
  .mt-row:hover .mt-open{opacity:1;}
  .mt-open:hover{background:${token.colorFillSecondary};color:${token.colorText};}
  .mt-due-overdue .ant-picker-input>input{color:${token.colorError} !important;}

  @media(max-width:680px){
    .mt-tools{width:100%;}
    .mt-tools .ant-input-affix-wrapper{width:100% !important;flex:1 1 100%;}
    .mt-ctrls{width:100%;padding-left:30px;justify-content:flex-start;}
    .mt-open{opacity:1;margin-left:auto;}
  }
  `;
}
