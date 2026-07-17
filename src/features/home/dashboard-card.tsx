"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar, Button, Empty, Mentions, Skeleton, Space, Tag, Tooltip, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useAllTeamTasks, type TeamTaskWithProject } from "@/features/tasks/use-all-tasks";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { useRef } from "react";
import {
  usePersonalTodos,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
  useActivityFeed,
} from "@/features/home/use-home";
import { useUIStore } from "@/store/ui-store";
import { GroupedChart } from "./dashboard-grouped-chart";
import { ChartDrillDown } from "./chart-drill-down";
import { useAnalyticsCapabilities, clampCardForViewer } from "./analytics-access";
import {
  visibleTasks,
  groupTasks,
  computeMetric,
  tasksInGroup,
  paletteFor,
} from "./dashboard-engine";
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
  const { token } = theme.useToken();
  const metric = card.metric ?? "open";
  const value = computeMetric(tasks, card.filter, metric, myTeamMemberId);
  const label = METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? "";
  const tone =
    metric === "overdue" && value > 0
      ? "#e0663f"
      : metric === "completed-week"
        ? "#3a9d6e"
        : token.colorText;
  return (
    <div style={{ padding: "18px 18px 20px" }}>
      <div
        className="font-mono"
        style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-1.5px", color: tone, lineHeight: 1 }}
      >
        {value}
      </div>
      <div style={{ marginTop: 6, fontSize: 12.5, color: token.colorTextTertiary }}>
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
  const [drill, setDrill] = useState<string | null>(null);
  const dark = useUIStore((s) => s.themeMode === "dark");
  const visible = visibleTasks(tasks, card.filter, myTeamMemberId);
  // When grouping by assignee, only count assignees the card's filter allows so
  // co-assignees outside the filter/scope don't leak into the chart.
  const assigneeAllow = new Set<string>(card.filter.assigneeIds);
  if (card.filter.scope === "me" && myTeamMemberId) assigneeAllow.add(myTeamMemberId);
  const groupBy = card.groupBy ?? "status";
  const data = groupTasks(visible, groupBy, assigneeAllow, paletteFor(dark));
  const chartHeight = height ? Math.max(120, height - 16) : card.span === "full" ? 240 : 210;

  const drilled = drill ? tasksInGroup(visible, groupBy, drill, assigneeAllow) : [];
  const drillLabel = data.find((d) => d.key === drill)?.label ?? "";

  return (
    <div style={{ padding: "10px 12px 6px" }}>
      <GroupedChart
        data={data}
        chart={card.chart ?? "donut"}
        height={chartHeight}
        onSelect={setDrill}
      />
      <ChartDrillDown
        open={drill !== null}
        title={`${drillLabel} · ${card.title}`}
        tasks={drilled}
        onClose={() => setDrill(null)}
      />
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
  const { token } = theme.useToken();
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
          <li key={t.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${token.colorSplit}` }}>
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
                    color: token.colorText,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.name}
                </div>
                <div style={{ fontSize: 11.5, color: token.colorTextTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
              <div style={{ width: 70, textAlign: "right", flex: "none", fontSize: 12, color: overdue ? "#e0663f" : token.colorTextTertiary }}>
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
  const { token } = theme.useToken();
  const { data, isLoading } = useActivityFeed();
  if (isLoading) return <div style={{ padding: 16 }}><Skeleton active paragraph={{ rows: 4 }} /></div>;
  const items = (data ?? []).slice(0, 8);
  if (items.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No recent activity" style={{ margin: "20px 0" }} />;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((a, i) => (
        <li key={a.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${token.colorSplit}` }}>
          <Link
            href={a.project_id ? `/projects/${a.project_id}?task=${a.task_id}` : "#"}
            style={{ display: "flex", gap: 10, padding: "9px 16px", color: "inherit", textDecoration: "none" }}
          >
            <Avatar size={24} src={a.author?.avatar_url ?? undefined} style={{ fontSize: 10, flex: "none" }}>
              {initials(a.author?.name ?? "?")}
            </Avatar>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, color: token.colorText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <strong>{a.author?.name ?? "Someone"}</strong> on {a.task_name ?? "a task"}
              </div>
              <div style={{ fontSize: 11.5, color: token.colorTextTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.content}
              </div>
            </div>
            <span style={{ fontSize: 11, color: token.colorTextQuaternary, flex: "none" }}>{dayjs(a.created_at).format("MMM D")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Inline `@`-mentions for to-dos. A picked suggestion is stored inside the
 * to-do's text as `@[Label](t:<id>)` / `@[Label](p:<id>)` so it survives as
 * plain text everywhere, and renders here as a chip — task chips open the
 * task drawer. Text typed as a bare "@something" with no pick stays plain.
 */
const MENTION_RE = /@\[([^\]]+)\]\((t|p):([^)]+)\)/g;

function TodoText({ name, done }: { name: string; done: boolean }) {
  const { token } = theme.useToken();
  const openTask = useTaskDrawer((s) => s.open);

  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "g");
  while ((m = re.exec(name)) !== null) {
    if (m.index > last) parts.push(name.slice(last, m.index));
    const [, label, type, id] = m;
    const isTask = type === "t";
    parts.push(
      <span
        key={`${type}:${id}:${m.index}`}
        role={isTask ? "button" : undefined}
        tabIndex={isTask ? 0 : undefined}
        onClick={isTask ? () => openTask(id) : undefined}
        onKeyDown={
          isTask
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") openTask(id);
              }
            : undefined
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "0 6px",
          margin: "0 1px",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: "18px",
          verticalAlign: "text-bottom",
          cursor: isTask ? "pointer" : "default",
          color: isTask ? "#4a4ad0" : token.colorTextSecondary,
          background: isTask ? token.colorPrimaryBg : token.colorFillSecondary,
        }}
      >
        <MIcon name={isTask ? "task_alt" : "person"} size={12} />
        {label}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < name.length) parts.push(name.slice(last));

  return (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        color: done ? token.colorTextQuaternary : token.colorText,
        textDecoration: done ? "line-through" : "none",
      }}
    >
      {parts}
    </span>
  );
}

function TodoBody() {
  const { token } = theme.useToken();
  const { data: todos } = usePersonalTodos();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  // Both already cached by the dashboard's own queries — no extra fetch.
  const { data: teamTasks } = useAllTeamTasks();
  const { data: members } = useTeamMembers();
  const [text, setText] = useState("");
  // Labels the user actually PICKED this compose session → their entity. Only
  // these get encoded on save; typing a bare "@word" stays plain text.
  const picked = useRef(new Map<string, { type: "t" | "p"; id: string }>());

  const list = todos ?? [];

  const options = [
    ...(teamTasks ?? [])
      .filter((t) => !t.done)
      .slice(0, 200)
      .map((t) => ({
        key: `t:${t.id}`,
        value: t.name,
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 320 }}>
            <MIcon name="task_alt" size={14} color="#4a4ad0" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
            <span style={{ fontSize: 11, color: token.colorTextQuaternary, flex: "none" }}>
              {t.project?.name}
            </span>
          </span>
        ),
      })),
    ...(members ?? [])
      .filter((m) => m.user)
      .map((m) => ({
        key: `p:${m.id}`,
        value: m.user!.name,
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <MIcon name="person" size={14} color={token.colorTextTertiary} />
            {m.user!.name}
          </span>
        ),
      })),
  ];

  const add = () => {
    let name = text.trim();
    if (!name) return;
    // Encode picked mentions so they survive as structured tokens in plain text.
    for (const [label, ent] of picked.current) {
      name = name.split(`@${label}`).join(`@[${label}](${ent.type}:${ent.id})`);
    }
    createTodo.mutate({ name });
    setText("");
    picked.current.clear();
  };

  return (
    <div style={{ padding: "8px 12px 12px" }}>
      <Space.Compact style={{ width: "100%", marginBottom: 8 }}>
        <Mentions
          value={text}
          onChange={setText}
          onSelect={(option) => {
            const key = String(option.key ?? "");
            const [type, ...rest] = key.split(":");
            if ((type === "t" || type === "p") && rest.length && option.value) {
              picked.current.set(option.value, { type, id: rest.join(":") });
            }
          }}
          onPressEnter={add}
          options={options}
          prefix="@"
          placeholder="Add a to-do…  (@ to tag a task or person)"
          autoSize={{ minRows: 1, maxRows: 3 }}
          style={{ width: "100%" }}
        />
        <Button
          type="primary"
          onClick={add}
          disabled={!text.trim()}
          loading={createTodo.isPending}
          icon={<MIcon name="add" size={16} />}
          aria-label="Add to-do"
        />
      </Space.Compact>
      {list.length === 0 ? (
        <div style={{ fontSize: 12.5, color: token.colorTextTertiary, padding: "6px 2px" }}>Nothing yet.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {list.map((td) => (
            <li key={td.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px" }}>
              <input
                type="checkbox"
                checked={Boolean(td.done)}
                onChange={(e) => updateTodo.mutate({ id: td.id, done: e.target.checked })}
              />
              <TodoText name={td.name} done={Boolean(td.done)} />
              <button
                type="button"
                aria-label="Delete to-do"
                onClick={() => deleteTodo.mutate(td.id)}
                style={{ border: "none", background: "transparent", color: token.colorTextQuaternary, cursor: "pointer" }}
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
  card: rawCard,
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
  const { token } = theme.useToken();
  const caps = useAnalyticsCapabilities();
  // Render-time role enforcement: gallery/drawer gating shapes what can be
  // BUILT, but stored layouts, seeded defaults, and layouts from before a role
  // change all land here — so the renderer clamps team-scoped cards to "me"
  // for viewers without team scope. (Their DATA is RLS-scoped regardless; this
  // stops a chart labelled "by member" from lying about what it shows.)
  const card = clampCardForViewer(rawCard, caps);
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
        background: token.colorBgContainer,
        border: `1px solid ${editMode ? token.colorBorder : token.colorBorderSecondary}`,
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
          borderBottom: `1px solid ${token.colorSplit}`,
        }}
      >
        {editMode && dragHandle ? dragHandle : null}
        <Text strong style={{ fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.title}
        </Text>
        {/* The clamp narrows WHAT the card shows but leaves the title alone
            (it's the user's text) — so when it changed anything, say so here
            instead of letting a "by member" title sit over personal data. */}
        {card !== rawCard ? (
          <Tooltip title="Shown as your own tasks — team analytics need a member role.">
            <Tag style={{ margin: 0, fontSize: 10.5, lineHeight: "16px", flex: "none" }}>
              Personal
            </Tag>
          </Tooltip>
        ) : null}
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
  const { token } = theme.useToken();
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
        color: disabled ? token.colorTextQuaternary : danger ? "#e0663f" : token.colorTextTertiary,
        display: "inline-flex",
        padding: 3,
        borderRadius: 6,
      }}
    >
      <MIcon name={icon} size={16} />
    </button>
  );
}
