"use client";

import { useState } from "react";
import { Empty, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  useWorkflowRuns,
  useWorkflowRun,
  type WorkflowRun,
} from "@/features/workflows/use-workflow-runs";

const statusColor = (s: string) =>
  s === "success"
    ? "green"
    : s === "error"
      ? "red"
      : s === "stopped"
        ? "orange"
        : s === "waiting_human"
          ? "gold"
          : "blue";

function StepTimeline({ runId }: { runId: string }) {
  const { data } = useWorkflowRun(runId);
  const stepRuns = data?.stepRuns ?? [];
  if (stepRuns.length === 0) {
    return <Typography.Text type="secondary">No steps recorded.</Typography.Text>;
  }
  return (
    <div style={{ padding: "4px 8px" }}>
      {stepRuns.map((sr) => (
        <div
          key={sr.id}
          style={{
            display: "flex",
            gap: 10,
            padding: "8px 0",
            borderBottom: "1px solid #f0f0f3",
          }}
        >
          <Tag style={{ margin: 0, height: 22 }}>{sr.step_key}</Tag>
          <Tag color={statusColor(sr.status)} style={{ margin: 0, height: 22 }}>
            {sr.status}
          </Tag>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {sr.step_type}
            </Typography.Text>
            {sr.input && Object.keys(sr.input as object).length > 0 ? (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 11.5, color: "#9a9da8", cursor: "pointer" }}>
                  input
                </summary>
                <pre
                  style={{
                    margin: "4px 0 0",
                    fontSize: 11.5,
                    color: "#6a6d78",
                    maxHeight: 120,
                    overflow: "auto",
                    background: "#fafafb",
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  {JSON.stringify(sr.input, null, 2)}
                </pre>
              </details>
            ) : null}
            {sr.error ? (
              <pre
                style={{
                  margin: "4px 0 0",
                  fontSize: 11.5,
                  color: "#e0556a",
                  whiteSpace: "pre-wrap",
                }}
              >
                {sr.error}
              </pre>
            ) : (
              <pre
                style={{
                  margin: "4px 0 0",
                  fontSize: 11.5,
                  color: "#494b54",
                  maxHeight: 160,
                  overflow: "auto",
                  background: "#fafafb",
                  padding: 8,
                  borderRadius: 6,
                }}
              >
                {JSON.stringify(sr.output, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        0 AI tokens used — deterministic run.
      </Typography.Text>
    </div>
  );
}

export function RunHistory({
  workflowId,
  highlightRunId,
}: {
  workflowId: string;
  highlightRunId?: string | null;
}) {
  const { data: runs, isLoading } = useWorkflowRuns(workflowId);
  const [expanded, setExpanded] = useState<readonly React.Key[]>(
    highlightRunId ? [highlightRunId] : [],
  );

  const columns: ColumnsType<WorkflowRun> = [
    {
      title: "Started",
      dataIndex: "started_at",
      key: "started",
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (s: string) => <Tag color={statusColor(s)}>{s}</Tag>,
    },
    {
      title: "Detail",
      key: "detail",
      render: (_, r) =>
        r.error ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {r.error}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {(r.context as { _stop_reason?: string })?._stop_reason
              ? "Stopped by condition"
              : "Completed"}
          </Typography.Text>
        ),
    },
  ];

  if ((runs?.length ?? 0) === 0 && !isLoading) {
    return (
      <Empty
        description="No runs yet — use Test run"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <Table<WorkflowRun>
      rowKey="id"
      size="small"
      loading={isLoading}
      columns={columns}
      dataSource={runs ?? []}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      expandable={{
        expandedRowKeys: expanded,
        onExpandedRowsChange: (keys) => setExpanded(keys),
        expandedRowRender: (record) => <StepTimeline runId={record.id} />,
      }}
    />
  );
}
