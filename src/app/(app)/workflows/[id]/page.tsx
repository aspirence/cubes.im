"use client";

import { useMemo, useState } from "react";
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
  STEP_CAPABILITIES,
  capabilityForStep,
  skillByKey,
  type FieldDef,
  type StepCapability,
  type StepType,
} from "@/lib/workflows/capabilities";
import { RunHistory } from "./_components/run-history";

const T = {
  border: "#ececf0",
  panel: "#fbfbfc",
  textSecondary: "#6a6d78",
  textTertiary: "#9a9da8",
  accent: "#4a4ad0",
};

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
    return `${cfg.left ?? "…"} ${cfg.op ?? "?"} ${cfg.right ?? "…"}`;
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
    if (s.step_type === "agent") {
      const a = agents.find((x) => x.id === cfg.agent_id);
      const skills = Array.isArray(a?.skills) ? (a!.skills as { skill: string }[]) : [];
      for (const sk of skills) {
        const desc = skillByKey(sk.skill);
        if (!desc) continue;
        if (desc.isList) {
          tokens.push({ label: `${desc.title} (list)`, token: `steps.${s.step_key}.${sk.skill}` });
        } else {
          for (const out of desc.outputs) {
            tokens.push({
              label: `${desc.title} → ${out}`,
              token: `steps.${s.step_key}.${sk.skill}.${out}`,
            });
          }
        }
      }
    } else if (s.step_type === "condition") {
      tokens.push({ label: "passed", token: `steps.${s.step_key}.passed` });
    } else if (s.step_type === "action" && cfg.action === "notify_user") {
      tokens.push({ label: "notified", token: `steps.${s.step_key}.notified` });
    } else if (s.step_type === "action" && cfg.action === "create_task") {
      tokens.push({ label: "task_id", token: `steps.${s.step_key}.task_id` });
    }
    if (tokens.length) groups.push({ label: s.step_key, tokens });
  }
  return groups;
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
      <div style={{ width: 2, height: 18, background: "#d9dbe3" }} />
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
            border: "1.5px dashed #b9bcc9",
            background: "#fff",
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
      <div style={{ width: 2, height: 18, background: "#d9dbe3" }} />
    </div>
  );

  return (
    <div
      style={{
        margin: "-22px -24px -48px",
        height: "calc(100vh - 58px)",
        position: "relative",
        overflow: "hidden",
        background: "#f6f7f9",
        backgroundImage: "radial-gradient(#d9dbe3 1.1px, transparent 1.1px)",
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
          background: "#fff",
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
            background: "#fff8e6",
            border: "1px solid #f5dd9b",
            color: "#8a6d1a",
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
          background: "#fff",
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          boxShadow: "0 6px 18px -8px rgba(16,24,40,.12)",
          overflow: "hidden",
        }}
      >
        {[
          { icon: "add", label: "Zoom in", onClick: () => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2))) },
          { icon: "remove", label: "Zoom out", onClick: () => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2))) },
          { icon: "fit_screen", label: "Reset zoom", onClick: () => setZoom(1) },
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

      {/* Canvas ---------------------------------------------------------- */}
      <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "84px 24px 60px" }}>
        <div
          style={{
            transform: `scale(${zoom})`,
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
              background: "#fff",
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
                background: "#eceefb",
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
              <div style={{ width: 2, height: 26, background: "#d9dbe3" }} />
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
                  background: "#c9cddb",
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
              <div style={{ marginTop: 14, fontWeight: 700, fontSize: 18, color: "#3a3a42" }}>
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
                        background: "#fff",
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
                          background: complete ? "#eceefb" : "#fdf5e6",
                          color: complete ? T.accent : "#b8842a",
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
                              <span style={{ color: "#b8842a", fontSize: 12 }}>⚠</span>
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
                          {stepSummary(s, agentList)}
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
                  background: "#fff",
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
                    background: "#eceefb",
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
        .wl-wf-tile:hover { border-color: #c6c8f0; box-shadow: 0 4px 14px -8px rgba(74,74,208,.3); }
      `}</style>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspector (unchanged).                                                     */
/* -------------------------------------------------------------------------- */

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
