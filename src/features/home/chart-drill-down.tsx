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
      )}
      <div style={{ marginTop: 12, textAlign: "right" }}>
        <Link href="/home/my-tasks" style={{ fontSize: 12.5 }} onClick={onClose}>
          Open My Tasks →
        </Link>
      </div>
    </Modal>
  );
}
