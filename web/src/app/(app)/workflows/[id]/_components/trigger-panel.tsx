"use client";

import { useMemo, useState } from "react";
import { Alert, App, Button, Input, Select, Switch, Tag, Typography, theme } from "antd";
import {
  TRIGGER_KINDS,
  WORKFLOW_EVENT_KEYS,
  workflowEventByKey,
  type ScheduleTriggerConfig,
  type TriggerKind,
} from "@/lib/workflows/app-action-catalog";
import {
  ScheduleTriggerForm,
  compactScheduleConfig,
  normalizeScheduleConfig,
} from "@/features/workflows/schedule-trigger-form";
import { WebhookTriggerPanel } from "@/features/workflows/webhook-trigger-panel";
import { SampleTree } from "@/features/workflows/field-picker";
import { useSaveTriggerSample } from "@/features/workflows/use-workflow-automation";
import { useUpdateWorkflow, type Workflow } from "@/features/workflows/use-workflows";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";
import type { TriggerSampleState } from "@/features/workflows/field-sources";
import type { Json } from "@/types/database";

/**
 * The trigger drawer: what starts this workflow, and what its data looks like.
 *
 * The sample matters as much as the trigger. Without one the field picker in
 * every step below has nothing to offer, so this panel always ends with the
 * sample — captured from a real request, pasted by hand, or the shape the
 * trigger kind always produces.
 */

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

export function TriggerPanel({
  workflow,
  canEdit,
  trigger,
  storedSample,
}: {
  workflow: Workflow;
  canEdit: boolean;
  /** What the builder resolved as the trigger's sample, and where it came from. */
  trigger: TriggerSampleState;
  /** workflows.trigger_sample as stored, when the column exists. */
  storedSample: unknown;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const updateWorkflow = useUpdateWorkflow();
  const saveSample = useSaveTriggerSample();
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const { data: installedApps } = useInstalledApps();

  const eventKey = useMemo(() => {
    const cfg = (workflow.trigger_config ?? {}) as { event_key?: string };
    return typeof cfg.event_key === "string" ? cfg.event_key : "";
  }, [workflow.trigger_config]);

  // An event of an app that is not installed can never fire here, so it is
  // not offered — except the one already chosen, which must stay visible.
  const eventOptions = useMemo(
    () =>
      WORKFLOW_EVENT_KEYS.filter(
        (e) => e.key === eventKey || (installedApps?.some((i) => i.app_key === e.appKey && i.enabled) ?? true),
      ).map((e) => ({ value: e.key, label: e.label })),
    [installedApps, eventKey],
  );

  const setTrigger = (kind: TriggerKind) => {
    const patch: Record<string, unknown> = { id: workflow.id, trigger_type: kind };
    // Switching to a schedule stores a complete config straight away so the
    // database can book the first run and the form has something to edit.
    if (kind === "schedule")
      patch.trigger_config = compactScheduleConfig(
        normalizeScheduleConfig(workflow.trigger_config),
      ) as unknown as Json;
    if (kind === "event" && !eventKey) patch.trigger_config = { event_key: "" } as unknown as Json;
    void updateWorkflow
      .mutateAsync(patch as Parameters<typeof updateWorkflow.mutateAsync>[0])
      .then(() => {
        // A sample captured from a webhook says nothing about what a schedule
        // or an event will carry, and a stale one silently mis-fills every
        // field picker below. Changing the kind clears it; the trigger's own
        // example shape takes over until a real one is captured or pasted.
        if (storedSample) {
          void saveSample.mutateAsync({ workflowId: workflow.id, sample: null }).catch(() => {
            // The column only exists once the automation migration is applied;
            // there is nothing to clear on an environment without it.
          });
        }
      })
      .catch((err: unknown) => {
        const code = (err as { code?: string })?.code;
        if (code === "23514") {
          message.error(
            "This trigger needs migration 20261132000000_workflow_automation.sql, which has not been applied here yet.",
          );
          return;
        }
        message.error(err instanceof Error ? err.message : "Could not change the trigger.");
      });
  };

  const savePasted = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(paste);
    } catch {
      message.error("That is not valid JSON.");
      return;
    }
    void saveSample
      .mutateAsync({ workflowId: workflow.id, sample: parsed })
      .then(() => {
        message.success("Sample saved.");
        setPasteOpen(false);
        setPaste("");
      })
      .catch((err: unknown) =>
        message.error(err instanceof Error ? err.message : "Could not save the sample."),
      );
  };

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        What starts this workflow.
      </Typography.Paragraph>

      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        {TRIGGER_KINDS.map((t) => {
          const active = workflow.trigger_type === t.value;
          return (
            <button
              key={t.value}
              type="button"
              disabled={!canEdit}
              onClick={() => (active ? undefined : setTrigger(t.value))}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                textAlign: "left",
                border: `1.5px solid ${active ? "#4a4ad0" : token.colorBorderSecondary}`,
                background: active ? token.colorPrimaryBg : token.colorBgContainer,
                borderRadius: 10,
                padding: "9px 11px",
                cursor: canEdit ? "pointer" : "not-allowed",
              }}
            >
              <MIcon name={t.icon} size={19} color={active ? "#4a4ad0" : token.colorTextSecondary} />
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: "block" }}>{t.label}</span>
                <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                  {t.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {workflow.trigger_type === "schedule" ? (
        <div>
          <ScheduleTriggerForm
            key={`${workflow.id}-${workflow.updated_at}`}
            value={workflow.trigger_config}
            nextRunAt={workflow.enabled ? workflow.next_run_at : null}
            disabled={!canEdit}
            saving={updateWorkflow.isPending}
            onSave={(cfg: ScheduleTriggerConfig) =>
              void updateWorkflow
                .mutateAsync({ id: workflow.id, trigger_config: cfg as unknown as Json })
                .then(() => message.success("Schedule saved."))
                .catch((err: unknown) =>
                  message.error(err instanceof Error ? err.message : "Failed to save schedule."),
                )
            }
          />
          {!workflow.enabled ? (
            <Typography.Paragraph type="warning" style={{ fontSize: 12, marginTop: 8 }}>
              The workflow is off, so the schedule will not fire until you turn it on.
            </Typography.Paragraph>
          ) : null}
        </div>
      ) : null}

      {workflow.trigger_type === "webhook" ? (
        <WebhookTriggerPanel
          workflowId={workflow.id}
          disabled={!canEdit}
          hasSample={Boolean(storedSample)}
        />
      ) : null}

      {workflow.trigger_type === "event" ? (
        <div>
          <Typography.Text style={{ fontSize: 13 }}>Which event</Typography.Text>
          <Select
            style={{ width: "100%", marginTop: 4 }}
            disabled={!canEdit}
            value={eventKey || undefined}
            placeholder="Pick an event"
            options={eventOptions}
            onChange={(v) =>
              void updateWorkflow
                .mutateAsync({ id: workflow.id, trigger_config: { event_key: v } as unknown as Json })
                .then(() => message.success("Event saved."))
                .catch((err: unknown) =>
                  message.error(err instanceof Error ? err.message : "Could not save the event."),
                )
            }
          />
          {eventKey ? (
            <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, marginTop: 6 }}>
              {workflowEventByKey(eventKey)?.description}{" "}
              <Tag style={{ marginInlineStart: 4, fontSize: 10.5 }}>{eventKey}</Tag>
            </Typography.Paragraph>
          ) : null}
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            message="Events are delivered by the runner"
            description="A run starts on the next runner tick after the event, not the same instant."
          />
        </div>
      ) : null}

      {workflow.trigger_type === "manual" ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          Nothing starts this on its own — press Run now to try it.
        </Typography.Paragraph>
      ) : null}

      {/* Sample data -------------------------------------------------- */}
      <div
        style={{
          marginTop: 20,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Typography.Text style={{ fontSize: 13, flex: 1 }}>Sample data</Typography.Text>
          <Button size="small" disabled={!canEdit} onClick={() => setPasteOpen((v) => !v)}>
            {pasteOpen ? "Cancel" : "Paste a sample"}
          </Button>
        </div>
        <Typography.Paragraph type="secondary" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>
          {trigger.note} Every step below builds its field picker from this.
        </Typography.Paragraph>

        {pasteOpen ? (
          <div style={{ marginBottom: 10 }}>
            <Input.TextArea
              rows={6}
              value={paste}
              placeholder='{"contact": {"name": "A Person", "email": "person@example.com"}}'
              onChange={(e) => setPaste(e.target.value)}
              style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: 12 }}
            />
            <Button
              type="primary"
              size="small"
              style={{ marginTop: 6 }}
              loading={saveSample.isPending}
              onClick={savePasted}
            >
              Save as sample
            </Button>
          </div>
        ) : null}

        <div
          style={{
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 10,
            padding: "8px 10px",
          }}
        >
          <SampleTree sample={trigger.sample} root="trigger" label="Trigger" height={220} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <Typography.Text style={{ fontSize: 13, flex: 1 }}>Workflow is on</Typography.Text>
        <Switch
          size="small"
          checked={workflow.enabled}
          disabled={!canEdit}
          onChange={(c) => void updateWorkflow.mutateAsync({ id: workflow.id, enabled: c })}
        />
      </div>
    </div>
  );
}
