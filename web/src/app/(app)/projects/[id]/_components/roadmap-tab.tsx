"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Card, Empty, Result, Skeleton, Space, Tag, Typography } from "antd";
import { ViewMode, type Task as GanttTask } from "gantt-task-react";
import "gantt-task-react/dist/index.css";

import { useTasks, type TaskWithRelations } from "@/features/tasks/use-tasks";
import { useTaskStatuses } from "@/features/tasks/use-task-statuses";
import { useTaskDrawer } from "@/store/task-drawer-store";

const { Text } = Typography;

// gantt-task-react reads `window` on import, so it must stay client-only.
const Gantt = dynamic(
  () => import("gantt-task-react").then((m) => m.Gantt),
  { ssr: false },
);

/** Days a task spans when it has no usable start/end dates. */
const DEFAULT_DURATION_DAYS = 3;

const FALLBACK_STATUS_COLOR = "#adb5bd";

function startOfDay(value: string | Date): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Roadmap timeline for a project's tasks.
 *
 * Each task becomes one gantt-task-react bar driven by `start_date` / `end_date`.
 * When a task is missing dates we fall back to `created_at` (+ a default
 * duration) so it still appears on the timeline. Bars are colored by their
 * status. Clicking a bar opens the shared task drawer.
 */
export function RoadmapTab({ projectId }: { projectId: string }) {
  const {
    data: tasks,
    isLoading,
    isError,
    error,
  } = useTasks(projectId);
  const { data: statuses } = useTaskStatuses(projectId);
  const openTask = useTaskDrawer((s) => s.open);

  const statusColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of statuses ?? []) {
      map.set(s.id, s.category?.color_code ?? FALLBACK_STATUS_COLOR);
    }
    return map;
  }, [statuses]);

  const statusNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of statuses ?? []) {
      map.set(s.id, s.name);
    }
    return map;
  }, [statuses]);

  const ganttTasks: GanttTask[] = useMemo(() => {
    const rows = (tasks ?? []) as TaskWithRelations[];

    return rows.map((task, index) => {
      const start = startOfDay(task.start_date ?? task.created_at);

      let end: Date;
      if (task.end_date) {
        end = startOfDay(task.end_date);
      } else if (task.start_date) {
        end = addDays(start, DEFAULT_DURATION_DAYS);
      } else {
        end = addDays(start, DEFAULT_DURATION_DAYS);
      }
      // Guard against inverted / zero-length ranges so a bar is always drawn.
      if (end.getTime() <= start.getTime()) {
        end = addDays(start, 1);
      }

      const color = task.status_id
        ? (statusColorById.get(task.status_id) ?? FALLBACK_STATUS_COLOR)
        : FALLBACK_STATUS_COLOR;

      const progress =
        typeof task.progress_value === "number"
          ? Math.max(0, Math.min(100, task.progress_value))
          : task.done
            ? 100
            : 0;

      return {
        id: task.id,
        type: "task",
        name:
          task.task_no != null ? `#${task.task_no} ${task.name}` : task.name,
        start,
        end,
        progress,
        displayOrder: index,
        styles: {
          backgroundColor: color,
          backgroundSelectedColor: color,
          progressColor: color,
          progressSelectedColor: color,
        },
      } satisfies GanttTask;
    });
  }, [tasks, statusColorById]);

  if (isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <Result
          status="error"
          title="Couldn't load the roadmap"
          subTitle={
            error instanceof Error
              ? error.message
              : "Something went wrong while loading tasks."
          }
        />
      </Card>
    );
  }

  if (ganttTasks.length === 0) {
    return (
      <Card>
        <Empty
          description="No tasks to chart yet"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="roadmap-scroll" style={{ overflowX: "auto" }}>
        <Gantt
          tasks={ganttTasks}
          viewMode={ViewMode.Week}
          listCellWidth="260px"
          columnWidth={120}
          rowHeight={40}
          onClick={(t) => openTask(t.id)}
        />
      </div>
      {statuses && statuses.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ marginRight: 8 }}>
            Statuses:
          </Text>
          <Space size={[4, 8]} wrap>
            {statuses.map((s) => (
              <Tag
                key={s.id}
                color={statusColorById.get(s.id) ?? FALLBACK_STATUS_COLOR}
              >
                {statusNameById.get(s.id) ?? s.name}
              </Tag>
            ))}
          </Space>
        </div>
      ) : null}
    </Card>
  );
}
