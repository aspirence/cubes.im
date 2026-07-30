import type { Json } from "@/types/database";

export type AgentContextKey =
  | "projects"
  | "tasks"
  | "members"
  | "workflows"
  | "reports"
  | "timelogs"
  | "files"
  | "reviews"
  | "social"
  | "employees"
  | "attendance"
  | "leaves";

export interface AgentContextDescriptor {
  key: AgentContextKey;
  title: string;
  description: string;
  accent: string;
}

export interface AgentTrainingTask {
  id: string;
  title: string;
  instruction: string;
  mentions: AgentContextKey[];
  expectedOutput: string | null;
  enabled: boolean;
}

export interface AgentConfig {
  version: 1;
  provider: "openrouter";
  model: string | null;
  systemPrompt: string | null;
  mascotUrl: string | null;
  mascotPath: string | null;
  trainingTasks: AgentTrainingTask[];
}

export const AGENT_CONTEXTS: AgentContextDescriptor[] = [
  {
    key: "projects",
    title: "Projects",
    description: "Project names, timelines, health and ownership context.",
    accent: "#4a63f6",
  },
  {
    key: "tasks",
    title: "Tasks",
    description: "Task titles, due dates, status and project links.",
    accent: "#f36f45",
  },
  {
    key: "members",
    title: "Members",
    description: "Team members, roles and ownership context.",
    accent: "#1c9c6c",
  },
  {
    key: "workflows",
    title: "Workflows",
    description: "Workflow names, trigger types and run health.",
    accent: "#8e63f6",
  },
  {
    key: "reports",
    title: "Reports",
    description: "Team, project and member rollups from reporting RPCs.",
    accent: "#d08422",
  },
  {
    key: "timelogs",
    title: "Time Logs",
    description: "Recent logged-time entries and utilization signals.",
    accent: "#07a0a8",
  },
  {
    key: "files",
    title: "Files",
    description: "Internal files metadata, ownership and project links.",
    accent: "#4a4ad0",
  },
  {
    key: "reviews",
    title: "Video Reviews",
    description: "Review assets, status, stage and linked project/task data.",
    accent: "#7254ff",
  },
  {
    key: "social",
    title: "Social Studio",
    description: "Social posts, campaign state and publishing schedule.",
    accent: "#ed4f9a",
  },
  {
    key: "employees",
    title: "Employees",
    description: "Employee directory, employment type and status.",
    accent: "#0f9d58",
  },
  {
    key: "attendance",
    title: "Attendance",
    description: "Clock-in/out, work minutes and attendance status.",
    accent: "#ff8a3d",
  },
  {
    key: "leaves",
    title: "Leaves",
    description: "Leave requests, approval state and date windows.",
    accent: "#d94b4b",
  },
];

const CONTEXT_LOOKUP = new Map(AGENT_CONTEXTS.map((context) => [context.key, context]));

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  version: 1,
  provider: "openrouter",
  model: null,
  systemPrompt: null,
  mascotUrl: null,
  mascotPath: null,
  trainingTasks: [],
};

function asObject(value: Json | null | undefined): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return value as Record<string, Json | undefined>;
}

export function normalizeAgentContextKey(
  value: string | null | undefined,
): AgentContextKey | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "");
  switch (normalized) {
    case "projects":
    case "tasks":
    case "members":
    case "workflows":
    case "reports":
    case "timelogs":
    case "files":
    case "reviews":
    case "social":
    case "employees":
    case "attendance":
    case "leaves":
      return normalized;
    case "timelogsdata":
    case "timelog":
      return "timelogs";
    case "videoreviews":
    case "video-review":
    case "videoreview":
      return "reviews";
    case "socialposts":
    case "socialstudio":
      return "social";
    case "hr":
    case "hremployees":
      return "employees";
    case "leave":
      return "leaves";
    default:
      return null;
  }
}

export function getAgentContext(key: AgentContextKey): AgentContextDescriptor {
  return CONTEXT_LOOKUP.get(key) ?? AGENT_CONTEXTS[0];
}

export function extractAgentMentions(text: string | null | undefined): AgentContextKey[] {
  if (!text) return [];
  const matches = text.matchAll(/@([a-z][a-z0-9_-]*)/gi);
  const found = new Set<AgentContextKey>();
  for (const match of matches) {
    const key = normalizeAgentContextKey(match[1]);
    if (key) found.add(key);
  }
  return [...found];
}

function normalizeTrainingTask(raw: Json, index: number): AgentTrainingTask {
  const obj = asObject(raw);
  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim()
      : `Task ${index + 1}`;
  const instruction = typeof obj.instruction === "string" ? obj.instruction : "";
  const mentionsFromList = Array.isArray(obj.mentions)
    ? obj.mentions
        .map((mention) => normalizeAgentContextKey(typeof mention === "string" ? mention : null))
        .filter((mention): mention is AgentContextKey => Boolean(mention))
    : [];
  const mentions = Array.from(
    new Set<AgentContextKey>([
      ...mentionsFromList,
      ...extractAgentMentions(title),
      ...extractAgentMentions(instruction),
    ]),
  );

  return {
    id:
      typeof obj.id === "string" && obj.id.trim()
        ? obj.id
        : `task-${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title,
    instruction,
    mentions,
    expectedOutput:
      typeof obj.expectedOutput === "string"
        ? obj.expectedOutput
        : typeof obj.expected_output === "string"
          ? obj.expected_output
          : null,
    enabled: obj.enabled !== false,
  };
}

export function readAgentConfig(value: Json | null | undefined): AgentConfig {
  const obj = asObject(value);
  const trainingTasks = Array.isArray(obj.trainingTasks)
    ? obj.trainingTasks.map((task, index) => normalizeTrainingTask(task, index))
    : [];

  return {
    version: 1,
    provider: "openrouter",
    model: typeof obj.model === "string" && obj.model.trim() ? obj.model.trim() : null,
    systemPrompt:
      typeof obj.systemPrompt === "string"
        ? obj.systemPrompt
        : typeof obj.system_prompt === "string"
          ? obj.system_prompt
          : null,
    mascotUrl:
      typeof obj.mascotUrl === "string"
        ? obj.mascotUrl
        : typeof obj.mascot_url === "string"
          ? obj.mascot_url
          : null,
    mascotPath:
      typeof obj.mascotPath === "string"
        ? obj.mascotPath
        : typeof obj.mascot_path === "string"
          ? obj.mascot_path
          : null,
    trainingTasks,
  };
}

export function serializeAgentConfig(config: Partial<AgentConfig> | null | undefined): Json {
  const normalized = config ? { ...DEFAULT_AGENT_CONFIG, ...config } : DEFAULT_AGENT_CONFIG;
  return {
    version: 1,
    provider: "openrouter",
    model: normalized.model ?? null,
    systemPrompt: normalized.systemPrompt ?? null,
    mascotUrl: normalized.mascotUrl ?? null,
    mascotPath: normalized.mascotPath ?? null,
    trainingTasks: (normalized.trainingTasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      instruction: task.instruction,
      mentions: Array.from(
        new Set<AgentContextKey>([
          ...(task.mentions ?? []),
          ...extractAgentMentions(task.title),
          ...extractAgentMentions(task.instruction),
        ]),
      ),
      expectedOutput: task.expectedOutput ?? null,
      enabled: task.enabled !== false,
    })),
  } as Json;
}

export function collectAgentMentions(
  config: AgentConfig,
  extraText: string | null | undefined = null,
): AgentContextKey[] {
  const mentions = new Set<AgentContextKey>();

  for (const mention of extractAgentMentions(config.systemPrompt)) {
    mentions.add(mention);
  }
  for (const task of config.trainingTasks) {
    for (const mention of task.mentions) mentions.add(mention);
    for (const mention of extractAgentMentions(task.instruction)) mentions.add(mention);
  }
  for (const mention of extractAgentMentions(extraText)) mentions.add(mention);

  return [...mentions];
}

export function deriveSkillsFromAgentConfig(
  config: AgentConfig,
): Array<{ skill: string; params?: Record<string, unknown> }> {
  const skills = new Set<string>();
  for (const mention of collectAgentMentions(config)) {
    if (mention === "reports") {
      skills.add("team_overview");
      skills.add("project_report");
      skills.add("member_report");
    }
    if (mention === "projects") skills.add("project_report");
    if (mention === "members") skills.add("member_report");
    if (mention === "timelogs") skills.add("timesheet");
    if (mention === "tasks") skills.add("overdue_tasks");
    if (mention === "employees" || mention === "attendance") skills.add("hr_analytics");
    if (mention === "leaves") skills.add("availability");
  }
  return [...skills].map((skill) => ({ skill }));
}
