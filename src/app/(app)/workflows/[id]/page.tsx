"use client";

import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  App,
  Button,
  Drawer,
  Dropdown,
  Input,
  InputNumber,
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
  CONDITION_OPS,
  STEP_CAPABILITIES,
  capabilityForStep,
  skillByKey,
  type FieldDef,
  type StepCapability,
  type StepType,
} from "@/lib/workflows/capabilities";
import { RunHistory } from "./_components/run-history";

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
function stepSummary(
  step: WorkflowStep,
  agents: Agent[],
  steps: WorkflowStep[],
  index: number,
): string {
  const cfg = (step.config as Cfg) ?? {};
  if (step.step_type === "agent") {
    const a = agents.find((x) => x.id === cfg.agent_id);
    return a ? `Agent: ${a.name}` : "Agent: (pick one)";
  }
  if (step.step_type === "condition") {
    const left = cfg.left
      ? tokenDisplay(String(cfg.left), steps, index, agents)
      : "…";
    const op = CONDITION_OPS.find((o) => o.value === cfg.op)?.label ?? "?";
    return `Continue if ${left} ${op} ${cfg.right ?? "…"}`;
  }
  if (step.step_type === "action") {
    return String(cfg.action ?? "action");
  }
  return step.step_type;
}

/** Whether a step's required config is filled in (drives the ⚠ badge). */
function isStepComplete(step: WorkflowStep, agents: Agent[]): boolean {
  const cfg = (step.config as Cfg) ?? {};
  if (step.step_type === "agent") {
    return agents.some((a) => a.id === cfg.agent_id);
  }
  const cap = capabilityForStep(step.step_type as StepType, cfg);
  if (!cap) return false;
  return cap.fields.every(
    (f) =>
      !f.required ||
      (cfg[f.key] !== undefined && String(cfg[f.key] ?? "").trim() !== ""),
  );
}

/** "leave_pending" → "Leave pending" — plain words for non-technical users. */
function humanize(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Tokens the "Insert data" picker offers, from upstream steps' outputs. */
function upstreamTokens(
  steps: WorkflowStep[],
  currentIndex: number,
  agents: Agent[],
): { label: string; tokens: { label: string; token: string }[] }[] {
  const groups: { label: string; tokens: { label: string; token: string }[] }[] = [];
  for (let i = 0; i < currentIndex; i++) {
    const s = steps[i];
    const cfg = (s.config as Cfg) ?? {};
    const tokens: { label: string; token: string }[] = [];
    let stepTitle = s.step_key;
    if (s.step_type === "agent") {
      const a = agents.find((x) => x.id === cfg.agent_id);
      if (a) stepTitle = a.name;
      const skills = Array.isArray(a?.skills) ? (a!.skills as { skill: string }[]) : [];
      for (const sk of skills) {
        const desc = skillByKey(sk.skill);
        if (!desc) continue;
        if (desc.isList) {
          tokens.push({ label: `${desc.title} (list)`, token: `steps.${s.step_key}.${sk.skill}` });
        } else {
          for (const out of desc.outputs) {
            tokens.push({
              label: `${desc.title} · ${humanize(out)}`,
              token: `steps.${s.step_key}.${sk.skill}.${out}`,
            });
          }
        }
      }
    } else if (s.step_type === "condition") {
      stepTitle = "Condition";
      tokens.push({ label: "Condition passed", token: `steps.${s.step_key}.passed` });
    } else if (s.step_type === "action" && cfg.action === "notify_user") {
      stepTitle = "Notify member";
      tokens.push({ label: "Notification sent", token: `steps.${s.step_key}.notified` });
    } else if (s.step_type === "action" && cfg.action === "create_task") {
      stepTitle = "Create task";
      tokens.push({ label: "Created task id", token: `steps.${s.step_key}.task_id` });
    }
    if (tokens.length) groups.push({ label: `Step ${i + 1} · ${stepTitle}`, tokens });
  }
  return groups;
}

/** Friendly label for a stored "{{steps.…}}" value (or the raw text itself). */
function tokenDisplay(
  value: string,
  steps: WorkflowStep[],
  stepIndex: number,
  agents: Agent[],
): string {
  const m = /^\{\{(.+)\}\}$/.exec(value.trim());
  if (!m) return value;
  for (const g of upstreamTokens(steps, stepIndex, agents)) {
    const hit = g.tokens.find((t) => t.token === m[1]);
    if (hit) return hit.label;
  }
  return value;
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
  insertGroups,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  members: { value: string; label: string }[];
  projects: { value: string; label: string }[];
  insertGroups: { label: string; tokens: { label: string; token: string }[] }[];
}) {
  const insertMenu =
    field.supportsInsert && insertGroups.length > 0 ? (
      <Dropdown
        trigger={["click"]}
        menu={{
          items: insertGroups.map((g) => ({
            key: g.label,
            type: "group" as const,
            label: g.label,
            children: g.tokens.map((t) => ({
              key: t.token,
              label: t.label,
              onClick: () =>
                onChange(`${typeof value === "string" ? value : ""}{{${t.token}}}`),
            })),
          })),
        }}
      >
        <Button size="small" type="link" style={{ padding: 0 }}>
          Insert data
        </Button>
      </Dropdown>
    ) : null;

  let control: React.ReactNode;
  if (field.type === "enum") {
    control = (
      <Select
        style={{ width: "100%" }}
        value={value as string}
        options={field.enumOptions}
        onChange={onChange}
        placeholder="Select"
      />
    );
  } else if (field.type === "number") {
    control = (
      <InputNumber
        style={{ width: "100%" }}
        value={value as number}
        onChange={(v) => onChange(v)}
      />
    );
  } else if (field.type === "boolean") {
    control = <Switch checked={Boolean(value)} onChange={onChange} />;
  } else if (field.type === "member") {
    control = (
      <MemberSingleSelect
        style={{ width: "100%" }}
        value={(value as string) || undefined}
        options={members}
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
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    control = (
      <Input
        value={(value as string) ?? ""}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <Typography.Text style={{ fontSize: 13 }}>
          {field.title}
          {field.required ? <span style={{ color: "#e0556a" }}> *</span> : null}
        </Typography.Text>
        {insertMenu}
      </div>
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
    stepType: StepType,
    fixedConfig: Record<string, string> | undefined,
    agentId?: string,
    at?: number | null,
  ) => {
    if (createStep.isPending) return;
    try {
      const config: Cfg = { ...(fixedConfig ?? {}) };
      if (agentId) config.agent_id = agentId;
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
      message.error(err instanceof Error ? err.message : "Failed to add step.");
    }
  };

  const saveConfig = async (step: WorkflowStep, config: Cfg) => {
    if (!canEdit) return;
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
      const runId = await runNow.mutateAsync(workflowId);
      setLastRunId(runId);
      setHistoryOpen(true);
      message.success("Run complete — 0 AI tokens used.");
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
  const pickerCats = ["All", "Agents", "Logic", "Actions", "Apps", "Human"];
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
  const capTiles = STEP_CAPABILITIES.filter(
    (c) =>
      (pickerCat === "All" || c.category === pickerCat) &&
      (!q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
  ).map((c) => ({
    key: c.key,
    icon: c.icon,
    title: c.title,
    desc: c.description,
    available: c.available,
    onAdd: () => void addStep(c.stepType, c.fixedConfig, undefined, pickerAt),
  }));
  const tiles = [
    ...(pickerCat === "All" || pickerCat === "Agents" ? agentTiles : []),
    ...(pickerCat === "Agents" ? [] : capTiles),
  ];

  /* ------------------------------------------------------------- rendering */

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
        <Tooltip title="Test run">
          <Button
            type="text"
            size="small"
            icon={<ThunderboltOutlined style={{ color: T.accent }} />}
            loading={running}
            disabled={savePending}
            onClick={() => void handleRun()}
            aria-label="Test run"
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
              <MIcon name="bolt" size={19} color={T.accent} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Trigger</div>
              <div style={{ fontSize: 12, color: T.textTertiary }}>
                {workflow.trigger_type === "schedule"
                  ? "On a schedule"
                  : workflow.trigger_type === "event"
                    ? "On a task event"
                    : "Manual / test run"}
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
                const cap = capabilityForStep(s.step_type as StepType, (s.config as Cfg) ?? {});
                const icon = s.step_type === "agent" ? "smart_toy" : cap?.icon ?? "widgets";
                const title =
                  s.step_type === "agent"
                    ? agentList.find((a) => a.id === ((s.config as Cfg)?.agent_id as string))?.name ?? "Agent"
                    : cap?.title ?? s.step_type;
                const complete = isStepComplete(s, agentList);
                const isSel = s.id === selectedId;
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
                          {stepSummary(s, agentList, stepList, i)}
                        </div>
                      </div>
                      <Tag style={{ margin: 0, fontSize: 10.5 }}>{s.step_key}</Tag>
                      {canEdit ? (
                        <div className="wl-wf-actions" style={{ display: "flex", gap: 0 }}>
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
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteStep
                                .mutateAsync({ id: s.id, workflowId })
                                .then(() => {
                                  if (selectedId === s.id) setSelectedId(null);
                                });
                            }}
                          />
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
                    <Tag style={{ marginInlineStart: 6, fontSize: 10 }}>Soon</Tag>
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
        title={selected ? `Configure — ${selected.step_key}` : "Configure"}
        placement="right"
        width={420}
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
      >
        {selected ? (
          <Inspector
            key={selected.id}
            step={selected}
            agents={agentList}
            members={memberOptions}
            projects={projectOptions}
            insertGroups={upstreamTokens(stepList, selectedIndex, agentList)}
            onSave={(cfg) => void saveConfig(selected, cfg)}
          />
        ) : null}
      </Drawer>

      {/* Trigger drawer -------------------------------------------------- */}
      <Drawer
        title="Trigger"
        placement="right"
        width={380}
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          What starts this workflow.
        </Typography.Paragraph>
        <Typography.Text style={{ fontSize: 13 }}>Trigger type</Typography.Text>
        <Select
          style={{ width: "100%", marginTop: 4 }}
          value={workflow.trigger_type}
          disabled={!canEdit}
          onChange={(v) => void updateWorkflow.mutateAsync({ id: workflow.id, trigger_type: v })}
          options={[
            { value: "manual", label: "Manual / test run" },
            { value: "schedule", label: "On a schedule" },
            { value: "event", label: "On a task event" },
          ]}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
          <Typography.Text style={{ fontSize: 13, flex: 1 }}>Enabled</Typography.Text>
          <Switch
            size="small"
            checked={workflow.enabled}
            disabled={!canEdit}
            onChange={(c) => void updateWorkflow.mutateAsync({ id: workflow.id, enabled: c })}
          />
        </div>
      </Drawer>

      {/* Run history drawer ---------------------------------------------- */}
      <Drawer
        title="Run history"
        placement="right"
        width={560}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <RunHistory workflowId={workflowId} highlightRunId={lastRunId} />
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
/* Inspector (unchanged).                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Point-and-click condition editor for non-technical users: pick a value that
 * an earlier step produced, choose a plain-language comparison, type the
 * number/text to compare against — and read the sentence it makes. The raw
 * "{{steps.…}}" template stays available behind an "advanced" toggle and old
 * configs load into it automatically.
 */
function ConditionBuilder({
  draft,
  set,
  insertGroups,
}: {
  draft: Cfg;
  set: (key: string, value: unknown) => void;
  insertGroups: { label: string; tokens: { label: string; token: string }[] }[];
}) {
  const { token } = theme.useToken();
  const T = useT();
  const left = typeof draft.left === "string" ? draft.left : "";
  const selectOptions = insertGroups.map((g) => ({
    label: g.label,
    options: g.tokens.map((t) => ({ value: `{{${t.token}}}`, label: t.label })),
  }));
  const knownValues = insertGroups.flatMap((g) => g.tokens.map((t) => `{{${t.token}}}`));
  // Old / hand-written configs that aren't a known token open in advanced mode.
  const [advanced, setAdvanced] = useState(() => Boolean(left) && !knownValues.includes(left));

  const leftLabel = left
    ? insertGroups.flatMap((g) => g.tokens).find((t) => `{{${t.token}}}` === left)?.label ?? left
    : null;
  const opLabel = CONDITION_OPS.find((o) => o.value === draft.op)?.label ?? null;
  const right = draft.right === undefined || draft.right === null ? "" : String(draft.right);

  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Condition
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        The workflow continues past this step only when the check below is true.
      </Typography.Paragraph>

      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <Typography.Text style={{ fontSize: 13 }}>
            Check this value<span style={{ color: "#e0556a" }}> *</span>
          </Typography.Text>
          <Button
            size="small"
            type="link"
            style={{ padding: 0, fontSize: 12 }}
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? "Pick from a list" : "Type a custom value"}
          </Button>
        </div>
        {advanced ? (
          <Input
            value={left}
            placeholder="A number, text, or {{data from a step}}"
            onChange={(e) => set("left", e.target.value)}
          />
        ) : insertGroups.length === 0 ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: 0 }}>
            No data to check yet — add a step <b>before</b> this one that produces
            data (for example an agent report), and its numbers will show up here.
          </Typography.Paragraph>
        ) : (
          <Select
            style={{ width: "100%" }}
            showSearch
            optionFilterProp="label"
            placeholder="Pick data from a previous step"
            value={knownValues.includes(left) ? left : undefined}
            options={selectOptions}
            onChange={(v) => set("left", v)}
          />
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <Typography.Text style={{ fontSize: 13 }}>
          Comparison<span style={{ color: "#e0556a" }}> *</span>
        </Typography.Text>
        <Select
          style={{ width: "100%", marginTop: 4 }}
          placeholder="How to compare"
          value={(draft.op as string) || undefined}
          options={CONDITION_OPS}
          onChange={(v) => set("op", v)}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Typography.Text style={{ fontSize: 13 }}>Compared to</Typography.Text>
        <Input
          style={{ marginTop: 4 }}
          value={right}
          placeholder="e.g. 0"
          onChange={(e) => set("right", e.target.value)}
        />
      </div>

      {leftLabel && opLabel ? (
        <div
          style={{
            background: token.colorFillTertiary,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12.5,
            lineHeight: 1.55,
            color: T.textSecondary,
          }}
        >
          Continue only when <b>{leftLabel}</b> {opLabel} <b>{right || "…"}</b>.
          Otherwise the run stops here.
        </div>
      ) : null}
    </div>
  );
}

function Inspector({
  step,
  agents,
  members,
  projects,
  insertGroups,
  onSave,
}: {
  step: WorkflowStep;
  agents: Agent[];
  members: { value: string; label: string }[];
  projects: { value: string; label: string }[];
  insertGroups: { label: string; tokens: { label: string; token: string }[] }[];
  onSave: (cfg: Cfg) => void;
}) {
  const [draft, setDraft] = useState<Cfg>((step.config as Cfg) ?? {});

  const set = (key: string, value: unknown) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onSave(next);
  };

  if (step.step_type === "agent") {
    return (
      <div>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Agent step
        </Typography.Title>
        <Typography.Text style={{ fontSize: 13 }}>Agent</Typography.Text>
        <Select
          style={{ width: "100%", marginTop: 4 }}
          value={(draft.agent_id as string) || undefined}
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
  }

  if (step.step_type === "condition") {
    return <ConditionBuilder draft={draft} set={set} insertGroups={insertGroups} />;
  }

  const cap: StepCapability | undefined = capabilityForStep(
    step.step_type as StepType,
    (step.config as Cfg) ?? {},
  );
  if (!cap) {
    return (
      <Typography.Text type="secondary">
        This step type ({step.step_type}) has no editable config yet.
      </Typography.Text>
    );
  }

  return (
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
          insertGroups={insertGroups}
        />
      ))}
    </div>
  );
}
