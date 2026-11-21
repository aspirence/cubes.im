"use client";

import Link from "next/link";
import { Empty, Modal, Tag, Typography, theme } from "antd";
import dayjs from "dayjs";
import type { TeamTaskWithProject } from "@/features/tasks/use-all-tasks";
import { useTaskDrawer } from "@/store/task-drawer-store";

const { Text } = Typography;

function MIcon({ name, size = 15, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, color, lineHeight: 1 }}>
      {name}
    </span>
  );
}

/**
 * Who is holding this exact set of tasks, biggest share first.
 *
 * It counts the list the modal was handed, so it always agrees with whatever
 * narrowed that list — the tile's own rule and the header's period. On "Today"
 * the "In Review" tile hands over the work that reached review today, and this
 * reads as who put it there; on "All time" it reads as who is sitting on the
 * queue. A task with two assignees counts for both, so the parts can add up to
 * more than the total; a task with none is counted once as unassigned.
 */
function countByAssignee(
  tasks: TeamTaskWithProject[],
): { name: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const t of tasks) {
    const names = t.assignees
      .map((a) => a.team_member?.user?.name)
      .filter((n): n is string => Boolean(n));
    const keys = names.length > 0 ? names : ["Unassigned"];
    for (const k of keys) tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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

/**
 * The tasks behind one clicked chart mark. Charts are a way INTO the work, so a
 * mark is a link, not a dead end — each row opens the task drawer in place.
 */
export function ChartDrillDown({
  open,
  title,
  tasks,
  onClose,
}: {
  open: boolean;
  /** e.g. "In progress · Tasks by status" */
  title: string;
  tasks: TeamTaskWithProject[];
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const openTask = useTaskDrawer((s) => s.open);
  const byAssignee = countByAssignee(tasks);

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {title}
          <Tag style={{ margin: 0 }}>{tasks.length}</Tag>
        </span>
      }
      onCancel={onClose}
      footer={null}
      width="min(680px, calc(100vw - 32px))"
      destroyOnHidden
    >
      {tasks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tasks in this group" />
      ) : (
        <>
        {byAssignee.length > 1 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: "2px 0 10px",
              borderBottom: `1px solid ${token.colorSplit}`,
            }}
          >
            {byAssignee.map((a) => (
              <span
                key={a.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 9px",
                  borderRadius: 999,
                  fontSize: 12,
                  background: token.colorFillQuaternary,
                  color: token.colorText,
                }}
              >
                {a.name}
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{a.count}</b>
              </span>
            ))}
          </div>
        ) : null}
        <div style={{ maxHeight: "60vh", overflowY: "auto", margin: "4px -8px 0" }}>
          {tasks.map((t) => {
            const due = t.end_date ? dayjs(t.end_date) : null;
            const overdue = due ? due.isBefore(dayjs().startOf("day")) && !t.done : false;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onClose();
                  openTask(t.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 8px",
                  border: "none",
                  borderTop: `1px solid ${token.colorSplit}`,
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flex: "none",
                    background: t.status?.category?.color_code ?? token.colorTextQuaternary,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, color: token.colorText, fontSize: 13 }}>
                  <span
                    style={{
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      textDecoration: t.done ? "line-through" : undefined,
                      opacity: t.done ? 0.6 : 1,
                    }}
                  >
                    {t.name}
                  </span>
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {t.project?.name ?? "—"}
                  </Text>
                </span>
                {t.priority?.name ? (
                  <Tag color={priorityColor(t.priority.name)} style={{ margin: 0 }}>
                    {t.priority.name}
                  </Tag>
                ) : null}
                {due ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11.5,
                      flex: "none",
                      color: overdue ? token.colorError : token.colorTextTertiary,
                    }}
                  >
                    <MIcon name="event" size={13} />
                    {due.format("MMM D")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        </>
      )}
      <div style={{ marginTop: 12, textAlign: "right" }}>
        <Link href="/home/my-tasks" style={{ fontSize: 12.5 }} onClick={onClose}>
          Open My Tasks →
        </Link>
      </div>
    </Modal>
  );
}
