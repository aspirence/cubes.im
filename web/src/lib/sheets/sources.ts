/**
 * Sheets app — what each data source offers. Pure (relative imports only), so
 * the wizard, the grid, the server adapters and node tests all read the same
 * list. A field's `key` is what SheetColumn.field refers to.
 */
import type { ColumnType, DynamicOptions, SelectOption, SheetSource } from "./types";

export interface SourceField {
  key: string;
  label: string;
  type: ColumnType;
  /** Can a user change it from the grid or from Google? */
  writable: boolean;
  /** Needed to create a record (grid "new row" / Google row without an id). */
  requiredOnCreate?: boolean;
  options?: SelectOption[];
  dynamicOptions?: DynamicOptions;
  /** Included when a sheet is created from this source without a template. */
  defaultOn?: boolean;
}

export interface SourceDescriptor {
  key: SheetSource;
  label: string;
  description: string;
  icon: string;
  /** installed_apps.app_key that must be installed + enabled (and active in the project). null = core. */
  appKey: string | null;
  /** true = only in a project sheet (needs project_id); false = project or workspace. */
  projectOnly: boolean;
  canCreate: boolean;
  canDelete: boolean;
  /** Keys of source_config the wizard shows, with their allowed values. */
  config: SourceConfigField[];
  fields: SourceField[];
}

export interface SourceConfigField {
  key: string;
  label: string;
  kind: "select" | "boolean";
  options?: SelectOption[];
  default: unknown;
}

const CS_TYPES: SelectOption[] = [
  { value: "social_post", label: "Social post" },
  { value: "blog_post", label: "Blog post" },
  { value: "newsletter", label: "Newsletter" },
  { value: "video", label: "Video" },
  { value: "podcast", label: "Podcast" },
  { value: "other", label: "Other" },
];

const CS_STATUSES: SelectOption[] = [
  { value: "draft", label: "Draft", color: "#8a8d98" },
  { value: "pending_approval", label: "Needs approval", color: "#b8842a" },
  { value: "scheduled", label: "Scheduled", color: "#4a4ad0" },
  { value: "published", label: "Published", color: "#2f8f5f" },
  { value: "failed", label: "Failed", color: "#c0453c" },
];

export const SOURCES: Record<SheetSource, SourceDescriptor> = {
  custom: {
    key: "custom",
    // Where the rows come from, which is what the sheet card and the column
    // editor say. The wizard's tile is named by its template ("Blank sheet",
    // "Content ideas backlog"), not by this.
    label: "Own rows",
    description: "Your own columns and rows, stored in Cubes.",
    icon: "grid_on",
    appKey: null,
    projectOnly: false,
    canCreate: true,
    canDelete: true,
    config: [],
    fields: [],
  },
  tasks: {
    key: "tasks",
    label: "Project tasks",
    description: "One row per task in this project. Edits write back to the task.",
    icon: "task_alt",
    appKey: null,
    projectOnly: true,
    canCreate: true,
    canDelete: false,
    config: [
      { key: "include_subtasks", label: "Include subtasks", kind: "boolean", default: false },
      { key: "include_done", label: "Include finished tasks", kind: "boolean", default: true },
    ],
    fields: [
      { key: "task_no", label: "#", type: "number", writable: false, defaultOn: true },
      { key: "name", label: "Task", type: "text", writable: true, requiredOnCreate: true, defaultOn: true },
      { key: "status", label: "Status", type: "select", writable: true, dynamicOptions: "task_statuses", defaultOn: true },
      { key: "priority", label: "Priority", type: "select", writable: true, dynamicOptions: "task_priorities", defaultOn: true },
      { key: "assignees", label: "Assignees", type: "people", writable: true, dynamicOptions: "team_members", defaultOn: true },
      { key: "start_date", label: "Start", type: "date", writable: true, defaultOn: true },
      { key: "due_date", label: "Due", type: "date", writable: true, defaultOn: true },
      { key: "labels", label: "Labels", type: "multi_select", writable: true, dynamicOptions: "team_labels" },
      { key: "description", label: "Description", type: "long_text", writable: true },
      { key: "done", label: "Done", type: "checkbox", writable: false },
      { key: "parent", label: "Parent task", type: "text", writable: false },
      { key: "created_at", label: "Created", type: "datetime", writable: false },
      { key: "updated_at", label: "Updated", type: "datetime", writable: false },
    ],
  },
  content_studio_items: {
    key: "content_studio_items",
    label: "Content Studio items",
    description: "Posts, articles, newsletters and videos. Edits write back to Content Studio.",
    icon: "campaign",
    appKey: "content_studio",
    projectOnly: false,
    canCreate: true,
    canDelete: false,
    config: [
      { key: "include_shared", label: "Include workspace-wide items", kind: "boolean", default: false },
    ],
    fields: [
      { key: "title", label: "Title", type: "text", writable: true, requiredOnCreate: true, defaultOn: true },
      { key: "body", label: "Body / caption", type: "long_text", writable: true, requiredOnCreate: true, defaultOn: true },
      { key: "content_type", label: "Type", type: "select", writable: true, options: CS_TYPES, defaultOn: true },
      { key: "status", label: "Status", type: "select", writable: true, options: CS_STATUSES, defaultOn: true },
      { key: "scheduled_for", label: "Scheduled for", type: "datetime", writable: true, defaultOn: true },
      { key: "destinations", label: "Destinations", type: "multi_select", writable: true, dynamicOptions: "cs_destinations", defaultOn: true },
      { key: "campaign", label: "Campaign", type: "select", writable: true, dynamicOptions: "cs_campaigns", defaultOn: true },
      { key: "target_url", label: "Link", type: "url", writable: true },
      { key: "approval_required", label: "Needs approval", type: "checkbox", writable: true },
      { key: "impressions", label: "Impressions", type: "number", writable: true },
      { key: "engagements", label: "Engagements", type: "number", writable: true },
      { key: "clicks", label: "Clicks", type: "number", writable: true },
      { key: "task", label: "Linked task", type: "text", writable: false },
      { key: "published_at", label: "Published at", type: "datetime", writable: false },
      { key: "updated_at", label: "Updated", type: "datetime", writable: false },
    ],
  },
};

export function sourceField(source: SheetSource, key: string): SourceField | undefined {
  return SOURCES[source].fields.find((f) => f.key === key);
}
