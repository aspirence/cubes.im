"use client";

import { useMemo } from "react";
import { Badge, Calendar, Card, theme } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useTasks, type TaskWithRelations } from "@/features/tasks/use-tasks";

/** Calendar view: tasks placed on a month grid by their due date. */
export function CalendarTab({ projectId }: { projectId: string }) {
  const { token } = theme.useToken();
  const { data: tasks, isLoading } = useTasks(projectId);

  const byDay = useMemo(() => {
    const m = new Map<string, TaskWithRelations[]>();
    for (const t of tasks ?? []) {
      if (!t.end_date) continue;
      const key = dayjs(t.end_date).format("YYYY-MM-DD");
      const arr = m.get(key) ?? [];
      arr.push(t);
      m.set(key, arr);
    }
    return m;
  }, [tasks]);

  const cellRender = (
    current: Dayjs,
    info: { type: string; originNode: React.ReactNode },
  ) => {
    if (info.type !== "date") return info.originNode;
    const items = byDay.get(current.format("YYYY-MM-DD")) ?? [];
    if (items.length === 0) return null;
    return (
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.slice(0, 3).map((t) => (
          <li
            key={t.id}
            style={{
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <Badge
              color={t.priority?.color_code ?? "#8a8d98"}
              text={t.name}
            />
          </li>
        ))}
        {items.length > 3 ? (
          <li style={{ fontSize: 11, color: token.colorTextTertiary }}>
            +{items.length - 3} more
          </li>
        ) : null}
      </ul>
    );
  };

  return (
    <Card loading={isLoading} styles={{ body: { padding: 8 } }}>
      <Calendar cellRender={cellRender} />
    </Card>
  );
}
