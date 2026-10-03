"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Popover, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { RecurrencePicker } from "./recurrence-picker";
import {
  DEFAULT_RECURRENCE,
  describeRecurrence,
  recurrenceError,
  type RecurrenceDraft,
} from "./recurrence";
import {
  toRecurrenceDraft,
  useRemoveTaskRecurring,
  useSetTaskRecurring,
  useTaskRecurring,
  useTaskRecurringOrigin,
} from "./use-recurring";

export interface TaskRecurrenceControlProps {
  taskId: string;
  projectId: string;
  /**
   * YYYY-MM-DD — the task's own day (its start, else its due). Null when the
   * task has no dates at all: the series then keeps counting from the day it
   * was set up (the schedule's starts_on), because "today" would silently move
   * the weekday every time the row was rendered.
   */
  anchor: string | null;
  /**
   * Rendered on the full-page task route, where no drawer is mounted: the
   * "Copy of" link then opens the source's full page instead of the drawer.
   */
  inPage?: boolean;
}

/**
 * The "Repeat" row of the task drawer: what the task's schedule is, a popover
 * to set or change it, and — for a copy the job made — a way back to the task
 * it was copied from, since that is where the series is stopped or changed.
 */
export function TaskRecurrenceControl({
  taskId,
  projectId,
  anchor,
  inPage = false,
}: TaskRecurrenceControlProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const openDrawer = useTaskDrawer((s) => s.open);
  const router = useRouter();
  const openTask = (id: string) =>
    inPage ? router.push(`/projects/${projectId}/tasks/${id}`) : openDrawer(id);
  const { data: schedule, isLoading } = useTaskRecurring(taskId);
  const { data: origin } = useTaskRecurringOrigin(taskId);
  const setRecurring = useSetTaskRecurring();
  const removeRecurring = useRemoveTaskRecurring();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RecurrenceDraft>(DEFAULT_RECURRENCE);

  // The day the series counts from: the task's own, else the one already
  // stored, else today for a dateless task that has never repeated.
  const startsOn = anchor ?? schedule?.starts_on ?? dayjs().format("YYYY-MM-DD");
  const problem = recurrenceError(draft, startsOn);

  const onOpenChange = (next: boolean) => {
    // Seed from what is saved each time, so a cancelled edit leaves no trace.
    if (next) setDraft(schedule ? toRecurrenceDraft(schedule) : DEFAULT_RECURRENCE);
    setOpen(next);
  };

  const save = async () => {
    if (problem) {
      message.warning(problem);
      return;
    }
    try {
      await setRecurring.mutateAsync({ taskId, projectId, ...draft, startsOn });
      message.success(`Repeats ${describeRecurrence(draft).toLowerCase()}.`);
      setOpen(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save the repeat.");
    }
  };

  const remove = async () => {
    try {
      await removeRecurring.mutateAsync({ taskId, projectId });
      message.success("This task no longer repeats.");
      setOpen(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to remove the repeat.");
    }
  };

  // A stopped series keeps its row (see useRemoveTaskRecurring), so "no schedule"
  // and "switched off" read the same to the user; an ended one says when.
  const label = !schedule || (!schedule.active && !schedule.ends_on)
    ? "Doesn't repeat"
    : schedule.active
      ? describeRecurrence(toRecurrenceDraft(schedule))
      : `Ended ${dayjs(schedule.ends_on as string).format("D MMM YYYY")}`;

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <Popover
        open={open}
        onOpenChange={onOpenChange}
        trigger="click"
        placement="bottomLeft"
        content={
          <div style={{ width: 340, display: "grid", gap: 10 }}>
            <RecurrencePicker value={draft} onChange={setDraft} startsOn={startsOn} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {schedule?.active ? (
                <Button size="small" danger loading={removeRecurring.isPending} onClick={remove}>
                  Stop repeating
                </Button>
              ) : null}
              <Button
                size="small"
                type="primary"
                loading={setRecurring.isPending}
                disabled={Boolean(problem)}
                title={problem ?? undefined}
                onClick={save}
              >
                {schedule?.active ? "Save" : "Repeat"}
              </Button>
            </div>
          </div>
        }
      >
        <Button
          size="small"
          type="text"
          loading={isLoading}
          style={{
            padding: "0 6px",
            marginLeft: -6,
            color: schedule?.active ? token.colorPrimary : token.colorTextSecondary,
          }}
        >
          {label}
        </Button>
      </Popover>

      {origin ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Copy of{" "}
          <Typography.Link style={{ fontSize: 12 }} onClick={() => openTask(origin.sourceTaskId)}>
            {origin.sourceTaskNo != null ? `#${origin.sourceTaskNo} · ` : ""}
            {origin.sourceName}
          </Typography.Link>
          {origin.active ? "" : " (series ended)"}
        </Typography.Text>
      ) : null}
    </div>
  );
}
