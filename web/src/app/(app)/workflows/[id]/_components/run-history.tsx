"use client";

import { useMemo, useState } from "react";
import { App, Button, Empty, Segmented, Table, Tag, Tooltip, Typography, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  useWorkflowRuns,
  useWorkflowRun,
  type WorkflowRun,
} from "@/features/workflows/use-workflow-runs";
import { useReplayRun } from "@/features/workflows/use-workflow-automation";
import { appActionByKey } from "@/lib/workflows/app-action-catalog";

/**
 * Run history — the place a workflow explains itself. Per run: what started it,
 * how long it took, and how many steps it charged for; per step: the exact
 * input it was given, the output it produced or the error it raised, and which
 * attempt this was. Failed runs can be filtered to and replayed from the raw
 * payload they were given.
 */

const statusColor = (s: string) =>
  s === "success"
    ? "green"
    : s === "error"
      ? "red"
      : s === "stopped" || s === "filtered"
        ? "orange"
        : s === "waiting_human" || s === "waiting_app" || s === "waiting_delay"
          ? "gold"
          : "blue";

const statusLabel = (s: string) =>
  s === "waiting_app"
    ? "working"
    : s === "waiting_delay"
      ? "waiting"
      : s === "waiting_human"
        ? "waiting"
        : s;

/** Columns the automation migration adds; absent until it is applied. */
interface RunExtras {
  trigger_payload?: unknown;
  replay_of?: string | null;
  task_count?: number | null;
  resume_at?: string | null;
}
interface StepRunExtras {
  attempt?: number | null;
}

/** "4.2s", "310ms", "—" while it is still going. */
function duration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function triggerLabel(run: WorkflowRun): string {
  const snapshot = (run.trigger_snapshot ?? {}) as { trigger?: string; event_key?: string };
  switch (snapshot.trigger) {
    case "schedule":
      return "Schedule";
    case "webhook":
      return "Webhook";
    case "event":
      return snapshot.event_key ?? "Event";
    default:
      return (run as WorkflowRun & RunExtras).replay_of ? "Replay" : "Manual";
  }
}

/**
 * An app step's output as labelled values ("Metric rows saved: 1,204") using
 * the catalog's output labels, instead of raw JSON. Nested values (spend per
 * currency) are shown compactly.
 */
function AppOutput({ action, output }: { action: string; output: Record<string, unknown> }) {
  const { token } = theme.useToken();
  const descriptor = appActionByKey(action);
  const labelled = descriptor?.outputs.filter((o) => o.key in output) ?? [];
  const show = (v: unknown): string => {
    if (typeof v === "number") return v.toLocaleString();
    if (v && typeof v === "object") {
      return (
        Object.entries(v as Record<string, unknown>)
          .map(([k, x]) => `${k} ${typeof x === "number" ? x.toLocaleString() : String(x)}`)
          .join(", ") || "—"
      );
    }
    return String(v ?? "—");
  };
  if (!labelled.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "2px 12px",
        marginTop: 4,
        fontSize: 12,
      }}
    >
      {labelled.map((o) => (
        <div key={o.key} style={{ display: "contents" }}>
          <span style={{ color: token.colorTextSecondary }}>{o.label}</span>
          <span style={{ color: token.colorText }}>{show(output[o.key])}</span>
        </div>
      ))}
    </div>
  );
}

function Json({ value, tone }: { value: unknown; tone?: "error" }) {
  const { token } = theme.useToken();
  return (
    <pre
      style={{
        margin: "4px 0 0",
        fontSize: 11.5,
        color: tone === "error" ? "#e0556a" : token.colorTextSecondary,
        maxHeight: 160,
        overflow: "auto",
        background: token.colorFillTertiary,
        padding: 8,
        borderRadius: 6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StepTimeline({ runId }: { runId: string }) {
  const { token } = theme.useToken();
  const { data } = useWorkflowRun(runId);
  const stepRuns = data?.stepRuns ?? [];
  if (stepRuns.length === 0) {
    return <Typography.Text type="secondary">No steps recorded.</Typography.Text>;
  }
  return (
    <div style={{ padding: "4px 8px" }}>
      {stepRuns.map((sr) => {
        const attempt = (sr as typeof sr & StepRunExtras).attempt ?? 1;
        const action = String((sr.input as { action?: string })?.action ?? "");
        return (
          <div
            key={sr.id}
            style={{
              display: "flex",
              gap: 10,
              padding: "8px 0",
              borderBottom: `1px solid ${token.colorSplit}`,
            }}
          >
            <Tag style={{ margin: 0, height: 22 }}>{sr.step_key}</Tag>
            <Tag color={statusColor(sr.status)} style={{ margin: 0, height: 22 }}>
              {sr.step_type === "app" && sr.status === "running" ? "working" : sr.status}
            </Tag>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {sr.step_type === "app"
                    ? (appActionByKey(action)?.label ?? "app")
                    : sr.step_type}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                  {duration(sr.started_at, sr.finished_at)}
                </Typography.Text>
                {attempt > 1 ? (
                  <Tooltip title="This step was retried">
                    <Tag color="gold" style={{ margin: 0, fontSize: 10.5 }}>
                      attempt {attempt}
                    </Tag>
                  </Tooltip>
                ) : null}
              </div>
              {sr.step_type === "app" && sr.status === "success" ? (
                <AppOutput action={action} output={(sr.output ?? {}) as Record<string, unknown>} />
              ) : null}
              {sr.input && Object.keys(sr.input as object).length > 0 ? (
                <details style={{ marginTop: 4 }}>
                  <summary
                    style={{ fontSize: 11.5, color: token.colorTextTertiary, cursor: "pointer" }}
                  >
                    input
                  </summary>
                  <Json value={sr.input} />
                </details>
              ) : null}
              {sr.error ? (
                <Json value={sr.error} tone="error" />
              ) : sr.status === "skipped" ? (
                <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                  Skipped — the filter did not match, and the run carried on.
                </Typography.Text>
              ) : (
                <details style={{ marginTop: 4 }} open>
                  <summary
                    style={{ fontSize: 11.5, color: token.colorTextTertiary, cursor: "pointer" }}
                  >
                    output
                  </summary>
                  <Json value={sr.output} />
                </details>
              )}
            </div>
          </div>
        );
      })}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        0 AI tokens used — deterministic run.
        {stepRuns.some((sr) => sr.step_type === "app" && sr.status === "running")
          ? " An app step is still working on the server; this updates when it finishes."
          : ""}
      </Typography.Text>
    </div>
  );
}

export function RunHistory({
  workflowId,
  highlightRunId,
  canReplay,
}: {
  workflowId: string;
  highlightRunId?: string | null;
  /** Replay starts a real run, so it follows the same admin gate as editing. */
  canReplay?: boolean;
}) {
  const { message } = App.useApp();
  const { data: runs, isLoading } = useWorkflowRuns(workflowId);
  const replay = useReplayRun();
  const [expanded, setExpanded] = useState<readonly React.Key[]>(
    highlightRunId ? [highlightRunId] : [],
  );
  const [filter, setFilter] = useState<"all" | "failed">("all");

  const all = useMemo(() => runs ?? [], [runs]);
  const failedCount = all.filter((r) => r.status === "error").length;
  const rows = filter === "failed" ? all.filter((r) => r.status === "error") : all;

  const columns: ColumnsType<WorkflowRun> = [
    {
      title: "Started",
      dataIndex: "started_at",
      key: "started",
      width: 146,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Trigger",
      key: "trigger",
      width: 86,
      render: (_, r) => triggerLabel(r),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 88,
      render: (s: string) => <Tag color={statusColor(s)}>{statusLabel(s)}</Tag>,
    },
    {
      title: "Took",
      key: "duration",
      width: 68,
      render: (_, r) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {duration(r.started_at, r.finished_at)}
        </Typography.Text>
      ),
    },
    {
      title: "Detail",
      key: "detail",
      // The drawer is narrow: one ellipsised line with the full text on hover,
      // instead of a column so thin that antd breaks "Completed" mid-word.
      render: (_, r) => {
        const extras = r as WorkflowRun & RunExtras;
        if (r.error)
          return (
            <Typography.Text type="danger" style={{ fontSize: 12 }} ellipsis={{ tooltip: r.error }}>
              {r.error}
            </Typography.Text>
          );
        const stopReason = (r.context as { _stop_reason?: string })?._stop_reason;
        const text = stopReason
          ? stopReason === "no_route"
            ? "No route matched"
            : "Stopped by a filter"
          : r.status === "waiting_app"
            ? "Running an app step on the server…"
            : r.status === "waiting_delay"
              ? extras.resume_at
                ? `Waiting until ${new Date(extras.resume_at).toLocaleString()}`
                : "Waiting out a delay"
              : r.status === "running"
                ? "Running…"
                : "Completed";
        return (
          <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: text }}>
            {text}
            {typeof extras.task_count === "number" && extras.task_count > 0
              ? ` · ${extras.task_count} task${extras.task_count === 1 ? "" : "s"}`
              : ""}
          </Typography.Text>
        );
      },
    },
    {
      title: "",
      key: "replay",
      width: 70,
      render: (_, r) => (
        <Tooltip title="Run this again with exactly the data it was given">
          <Button
            size="small"
            type="link"
            style={{ padding: 0 }}
            disabled={!canReplay}
            loading={replay.isPending && replay.variables?.runId === r.id}
            onClick={() =>
              void replay
                .mutateAsync({ runId: r.id, workflowId })
                .then((runId) => {
                  message.success("Replay started.");
                  if (runId) setExpanded([runId]);
                })
                .catch((err: unknown) =>
                  message.error(err instanceof Error ? err.message : "Replay failed."),
                )
            }
          >
            Replay
          </Button>
        </Tooltip>
      ),
    },
  ];

  if (all.length === 0 && !isLoading) {
    return <Empty description="No runs yet — use Run now" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <>
      <Segmented
        size="small"
        value={filter}
        onChange={(v) => setFilter(v as "all" | "failed")}
        options={[
          { value: "all", label: `All (${all.length})` },
          { value: "failed", label: `Failures (${failedCount})` },
        ]}
        style={{ marginBottom: 10 }}
      />
      {filter === "failed" && failedCount === 0 ? (
        <Empty description="No failed runs." image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table<WorkflowRun>
          rowKey="id"
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          expandable={{
            expandedRowKeys: expanded,
            onExpandedRowsChange: (keys) => setExpanded(keys),
            expandedRowRender: (record) => <StepTimeline runId={record.id} />,
          }}
        />
      )}
    </>
  );
}
