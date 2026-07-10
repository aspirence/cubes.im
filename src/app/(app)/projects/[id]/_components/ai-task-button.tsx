"use client";

import { useState } from "react";
import { App, Button, Input, Modal, Tag, Typography } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useAiCreateTask, type AiCreateTaskResult } from "@/features/ai/use-ai";

const { Text } = Typography;

/**
 * "AI task" — natural-language task creation for the project workspace
 * header. The prompt goes to /api/ai/task, which parses it with Claude and
 * creates the task under the caller's own RLS session; the result chip shows
 * what the parser actually applied.
 */
export function AiTaskButton({ projectId }: { projectId: string }) {
  const { message } = App.useApp();
  const aiCreate = useAiCreateTask();

  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [lastResult, setLastResult] = useState<AiCreateTaskResult | null>(
    null,
  );

  const handleCreate = async () => {
    const trimmed = prompt.trim();
    // isPending guard: Enter can fire repeatedly while a request is in flight.
    if (!trimmed || aiCreate.isPending) return;
    try {
      const result = await aiCreate.mutateAsync({ projectId, prompt: trimmed });
      setLastResult(result);
      setPrompt("");
      if (result.warning) {
        message.warning(result.warning);
      } else {
        message.success(`Task "${result.task.name}" created.`);
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "AI task creation failed.",
      );
    }
  };

  const applied = lastResult?.applied;
  const appliedChips = applied
    ? (
        [
          applied.status && `Status: ${applied.status}`,
          applied.priority && `Priority: ${applied.priority}`,
          applied.assignee && `Assignee: ${applied.assignee}`,
          applied.startDate && `Start: ${applied.startDate}`,
          applied.endDate && `Due: ${applied.endDate}`,
        ] as (string | null)[]
      ).filter((c): c is string => Boolean(c))
    : [];

  return (
    <>
      <Button
        icon={<ThunderboltOutlined />}
        onClick={() => {
          setLastResult(null);
          setOpen(true);
        }}
      >
        AI task
      </Button>
      <Modal
        title="Create a task with AI"
        open={open}
        onOk={handleCreate}
        onCancel={() => setOpen(false)}
        okText="Create task"
        okButtonProps={{ disabled: !prompt.trim() }}
        confirmLoading={aiCreate.isPending}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Describe the task in plain language — assignee, priority and dates
            are picked up automatically. e.g. “Fix the login redirect bug,
            assign it to Rahul, high priority, due next Friday”.
          </Text>
          <Input.TextArea
            autoFocus
            rows={3}
            maxLength={4000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void handleCreate();
              }
            }}
            placeholder="What needs to be done?"
          />
          {lastResult && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "8px 10px",
                background: "#f6f7f9",
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 13 }}>
                Created{" "}
                <Text strong>
                  {lastResult.task.taskNo != null
                    ? `#${lastResult.task.taskNo} `
                    : ""}
                  {lastResult.task.name}
                </Text>
              </Text>
              {appliedChips.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {appliedChips.map((chip) => (
                    <Tag key={chip} style={{ borderRadius: 6, marginInlineEnd: 0 }}>
                      {chip}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
