"use client";

import { useMemo } from "react";
import { Avatar, Empty, Skeleton, Tooltip, theme } from "antd";
import dayjs from "dayjs";
import { useTasks, type TaskWithRelations } from "@/features/tasks/use-tasks";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { TaskIdLabel } from "@/features/tasks/task-id-label";
import { useTaskStatuses } from "@/features/tasks/use-task-statuses";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => c && /[\p{L}\p{N}]/u.test(c))
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** A task plus the serial label it carries in the running order ("3", "3.2"). */
interface SerialRow {
  task: TaskWithRelations;
  serial: string;
  depth: number;
}

/**
 * Flattens the project's tasks into ONE continuous numbered sequence: top-level
 * tasks get 1, 2, 3…, and each task's subtasks continue underneath as 1.1, 1.2…
 * (any depth). Ordering follows the project's own task order (sort_order), so
 * the serial numbers match how the work is arranged — not an arbitrary sort.
 */
function toSerialRows(tasks: TaskWithRelations[]): SerialRow[] {
  const byParent = new Map<string | null, TaskWithRelations[]>();
  for (const t of tasks) {
    const key = t.parent_task_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(t);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort(
      (a, b) =>
        Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
        a.name.localeCompare(b.name),
    );
  }

  const rows: SerialRow[] = [];
  const walk = (parent: string | null, prefix: string, depth: number) => {
    const children = byParent.get(parent) ?? [];
    children.forEach((task, i) => {
      const serial = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      rows.push({ task, serial, depth });
      // Guard against a corrupt parent chain pointing at itself.
      if (task.id !== parent) walk(task.id, serial, depth + 1);
    });
  };
  walk(null, "", 0);
  return rows;
}

function dueLabel(end: string): { text: string; overdue: boolean } {
  const d = dayjs(end);
  const today = dayjs().startOf("day");
  const diff = d.startOf("day").diff(today, "day");
  if (diff === 0) return { text: "Today", overdue: false };
  if (diff === 1) return { text: "Tomorrow", overdue: false };
  if (diff === -1) return { text: "Yesterday", overdue: true };
  return {
    text: d.format(d.year() === today.year() ? "MMM D" : "MMM D, YYYY"),
    overdue: diff < 0,
  };
}

/**
 * Serial view — every task in one flat, continuously numbered run. Unlike List
 * (which groups by status) this reads top-to-bottom like a numbered document,
 * so you can point at "item 7" in a call and everyone finds the same row.
 */
export function SerialTab({ projectId }: { projectId: string }) {
  const { token } = theme.useToken();
  // Serial is the one view that numbers the WHOLE tree, so it needs subtasks.
  const { data: tasks, isLoading } = useTasks(projectId, { includeSubtasks: true });
  const { data: statuses } = useTaskStatuses(projectId);
  const open = useTaskDrawer((s) => s.open);

  const rows = useMemo(() => toSerialRows(tasks ?? []), [tasks]);
  // The task embed carries only category_id — resolve the stage colour from the
  // project's status list so the dots match Board/List.
  const statusColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const st of statuses ?? [])
      if (st.category?.color_code) m.set(st.id, st.category.color_code);
    return m;
  }, [statuses]);

  if (isLoading) {
    return (
      <div style={{ padding: 8 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No tasks yet — add one from the List or Board view."
        style={{ margin: "48px 0" }}
      />
    );
  }

  const done = rows.filter((r) => r.task.done).length;

  return (
    <div>
      <style>{`
        .wl-serial-row:hover { background: ${token.colorFillQuaternary}; }
      `}</style>

      {/* Header strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 4px 10px",
          fontSize: 12.5,
          color: token.colorTextTertiary,
        }}
      >
        <span>
          <b className="tabular" style={{ color: token.colorText }}>
            {rows.length}
          </b>{" "}
          item{rows.length === 1 ? "" : "s"} in order
        </span>
        <span aria-hidden>·</span>
        <span>
          <b className="tabular" style={{ color: "#2f8f5f" }}>
            {done}
          </b>{" "}
          done
        </span>
      </div>

      {/* Column head */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: token.colorTextTertiary,
          textTransform: "uppercase",
        }}
      >
        <span style={{ width: 52, flex: "none" }}>#</span>
        <span style={{ flex: 1, minWidth: 0 }}>Task</span>
        <span style={{ width: 120, flex: "none" }}>Status</span>
        <span style={{ width: 96, flex: "none" }}>Assignee</span>
        <span style={{ width: 92, flex: "none" }}>Due</span>
      </div>

      {rows.map(({ task, serial, depth }) => {
        const due = task.end_date ? dueLabel(task.end_date) : null;
        const overdue = due?.overdue && !task.done;
        return (
          <div
            key={task.id}
            className="wl-serial-row"
            role="button"
            tabIndex={0}
            onClick={() => open(task.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open(task.id);
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "9px 12px",
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              cursor: "pointer",
              transition: "background .12s ease",
            }}
          >
            {/* Serial number — the whole point of this view */}
            <span
              className="tabular"
              style={{
                width: 52,
                flex: "none",
                fontSize: depth === 0 ? 13 : 12,
                fontWeight: depth === 0 ? 700 : 600,
                color: depth === 0 ? token.colorText : token.colorTextTertiary,
              }}
            >
              {serial}
            </span>

            <span
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                // Nest subtasks visually without losing the number column.
                paddingLeft: depth * 16,
              }}
            >
              <span
                style={{
                  fontSize: 13.5,
                  color: token.colorText,
                  textDecoration: task.done ? "line-through" : undefined,
                  opacity: task.done ? 0.6 : 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {task.name}
              </span>
              {task.task_no != null ? (
                <span
                  className="tabular"
                  style={{ fontSize: 11, color: token.colorTextQuaternary, flex: "none" }}
                >
                  <TaskIdLabel projectId={task.project_id} taskNo={task.task_no} />
                </span>
              ) : null}
            </span>

            <span style={{ width: 120, flex: "none" }}>
              {task.status ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: token.colorTextSecondary,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flex: "none",
                      background:
                        statusColor.get(task.status.id) ?? token.colorTextQuaternary,
                    }}
                  />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {task.status.name}
                  </span>
                </span>
              ) : (
                <span style={{ color: token.colorTextQuaternary, fontSize: 12 }}>—</span>
              )}
            </span>

            <span style={{ width: 96, flex: "none" }}>
              {task.assignees.length > 0 ? (
                <Avatar.Group max={{ count: 3 }} size={22}>
                  {task.assignees.map((a) => (
                    <Tooltip
                      key={a.team_member_id}
                      title={a.team_member?.user?.name ?? "Member"}
                    >
                      <Avatar
                        size={22}
                        src={a.team_member?.user?.avatar_url ?? undefined}
                        style={{ fontSize: 10 }}
                      >
                        {initials(a.team_member?.user?.name ?? "?")}
                      </Avatar>
                    </Tooltip>
                  ))}
                </Avatar.Group>
              ) : (
                <span style={{ color: token.colorTextQuaternary, fontSize: 12 }}>—</span>
              )}
            </span>

            <span
              style={{
                width: 92,
                flex: "none",
                fontSize: 12,
                color: overdue ? token.colorError : token.colorTextTertiary,
              }}
            >
              {due?.text ?? "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
