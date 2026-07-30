"use client";

import { useState } from "react";
import { App, Button, Input, Modal } from "antd";
import {
  PauseCircleFilled,
  PlayCircleOutlined,
} from "@ant-design/icons";

import {
  useStartTimer,
  useStopTimer,
  useActiveTimer,
} from "@/features/time/use-time";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Format a whole number of seconds as a ticking `HH:MM:SS` clock. */
function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/* -------------------------------------------------------------------------- */

/**
 * Start/stop time-tracking toggle for a single task.
 *
 * When a timer is running for the current user/task it shows the live elapsed
 * time as a ticking `HH:MM:SS` clock in an active (danger) style; clicking it
 * stops the timer and optionally captures a short description. When idle it
 * shows a plain "Start timer" button.
 *
 * Timer state and the live elapsed counter come from Agent A's `useActiveTimer`
 * hook so this component stays presentational.
 */
export function TaskTimerButton({ taskId }: { taskId: string }) {
  const { message } = App.useApp();

  const { timer, elapsedSeconds } = useActiveTimer(taskId);
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();

  const [stopOpen, setStopOpen] = useState(false);
  const [description, setDescription] = useState("");

  const running = Boolean(timer);

  const handleStart = async () => {
    try {
      await startTimer.mutateAsync({ taskId });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to start timer.",
      );
    }
  };

  const handleStopConfirm = async () => {
    try {
      await stopTimer.mutateAsync({
        taskId,
        description: description.trim() ? description.trim() : undefined,
      });
      setStopOpen(false);
      setDescription("");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to stop timer.",
      );
    }
  };

  if (running) {
    return (
      <>
        <Button
          danger
          type="primary"
          icon={<PauseCircleFilled />}
          loading={stopTimer.isPending}
          onClick={() => setStopOpen(true)}
        >
          {formatClock(elapsedSeconds)}
        </Button>

        <Modal
          title="Stop timer"
          open={stopOpen}
          onOk={handleStopConfirm}
          okText="Stop & log"
          confirmLoading={stopTimer.isPending}
          onCancel={() => setStopOpen(false)}
          destroyOnHidden
        >
          <p style={{ marginTop: 0 }}>
            Elapsed: <strong>{formatClock(elapsedSeconds)}</strong>
          </p>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you work on? (optional)"
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </Modal>
      </>
    );
  }

  return (
    <Button
      icon={<PlayCircleOutlined />}
      loading={startTimer.isPending}
      onClick={handleStart}
    >
      Start timer
    </Button>
  );
}
