"use client";

import { useParams } from "next/navigation";
import { TaskDetailPage } from "../../_components/task-drawer";

/**
 * Full-page task detail view — the same content the task drawer renders,
 * expanded to fill the screen. Reached via the "Open in full page" control in
 * the drawer, or by deep link.
 */
export default function TaskFullPage() {
  const params = useParams<{ id: string; taskId: string }>();
  const taskId = params?.taskId;

  if (!taskId) return null;
  return <TaskDetailPage taskId={taskId} />;
}
