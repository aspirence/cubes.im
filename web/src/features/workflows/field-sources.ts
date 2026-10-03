/**
 * Turns a workflow into the list of sample sources the field picker offers:
 * the trigger first, then every step before the one being edited.
 *
 * A step that has never been tested still gets an entry — its shape from the
 * catalog, with empty example values and a hint saying to test it — because an
 * empty picker is the thing that makes people give up and hand-type
 * `{{steps.s1.rows}}` wrongly.
 *
 * Pure; the React side is field-picker.tsx.
 */

import {
  appActionByKey,
  workflowEventByKey,
  type ScheduleTriggerConfig,
} from "@/lib/workflows/app-action-catalog";
import { TRIGGER_TOKEN_ROOT, type FieldSource } from "./field-tokens";

export interface TriggerSampleInput {
  triggerType: string;
  triggerConfig: unknown;
  /** workflows.trigger_sample, when the column exists and has been filled. */
  storedSample: unknown;
  /** The newest captured webhook payload, when the panel has one. */
  capturedSample?: unknown;
}

export type TriggerSampleOrigin = "stored" | "capture" | "event" | "schedule" | "manual";

export interface TriggerSampleState {
  sample: unknown;
  origin: TriggerSampleOrigin;
  /** Plain-words description of where the example values came from. */
  note: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * What the trigger half of the picker shows, and why. Precedence is: what was
 * explicitly saved as the sample, then the newest live capture, then the shape
 * the trigger kind always produces.
 */
export function triggerSampleState(input: TriggerSampleInput): TriggerSampleState {
  if (isObject(input.storedSample) && Object.keys(input.storedSample).length > 0) {
    return {
      sample: input.storedSample,
      origin: "stored",
      note: "From the sample saved on this trigger.",
    };
  }
  if (isObject(input.capturedSample) && Object.keys(input.capturedSample).length > 0) {
    return {
      sample: input.capturedSample,
      origin: "capture",
      note: "From the request that just arrived — save it as the sample to keep it.",
    };
  }
  if (input.triggerType === "event") {
    const key = isObject(input.triggerConfig) ? String(input.triggerConfig.event_key ?? "") : "";
    const descriptor = workflowEventByKey(key);
    if (descriptor) {
      return {
        sample: descriptor.sample,
        origin: "event",
        note: `An example ${descriptor.label.toLowerCase()} payload — real runs carry the same fields.`,
      };
    }
    return { sample: {}, origin: "event", note: "Pick an event to see the fields it carries." };
  }
  if (input.triggerType === "schedule") {
    const cfg = (input.triggerConfig ?? {}) as Partial<ScheduleTriggerConfig>;
    return {
      sample: {
        trigger: "schedule",
        fired_at: "2026-09-20T09:00:00Z",
        scheduled_for: "2026-09-20T09:00:00Z",
        timezone: typeof cfg.timezone === "string" ? cfg.timezone : "Asia/Kolkata",
      },
      origin: "schedule",
      note: "A schedule run carries only when it fired.",
    };
  }
  if (input.triggerType === "webhook") {
    return {
      sample: {},
      origin: "capture",
      note: "No request captured yet — send one to the URL and it appears here.",
    };
  }
  return {
    sample: { trigger: "manual", fired_at: "2026-09-20T09:00:00Z" },
    origin: "manual",
    note: "A manual run carries only when it was started.",
  };
}

export interface StepSampleInput {
  step_key: string;
  step_type: string;
  config: Record<string, unknown>;
  /** workflow_steps.sample_output, when the column exists and has been filled. */
  sampleOutput?: unknown;
  /** How the step is named on the canvas. */
  label: string;
  /** Shape to show when the step has never been tested (agents supply theirs). */
  fallbackSample?: unknown;
}

/** The shape a step is known to produce, from the catalog, with no values yet. */
export function shapeForStep(step: StepSampleInput): unknown {
  if (step.fallbackSample !== undefined) return step.fallbackSample;
  const action = typeof step.config.action === "string" ? step.config.action : "";
  if (step.step_type === "app") {
    const descriptor = appActionByKey(action);
    if (descriptor) return Object.fromEntries(descriptor.outputs.map((o) => [o.key, null]));
    return {};
  }
  if (step.step_type === "http") return { status: null, headers: {}, body: null };
  if (step.step_type === "condition") return { passed: null, mode: null };
  if (step.step_type === "router") return { route: null, matched: null };
  if (step.step_type === "delay") return { resume_at: null, waited_seconds: null };
  if (action === "notify_user") return { notified: null };
  if (action === "create_task") return { task_id: null };
  return {};
}

/**
 * The picker's sources for the step at `index` (pass `steps.length` for a
 * trigger-only picker). Steps at or after `index` are left out: a step cannot
 * map data from itself or from something that has not run yet.
 */
export function builderFieldSources(
  trigger: TriggerSampleState,
  steps: StepSampleInput[],
  index: number,
): FieldSource[] {
  const sources: FieldSource[] = [
    {
      key: TRIGGER_TOKEN_ROOT,
      label: "Trigger",
      root: TRIGGER_TOKEN_ROOT,
      sample: trigger.sample,
      emptyHint:
        trigger.origin === "capture"
          ? "Nothing captured yet — send a request to the webhook URL."
          : "This trigger carries no data.",
    },
  ];
  for (let i = 0; i < Math.min(index, steps.length); i++) {
    const s = steps[i];
    const tested = s.sampleOutput !== undefined && s.sampleOutput !== null;
    sources.push({
      key: s.step_key,
      label: `Step ${i + 1} · ${s.label}`,
      root: `steps.${s.step_key}`,
      sample: tested ? s.sampleOutput : shapeForStep(s),
      emptyHint: tested
        ? "This step produced nothing to map."
        : "Not tested yet — use “Test this step” to fill in real values.",
    });
  }
  return sources;
}
