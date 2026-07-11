/**
 * Capability registry (v1, code-level) — the single source the Builder palette,
 * the inspector's auto-generated forms, the "Insert data" field picker, and the
 * agent skills catalog all render from. Runtime dispatch lives in the SQL
 * executor (20261012 migration); this file is the UI/authoring mirror of it.
 *
 * New step type / skill = one descriptor here + one executor branch there.
 */

export type StepType = "agent" | "condition" | "action" | "app" | "human" | "ai";

/** A form field descriptor (a small JSON-Schema subset the renderer supports). */
export type FieldType =
  | "string"
  | "text" // multiline
  | "number"
  | "boolean"
  | "enum"
  | "member" // team-member picker (returns user_id)
  | "project" // project picker
  | "agent"; // agent picker

export interface FieldDef {
  key: string;
  type: FieldType;
  title: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  /** Show the "Insert data" ({{steps.*}}) picker for this field. */
  supportsInsert?: boolean;
  enumOptions?: { value: string; label: string }[];
}

export interface StepCapability {
  key: string;
  stepType: StepType;
  title: string;
  description: string;
  /** Material Symbols Rounded glyph. */
  icon: string;
  category: "Logic" | "Actions" | "Apps" | "Human";
  available: boolean;
  fields: FieldDef[];
  /** Merged verbatim into the step config (e.g. the action discriminator). */
  fixedConfig?: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Skills — the deterministic data capabilities an agent can bundle.          */
/* -------------------------------------------------------------------------- */

export interface SkillDescriptor {
  key: string;
  title: string;
  description: string;
  icon: string;
  category: "Reporting" | "HR" | "Tasks";
  /** True when the skill reads org-level data (agent needs org scope). */
  requiresOrg?: boolean;
  /** Whether the skill's output is a list (affects the insert-data hints). */
  isList?: boolean;
  /** Notable output fields, surfaced in the "Insert data" picker. */
  outputs: string[];
}

export const SKILLS: SkillDescriptor[] = [
  {
    key: "team_overview",
    title: "Team Overview",
    description: "Project, task, completion and logged-time totals for the team.",
    icon: "monitoring",
    category: "Reporting",
    outputs: [
      "total_projects",
      "active_projects",
      "total_tasks",
      "completed_tasks",
      "overdue_tasks",
      "total_members",
      "total_logged_minutes",
    ],
  },
  {
    key: "project_report",
    title: "Project Report",
    description: "Per-project task counts, completion %, logged minutes, members.",
    icon: "folder",
    category: "Reporting",
    isList: true,
    outputs: ["project_name", "completion_pct", "total_tasks", "logged_minutes"],
  },
  {
    key: "member_report",
    title: "Member Report",
    description: "Per-member assigned/completed tasks and logged minutes.",
    icon: "group",
    category: "Reporting",
    isList: true,
    outputs: ["user_name", "assigned_tasks", "completed_tasks", "logged_minutes"],
  },
  {
    key: "timesheet",
    title: "Timesheet",
    description: "Raw time-log entries for the team over a date range.",
    icon: "schedule",
    category: "Reporting",
    isList: true,
    outputs: ["task_name", "project_name", "user_name", "minutes", "is_billable"],
  },
  {
    key: "availability",
    title: "Availability",
    description: "Leaves / holidays across the team for a date range.",
    icon: "event_available",
    category: "HR",
    isList: true,
    outputs: ["day", "kind", "label", "user_id"],
  },
  {
    key: "overdue_tasks",
    title: "Overdue & Due Soon",
    description: "Counts and lists of overdue and next-7-day tasks.",
    icon: "warning",
    category: "Tasks",
    outputs: ["overdue_count", "due_soon_count", "overdue", "due_soon"],
  },
  {
    key: "hr_analytics",
    title: "HR Analytics",
    description: "Headcount, attendance rate, pending leaves, joiners/exits.",
    icon: "diversity_3",
    category: "HR",
    requiresOrg: true,
    outputs: [
      "headcount",
      "leave_pending",
      "attendance_rate_month",
      "exits_30d",
      "present_today",
      "new_joiners_30d",
      "total_employees",
    ],
  },
];

export const skillByKey = (key: string): SkillDescriptor | undefined =>
  SKILLS.find((s) => s.key === key);

/* -------------------------------------------------------------------------- */
/* Step capabilities — the Builder palette (agents are added dynamically).    */
/* -------------------------------------------------------------------------- */

export const CONDITION_OPS: { value: string; label: string }[] = [
  { value: ">", label: "is greater than" },
  { value: ">=", label: "is at least" },
  { value: "<", label: "is less than" },
  { value: "<=", label: "is at most" },
  { value: "=", label: "is equal to" },
  { value: "!=", label: "is not equal to" },
];

export const STEP_CAPABILITIES: StepCapability[] = [
  {
    key: "condition",
    stepType: "condition",
    title: "Condition",
    description: "Continue only if a comparison holds; otherwise stop the run.",
    icon: "filter_alt",
    category: "Logic",
    available: true,
    fields: [
      {
        key: "left",
        type: "string",
        title: "Left value",
        required: true,
        supportsInsert: true,
        placeholder: "{{steps.s1.hr_analytics.leave_pending}}",
      },
      {
        key: "op",
        type: "enum",
        title: "Operator",
        required: true,
        enumOptions: CONDITION_OPS,
      },
      {
        key: "right",
        type: "string",
        title: "Right value",
        supportsInsert: true,
        placeholder: "0",
      },
    ],
  },
  {
    key: "notify_user",
    stepType: "action",
    title: "Notify member",
    description: "Send an in-app notification to a team member.",
    icon: "notifications",
    category: "Actions",
    available: true,
    fixedConfig: { action: "notify_user" },
    fields: [
      { key: "user_id", type: "member", title: "Notify", required: true },
      {
        key: "message",
        type: "text",
        title: "Message",
        required: true,
        supportsInsert: true,
        placeholder: "Weekly pulse: {{steps.s1.overdue_tasks.overdue_count}} overdue",
      },
    ],
  },
  {
    key: "create_task",
    stepType: "action",
    title: "Create task",
    description: "Create a task in a project.",
    icon: "add_task",
    category: "Actions",
    available: true,
    fixedConfig: { action: "create_task" },
    fields: [
      { key: "project_id", type: "project", title: "Project", required: true },
      {
        key: "name",
        type: "string",
        title: "Task name",
        required: true,
        supportsInsert: true,
      },
    ],
  },
  {
    key: "app",
    stepType: "app",
    title: "App delivery",
    description: "Send via a connected app (Slack, webhook, …). Coming in Phase C.",
    icon: "send",
    category: "Apps",
    available: false,
    fields: [],
  },
  {
    key: "human",
    stepType: "human",
    title: "Human approval",
    description: "Pause for a member to approve or reject. Coming in Phase C.",
    icon: "how_to_reg",
    category: "Human",
    available: false,
    fields: [],
  },
];

export const stepCapByKey = (key: string): StepCapability | undefined =>
  STEP_CAPABILITIES.find((c) => c.key === key);

/**
 * Resolves the capability for a stored step. Agent steps have no static
 * capability (they reference a team agent); everything else matches by the
 * action discriminator (for action steps) or the step type.
 */
export function capabilityForStep(
  stepType: StepType,
  config: Record<string, unknown>,
): StepCapability | undefined {
  if (stepType === "action") {
    const action = typeof config.action === "string" ? config.action : "";
    return STEP_CAPABILITIES.find(
      (c) => c.stepType === "action" && c.fixedConfig?.action === action,
    );
  }
  return STEP_CAPABILITIES.find((c) => c.stepType === stepType);
}
