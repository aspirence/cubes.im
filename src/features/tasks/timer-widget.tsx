"use client";

import { useRouter } from "next/navigation";
import { App as AntdApp, theme } from "antd";
import {
  useMyRunningTimer,
  useStartTimer,
  useStopTimer,
  useElapsed,
} from "@/features/tasks/use-task-timer";

/**
 * The running-timer widget pinned to the sidebar's footer: a soft amber card
 * with the ticking elapsed time, the task it's tracking, and a pause button.
 * Renders nothing when no timer is running.
 */
export function TimerWidget() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: timer } = useMyRunningTimer();
  const stopTimer = useStopTimer();
  const elapsed = useElapsed(timer?.started_at);

  if (!timer) return null;

  async function onPause() {
    if (!timer || stopTimer.isPending) return;
    try {
      await stopTimer.mutateAsync(timer.task_id);
      message.success("Time logged to the task.");
    } catch {
      message.error("Couldn't stop the timer.");
    }
  }

  return (
    <div
      style={{
        margin: "8px 10px 10px",
        padding: "10px 12px",
        borderRadius: 14,
        background: "linear-gradient(135deg, #fdf6e6 0%, #faeecf 100%)",
        border: "1px solid #f1e3c0",
        boxShadow: "0 4px 14px rgba(191, 146, 42, 0.12)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* Pause — the amber dial, like a little stopwatch face. */}
      <button
        type="button"
        aria-label="Pause timer"
        onClick={onPause}
        disabled={stopTimer.isPending}
        style={{
          width: 36,
          height: 36,
          flex: "none",
          borderRadius: "50%",
          border: "2.5px solid #e8b33c",
          background: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#b97f14",
          boxShadow: "0 2px 6px rgba(191, 146, 42, 0.22)",
        }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
          pause
        </span>
      </button>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          className="tabular"
          style={{
            fontSize: 17,
            fontWeight: 700,
            lineHeight: 1.1,
            color: "#4d3a10",
            letterSpacing: 0.3,
          }}
        >
          {elapsed}
        </div>
        <button
          type="button"
          onClick={() => router.push(`/projects/${timer.project_id}`)}
          title={`${timer.task_name} — ${timer.project_name}`}
          style={{
            display: "block",
            maxWidth: "100%",
            border: "none",
            background: "none",
            padding: 0,
            marginTop: 2,
            fontSize: 11.5,
            color: "#8a6d2b",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {timer.task_name}
        </button>
      </div>

      {/* Live dot — the widget's "recording" cue. */}
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          flex: "none",
          borderRadius: "50%",
          background: "#e8b33c",
          boxShadow: "0 0 0 4px rgba(232, 179, 60, 0.22)",
        }}
      />
    </div>
  );
}

/**
 * Inline play/pause control for a single task — shown wherever a task in an
 * ACTIVE-stage status is rendered (board cards, the task drawer). Play starts
 * tracking this task (stopping any other timer); pause stops and logs.
 */
export function TaskTimerButton({
  taskId,
  size = 26,
}: {
  taskId: string;
  size?: number;
}) {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const { data: timer } = useMyRunningTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const running = timer?.task_id === taskId;
  const busy = start.isPending || stop.isPending;

  async function onToggle(e: React.MouseEvent) {
    // Board cards / drawer rows have their own click handlers — the timer
    // button must never open the task while toggling.
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    try {
      if (running) {
        await stop.mutateAsync(taskId);
        message.success("Time logged to the task.");
      } else {
        await start.mutateAsync(taskId);
      }
    } catch {
      message.error(running ? "Couldn't stop the timer." : "Couldn't start the timer.");
    }
  }

  return (
    <button
      type="button"
      aria-label={running ? "Pause timer" : "Start timer"}
      title={running ? "Pause — logs the tracked time" : "Start timer"}
      onClick={onToggle}
      disabled={busy}
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        border: running ? "1.5px solid #e8b33c" : `1.5px solid ${token.colorBorder}`,
        background: running ? "#fdf3dc" : token.colorBgContainer,
        color: running ? "#b97f14" : token.colorTextTertiary,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all .15s ease",
      }}
    >
      <span
        className="material-symbols-rounded"
        style={{ fontSize: size * 0.58, lineHeight: 1 }}
      >
        {running ? "pause" : "play_arrow"}
      </span>
    </button>
  );
}
