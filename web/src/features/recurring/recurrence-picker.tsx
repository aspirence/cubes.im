"use client";

import { DatePicker, InputNumber, Segmented, Select, theme } from "antd";
import dayjs from "dayjs";
import {
  describeRecurrence,
  previewCopies,
  WEEKDAY_OPTIONS,
  type RecurrenceDraft,
  type RecurringScheduleType,
} from "./recurrence";

export interface RecurrencePickerProps {
  value: RecurrenceDraft;
  onChange: (next: RecurrenceDraft) => void;
  /** YYYY-MM-DD — the task's own day, which the series counts from. */
  startsOn: string;
}

/**
 * The cadence controls shared by the create-task modal and the task drawer:
 * daily / weekly / monthly, every N, the weekday or day-of-month, an optional
 * end — and, before anything is saved, the first days copies will be made on.
 */
export function RecurrencePicker({ value, onChange, startsOn }: RecurrencePickerProps) {
  const { token } = theme.useToken();
  const set = (patch: Partial<RecurrenceDraft>) => onChange({ ...value, ...patch });
  const preview = previewCopies(value, startsOn);
  const endsBeforeStart = Boolean(value.endsOn) && dayjs(value.endsOn).isBefore(dayjs(startsOn), "day");

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Segmented
        block
        size="small"
        value={value.scheduleType}
        onChange={(v) => set({ scheduleType: v as RecurringScheduleType })}
        options={[
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ]}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <InputNumber
          size="small"
          min={1}
          max={365}
          value={value.intervalValue}
          onChange={(v) => set({ intervalValue: v ?? 1 })}
          addonBefore="Every"
          addonAfter={
            value.scheduleType === "daily"
              ? "days"
              : value.scheduleType === "weekly"
                ? "weeks"
                : "months"
          }
          style={{ width: 170 }}
        />
        {value.scheduleType === "weekly" ? (
          <Select
            size="small"
            allowClear
            placeholder="On (same weekday)"
            value={value.dayOfWeek ?? undefined}
            onChange={(v) => set({ dayOfWeek: v ?? null })}
            options={WEEKDAY_OPTIONS}
            style={{ width: 150 }}
          />
        ) : null}
        {value.scheduleType === "monthly" ? (
          <InputNumber
            size="small"
            min={1}
            max={31}
            placeholder="same day"
            value={value.dayOfMonth ?? undefined}
            onChange={(v) => set({ dayOfMonth: v ?? null })}
            addonBefore="Day"
            style={{ width: 130 }}
          />
        ) : null}
      </div>

      <DatePicker
        size="small"
        value={value.endsOn ? dayjs(value.endsOn) : null}
        onChange={(v) => set({ endsOn: v ? v.format("YYYY-MM-DD") : null })}
        format="DD MMM YYYY"
        placeholder="Ends (optional)"
        disabledDate={(d) => d.isBefore(dayjs(startsOn), "day")}
        style={{ width: "100%" }}
      />

      {/* What it will actually do, before it does it. */}
      <div
        style={{
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          padding: "8px 10px",
          fontSize: 12.5,
          lineHeight: 1.45,
          color: token.colorTextSecondary,
        }}
      >
        <strong style={{ color: token.colorText }}>{describeRecurrence(value)}</strong>
        {endsBeforeStart
          ? " — the end date is before this task's day, so nothing would be created."
          : preview.length > 0
            ? ` — next copies: ${preview.map((d) => dayjs(d).format("ddd D MMM")).join(" · ")}`
            : " — the end date is before the first copy, so nothing would be created."}
      </div>
    </div>
  );
}
