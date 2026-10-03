"use client";

import { useMemo, useState } from "react";
import { Alert, Button, InputNumber, Segmented, Select, TimePicker, Typography, theme } from "antd";
import dayjs from "dayjs";
import {
  describeSchedule,
  type ScheduleTriggerConfig,
} from "@/lib/workflows/app-action-catalog";
import {
  browserTimeZone,
  formatInZone,
  previewScheduleRuns,
  scheduleConfigProblem,
  validTimeZone,
} from "@/lib/workflows/schedule";

/**
 * The schedule trigger's settings: how often, at what local time, on which
 * days, in which zone. The zone defaults to the browser's, because "09:00"
 * means the admin's morning, not UTC's. The preview is computed in the
 * browser by the TypeScript twin of the SQL scheduler; the database computes
 * the real next_run_at when the config is saved.
 */

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const FREQUENCIES: { value: ScheduleTriggerConfig["frequency"]; label: string }[] = [
  { value: "every_n_minutes", label: "Every N min" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

/** Reads a stored trigger_config into a complete, editable config. */
export function normalizeScheduleConfig(raw: unknown): ScheduleTriggerConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<ScheduleTriggerConfig>;
  const frequency = FREQUENCIES.some((f) => f.value === c.frequency) ? c.frequency! : "daily";
  return {
    frequency,
    interval_minutes: typeof c.interval_minutes === "number" ? c.interval_minutes : 60,
    time: typeof c.time === "string" && /^\d{1,2}:\d{2}$/.test(c.time) ? c.time : frequency === "hourly" ? "00:00" : "09:00",
    days: Array.isArray(c.days) && c.days.length ? c.days : [1],
    timezone: typeof c.timezone === "string" && c.timezone ? c.timezone : browserTimeZone(),
  };
}

/** Only the keys that matter for the chosen frequency are stored. */
export function compactScheduleConfig(c: ScheduleTriggerConfig): ScheduleTriggerConfig {
  switch (c.frequency) {
    case "every_n_minutes":
      return { frequency: c.frequency, interval_minutes: c.interval_minutes, timezone: c.timezone };
    case "hourly":
      return { frequency: c.frequency, time: `00:${(c.time ?? "00:00").slice(-2)}`, timezone: c.timezone };
    case "daily":
      return { frequency: c.frequency, time: c.time, timezone: c.timezone };
    case "weekly":
      return { frequency: c.frequency, time: c.time, days: [...(c.days ?? [])].sort((a, b) => a - b), timezone: c.timezone };
  }
}

function stableJson(v: unknown): string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return JSON.stringify(v ?? null);
  const o = v as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
}

function zoneOptions(current: string): { value: string; label: string }[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const all = new Set([current, browserTimeZone(), "UTC", ...zones]);
  return [...all].filter(Boolean).map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
}

export function ScheduleTriggerForm({
  value,
  nextRunAt,
  disabled,
  saving,
  onSave,
}: {
  value: unknown;
  /** workflows.next_run_at as the database computed it. */
  nextRunAt: string | null;
  disabled?: boolean;
  saving?: boolean;
  onSave: (config: ScheduleTriggerConfig) => void;
}) {
  const { token } = theme.useToken();
  const initial = useMemo(() => normalizeScheduleConfig(value), [value]);
  const [draft, setDraft] = useState<ScheduleTriggerConfig>(initial);
  const set = (patch: Partial<ScheduleTriggerConfig>) => setDraft((d) => ({ ...d, ...patch }));

  const config = compactScheduleConfig(draft);
  const problem = scheduleConfigProblem(config);
  const preview = problem ? [] : previewScheduleRuns(config, 3);
  const localZone = browserTimeZone();
  // Compared with what is stored, not with the defaults, so a config that was
  // never saved (just switched to "schedule") can still be saved as shown.
  // jsonb reorders keys, so compare key-sorted.
  const dirty = stableJson(config) !== stableJson(value);
  const zones = useMemo(() => zoneOptions(draft.timezone), [draft.timezone]);

  const label = (text: string) => (
    <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 4 }}>{text}</Typography.Text>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        {label("Repeat")}
        <Segmented
          block
          disabled={disabled}
          value={draft.frequency}
          options={FREQUENCIES}
          onChange={(v) => set({ frequency: v as ScheduleTriggerConfig["frequency"] })}
        />
      </div>

      {draft.frequency === "every_n_minutes" ? (
        <div>
          {label("Every (minutes)")}
          <InputNumber
            style={{ width: "100%" }}
            disabled={disabled}
            min={15}
            max={720}
            step={15}
            value={draft.interval_minutes}
            onChange={(v) => set({ interval_minutes: typeof v === "number" ? v : undefined })}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Between 15 and 720. Runs are checked every five minutes.
          </Typography.Text>
        </div>
      ) : null}

      {draft.frequency === "hourly" ? (
        <div>
          {label("Minutes past the hour")}
          <InputNumber
            style={{ width: "100%" }}
            disabled={disabled}
            min={0}
            max={59}
            value={Number((draft.time ?? "00:00").slice(-2))}
            onChange={(v) => set({ time: `00:${String(typeof v === "number" ? v : 0).padStart(2, "0")}` })}
          />
        </div>
      ) : null}

      {draft.frequency === "daily" || draft.frequency === "weekly" ? (
        <div>
          {label("At")}
          <TimePicker
            style={{ width: "100%" }}
            disabled={disabled}
            format="HH:mm"
            minuteStep={5}
            allowClear={false}
            needConfirm={false}
            value={dayjs(`2000-01-01T${(draft.time ?? "09:00").padStart(5, "0")}`)}
            onChange={(d) => d && set({ time: d.format("HH:mm") })}
          />
        </div>
      ) : null}

      {draft.frequency === "weekly" ? (
        <div>
          {label("On")}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DAYS.map((d) => {
              const on = (draft.days ?? []).includes(d.value);
              return (
                <Button
                  key={d.value}
                  size="small"
                  disabled={disabled}
                  type={on ? "primary" : "default"}
                  onClick={() =>
                    set({
                      days: on
                        ? (draft.days ?? []).filter((x) => x !== d.value)
                        : [...(draft.days ?? []), d.value],
                    })
                  }
                >
                  {d.label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        {label("Time zone")}
        <Select
          showSearch
          style={{ width: "100%" }}
          disabled={disabled}
          value={draft.timezone}
          options={zones}
          optionFilterProp="label"
          onChange={(v) => set({ timezone: v })}
        />
      </div>

      {problem ? (
        <Alert type="warning" showIcon message={problem} />
      ) : (
        <div
          style={{
            background: token.colorFillTertiary,
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12.5,
            color: token.colorTextSecondary,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, color: token.colorText }}>{describeSchedule(config)}</div>
          <div style={{ marginTop: 4 }}>Next runs:</div>
          {preview.map((d) => (
            <div key={d.toISOString()}>
              {formatInZone(d, config.timezone)}
              {validTimeZone(config.timezone) !== localZone ? (
                <span style={{ color: token.colorTextTertiary }}> · {formatInZone(d, localZone)} your time</span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!dirty && nextRunAt ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Scheduled: next run {formatInZone(new Date(nextRunAt), config.timezone)}.
        </Typography.Text>
      ) : null}

      <Button
        type="primary"
        disabled={disabled || Boolean(problem) || !dirty}
        loading={saving}
        onClick={() => onSave(config)}
      >
        Save schedule
      </Button>
    </div>
  );
}
