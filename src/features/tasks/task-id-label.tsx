"use client";

import { useTaskIdFormatter } from "@/features/settings/use-task-id-format";

/**
 * Renders a task's configured display id (e.g. "PAY2-012" or "#12"). Reads the
 * team's format + the project's key via cached queries, so it can be dropped in
 * anywhere a task number is shown without threading props through.
 */
export function TaskIdLabel({
  projectId,
  taskNo,
}: {
  projectId: string | undefined;
  taskNo: number | null | undefined;
}) {
  const fmt = useTaskIdFormatter(projectId);
  return <>{fmt(taskNo)}</>;
}
