"use client";

import { useState } from "react";
import { Alert, Button, Tag, Typography, theme } from "antd";
import { useTestStep, type StepTestResult } from "./use-workflow-automation";

/**
 * "Test this step": runs one step on its own against the stored samples and
 * shows the exact request that went out and the exact response that came back.
 *
 * Both halves are shown raw. A test is the one place where a person needs to
 * see literally what was sent — a prettified summary is what makes a mapping
 * bug invisible.
 */

function Pane({ title, value, tone }: { title: string; value: unknown; tone?: "error" }) {
  const { token } = theme.useToken();
  const text =
    value === null || value === undefined
      ? "—"
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  return (
    <div style={{ marginTop: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
        {title}
      </Typography.Text>
      <pre
        style={{
          margin: "3px 0 0",
          fontSize: 11.5,
          maxHeight: 200,
          overflow: "auto",
          background: token.colorFillTertiary,
          color: tone === "error" ? token.colorErrorText : token.colorText,
          padding: 8,
          borderRadius: 6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

export function TestStepPanel({
  stepId,
  workflowId,
  disabled,
  /** Why the step cannot be tested yet (incomplete config, usually). */
  blockedReason,
}: {
  stepId: string;
  workflowId: string;
  disabled?: boolean;
  blockedReason?: string | null;
}) {
  const { token } = theme.useToken();
  const test = useTestStep();
  const [result, setResult] = useState<StepTestResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = () => {
    setFailure(null);
    setResult(null);
    void test
      .mutateAsync({ stepId, workflowId })
      .then(setResult)
      .catch((err: unknown) => setFailure(err instanceof Error ? err.message : "The test failed."));
  };

  return (
    <div
      style={{
        marginTop: 16,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        paddingTop: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="small"
          loading={test.isPending}
          disabled={disabled || Boolean(blockedReason)}
          onClick={run}
        >
          Test this step
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 11.5, flex: 1 }}>
          {blockedReason ?? "Runs only this step, using the samples above, and saves the result."}
        </Typography.Text>
      </div>

      {failure ? (
        <Alert type="error" showIcon style={{ marginTop: 8 }} message={failure} />
      ) : null}

      {result ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tag color={result.ok && !result.error ? "green" : "red"} style={{ margin: 0 }}>
              {result.ok && !result.error ? "succeeded" : "failed"}
            </Tag>
            {!result.executed ? (
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                Described, not performed — this step only acts inside a real run.
              </Typography.Text>
            ) : null}
            {result.durationMs !== null ? (
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                {result.durationMs} ms
              </Typography.Text>
            ) : null}
          </div>
          {result.error ? <Pane title="Error" value={result.error} tone="error" /> : null}
          <Pane title="Request sent" value={result.request} />
          <Pane
            title={
              result.executed
                ? "Response — this is now the step's sample"
                : "What it would produce — saved as the step's sample"
            }
            value={result.response}
          />
        </div>
      ) : null}
    </div>
  );
}
