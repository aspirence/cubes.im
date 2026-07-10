"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar, Empty, Input, Skeleton, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import type { TeamTaskWithProject } from "@/features/tasks/use-all-tasks";
import {
  usePersonalTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  useActivityFeed,
} from "@/features/home/use-home";
import { GroupedChart } from "./dashboard-grouped-chart";
import { visibleTasks, groupTasks, computeMetric } from "./dashboard-engine";
import { METRIC_OPTIONS, type DashboardCard } from "./dashboard-types";

const { Text } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, color, lineHeight: 1 }}
    >
      {name}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* --------------------------------------------------------------- kind bodies */

function MetricBody({
  card,
  tasks,
  myTeamMemberId,
}: {
  card: DashboardCard;
  tasks: TeamTaskWithProject[];
  myTeamMemberId: string | undefined;
}) {
  const metric = card.metric ?? "open";
  const value = computeMetric(tasks, card.filter, metric, myTeamMemberId);
  const label = METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? "";
  const tone =
    metric === "overdue" && value > 0
      ? "#e0663f"
      : metric === "completed-week"
        ? "#3a9d6e"
        : "#17171c";
  return (
    <div style={{ padding: "18px 18px 20px" }}>
      <div
        className="font-mono"
        style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-1.5px", color: tone, lineHeight: 1 }}
      >
        {value}
      </div>
      <div style={{ marginTop: 6, fontSize: 12.5, color: "#8a8d98" }}>
        {label}
        {card.filter.scope === "me" ? " · you" : ""}
      </div>
    </div>
  );
}

function ChartBody({
  card,
  tasks,
  myTeamMemberId,
  height,
}: {
  card: DashboardCard;
  tasks: TeamTaskWithProject[];
  myTeamMemberId: string | undefined;
  height?: number;
}) {
  const visible = visibleTasks(tasks, card.filter, myTeamMemberId);
  // When grouping by assignee, only count assignees the card's filter allows so
  // co-assignees outside the filter/scope don't leak into the chart.
  const assigneeAllow = new Set<string>(card.filter.assigneeIds);
  if (card.filter.scope === "me" && myTeamMemberId) assigneeAllow.add(myTeamMemberId);
  const data = groupTasks(visible, card.groupBy ?? "status", assigneeAllow);
  const chartHeight = height ? Math.max(120, height - 16) : card.span === "full" ? 240 : 210;
  return (
    <div style={{ padding: "10px 12px 6px" }}>
      <GroupedChart data={data} chart={card.chart ?? "donut"} height={chartHeight} />
    </div>
  );
}

function priorityColor(p: string | null | undefined): string | undefined {
  switch ((p ?? "").toLowerCase()) {
    case "high":
      return "red";
    case "medium":
      return "gold";
    case "low":
      return "green";
    default:
      return undefined;
  }
}

function TasksBody({
  card,
  tasks,
  myTeamMemberId,
}: {
  card: DashboardCard;
  tasks: TeamTaskWithProject[];
  myTeamMemberId: string | undefined;
}) {
  const rows = visibleTasks(tasks, card.filter, myTeamMemberId).slice(0, card.limit ?? 12);
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No matching tasks" style={{ margin: "20px 0" }} />;
  }
  const today = dayjs().startOf("day");
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((t, i) => {
        const due = t.end_date ? dayjs(t.end_date) : null;
        const overdue = due ? due.isBefore(today) && !t.done : false;
        return (
          <li key={t.id} style={{ borderTop: i === 0 ? "none" : "1px solid #f4f4f6" }}>
            <Link
              href={`/projects/${t.project_id}?task=${t.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 16px",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flex: "none",
                  background: t.project?.color_code ?? "#8a8d98",
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#17171c",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.name}
                </div>
                <div style={{ fontSize: 11.5, color: "#9a9da8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.project?.name ?? "Project"}
                </div>
              </div>
              <Avatar.Group max={{ count: 3 }} size={20}>
                {t.assignees.map((a) => (
                  <Tooltip key={a.team_member_id} title={a.team_member?.user?.name ?? "Member"}>
                    <Avatar size={20} src={a.team_member?.user?.avatar_url ?? undefined} style={{ fontSize: 9 }}>
                      {initials(a.team_member?.user?.name ?? "?")}
                    </Avatar>
                  </Tooltip>
                ))}
              </Avatar.Group>
              {t.priority?.name ? (
                <Tag color={priorityColor(t.priority.name)} style={{ marginInlineEnd: 0 }}>
                  {t.priority.name}
                </Tag>
              ) : null}
              <div style={{ width: 70, textAlign: "right", flex: "none", fontSize: 12, color: overdue ? "#e0663f" : "#9a9da8" }}>
                {due ? due.format("MMM D") : "—"}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActivityBody() {
  const { data, isLoading } = useActivityFeed();
  if (isLoading) return <div style={{ padding: 16 }}><Skeleton active paragraph={{ rows: 4 }} /></div>;
  const items = (data ?? []).slice(0, 8);
  if (items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No recent activity" style={{ margin: "20px 0" }} />;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((a, i) => (
        <li key={a.id} style={{ borderTop: i === 0 ? "none" : "1px solid #f4f4f6" }}>
          <Link
            href={a.project_id ? `/projects/${a.project_id}?task=${a.task_id}` : "#"}
            style={{ display: "flex", gap: 10, padding: "9px 16px", color: "inherit", textDecoration: "none" }}
          >
            <Avatar size={24} src={a.author?.avatar_url ?? undefined} style={{ fontSize: 10, flex: "none" }}>
              {initials(a.author?.name ?? "?")}
            </Avatar>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, color: "#17171c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong>{a.author?.name ?? "Someone"}</strong> on {a.task_name ?? "a task"}
              </div>
              <div style={{ fontSize: 11.5, color: "#9a9da8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.content}
              </div>
            </div>
            <span style={{ fontSize: 11, color: "#b6b8c0", flex: "none" }}>{dayjs(a.created_at).format("MMM D")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TodoBody() {
  const { data: todos } = usePersonalTodos();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const [text, setText] = useState("");
  const list = todos ?? [];

  const add = () => {
    const name = text.trim();
    if (!name) return;
    createTodo.mutate({ name });
    setText("");
  };

  return (
    <div style={{ padding: "8px 12px 12px" }}>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPressEnter={add}
        placeholder="Add a to-do…"
        size="small"
        style={{ marginBottom: 8 }}
      />
      {list.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#9a9da8", padding: "6px 2px" }}>Nothing yet.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {list.map((td) => (
            <li key={td.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px" }}>
              <input
                type="checkbox"
                checked={Boolean(td.done)}
                onChange={(e) => updateTodo.mutate({ id: td.id, done: e.target.checked })}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: td.done ? "#b6b8c0" : "#17171c",
                  textDecoration: td.done ? "line-through" : "none",
                }}
              >
                {td.name}
              </span>
              <button
                type="button"
                aria-label="Delete to-do"
                onClick={() => deleteTodo.mutate(td.id)}
                style={{ border: "none", background: "transparent", color: "#b6b8c0", cursor: "pointer" }}
              >
                <MIcon name="close" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export function DashboardCardView({
  card,
  tasks,
  tasksLoading,
  myTeamMemberId,
  editMode,
  dragHandle,
  bodyHeight,
  onEdit,
  onRemove,
}: {
  card: DashboardCard;
  tasks: TeamTaskWithProject[];
  tasksLoading: boolean;
  myTeamMemberId: string | undefined;
  editMode: boolean;
  /** Drag handle element (carries dnd-kit listeners); shown only in edit mode. */
  dragHandle?: React.ReactNode;
  /** Resized card body height in px; charts fill it, lists scroll within it. */
  bodyHeight?: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  // Height applies to every kind: charts size their canvas via ChartBody, metric
  // cards grow (minHeight), lists get a fixed height + scroll.
  const bodyStyle: React.CSSProperties | undefined =
    bodyHeight == null
      ? undefined
      : card.kind === "chart"
        ? undefined
        : card.kind === "metric"
          ? { minHeight: bodyHeight }
          : { height: bodyHeight, overflowY: "auto" };
  const taskDriven = card.kind === "chart" || card.kind === "metric" || card.kind === "tasks";
  return (
    <section
      style={{
        background: "#fff",
        border: `1px solid ${editMode ? "#d9d9e6" : "#ececf0"}`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: editMode ? "0 0 0 1px rgba(76,76,214,0.08)" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 14px",
          borderBottom: "1px solid #f2f2f5",
        }}
      >
        {editMode && dragHandle ? dragHandle : null}
        <Text strong style={{ fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.title}
        </Text>
        {editMode ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2, position: "relative", zIndex: 7 }}>
            <IconBtn label="Configure card" onClick={onEdit} icon="tune" />
            <IconBtn label="Remove card" onClick={onRemove} icon="close" danger />
          </div>
        ) : null}
      </div>

      <div style={bodyStyle}>
        {taskDriven && tasksLoading ? (
          <div style={{ padding: 16 }}>
            <Skeleton active paragraph={{ rows: 3 }} />
          </div>
        ) : card.kind === "metric" ? (
          <MetricBody card={card} tasks={tasks} myTeamMemberId={myTeamMemberId} />
        ) : card.kind === "chart" ? (
          <ChartBody card={card} tasks={tasks} myTeamMemberId={myTeamMemberId} height={bodyHeight} />
        ) : card.kind === "tasks" ? (
          <TasksBody card={card} tasks={tasks} myTeamMemberId={myTeamMemberId} />
        ) : card.kind === "activity" ? (
          <ActivityBody />
        ) : (
          <TodoBody />
        )}
      </div>
    </section>
  );
}

function IconBtn({
  label,
  icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? "#d0d1d8" : danger ? "#e0663f" : "#8a8d98",
        display: "inline-flex",
        padding: 3,
        borderRadius: 6,
      }}
    >
      <MIcon name={icon} size={16} />
    </button>
  );
}
