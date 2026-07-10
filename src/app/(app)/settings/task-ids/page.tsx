"use client";

import { useState } from "react";
import { App, Button, Input, InputNumber, Segmented, Select, Switch, Typography, theme } from "antd";
import {
  useTaskIdConfig,
  useUpdateTaskIdConfig,
  formatTaskId,
  DEFAULT_TASK_ID_CONFIG,
  type TaskIdConfig,
} from "@/features/settings/use-task-id-format";

const { Title, Text } = Typography;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 0", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
      <div>
        <div style={{ fontSize: 13.5, color: token.colorText, fontWeight: 500 }}>{label}</div>
        {hint ? <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{hint}</div> : null}
      </div>
      <div style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

export default function TaskIdSettingsPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: saved } = useTaskIdConfig();
  const update = useUpdateTaskIdConfig();

  // Local edits (null until the user touches something); until then we show the
  // saved config. Seeding at render-time avoids a set-state-in-effect.
  const [cfg, setCfg] = useState<TaskIdConfig | null>(null);
  const effective = cfg ?? saved ?? DEFAULT_TASK_ID_CONFIG;

  const patch = (p: Partial<TaskIdConfig>) => setCfg({ ...effective, ...p });

  const save = async () => {
    try {
      await update.mutateAsync(effective);
      message.success("Task ID format saved.");
    } catch {
      message.error("Only a team admin can change this.");
    }
  };

  const samples: { key: string; no: number }[] = [
    { key: "PAY2", no: 7 },
    { key: "MKT", no: 128 },
  ];

  return (
    <div style={{ maxWidth: 720 }}>
      <Title level={4} style={{ marginTop: 0 }}>Task IDs</Title>
      <Text type="secondary">Choose how every task&apos;s ID is displayed across the workspace.</Text>

      {/* Live preview */}
      <div
        style={{
          marginTop: 18,
          padding: 18,
          borderRadius: 14,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorFillQuaternary,
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Text type="secondary" style={{ fontSize: 12.5 }}>Preview</Text>
        {samples.map((s) => (
          <span
            key={s.key}
            style={{
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              fontSize: 20,
              fontWeight: 700,
              color: token.colorText,
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 8,
              padding: "6px 14px",
            }}
          >
            {formatTaskId(s.key, s.no, effective)}
          </span>
        ))}
        <Text type="secondary" style={{ fontSize: 12 }}>
          (project key <b>{samples[0].key}</b>, task #{samples[0].no})
        </Text>
      </div>

      <div style={{ marginTop: 18 }}>
        <Row label="Prefix" hint="What comes before the number.">
          <Segmented
            value={effective.prefixSource}
            onChange={(v) => patch({ prefixSource: v as TaskIdConfig["prefixSource"] })}
            options={[
              { label: "Project key", value: "project_key" },
              { label: "Custom", value: "custom" },
              { label: "None (#)", value: "none" },
            ]}
          />
        </Row>

        {effective.prefixSource === "custom" ? (
          <Row label="Custom prefix" hint="Used for every project.">
            <Input
              value={effective.customPrefix}
              onChange={(e) => patch({ customPrefix: e.target.value.slice(0, 10) })}
              placeholder="TASK"
              style={{ width: 160 }}
            />
          </Row>
        ) : null}

        {effective.prefixSource !== "none" ? (
          <>
            <Row label="Separator" hint="Between the prefix and number.">
              <Select
                value={effective.separator}
                onChange={(separator) => patch({ separator })}
                style={{ width: 160 }}
                options={[
                  { label: "Dash  (PAY-12)", value: "-" },
                  { label: "Underscore  (PAY_12)", value: "_" },
                  { label: "Space  (PAY 12)", value: " " },
                  { label: "None  (PAY12)", value: "" },
                ]}
              />
            </Row>
            <Row label="Uppercase prefix">
              <Switch checked={effective.uppercase} onChange={(uppercase) => patch({ uppercase })} />
            </Row>
          </>
        ) : null}

        <Row label="Number padding" hint="Zero-pad the number (0 = off). e.g. 3 → 007.">
          <InputNumber
            min={0}
            max={8}
            value={effective.padding}
            onChange={(v) => patch({ padding: v ?? 0 })}
            style={{ width: 100 }}
          />
        </Row>
      </div>

      <div style={{ marginTop: 20 }}>
        <Button type="primary" loading={update.isPending} onClick={save}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
