"use client";

import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  App,
  Button,
  Drawer,
  Input,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  useWorkflow,
  useWorkflowSteps,
  useUpdateWorkflow,
  useCreateStep,
  useUpdateStep,
  useDeleteStep,
  useReorderSteps,
  useIsTeamAdmin,
  type WorkflowStep,
} from "@/features/workflows/use-workflows";
import { useRunNow } from "@/features/workflows/use-workflow-runs";
import { useAgents, type Agent } from "@/features/workflows/use-agents";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MemberSingleSelect } from "@/features/team-members/member-select";
import { useProjects } from "@/features/projects/use-projects";
import {
  appActionForStep,
  appActionTiles,
  capabilityForStep,
  skillByKey,
  type FieldDef,
  type StepCapability,
  type StepType,
} from "@/lib/workflows/capabilities";
import {
  BUILDER_STEP_TYPES,
  TRIGGER_KINDS,
  appActionByKey,
  builderStepForStep,
  describeSchedule,
  workflowEventByKey,
} from "@/lib/workflows/app-action-catalog";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";
import { AppStepInspector, isAppStepComplete } from "@/features/workflows/app-step-inspector";
import { normalizeScheduleConfig } from "@/features/workflows/schedule-trigger-form";
import { buildFieldTree, type FieldGroup } from "@/features/workflows/field-tokens";
import {
  builderFieldSources,
  triggerSampleState,
  type StepSampleInput,
} from "@/features/workflows/field-sources";
import { TokenInput } from "@/features/workflows/field-picker";
import {
  BranchPicker,
  CreateTaskInspector,
  DelayInspector,
  DeleteStepButton,
  FilterInspector,
  HttpInspector,
  NotifyInspector,
  RouterInspector,
} from "@/features/workflows/step-inspectors";
import { TestStepPanel } from "@/features/workflows/test-step-panel";
import {
  compactConditionConfig,
  describeRuleGroup,
  normalizeConditionConfig,
  normalizeRouterConfig,
  validateRouterConfig,
  validateRuleGroup,
} from "@/features/workflows/rule-groups";
import {
  compactDelayConfig,
  compactHttpConfig,
  describeDelay,
  describeHttp,
  normalizeDelayConfig,
  normalizeHttpConfig,
  validateDelayConfig,
  validateHttpConfig,
} from "@/features/workflows/step-config";
import {
  useWebhookEvents,
  useWorkflowWebhook,
} from "@/features/workflows/use-workflow-automation";
import { RunHistory } from "./_components/run-history";
import { TriggerPanel } from "./_components/trigger-panel";

function useT() {
  const { token } = theme.useToken();
  return useMemo(
    () => ({
      border: token.colorBorderSecondary,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      accent: "#4a4ad0",
    }),
    [token],
  );
}

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

type Cfg = Record<string, unknown>;

/** Nice one-line summary of a step's config for the canvas card. */
function stepSummary(step: WorkflowStep, agents: Agent[]): string {
  const cfg = (step.config as Cfg) ?? {};
  if (step.step_type === "agent") {
    const a = agents.find((x) => x.id === cfg.agent_id);
    return a ? `Agent: ${a.name}` : "Agent: (pick one)";
  }
  if (step.step_type === "condition") {
    const c = normalizeConditionConfig(cfg);
    const lead = c.mode === "filter" ? "Continue when" : "Stop unless";
    return `${lead} ${describeRuleGroup(c)}`;
  }
  if (step.step_type === "router") {
    const routes = normalizeRouterConfig(cfg).routes;
    return `${routes.length} route${routes.length === 1 ? "" : "s"}: ${routes
      .map((r) => r.label)
      .join(", ")}`;
  }
  if (step.step_type === "delay") {
    return describeDelay(normalizeDelayConfig(cfg));
  }
  if (step.step_type === "action") {
    if (cfg.action === "create_task") return String(cfg.name ?? "Create a task");
    if (cfg.action === "notify_user") return String(cfg.message ?? "Send a notification");
    return String(cfg.action ?? "action");
  }
  if (step.step_type === "http") return describeHttp(normalizeHttpConfig(cfg));
  if (step.step_type === "app") {
    const action = appActionForStep(cfg);
    if (!action) return "App: (unknown action)";
    const params = (cfg.params ?? {}) as Cfg;
    if (action.key === "sheets.sync") return params.sheet_id ? "Sync the chosen sheet" : "Pick a sheet";
    return action.description;
  }
  return step.step_type;
}

/** The name a step carries on its card and in the field picker. */
function stepTitle(step: WorkflowStep, agents: Agent[]): string {
  const cfg = (step.config as Cfg) ?? {};
  if (step.step_type === "agent")
    return agents.find((a) => a.id === cfg.agent_id)?.name ?? "Agent";
  const builder = builderStepForStep(step.step_type, cfg);
  if (builder) return builder.title;
  const action = appActionForStep(cfg);
  if (action) return action.label;
  return capabilityForStep(step.step_type as StepType, cfg)?.title ?? step.step_type;
}

/** The glyph a step carries on its card. */
function stepIcon(step: WorkflowStep): string {
  const cfg = (step.config as Cfg) ?? {};
  if (step.step_type === "agent") return "smart_toy";
  const builder = builderStepForStep(step.step_type, cfg);
  if (builder) return builder.icon;
  return (
    appActionForStep(cfg)?.icon ?? capabilityForStep(step.step_type as StepType, cfg)?.icon ?? "widgets"
  );
}

/** Whether a step's required config is filled in (drives the ⚠ badge). */
function isStepComplete(step: WorkflowStep, agents: Agent[]): boolean {
  const cfg = (step.config as Cfg) ?? {};
  if (step.step_type === "agent") {
    return agents.some((a) => a.id === cfg.agent_id);
  }
  if (step.step_type === "condition") return validateRuleGroup(normalizeConditionConfig(cfg)) === null;
  if (step.step_type === "router") return validateRouterConfig(normalizeRouterConfig(cfg)) === null;
  if (step.step_type === "delay") return validateDelayConfig(normalizeDelayConfig(cfg)) === null;
  if (step.step_type === "http") return validateHttpConfig(normalizeHttpConfig(cfg)) === null;
  if (step.step_type === "app") return isAppStepComplete(cfg);
  const cap = capabilityForStep(step.step_type as StepType, cfg);
  if (!cap) return false;
  return cap.fields.every(
    (f) =>
      !f.required ||
      (cfg[f.key] !== undefined && String(cfg[f.key] ?? "").trim() !== ""),
  );
}

/* -------------------------------------------------------------------------- */
/* Inspector field renderer.                                                  */
/* -------------------------------------------------------------------------- */

function FieldInput({
  field,
  value,
  onChange,
  members,
  projects,
  groups,
  disabled,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  members: { value: string; label: string }[];
  projects: { value: string; label: string }[];
  groups: FieldGroup[];
  disabled?: boolean;
}) {
  // A text field that can carry data gets the full picker, not a menu of
  // guessed token names: the picker knows what the samples actually contain.
  if (field.supportsInsert && (field.type === "string" || field.type === "text")) {
    return (
      <TokenInput
        label={field.title}
        required={field.required}
        multiline={field.type === "text"}
        rows={3}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        groups={groups}
        disabled={disabled}
        placeholder={field.placeholder}
      />
    );
  }

  let control: React.ReactNode;
  if (field.type === "enum") {
    control = (
      <Select
        style={{ width: "100%" }}
        value={value as string}
        options={field.enumOptions}
        onChange={onChange}
        disabled={disabled}
        placeholder="Select"
      />
    );
  } else if (field.type === "number") {
    control = (
      <InputNumber
        style={{ width: "100%" }}
        value={value as number}
        disabled={disabled}
        onChange={(v) => onChange(v)}
      />
    );
  } else if (field.type === "boolean") {
    control = <Switch checked={Boolean(value)} disabled={disabled} onChange={onChange} />;
  } else if (field.type === "member") {
    control = (
      <MemberSingleSelect
        style={{ width: "100%" }}
        value={(value as string) || undefined}
        options={members}
        disabled={disabled}
        onChange={onChange}
        placeholder="Select member"
      />
    );
  } else if (field.type === "project") {
    control = (
      <Select
        style={{ width: "100%" }}
        showSearch
        optionFilterProp="label"
        value={(value as string) || undefined}
        options={projects}
        disabled={disabled}
        onChange={onChange}
        placeholder="Select project"
      />
    );
  } else if (field.type === "text") {
    control = (
      <Input.TextArea
        rows={3}
        value={(value as string) ?? ""}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    control = (
      <Input
        value={(value as string) ?? ""}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
        {field.title}
        {field.required ? <span style={{ color: "#e0556a" }}> *</span> : null}
      </Typography.Text>
      {control}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Builder page — full-bleed canvas (Pabbly-style layout, cubes colors).    */
/* -------------------------------------------------------------------------- */

const NODE_W = 340;

export default function WorkflowBuilderPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const T = useT();

  const { data: workflow, isLoading: wfLoading } = useWorkflow(workflowId);
  const { data: steps } = useWorkflowSteps(workflowId);
  const { data: agents } = useAgents();
  const { data: members } = useTeamMembers();
  const { data: projects } = useProjects();
  const { data: installedApps } = useInstalledApps();

  const updateWorkflow = useUpdateWorkflow();
  const createStep = useCreateStep();
  const updateStep = useUpdateStep();
  const deleteStep = useDeleteStep();
  const reorderSteps = useReorderSteps();
  const runNow = useRunNow();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const canEdit = Boolean(isTeamAdmin);
  const savePending =
    createStep.isPending || updateStep.isPending || reorderSteps.isPending;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  // Canvas chrome
  const [zoom, setZoom] = useState(1);
  // Drag-to-pan: grab anywhere on the canvas background to move the view.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panDrag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const [pickerAt, setPickerAt] = useState<number | null>(null); // insert index; null = closed
  const [pickerQ, setPickerQ] = useState("");
  const [pickerCat, setPickerCat] = useState<string>("All");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);

  const stepList = useMemo(() => steps ?? [], [steps]);
  const agentList = useMemo(() => agents ?? [], [agents]);
  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
  );
  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const selected = stepList.find((s) => s.id === selectedId) ?? null;
  const selectedIndex = stepList.findIndex((s) => s.id === selectedId);

  /* ------------------------------------------------------------- samples -- */
  // The webhook's capture buffer doubles as the trigger's sample until one is
  // saved, so the field picker is useful the moment a request lands.
  const { data: hook } = useWorkflowWebhook(workflowId, workflow?.trigger_type === "webhook");
  const { data: hookEvents } = useWebhookEvents(hook?.row?.id, { limit: 1 });
  const capturedSample = hookEvents?.row?.[0]?.payload ?? undefined;

  const storedTriggerSample = (workflow as { trigger_sample?: unknown } | undefined)
    ?.trigger_sample;

  const triggerState = useMemo(
    () =>
      triggerSampleState({
        triggerType: workflow?.trigger_type ?? "manual",
        triggerConfig: workflow?.trigger_config,
        storedSample: storedTriggerSample,
        capturedSample,
      }),
    [workflow?.trigger_type, workflow?.trigger_config, storedTriggerSample, capturedSample],
  );

  const sampleSteps = useMemo<StepSampleInput[]>(
    () =>
      stepList.map((s) => {
        const cfg = (s.config as Cfg) ?? {};
        const agent = agentList.find((a) => a.id === cfg.agent_id);
        // An agent has no catalog shape of its own: its outputs are one block
        // per skill it bundles, which is what the run context ends up holding.
        let fallbackSample: unknown;
        if (s.step_type === "agent") {
          const skills = Array.isArray(agent?.skills)
            ? (agent.skills as { skill: string }[])
            : [];
          const shape: Record<string, unknown> = {};
          for (const sk of skills) {
            const desc = skillByKey(sk.skill);
            if (!desc) continue;
            const fields = Object.fromEntries(desc.outputs.map((o) => [o, null]));
            shape[sk.skill] = desc.isList ? [fields] : fields;
          }
          fallbackSample = shape;
        }
        return {
          step_key: s.step_key,
          step_type: s.step_type,
          config: cfg,
          sampleOutput: (s as { sample_output?: unknown }).sample_output,
          label: stepTitle(s, agentList),
          fallbackSample,
        };
      }),
    [stepList, agentList],
  );

  /** The picker's tree for the step at `index` — trigger plus earlier steps. */
  const groupsFor = (index: number): FieldGroup[] =>
    buildFieldTree(builderFieldSources(triggerState, sampleSteps, index));

  /** The nearest router above a step, so the step can pick its route. */
  const routerBefore = (index: number): WorkflowStep | null => {
    for (let i = index - 1; i >= 0; i--) if (stepList[i].step_type === "router") return stepList[i];
    return null;
  };

  const nextStepKey = () => {
    let max = 0;
    for (const s of stepList) {
      const m = /^s(\d+)$/.exec(s.step_key);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `s${max + 1}`;
  };

  /** Adds a step, inserting at `at` (chain index) when given. */
  const addStep = async (
    stepType: string,
    fixedConfig: Record<string, string> | undefined,
    agentId?: string,
    at?: number | null,
  ) => {
    if (createStep.isPending) return;
    try {
      const config: Cfg = { ...(fixedConfig ?? {}) };
      if (agentId) config.agent_id = agentId;
      // App steps start with the catalog defaults, so the step is runnable
      // as soon as it is added (unless it needs a pick, like a sheet).
      if (stepType === "app" && typeof config.action === "string") {
        const params: Cfg = {};
        for (const p of appActionByKey(config.action)?.params ?? []) params[p.key] = p.default;
        config.params = params;
      }
      // The logic steps start from a complete, editable shape rather than {},
      // so the drawer has something to show and the canvas card reads sensibly.
      if (stepType === "condition")
        Object.assign(config, compactConditionConfig(normalizeConditionConfig(config)));
      if (stepType === "router") Object.assign(config, normalizeRouterConfig(null));
      if (stepType === "delay") Object.assign(config, compactDelayConfig(normalizeDelayConfig(null)));
      if (stepType === "http") Object.assign(config, compactHttpConfig(normalizeHttpConfig(null)));
      const created = await createStep.mutateAsync({
        workflowId,
        position: stepList.length + 1,
        stepKey: nextStepKey(),
        stepType,
        config,
      });
      // Mid-chain insert: append happened above; renumber into place.
      if (at != null && at < stepList.length) {
        const ordered = [...stepList.map((s) => s.id)];
        ordered.splice(at, 0, created.id);
        await reorderSteps.mutateAsync({ workflowId, orderedIds: ordered });
      }
      setSelectedId(created.id);
      setPickerAt(null);
    } catch (err) {
      // A step_type the engine has not learned yet comes back as a CHECK
      // violation, which reads like nonsense — say what is actually missing.
      if ((err as { code?: string })?.code === "23514") {
        message.error(
          "This step type needs migration 20261132000000_workflow_automation.sql, which has not been applied here yet.",
        );
        setPickerAt(null);
        return;
      }
      message.error(err instanceof Error ? err.message : "Failed to add step.");
    }
  };

  const saveConfig = async (step: WorkflowStep, config: Cfg) => {
    // Silently dropping the change left a non-admin looking at edits that were
    // never stored and vanished on reload; say so instead.
    if (!canEdit) {
      message.warning("Only workspace admins can change a workflow's steps.");
      return;
    }
    try {
      await updateStep.mutateAsync({ id: step.id, workflowId, config });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save step.");
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= stepList.length) return;
    const ordered = [...stepList];
    const [item] = ordered.splice(index, 1);
    ordered.splice(target, 0, item);
    await reorderSteps.mutateAsync({ workflowId, orderedIds: ordered.map((s) => s.id) });
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      const { runId, status } = await runNow.mutateAsync(workflowId);
      setLastRunId(runId);
      setHistoryOpen(true);
      if (status === "error") message.error("The run failed — see the run history for the step that stopped it.");
      else if (status === "waiting_app" || status === "running" || status === null)
        // null = the /continue call did not come back with a status (the run is
        // started either way and the next runner tick finishes it), so do not
        // claim "complete" for something that may still be working.
        message.info("Run started — app steps are still working; the history updates as they finish.");
      else message.success("Run complete.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  };

  if (wfLoading || !workflow) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active />
      </div>
    );
  }

  /* ------------------------------------------------------------ picker data */
  const pickerCats = ["All", "Agents", "Logic", "Actions", "Apps"];
  const q = pickerQ.trim().toLowerCase();
  const agentTiles = agentList
    .filter((a) => !q || a.name.toLowerCase().includes(q))
    .map((a) => ({
      key: `agent-${a.id}`,
      icon: "smart_toy",
      title: `${a.emoji ?? ""} ${a.name}`.trim(),
      desc: "Runs this agent's configured context pack and stores its outputs.",
      available: true,
      onAdd: () => void addStep("agent", undefined, a.id, pickerAt),
    }));
  const capTiles = BUILDER_STEP_TYPES.filter(
    (c) =>
      (pickerCat === "All" || c.category === pickerCat) &&
      (!q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
  ).map((c) => ({
    key: c.key,
    icon: c.icon,
    title: c.title,
    desc: c.description,
    available: true,
    reason: undefined as string | undefined,
    onAdd: () => void addStep(c.stepType, c.fixedConfig, undefined, pickerAt),
  }));
  const appTiles =
    pickerCat === "All" || pickerCat === "Apps"
      ? appActionTiles(installedApps ?? [])
          .filter((a) => a.appKey !== "")
          .filter(
            (a) =>
              !q || a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
          )
          .map((a) => ({
            key: `app-${a.key}`,
            icon: a.icon,
            title: a.label,
            desc: a.available ? a.description : a.reason ?? a.description,
            available: a.available,
            reason: a.reason,
            onAdd: () => void addStep("app", { action: a.key }, undefined, pickerAt),
          }))
      : [];
  const tiles = [
    ...(pickerCat === "All" || pickerCat === "Agents" ? agentTiles : []),
    ...(pickerCat === "Agents" ? [] : capTiles),
    ...(pickerCat === "Agents" ? [] : appTiles),
  ];

  /* ------------------------------------------------------------- rendering */

  /* ---------------------------------------------------------- trigger card */
  const triggerDescriptor = TRIGGER_KINDS.find((t) => t.value === workflow.trigger_type);
  const triggerIcon = triggerDescriptor?.icon ?? "bolt";
  const triggerEventKey = ((workflow.trigger_config ?? {}) as { event_key?: string }).event_key;
  const triggerText =
    workflow.trigger_type === "schedule"
      ? `${describeSchedule(normalizeScheduleConfig(workflow.trigger_config))} (${
          normalizeScheduleConfig(workflow.trigger_config).timezone
        })`
      : workflow.trigger_type === "event"
        ? (workflowEventByKey(triggerEventKey ?? "")?.label ?? "Pick an event")
        : workflow.trigger_type === "webhook"
          ? hook?.row
            ? hook.row.capture_mode
              ? "Webhook — capturing requests, not running"
              : "Webhook — live"
            : "Webhook — no URL issued yet"
          : "Manual / test run";

  const connector = (at: number) => (
    <div key={`conn-${at}`} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: 2, height: 18, background: token.colorBorder }} />
      <Tooltip title={canEdit ? "Add a step here" : "Read-only"}>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => {
            setPickerAt(at);
            setPickerQ("");
            setPickerCat("All");
          }}
          className="wl-wf-plus"
          aria-label="Add step"
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            border: `1.5px dashed ${token.colorBorder}`,
            background: token.colorBgContainer,
            color: T.accent,
            cursor: canEdit ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PlusOutlined style={{ fontSize: 12 }} />
        </button>
      </Tooltip>
      <div style={{ width: 2, height: 18, background: token.colorBorder }} />
    </div>
  );

  return (
    <div
      style={{
        margin: "-22px -24px -48px",
        height: "calc(100vh - 58px)",
        position: "relative",
        overflow: "hidden",
        background: token.colorBgLayout,
        backgroundImage: `radial-gradient(${token.colorBorderSecondary} 1.1px, transparent 1.1px)`,
        backgroundSize: "22px 22px",
      }}
    >
      {/* Floating title card ------------------------------------------- */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: token.colorBgContainer,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          boxShadow: "0 6px 18px -8px rgba(16,24,40,.14)",
          padding: "8px 10px",
          maxWidth: "min(620px, calc(100vw - 260px))",
        }}
      >
        <Tooltip title="Back to workflows">
          <Button
            type="text"
            size="small"
            icon={<MIcon name="arrow_back" size={17} color={T.textSecondary} />}
            onClick={() => router.push("/workflows")}
            aria-label="Back to workflows"
          />
        </Tooltip>
        <Input
          variant="borderless"
          defaultValue={workflow.name}
          disabled={!canEdit}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== workflow.name)
              void updateWorkflow.mutateAsync({ id: workflow.id, name: v });
          }}
          style={{ fontSize: 15, fontWeight: 600, width: 220 }}
        />
        <Tooltip title="Run history">
          <Button
            type="text"
            size="small"
            icon={<MIcon name="history" size={17} color={T.textSecondary} />}
            onClick={() => setHistoryOpen(true)}
            aria-label="Run history"
          />
        </Tooltip>
        <Tooltip title="Run now">
          <Button
            type="text"
            size="small"
            icon={<ThunderboltOutlined style={{ color: T.accent }} />}
            loading={running}
            disabled={savePending}
            onClick={() => void handleRun()}
            aria-label="Run now"
          />
        </Tooltip>
        <Tooltip title={workflow.enabled ? "Enabled" : "Disabled"}>
          <Switch
            size="small"
            checked={workflow.enabled}
            disabled={!canEdit}
            onChange={(c) => void updateWorkflow.mutateAsync({ id: workflow.id, enabled: c })}
          />
        </Tooltip>
      </div>

      {!canEdit ? (
        <div
          style={{
            position: "absolute",
            top: 18,
            right: 16,
            zIndex: 10,
            background: token.colorWarningBg,
            border: `1px solid ${token.colorWarningBorder}`,
            color: token.colorWarningText,
            fontSize: 12,
            borderRadius: 8,
            padding: "5px 10px",
          }}
        >
          Read-only — only team admins can edit. Test-run is allowed.
        </div>
      ) : null}

      {/* Zoom toolbar --------------------------------------------------- */}
      <div
        style={{
          position: "absolute",
          left: 16,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          background: token.colorBgContainer,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          boxShadow: "0 6px 18px -8px rgba(16,24,40,.12)",
          overflow: "hidden",
        }}
      >
        {[
          { icon: "add", label: "Zoom in", onClick: () => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2))) },
          { icon: "remove", label: "Zoom out", onClick: () => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2))) },
          { icon: "fit_screen", label: "Reset view", onClick: () => { setZoom(1); setPan({ x: 0, y: 0 }); } },
        ].map((b) => (
          <Tooltip key={b.icon} title={b.label} placement="right">
            <button
              type="button"
              onClick={b.onClick}
              aria-label={b.label}
              style={{
                width: 36,
                height: 34,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: T.textSecondary,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MIcon name={b.icon} size={17} />
            </button>
          </Tooltip>
        ))}
        <div style={{ textAlign: "center", fontSize: 10, color: T.textTertiary, padding: "2px 0 6px" }}>
          {Math.round(zoom * 100)}%
        </div>
      </div>

      {/* Canvas — drag anywhere on the background to pan; wheel scrolls. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          padding: "84px 24px 60px",
          cursor: panning ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Only pan from the background — not nodes, buttons, or inputs.
          const el = e.target as HTMLElement;
          if (el.closest(".wl-wf-node, button, input, a, .ant-tag")) return;
          panDrag.current = { startX: e.clientX, startY: e.clientY, ox: pan.x, oy: pan.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setPanning(true);
        }}
        onPointerMove={(e) => {
          const d = panDrag.current;
          if (!d) return;
          setPan({ x: d.ox + e.clientX - d.startX, y: d.oy + e.clientY - d.startY });
        }}
        onPointerUp={() => {
          panDrag.current = null;
          setPanning(false);
        }}
        onPointerCancel={() => {
          panDrag.current = null;
          setPanning(false);
        }}
        onWheel={(e) => {
          setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "top center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* Trigger node */}
          <div
            onClick={() => setTriggerOpen(true)}
            className="wl-wf-node"
            style={{
              width: NODE_W,
              background: token.colorBgContainer,
              border: `1.5px solid ${T.border}`,
              borderRadius: 12,
              boxShadow: "0 4px 14px -8px rgba(16,24,40,.12)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: token.colorPrimaryBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <MIcon name={triggerIcon} size={19} color={T.accent} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Trigger</div>
              <div
                style={{
                  fontSize: 12,
                  color: T.textTertiary,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {triggerText}
              </div>
            </div>
            <Tag style={{ margin: 0 }}>{workflow.trigger_type}</Tag>
          </div>

          {/* Steps */}
          {stepList.length === 0 ? (
            <>
              <div style={{ width: 2, height: 26, background: token.colorBorder }} />
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  setPickerAt(stepList.length);
                  setPickerQ("");
                  setPickerCat("All");
                }}
                style={{
                  width: 130,
                  height: 130,
                  borderRadius: 36,
                  border: "none",
                  background: token.colorTextQuaternary,
                  color: "#fff",
                  cursor: canEdit ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 10px 26px -12px rgba(16,24,40,.25)",
                }}
                aria-label="Add your first step"
              >
                <PlusOutlined style={{ fontSize: 42 }} />
              </button>
              <div style={{ marginTop: 14, fontWeight: 700, fontSize: 18, color: token.colorText }}>
                Add your first step
              </div>
              <div style={{ color: T.textTertiary, fontSize: 13 }}>
                Choose what happens when the trigger fires
              </div>
            </>
          ) : (
            <>
              {stepList.map((s, i) => {
                const icon = stepIcon(s);
                const title = stepTitle(s, agentList);
                const complete = isStepComplete(s, agentList);
                const isSel = s.id === selectedId;
                const branch = (s as WorkflowStep & { branch_key?: string | null }).branch_key;
                const router = routerBefore(i);
                const routeLabel = branch
                  ? normalizeRouterConfig((router?.config as Cfg) ?? {}).routes.find(
                      (r) => r.key === branch,
                    )?.label ?? branch
                  : null;
                return (
                  <div key={s.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    {connector(i)}
                    <div
                      onClick={() => setSelectedId(s.id)}
                      className="wl-wf-node"
                      style={{
                        width: NODE_W,
                        background: token.colorBgContainer,
                        border: `1.5px solid ${isSel ? T.accent : T.border}`,
                        borderRadius: 12,
                        boxShadow: isSel
                          ? "0 6px 18px -8px rgba(74,74,208,.35)"
                          : "0 4px 14px -8px rgba(16,24,40,.12)",
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: "pointer",
                        position: "relative",
                        opacity: s.enabled ? 1 : 0.55,
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          background: complete ? token.colorPrimaryBg : token.colorWarningBg,
                          color: complete ? T.accent : token.colorWarningText,
                          fontSize: 11.5,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flex: "none",
                        }}
                      >
                        {i + 1}
                      </div>
                      <MIcon name={icon} size={19} color={T.textSecondary} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {title}
                          </span>
                          {!complete ? (
                            <Tooltip title="Incomplete configuration">
                              <span style={{ color: token.colorWarningText, fontSize: 12 }}>⚠</span>
                            </Tooltip>
                          ) : null}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: T.textTertiary,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.enabled ? stepSummary(s, agentList) : "Off — this step is skipped."}
                        </div>
                      </div>
                      {routeLabel ? (
                        <Tooltip title="This step only runs on that route">
                          <Tag color="purple" style={{ margin: 0, fontSize: 10.5 }}>
                            {routeLabel}
                          </Tag>
                        </Tooltip>
                      ) : null}
                      <Tag style={{ margin: 0, fontSize: 10.5 }}>{s.step_key}</Tag>
                      {canEdit ? (
                        <div className="wl-wf-actions" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <Tooltip title={s.enabled ? "Turn this step off" : "Turn this step on"}>
                            <Switch
                              size="small"
                              checked={s.enabled}
                              onClick={(_checked, e) => e.stopPropagation()}
                              onChange={(checked) =>
                                void updateStep
                                  .mutateAsync({ id: s.id, workflowId, enabled: checked })
                                  .catch((err: unknown) =>
                                    message.error(
                                      err instanceof Error ? err.message : "Could not change the step.",
                                    ),
                                  )
                              }
                            />
                          </Tooltip>
                          <Button
                            type="text"
                            size="small"
                            icon={<ArrowUpOutlined style={{ fontSize: 11 }} />}
                            disabled={i === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              void move(i, -1);
                            }}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={<ArrowDownOutlined style={{ fontSize: 11 }} />}
                            disabled={i === stepList.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              void move(i, 1);
                            }}
                          />
                          <Popconfirm
                            title="Delete this step?"
                            okText="Delete"
                            okButtonProps={{ danger: true }}
                            onConfirm={() =>
                              void deleteStep.mutateAsync({ id: s.id, workflowId }).then(() => {
                                if (selectedId === s.id) setSelectedId(null);
                              })
                            }
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              aria-label="Delete step"
                              icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Popconfirm>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {connector(stepList.length)}
              <div style={{ color: T.textTertiary, fontSize: 12 }}>End</div>
            </>
          )}
        </div>
      </div>

      {/* Step picker drawer --------------------------------------------- */}
      <Drawer
        title="Add a step"
        placement="right"
        width={520}
        open={pickerAt !== null}
        onClose={() => setPickerAt(null)}
      >
        <Input
          allowClear
          autoFocus
          placeholder="Search steps and agents…"
          value={pickerQ}
          onChange={(e) => setPickerQ(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <Segmented
          block
          value={pickerCat}
          onChange={(v) => setPickerCat(String(v))}
          options={pickerCats}
          style={{ marginBottom: 14 }}
        />
        {tiles.length === 0 ? (
          <Typography.Text type="secondary">No matches.</Typography.Text>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {tiles.map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={!t.available || !canEdit}
                onClick={t.onAdd}
                className="wl-wf-tile"
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  background: token.colorBgContainer,
                  padding: "14px 12px",
                  cursor: t.available && canEdit ? "pointer" : "not-allowed",
                  opacity: t.available ? 1 : 0.55,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 11,
                    background: token.colorPrimaryBg,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 8,
                  }}
                >
                  <MIcon name={t.icon} size={21} color={T.accent} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {t.title}
                  {!t.available ? (
                    <Tag style={{ marginInlineStart: 6, fontSize: 10 }}>
                      {"reason" in t && t.reason ? "Install app" : "Soon"}
                    </Tag>
                  ) : null}
                </div>
                <div style={{ fontSize: 11.5, color: T.textTertiary, marginTop: 3 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        )}
        {agentList.length === 0 && (pickerCat === "All" || pickerCat === "Agents") ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
            No agents yet — <a onClick={() => router.push("/workflows/agents")}>create one</a> to add
            AI/report steps.
          </Typography.Paragraph>
        ) : null}
      </Drawer>

      {/* Inspector drawer ------------------------------------------------ */}
      <Drawer
        title={
          selected ? `${stepTitle(selected, agentList)} — ${selected.step_key}` : "Configure"
        }
        placement="right"
        width={480}
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        extra={
          selected ? (
            <Tooltip title={selected.enabled ? "Step is on" : "Step is off"}>
              <Switch
                size="small"
                checked={selected.enabled}
                disabled={!canEdit}
                onChange={(checked) =>
                  void updateStep
                    .mutateAsync({ id: selected.id, workflowId, enabled: checked })
                    .catch((err: unknown) =>
                      message.error(
                        err instanceof Error ? err.message : "Could not change the step.",
                      ),
                    )
                }
              />
            </Tooltip>
          ) : null
        }
      >
        {selected ? (
          <Inspector
            key={selected.id}
            step={selected}
            index={selectedIndex}
            workflowId={workflowId}
            agents={agentList}
            members={memberOptions}
            projects={projectOptions}
            groups={groupsFor(selectedIndex)}
            routerBefore={routerBefore(selectedIndex)}
            readOnly={!canEdit}
            onSave={(cfg) => void saveConfig(selected, cfg)}
            onBranchChange={(key) =>
              // workflow_steps_branch_check: a branch_key is only legal with the
              // parent router's id alongside it, so the two are always written
              // together.
              void updateStep
                .mutateAsync({
                  id: selected.id,
                  workflowId,
                  branchKey: key,
                  parentStepId: key ? (routerBefore(selectedIndex)?.id ?? null) : null,
                })
                .catch((err: unknown) =>
                  message.error(
                    (err as { code?: string })?.code === "42703"
                      ? "Routes need migration 20261132000000_workflow_automation.sql, which has not been applied here yet."
                      : err instanceof Error
                        ? err.message
                        : "Could not set the route.",
                  ),
                )
            }
            onDelete={() =>
              void deleteStep
                .mutateAsync({ id: selected.id, workflowId })
                .then(() => setSelectedId(null))
            }
          />
        ) : null}
      </Drawer>

      {/* Trigger drawer -------------------------------------------------- */}
      <Drawer
        title="Trigger"
        placement="right"
        width={480}
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
      >
        <TriggerPanel
          workflow={workflow}
          canEdit={canEdit}
          trigger={triggerState}
          storedSample={storedTriggerSample}
        />
      </Drawer>

      {/* Run history drawer ---------------------------------------------- */}
      <Drawer
        title="Run history"
        placement="right"
        width={560}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <RunHistory workflowId={workflowId} highlightRunId={lastRunId} canReplay={canEdit} />
      </Drawer>

      <style>{`
        .wl-wf-node .wl-wf-actions { opacity: 0; transition: opacity .12s ease; }
        .wl-wf-node:hover .wl-wf-actions { opacity: 1; }
        .wl-wf-plus { transition: transform .12s ease, border-color .12s ease; }
        .wl-wf-plus:hover { transform: scale(1.12); border-color: #4a4ad0; }
        .wl-wf-tile { transition: border-color .12s ease, box-shadow .12s ease; }
        .wl-wf-tile:hover { border-color: ${token.colorPrimaryBorder}; box-shadow: 0 4px 14px -8px rgba(74,74,208,.3); }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspector — one drawer body per step type, all sharing the field picker.   */
/* -------------------------------------------------------------------------- */

function Inspector({
  step,
  index,
  workflowId,
  agents,
  members,
  projects,
  groups,
  routerBefore,
  readOnly,
  onSave,
  onDelete,
  onBranchChange,
}: {
  step: WorkflowStep;
  index: number;
  workflowId: string;
  agents: Agent[];
  members: { value: string; label: string }[];
  projects: { value: string; label: string }[];
  groups: FieldGroup[];
  /** The nearest router above this step, when there is one. */
  routerBefore: WorkflowStep | null;
  /** Non-admins may look but not change: the save is refused by RLS anyway. */
  readOnly?: boolean;
  onSave: (cfg: Cfg) => void;
  onDelete: () => void;
  /** Writes workflow_steps.branch_key — a column, not part of the config. */
  onBranchChange: (key: string | null) => void;
}) {
  const [draft, setDraft] = useState<Cfg>((step.config as Cfg) ?? {});
  const cfg = (step.config as Cfg) ?? {};

  const set = (key: string, value: unknown) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onSave(next);
  };

  const branch = (step as WorkflowStep & { branch_key?: string | null }).branch_key ?? null;
  const incomplete = !isStepComplete(step, agents);

  let body: React.ReactNode;

  if (step.step_type === "agent") {
    body = (
      <div>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Agent step
        </Typography.Title>
        <Typography.Text style={{ fontSize: 13 }}>Agent</Typography.Text>
        <Select
          style={{ width: "100%", marginTop: 4 }}
          value={(draft.agent_id as string) || undefined}
          disabled={readOnly}
          options={agents.map((a) => ({ value: a.id, label: `${a.emoji ?? ""} ${a.name}`.trim() }))}
          onChange={(v) => set("agent_id", v)}
          placeholder="Select an agent"
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 10 }}>
          The agent runs its configured context pack and writes its results into{" "}
          <code>steps.{step.step_key}.*</code> for later steps.
        </Typography.Paragraph>
      </div>
    );
  } else if (step.step_type === "condition") {
    body = (
      <FilterInspector config={cfg} groups={groups} disabled={readOnly} onSave={onSave} />
    );
  } else if (step.step_type === "router") {
    body = (
      <RouterInspector
        config={cfg}
        groups={groups}
        disabled={readOnly}
        onSave={onSave}
        stepKey={step.step_key}
      />
    );
  } else if (step.step_type === "delay") {
    body = <DelayInspector config={cfg} groups={groups} disabled={readOnly} onSave={onSave} />;
  } else if (step.step_type === "http" || (step.step_type === "app" && cfg.action === "http.request")) {
    body = (
      <HttpInspector
        config={cfg}
        groups={groups}
        disabled={readOnly}
        onSave={onSave}
        stepKey={step.step_key}
      />
    );
  } else if (step.step_type === "app") {
    body = (
      <AppStepInspector
        stepKey={step.step_key}
        config={draft}
        groups={groups}
        disabled={readOnly}
        onSave={onSave}
      />
    );
  } else if (step.step_type === "action" && cfg.action === "notify_user") {
    body = (
      <NotifyInspector
        config={cfg}
        groups={groups}
        disabled={readOnly}
        onSave={onSave}
        members={members}
      />
    );
  } else if (step.step_type === "action" && cfg.action === "create_task") {
    body = (
      <CreateTaskInspector
        config={cfg}
        groups={groups}
        disabled={readOnly}
        onSave={onSave}
        projects={projects}
      />
    );
  } else {
    const cap: StepCapability | undefined = capabilityForStep(step.step_type as StepType, cfg);
    body = cap ? (
      <div>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {cap.title}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          {cap.description}
        </Typography.Paragraph>
        {cap.fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={draft[f.key]}
            onChange={(v) => set(f.key, v)}
            members={members}
            projects={projects}
            groups={groups}
            disabled={readOnly}
          />
        ))}
      </div>
    ) : (
      <Typography.Text type="secondary">
        This step type ({step.step_type}) has no editable config yet.
      </Typography.Text>
    );
  }

  return (
    <div>
      {routerBefore ? (
        <BranchPicker
          routerConfig={(routerBefore.config as Cfg) ?? {}}
          value={branch}
          disabled={readOnly}
          onChange={onBranchChange}
        />
      ) : null}

      {body}

      <TestStepPanel
        stepId={step.id}
        workflowId={workflowId}
        disabled={readOnly}
        blockedReason={
          incomplete ? "Finish this step's settings before testing it." : null
        }
      />

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <Typography.Text type="secondary" style={{ fontSize: 11.5, flex: 1 }}>
          Step {index + 1} · <code>{step.step_key}</code>
        </Typography.Text>
        <DeleteStepButton disabled={readOnly} onConfirm={onDelete} />
      </div>
    </div>
  );
}
