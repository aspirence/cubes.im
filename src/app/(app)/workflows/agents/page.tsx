"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  Upload,
  theme,
} from "antd";
import type { GlobalToken, UploadProps } from "antd";
import {
  DeleteOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { AgentMentionsInput } from "@/app/(app)/workflows/agents/_components/agent-mentions-input";
import {
  AGENT_CONTEXTS,
  extractAgentMentions,
  getAgentContext,
  readAgentConfig,
  serializeAgentConfig,
  type AgentConfig,
  type AgentTrainingTask,
} from "@/features/workflows/agent-config";
import {
  useAgents,
  useCreateAgent,
  useDeleteAgent,
  useRunAgent,
  useUpdateAgent,
  useUploadAgentMascot,
  type Agent,
  type RunAgentResult,
} from "@/features/workflows/use-agents";
import { useCreateAgentFromTemplate, type OpsAgent } from "@/features/workflows/use-ops-manager";
import { AGENT_TEMPLATES } from "@/features/workflows/agent-templates";
import { OpsInsightsPanel } from "./_components/ops-insights-panel";
import { AgentGallery } from "./_components/agent-gallery";

interface AgentBasicsForm {
  name: string;
  description?: string;
  model?: string;
  systemPrompt?: string;
}

interface AgentDraft {
  name: string;
  description: string;
  emoji: string;
  config: AgentConfig;
}

function agentToDraft(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    description: agent.description ?? "",
    emoji: agent.emoji ?? "🤖",
    config: readAgentConfig(agent.data_scope),
  };
}

function draftSnapshot(draft: AgentDraft | null) {
  if (!draft) return "";
  return JSON.stringify({
    name: draft.name.trim(),
    description: draft.description.trim(),
    emoji: draft.emoji,
    dataScope: serializeAgentConfig(draft.config),
  });
}

function storedSnapshot(agent: Agent | null) {
  if (!agent) return "";
  const draft = agentToDraft(agent);
  return draftSnapshot(draft);
}

function newTrainingTask(): AgentTrainingTask {
  return {
    id: crypto.randomUUID(),
    title: "New task",
    instruction: "",
    mentions: [],
    expectedOutput: null,
    enabled: true,
  };
}

async function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function renderMascot(
  name: string,
  src: string | null | undefined,
  size: number,
  token: GlobalToken,
) {
  return (
    <Avatar
      src={src ?? undefined}
      size={size}
      icon={!src ? <RobotOutlined /> : undefined}
      style={{
        background: src ? token.colorBgContainer : "linear-gradient(135deg, #4a4ad0 0%, #7c6cff 100%)",
        flex: "0 0 auto",
      }}
    >
      {!src ? name.slice(0, 1).toUpperCase() : null}
    </Avatar>
  );
}

export default function AgentsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { data: agents, isLoading } = useAgents();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const uploadMascot = useUploadAgentMascot();
  const runAgent = useRunAgent();
  const createFromTemplate = useCreateAgentFromTemplate();

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [playgroundTaskId, setPlaygroundTaskId] = useState<string | null>(null);
  const [playgroundPrompt, setPlaygroundPrompt] = useState("");
  const [lastRun, setLastRun] = useState<RunAgentResult | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createMascotFile, setCreateMascotFile] = useState<File | null>(null);
  const [createMascotPreview, setCreateMascotPreview] = useState<string | null>(null);
  const [pendingMascotFile, setPendingMascotFile] = useState<File | null>(null);
  const [pendingMascotPreview, setPendingMascotPreview] = useState<string | null>(null);

  const [createForm] = Form.useForm<AgentBasicsForm>();
  const createName = Form.useWatch("name", createForm) ?? "";

  const agentList = useMemo(() => agents ?? [], [agents]);
  const selectedAgent = useMemo(
    () => agentList.find((agent) => agent.id === selectedAgentId) ?? null,
    [agentList, selectedAgentId],
  );
  const currentTask = useMemo(
    () => draft?.config.trainingTasks.find((task) => task.id === selectedTaskId) ?? null,
    [draft, selectedTaskId],
  );

  const isDirty = useMemo(
    () =>
      Boolean(
        selectedAgent &&
          draft &&
          (draftSnapshot(draft) !== storedSnapshot(selectedAgent) || pendingMascotFile),
      ),
    [draft, pendingMascotFile, selectedAgent],
  );

  useEffect(() => {
    if (!agentList.length) {
      setSelectedAgentId(null);
      setDraft(null);
      return;
    }
    if (!selectedAgentId || !agentList.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agentList[0].id);
    }
  }, [agentList, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgent) return;
    const nextDraft = agentToDraft(selectedAgent);
    setDraft(nextDraft);
    setSelectedTaskId(nextDraft.config.trainingTasks[0]?.id ?? null);
    setPlaygroundTaskId(nextDraft.config.trainingTasks[0]?.id ?? null);
    setPendingMascotFile(null);
    setPendingMascotPreview(null);
    setLastRun(null);
  }, [selectedAgent]);

  const beforeCreateUpload: NonNullable<UploadProps["beforeUpload"]> = async (file) => {
    setCreateMascotFile(file);
    setCreateMascotPreview(await toDataUrl(file));
    return Upload.LIST_IGNORE;
  };

  const beforePendingUpload: NonNullable<UploadProps["beforeUpload"]> = async (file) => {
    setPendingMascotFile(file);
    setPendingMascotPreview(await toDataUrl(file));
    return Upload.LIST_IGNORE;
  };

  const resetCreateModal = () => {
    setCreateOpen(false);
    createForm.resetFields();
    setCreateMascotFile(null);
    setCreateMascotPreview(null);
  };

  const handleCreateAgent = async () => {
    const values = await createForm.validateFields();
    try {
      let mascotUrl: string | null = null;
      let mascotPath: string | null = null;
      if (createMascotFile) {
        const uploaded = await uploadMascot.mutateAsync(createMascotFile);
        mascotUrl = uploaded.url;
        mascotPath = uploaded.path;
      }

      const created = await createAgent.mutateAsync({
        name: values.name.trim(),
        emoji: "🤖",
        description: values.description?.trim() || null,
        dataScope: serializeAgentConfig({
          model: values.model?.trim() || null,
          systemPrompt: values.systemPrompt?.trim() || null,
          mascotUrl,
          mascotPath,
          trainingTasks: [],
        }),
      });
      setSelectedAgentId(created.id);
      resetCreateModal();
      message.success("Agent created.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to create agent.");
    }
  };

  const handleCreateFromTemplate = async (templateKey: string) => {
    try {
      const id = await createFromTemplate.mutateAsync(templateKey);
      setSelectedAgentId(id);
      resetCreateModal();
      message.success("Operations Manager agent created.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to create agent from template.",
      );
    }
  };

  const updateDraft = (updater: (current: AgentDraft) => AgentDraft) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const updateCurrentTask = (
    updater: (task: AgentTrainingTask) => AgentTrainingTask,
  ) => {
    if (!currentTask) return;
    updateDraft((current) => ({
      ...current,
      config: {
        ...current.config,
        trainingTasks: current.config.trainingTasks.map((task) =>
          task.id === currentTask.id ? updater(task) : task,
        ),
      },
    }));
  };

  const addTask = () => {
    const task = newTrainingTask();
    updateDraft((current) => ({
      ...current,
      config: {
        ...current.config,
        trainingTasks: [...current.config.trainingTasks, task],
      },
    }));
    setSelectedTaskId(task.id);
    if (!playgroundTaskId) setPlaygroundTaskId(task.id);
  };

  const removeTask = (id: string) => {
    updateDraft((current) => {
      const nextTasks = current.config.trainingTasks.filter((task) => task.id !== id);
      return {
        ...current,
        config: {
          ...current.config,
          trainingTasks: nextTasks,
        },
      };
    });
    const nextTaskId =
      draft?.config.trainingTasks.find((task) => task.id !== id)?.id ?? null;
    if (selectedTaskId === id) setSelectedTaskId(nextTaskId);
    if (playgroundTaskId === id) setPlaygroundTaskId(nextTaskId);
  };

  const handleSave = async () => {
    if (!selectedAgent || !draft) return;
    if (!draft.name.trim()) {
      message.error("Agent name is required.");
      return;
    }

    try {
      let nextConfig = draft.config;
      if (pendingMascotFile) {
        const uploaded = await uploadMascot.mutateAsync(pendingMascotFile);
        nextConfig = {
          ...nextConfig,
          mascotUrl: uploaded.url,
          mascotPath: uploaded.path,
        };
      }

      const saved = await updateAgent.mutateAsync({
        id: selectedAgent.id,
        name: draft.name.trim(),
        emoji: draft.emoji,
        description: draft.description.trim() || null,
        dataScope: serializeAgentConfig(nextConfig),
      });

      setDraft(agentToDraft(saved));
      setPendingMascotFile(null);
      setPendingMascotPreview(null);
      message.success("Agent updated.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to update agent.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAgent.mutateAsync(id);
      message.success("Agent deleted.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to delete agent.");
    }
  };

  const handleRun = async () => {
    if (!selectedAgent) return;
    try {
      const result = await runAgent.mutateAsync({
        agentId: selectedAgent.id,
        prompt: playgroundPrompt.trim(),
        trainingTaskId: playgroundTaskId,
      });
      setLastRun(result);
      message.success("Agent response ready.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Agent run failed.");
    }
  };

  return (
    <>
      <style>{`@media (max-width:900px){.wl-agents-cols{grid-template-columns:1fr !important}.wl-agents-tasks{grid-template-columns:1fr !important}}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 21,
                fontWeight: 600,
                letterSpacing: "-.4px",
                color: token.colorText,
              }}
            >
              Agents
            </h1>
            <Typography.Paragraph
              style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}
            >
              Create mascot-driven AI agents, teach them specific work with saved prompts,
              and attach live Cubes context using <code>@projects</code>,
              <code> @tasks</code>, <code> @files</code>, and more.
            </Typography.Paragraph>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New agent
          </Button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!selectedAgent ? (
            <AgentGallery
              agents={agentList}
              isLoading={isLoading}
              onSelect={setSelectedAgentId}
              onCreate={() => setCreateOpen(true)}
            />
          ) : !draft ? null : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <Button
                  type="text"
                  onClick={() => setSelectedAgentId(null)}
                  style={{ paddingLeft: 0, color: token.colorTextSecondary }}
                  icon={
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                      arrow_back
                    </span>
                  }
                >
                  All agents
                </Button>
              </div>
              <Card>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    {renderMascot(
                      draft.name,
                      pendingMascotPreview ?? draft.config.mascotUrl,
                      72,
                      token,
                    )}
                    <div>
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        {draft.name || "Untitled agent"}
                      </Typography.Title>
                      <Typography.Text type="secondary">
                        Prompt-driven AI workspace with saved tasks and context tagging.
                      </Typography.Text>
                      <div style={{ marginTop: 10 }}>
                        <Upload
                          showUploadList={false}
                          beforeUpload={beforePendingUpload}
                          accept="image/*"
                        >
                          <Button icon={<UploadOutlined />}>Upload mascot</Button>
                        </Upload>
                      </div>
                    </div>
                  </div>

                  <Space wrap>
                    <Button
                      onClick={() => {
                        if (!selectedAgent) return;
                        setDraft(agentToDraft(selectedAgent));
                        setPendingMascotFile(null);
                        setPendingMascotPreview(null);
                      }}
                      disabled={!isDirty}
                    >
                      Discard
                    </Button>
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={() => void handleSave()}
                      loading={
                        updateAgent.isPending || uploadMascot.isPending
                      }
                      disabled={!isDirty}
                    >
                      Save changes
                    </Button>
                    <Popconfirm
                      title="Delete this agent?"
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void handleDelete(selectedAgent.id)}
                    >
                      <Button danger icon={<DeleteOutlined />}>
                        Delete
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>

                <div
                  style={{
                    marginTop: 20,
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 16,
                  }}
                >
                  <div>
                    <Typography.Text strong>Name</Typography.Text>
                    <Input
                      value={draft.name}
                      onChange={(e) =>
                        updateDraft((current) => ({ ...current, name: e.target.value }))
                      }
                      placeholder="HR analyst"
                      style={{ marginTop: 8 }}
                    />
                  </div>
                  <div>
                    <Typography.Text strong>OpenRouter model</Typography.Text>
                    <Input
                      value={draft.config.model ?? ""}
                      onChange={(e) =>
                        updateDraft((current) => ({
                          ...current,
                          config: {
                            ...current.config,
                            model: e.target.value.trim() || null,
                          },
                        }))
                      }
                      placeholder="openrouter/auto"
                      style={{ marginTop: 8 }}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Typography.Text strong>Description</Typography.Text>
                    <Input.TextArea
                      value={draft.description}
                      onChange={(e) =>
                        updateDraft((current) => ({
                          ...current,
                          description: e.target.value,
                        }))
                      }
                      rows={2}
                      maxLength={300}
                      placeholder="What this agent is responsible for."
                      style={{ marginTop: 8 }}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Typography.Text strong>Core instructions</Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      <AgentMentionsInput
                        value={draft.config.systemPrompt ?? ""}
                        onChange={(value) =>
                          updateDraft((current) => ({
                            ...current,
                            config: {
                              ...current.config,
                              systemPrompt: value,
                            },
                          }))
                        }
                        rows={6}
                        placeholder="Describe how this agent should think, what it should produce, and which @contexts it should rely on."
                      />
                    </div>
                  </div>
                </div>
              </Card>

              {/* Operations Manager agents get a live delivery-health command panel. */}
              {selectedAgent &&
              (selectedAgent as unknown as OpsAgent).kind === "ops_manager" ? (
                <OpsInsightsPanel
                  key={selectedAgent.id}
                  agent={selectedAgent as unknown as OpsAgent}
                />
              ) : null}

              <div
                className="wl-agents-tasks"
                style={{
                  display: "grid",
                  gridTemplateColumns: "360px minmax(0, 1fr)",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <Card
                  title="Saved tasks"
                  extra={
                    <Button type="primary" size="small" icon={<PlusOutlined />} onClick={addTask}>
                      Add task
                    </Button>
                  }
                >
                  {draft.config.trainingTasks.length === 0 ? (
                    <Empty
                      description="No saved tasks yet"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {draft.config.trainingTasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => setSelectedTaskId(task.id)}
                          style={{
                            textAlign: "left",
                            border:
                              selectedTaskId === task.id
                                ? `1px solid ${token.colorPrimaryBorder}`
                                : `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: 12,
                            padding: 12,
                            background:
                              selectedTaskId === task.id
                                ? token.colorPrimaryBg
                                : token.colorBgContainer,
                            cursor: "pointer",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "flex-start",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <Typography.Text strong style={{ display: "block" }}>
                                {task.title}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                                {task.instruction.trim()
                                  ? task.instruction
                                  : "No task instructions yet"}
                              </Typography.Text>
                            </div>
                            <Tag color={task.enabled ? "success" : "default"} style={{ margin: 0 }}>
                              {task.enabled ? "Enabled" : "Paused"}
                            </Tag>
                          </div>
                          <Space size={[6, 6]} wrap style={{ marginTop: 10 }}>
                            {task.mentions.length === 0 ? (
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                No context tagged
                              </Typography.Text>
                            ) : (
                              task.mentions.map((mention) => {
                                const context = getAgentContext(mention);
                                return (
                                  <Tag
                                    key={mention}
                                    style={{
                                      margin: 0,
                                      borderRadius: 999,
                                      color: context.accent,
                                      borderColor: `${context.accent}33`,
                                      background: `${context.accent}12`,
                                    }}
                                  >
                                    @{mention}
                                  </Tag>
                                );
                              })
                            )}
                          </Space>
                        </button>
                      ))}
                    </div>
                  )}
                </Card>

                <Card
                  title={currentTask ? "Task editor" : "Task editor"}
                  extra={
                    currentTask ? (
                      <Popconfirm
                        title="Remove this saved task?"
                        okText="Remove"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => removeTask(currentTask.id)}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    ) : null
                  }
                >
                  {!currentTask ? (
                    <Empty
                      description="Select a saved task or create a new one"
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <Typography.Text strong>Task name</Typography.Text>
                          <Input
                            value={currentTask.title}
                            onChange={(e) =>
                              updateCurrentTask((task) => ({
                                ...task,
                                title: e.target.value,
                              }))
                            }
                            placeholder="Weekly project health summary"
                            style={{ marginTop: 8 }}
                          />
                        </div>
                        <div style={{ minWidth: 180 }}>
                          <Typography.Text strong>Enabled</Typography.Text>
                          <div style={{ marginTop: 10 }}>
                            <Switch
                              checked={currentTask.enabled}
                              onChange={(checked) =>
                                updateCurrentTask((task) => ({ ...task, enabled: checked }))
                              }
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <Typography.Text strong>Task instructions</Typography.Text>
                        <div style={{ marginTop: 8 }}>
                          <AgentMentionsInput
                            value={currentTask.instruction}
                            onChange={(value) =>
                              updateCurrentTask((task) => ({
                                ...task,
                                instruction: value,
                                mentions: extractAgentMentions(value),
                              }))
                            }
                            rows={7}
                            placeholder="Example: Every Monday, review @projects and @tasks, then summarize risks and overdue items for leadership."
                          />
                        </div>
                      </div>

                      <div>
                        <Typography.Text strong>Expected output</Typography.Text>
                        <Input.TextArea
                          value={currentTask.expectedOutput ?? ""}
                          onChange={(e) =>
                            updateCurrentTask((task) => ({
                              ...task,
                              expectedOutput: e.target.value || null,
                            }))
                          }
                          rows={4}
                          placeholder="Optional sample of the report, checklist, markdown table, or action plan this task should return."
                          style={{ marginTop: 8 }}
                        />
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <Card title="Available context">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 12,
                    }}
                  >
                    {AGENT_CONTEXTS.map((context) => (
                      <div
                        key={context.key}
                        style={{
                          border: `1px solid ${token.colorBorderSecondary}`,
                          borderRadius: 12,
                          padding: 12,
                          background: token.colorBgContainer,
                        }}
                      >
                        <Tag
                          style={{
                            margin: 0,
                            borderRadius: 999,
                            color: context.accent,
                            borderColor: `${context.accent}33`,
                            background: `${context.accent}12`,
                          }}
                        >
                          @{context.key}
                        </Tag>
                        <Typography.Text strong style={{ display: "block", marginTop: 10 }}>
                          {context.title}
                        </Typography.Text>
                        <Typography.Paragraph
                          type="secondary"
                          style={{ margin: "6px 0 0", fontSize: 12.5 }}
                        >
                          {context.description}
                        </Typography.Paragraph>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card
                  title="Playground"
                  extra={
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => void handleRun()}
                      loading={runAgent.isPending}
                    >
                      Run agent
                    </Button>
                  }
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <Typography.Text strong>Saved task</Typography.Text>
                      <Select
                        allowClear
                        value={playgroundTaskId ?? undefined}
                        onChange={(value) => setPlaygroundTaskId(value ?? null)}
                        placeholder="Optional: start from a saved task"
                        style={{ width: "100%", marginTop: 8 }}
                        options={draft.config.trainingTasks.map((task) => ({
                          value: task.id,
                          label: task.title,
                        }))}
                      />
                    </div>

                    <div>
                      <Typography.Text strong>Ask the agent</Typography.Text>
                      <div style={{ marginTop: 8 }}>
                        <AgentMentionsInput
                          value={playgroundPrompt}
                          onChange={setPlaygroundPrompt}
                          rows={6}
                          placeholder="Example: Compare @projects and @reviews, then tell me which launches need attention this week."
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        borderRadius: 12,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        background: token.colorFillTertiary,
                        padding: 14,
                        minHeight: 220,
                      }}
                    >
                      {lastRun ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            <Space size={[6, 6]} wrap>
                              {(lastRun.usedMentions ?? []).map((mention) => (
                                <Tag key={mention} color="blue" style={{ margin: 0 }}>
                                  @{mention}
                                </Tag>
                              ))}
                            </Space>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {lastRun.model}
                            </Typography.Text>
                          </div>
                          {lastRun.trainingTask ? (
                            <div
                              style={{
                                borderRadius: 12,
                                padding: 12,
                                background: token.colorBgContainer,
                                border: `1px solid ${token.colorBorderSecondary}`,
                              }}
                            >
                              <Typography.Text strong>{lastRun.trainingTask.title}</Typography.Text>
                              <Typography.Paragraph
                                type="secondary"
                                style={{ margin: "6px 0 0", fontSize: 12.5 }}
                              >
                                {lastRun.trainingTask.instruction}
                              </Typography.Paragraph>
                            </div>
                          ) : null}
                          <div
                            style={{
                              whiteSpace: "pre-wrap",
                              lineHeight: 1.65,
                              color: token.colorText,
                            }}
                          >
                            {lastRun.answer}
                          </div>
                        </div>
                      ) : (
                        <Empty
                          description="Run the agent to see the response here"
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          style={{ marginTop: 36 }}
                        />
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        title="New agent"
        open={createOpen}
        onCancel={resetCreateModal}
        onOk={() => void handleCreateAgent()}
        okText="Create agent"
        confirmLoading={createAgent.isPending || uploadMascot.isPending}
        destroyOnHidden
        width={640}
      >
        {/* Start from a template — one click seeds a fully-configured agent. */}
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: token.colorTextTertiary,
              marginBottom: 8,
            }}
          >
            Start from a template
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {AGENT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => void handleCreateFromTemplate(tpl.key)}
                disabled={createFromTemplate.isPending}
                style={{
                  flex: "1 1 240px",
                  textAlign: "left",
                  display: "flex",
                  gap: 10,
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    flex: "none",
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    background: `${tpl.accent}1f`,
                  }}
                >
                  {tpl.emoji}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: token.colorText }}>
                    {tpl.name}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: token.colorTextTertiary, marginTop: 1 }}>
                    {tpl.tagline}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "#4a4ad0", marginTop: 5, fontWeight: 600 }}>
                    Use template →
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "16px 0 4px",
              color: token.colorTextTertiary,
              fontSize: 12,
            }}
          >
            <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
            or build from scratch
            <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
          </div>
        </div>
        <Form form={createForm} layout="vertical" requiredMark={false}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "112px minmax(0, 1fr)",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div>
              <Typography.Text strong>Mascot</Typography.Text>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
                {renderMascot(
                  createName || "A",
                  createMascotPreview,
                  88,
                  token,
                )}
              </div>
              <Upload
                showUploadList={false}
                beforeUpload={beforeCreateUpload}
                accept="image/*"
              >
                <Button icon={<UploadOutlined />} block style={{ marginTop: 12 }}>
                  Upload
                </Button>
              </Upload>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Form.Item
                label="Name"
                name="name"
                rules={[{ required: true, message: "Please enter a name." }]}
              >
                <Input placeholder="Campaign reviewer" />
              </Form.Item>
              <Form.Item label="Description" name="description">
                <Input.TextArea
                  rows={2}
                  maxLength={300}
                  placeholder="What this agent should own."
                />
              </Form.Item>
              <Form.Item label="OpenRouter model" name="model">
                <Input placeholder="openrouter/auto" />
              </Form.Item>
              <Form.Item label="Core instructions" name="systemPrompt">
                <AgentMentionsInput
                  rows={5}
                  placeholder="Describe how this agent should operate and which @contexts it should use by default."
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </>
  );
}
