/**
 * Workflow "app" steps and the schedule trigger — the client-safe catalog.
 *
 * A workflow_steps row with step_type 'app' carries config
 *   { "action": "<AppActionKey>", "params": { ... } }
 * The SQL engine parks the run on that step (status 'waiting_app'); the Node
 * runner (src/lib/workflows/runner.ts) executes the action through the server
 * registry (src/lib/workflows/app-actions.ts) and resumes the run. Outputs land
 * in the run context under steps.<step_key>, like every other step, so later
 * steps can use {{steps.<key>.<output>}}.
 *
 * Pure: no imports.
 */

export type AppActionKey =
  | "http.request"
  | "crm.create_deal"
  | "crm.update_deal"
  | "crm.find_deal"
  | "sheets.sync";

export interface AppActionParam {
  key: string;
  label: string;
  kind:
    | "select"
    | "multi_select"
    | "number"
    | "boolean"
    | "sheet"
    /**
     * A CRM stage / CRM campaign: picked from the team's list, or typed as a
     * name, or mapped from earlier data. The CRM is admin-only, so a member
     * building a workflow may not be able to list them — a name still works,
     * matched case-insensitively when the step runs.
     */
    | "crm_stage"
    | "crm_campaign"
    /** One-line free text, usually with {{steps.…}} tokens in it. */
    | "text"
    /** A list of header name/value pairs. */
    | "headers"
    /** A multi-line body (JSON, usually). */
    | "code";
  options?: { value: string; label: string }[];
  default: unknown;
  help?: string;
  min?: number;
  max?: number;
  /** The step is incomplete (⚠ on the canvas) until this one has a value. */
  required?: boolean;
}

/** Whether a stored params object satisfies an action's required params. */
export function appActionParamsComplete(
  action: AppActionDescriptor,
  params: Record<string, unknown>,
): boolean {
  return action.params.every(
    (p) => !p.required || (typeof params[p.key] === "string" && params[p.key] !== ""),
  );
}

export interface AppActionDescriptor {
  key: AppActionKey;
  /** installed_apps.app_key that must be installed and enabled for the step to run. */
  appKey: string;
  label: string;
  description: string;
  icon: string;
  params: AppActionParam[];
  outputs: { key: string; label: string }[];
}

export const APP_ACTIONS: AppActionDescriptor[] = [
  {
    // The step that lets a workflow talk to anything we have no connector for.
    // It belongs to no installed app, so the palette shows it as its own step
    // type (see BUILDER_STEP_TYPES) rather than through appActionTiles, and the
    // builder gives it a dedicated inspector instead of the generic param form.
    key: "http.request",
    appKey: "",
    label: "HTTP request",
    description: "Call any https URL and use what comes back in later steps.",
    icon: "cloud_sync",
    params: [
      {
        key: "method",
        label: "Method",
        kind: "select",
        default: "POST",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
          { value: "DELETE", label: "DELETE" },
        ],
      },
      { key: "url", label: "URL", kind: "text", default: "", help: "https only." },
      {
        key: "headers",
        label: "Headers",
        kind: "headers",
        default: {},
        help: "Never paste a token here — use {{connection.<id>.token}}, which the server fills in.",
      },
      { key: "body", label: "Body", kind: "code", default: "" },
      { key: "timeout_ms", label: "Timeout (ms)", kind: "number", default: 10000, min: 1000, max: 60000 },
    ],
    outputs: [
      { key: "status", label: "HTTP status" },
      { key: "headers", label: "Response headers" },
      { key: "body", label: "Response body" },
    ],
  },
  {
    key: "sheets.sync",
    appKey: "sheets",
    label: "Sheets: sync with Google Sheets",
    description: "Run the two-way sync for a sheet that is linked to a Google Sheet.",
    icon: "table_view",
    params: [{ key: "sheet_id", label: "Sheet", kind: "sheet", default: null, required: true }],
    outputs: [
      { key: "pushed", label: "Changes sent to Google" },
      { key: "pulled", label: "Changes taken from Google" },
      { key: "created", label: "Rows created" },
      { key: "conflicts", label: "Conflicts" },
    ],
  },
  {
    key: "crm.create_deal",
    appKey: "crm",
    label: "CRM: create a deal",
    description:
      "Turn a lead into a CRM deal: file it under a project, find or create the person and company, attach the campaign, record where it came from, and never make the same lead twice.",
    icon: "person_add_alt",
    params: [
      { key: "name", label: "Deal name", kind: "text", default: "", help: "Empty = the contact's name, else the email or phone." },
      { key: "contact_name", label: "Contact name", kind: "text", default: "", help: "{{trigger.name}} from a web form." },
      { key: "email", label: "Email", kind: "text", default: "" },
      { key: "phone", label: "Phone", kind: "text", default: "" },
      { key: "company", label: "Company", kind: "text", default: "", help: "Found by domain, then by name; created when new." },
      { key: "company_domain", label: "Company domain", kind: "text", default: "" },
      {
        key: "project",
        label: "Project",
        kind: "text",
        default: "",
        help: "A project id — e.g. {{trigger.project_id}}; empty = no project. A person or company created here is filed there too.",
      },
      {
        key: "status",
        label: "Lead status",
        kind: "select",
        default: "new",
        options: [
          { value: "new", label: "New" },
          { value: "contacted", label: "Contacted" },
          { value: "follow_up", label: "Follow up" },
          { value: "qualified", label: "Qualified" },
        ],
      },
      { key: "stage", label: "Board stage", kind: "crm_stage", default: "", help: "Empty = the first stage of the board." },
      {
        key: "campaign",
        label: "CRM campaign",
        kind: "crm_campaign",
        default: "",
        help: "The attribution — the CRM campaign this lead came from. Pick one, type its name, or map an id from the trigger.",
      },
      { key: "amount", label: "Amount", kind: "text", default: "" },
      { key: "currency", label: "Currency", kind: "text", default: "", help: "Three letters. Empty = the campaign's, else the CRM default." },
      { key: "close_date", label: "Close date", kind: "text", default: "", help: "YYYY-MM-DD." },
      { key: "source", label: "Source", kind: "text", default: "workflow", help: "A short word for where this came from: webhook, website…" },
      {
        key: "source_ref",
        label: "Source details",
        kind: "code",
        default: "",
        help: "JSON — the UTM fields of a web form, or one object mapped from the trigger.",
      },
      { key: "note", label: "Note on the deal", kind: "code", default: "", help: "Added as a CRM note. On a duplicate it is added to the existing deal." },
      {
        key: "dedupe",
        label: "Skip duplicates by",
        kind: "select",
        default: "email_or_phone",
        options: [
          { value: "email_or_phone", label: "Email or phone" },
          { value: "email", label: "Email only" },
          { value: "phone", label: "Phone only" },
          { value: "none", label: "Never — always create" },
        ],
        help: "An open deal for the same person inside the window is returned instead of a new one (created = false).",
      },
      { key: "dedupe_days", label: "Duplicate window (days)", kind: "number", default: 30, min: 0, max: 3650, help: "0 = any time." },
    ],
    outputs: [
      { key: "deal_id", label: "Deal id" },
      { key: "created", label: "Created (false = an existing deal was returned)" },
      { key: "duplicate", label: "Was a duplicate" },
      { key: "name", label: "Deal name" },
      { key: "status", label: "Status" },
      { key: "stage", label: "Stage" },
      { key: "stage_id", label: "Stage id" },
      { key: "campaign_id", label: "CRM campaign id" },
      { key: "campaign_name", label: "CRM campaign" },
      { key: "contact_id", label: "Contact id" },
      { key: "contact_name", label: "Contact name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "company_id", label: "Company id" },
      { key: "project_id", label: "Project id" },
      { key: "amount", label: "Amount" },
      { key: "currency", label: "Currency" },
      { key: "url", label: "Open in CRM (path)" },
    ],
  },
  {
    key: "crm.update_deal",
    appKey: "crm",
    label: "CRM: update a deal",
    description: "Change a deal's status, stage, campaign, project, amount or close date, or add a note. Blank fields are left alone.",
    icon: "edit_note",
    params: [
      { key: "deal_id", label: "Deal", kind: "text", default: "", required: true, help: "{{trigger.deal_id}} or {{steps.find.deal_id}}." },
      {
        key: "status",
        label: "Lead status",
        kind: "select",
        default: "",
        options: [
          { value: "", label: "Leave as is" },
          { value: "new", label: "New" },
          { value: "contacted", label: "Contacted" },
          { value: "follow_up", label: "Follow up" },
          { value: "qualified", label: "Qualified" },
          { value: "not_interested", label: "Not interested" },
          { value: "junk", label: "Junk" },
          { value: "converted", label: "Converted" },
        ],
      },
      { key: "stage", label: "Board stage", kind: "crm_stage", default: "" },
      { key: "campaign", label: "CRM campaign", kind: "crm_campaign", default: "" },
      {
        key: "project",
        label: "Project",
        kind: "text",
        default: "",
        // Blank must leave the deal where it is, like every other field here:
        // a step saved before projects existed has no value for it.
        help: "A project id — e.g. {{trigger.project_id}}; empty = leave as is; \"none\" = no project.",
      },
      { key: "amount", label: "Amount", kind: "text", default: "" },
      { key: "close_date", label: "Close date", kind: "text", default: "", help: "YYYY-MM-DD." },
      { key: "name", label: "Rename to", kind: "text", default: "" },
      { key: "note", label: "Add a note", kind: "code", default: "" },
    ],
    outputs: [
      { key: "deal_id", label: "Deal id" },
      { key: "status", label: "Status" },
      { key: "stage", label: "Stage" },
      { key: "campaign_id", label: "CRM campaign id" },
      { key: "project_id", label: "Project id" },
      { key: "changed", label: "Fields changed" },
      { key: "url", label: "Open in CRM (path)" },
    ],
  },
  {
    key: "crm.find_deal",
    appKey: "crm",
    label: "CRM: find a deal",
    description: "Look a deal up by id, or the newest open deal for an email or phone. Nothing found is an answer, not a failure — filter on “found”.",
    icon: "person_search",
    params: [
      { key: "deal_id", label: "Deal id", kind: "text", default: "" },
      { key: "email", label: "Email", kind: "text", default: "" },
      { key: "phone", label: "Phone", kind: "text", default: "" },
    ],
    outputs: [
      { key: "found", label: "Found" },
      { key: "deal_id", label: "Deal id" },
      { key: "name", label: "Deal name" },
      { key: "status", label: "Status" },
      { key: "stage", label: "Stage" },
      { key: "campaign_id", label: "CRM campaign id" },
      { key: "contact_id", label: "Contact id" },
      { key: "contact_name", label: "Contact name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "project_id", label: "Project id" },
      { key: "amount", label: "Amount" },
      { key: "url", label: "Open in CRM (path)" },
    ],
  },
];

export function appActionByKey(key: string): AppActionDescriptor | undefined {
  return APP_ACTIONS.find((a) => a.key === key);
}

/* -------------------------------------------------------------------------- */
/* Builder step types — the palette beyond agents and installed-app actions.  */
/* -------------------------------------------------------------------------- */

/**
 * One tile per thing a person can add to a workflow. `stepType` is the value
 * written to `workflow_steps.step_type`, `fixedConfig` is merged into the new
 * step's config, and `needsAutomationMigration` marks the types the engine only
 * accepts once 20261132000000_workflow_automation.sql has been applied — the
 * builder says so plainly instead of letting the insert fail with a check
 * violation nobody can read.
 */
export interface BuilderStepDescriptor {
  key: string;
  stepType: "condition" | "action" | "app" | "router" | "delay" | "http";
  title: string;
  description: string;
  /** Material Symbols Rounded glyph. */
  icon: string;
  category: "Logic" | "Actions" | "Apps";
  fixedConfig?: Record<string, string>;
  needsAutomationMigration?: boolean;
}

export const BUILDER_STEP_TYPES: BuilderStepDescriptor[] = [
  {
    key: "filter",
    stepType: "condition",
    title: "Filter",
    description: "Carry on only when the data matches — otherwise skip this step and keep going.",
    icon: "filter_alt",
    category: "Logic",
    fixedConfig: { mode: "filter" },
  },
  {
    key: "router",
    stepType: "router",
    title: "Router",
    description: "Send the run down one of up to five named routes, with a fallback for the rest.",
    icon: "call_split",
    category: "Logic",
    needsAutomationMigration: true,
  },
  {
    key: "delay",
    stepType: "delay",
    title: "Delay",
    description: "Pause the run for a while, or until a date the data carries.",
    icon: "hourglass_top",
    category: "Logic",
    needsAutomationMigration: true,
  },
  {
    key: "http",
    stepType: "http",
    title: "HTTP request",
    description: "Call any https URL and use the response in later steps.",
    icon: "cloud_sync",
    category: "Actions",
  },
  {
    key: "notify_user",
    stepType: "action",
    title: "Notify member",
    description: "Send an in-app notification to a team member.",
    icon: "notifications",
    category: "Actions",
    fixedConfig: { action: "notify_user" },
  },
  {
    key: "create_task",
    stepType: "action",
    title: "Create task",
    description: "Create a task in a project.",
    icon: "add_task",
    category: "Actions",
    fixedConfig: { action: "create_task" },
  },
];

export const builderStepByKey = (key: string): BuilderStepDescriptor | undefined =>
  BUILDER_STEP_TYPES.find((s) => s.key === key);

/** The descriptor a stored step maps back to, for its canvas card and drawer. */
export function builderStepForStep(
  stepType: string,
  config: Record<string, unknown>,
): BuilderStepDescriptor | undefined {
  const action = typeof config.action === "string" ? config.action : "";
  // 'http' is the engine's own step type; the http.request app action is the
  // same thing reached through the action registry, so both map to one tile.
  if (stepType === "http" || (stepType === "app" && action === "http.request"))
    return builderStepByKey("http");
  if (stepType === "action")
    return BUILDER_STEP_TYPES.find((s) => s.stepType === "action" && s.fixedConfig?.action === action);
  if (stepType === "condition") return builderStepByKey("filter");
  return BUILDER_STEP_TYPES.find((s) => s.stepType === stepType && !s.fixedConfig);
}

/* -------------------------------------------------------------------------- */
/* Triggers.                                                                  */
/* -------------------------------------------------------------------------- */

export type TriggerKind = "manual" | "schedule" | "webhook" | "event";

export interface TriggerDescriptor {
  value: TriggerKind;
  label: string;
  description: string;
  icon: string;
  /** True for the kinds the `workflows.trigger_type` check only accepts after
   *  20261132000000_workflow_automation.sql. */
  needsAutomationMigration?: boolean;
}

export const TRIGGER_KINDS: TriggerDescriptor[] = [
  {
    value: "manual",
    label: "Manual / test run",
    description: "Only runs when someone presses Run now.",
    icon: "touch_app",
  },
  {
    value: "schedule",
    label: "On a schedule",
    description: "Runs itself every so often, in your workspace's time zone.",
    icon: "schedule",
  },
  {
    value: "webhook",
    label: "On a webhook",
    description: "Another system posts to a private URL and the run starts with that payload.",
    icon: "webhook",
    needsAutomationMigration: true,
  },
  {
    value: "event",
    label: "On an event in Cubes",
    description: "Runs when something happens in the Client app, CRM or Sheets — a deal arriving or changing, a row appearing, a client deciding.",
    icon: "bolt",
  },
];

/**
 * The v1 event keys (contract §2.8). Each carries a sample payload so the field
 * picker has something to offer before the first real event has ever fired.
 */
export interface WorkflowEventDescriptor {
  key: string;
  /** installed_apps.app_key of the app that emits it; the trigger picker hides events of apps not installed. */
  appKey: string;
  label: string;
  description: string;
  /** Shape of `workflow_events.payload` for this key. */
  sample: Record<string, unknown>;
}

export const WORKFLOW_EVENT_KEYS: WorkflowEventDescriptor[] = [
  {
    key: "client.request_created",
    appKey: "client",
    label: "Client sent a request",
    description: "A client contact submitted a request on a project in the Client app.",
    sample: {
      request_id: "00000000-0000-0000-0000-000000000001",
      project_id: "00000000-0000-0000-0000-000000000002",
      contact_id: "00000000-0000-0000-0000-000000000003",
      contact_name: "Client contact",
      request_type: "general",
      title: "Please add a story for the Diwali offer",
      details: "Same artwork as the post, 1080x1920.",
      priority: "normal",
      created_at: "2026-09-20T09:12:00Z",
    },
  },
  {
    key: "client.approval_decided",
    appKey: "client",
    label: "Client decided on an approval",
    description: "A client approved a piece of work or asked for changes.",
    sample: {
      approval_id: "00000000-0000-0000-0000-000000000004",
      project_id: "00000000-0000-0000-0000-000000000002",
      subject_kind: "content_item",
      subject_id: "00000000-0000-0000-0000-000000000005",
      version: 2,
      state: "changes_requested",
      decision_note: "Make the logo bigger.",
      decided_at: "2026-09-20T10:04:00Z",
    },
  },
  {
    key: "crm.deal_created",
    appKey: "crm",
    label: "A CRM deal was created",
    description: "A new lead or deal landed in the CRM.",
    // Built by app_crm_deal_event_payload (20261148000000): the keys the first
    // sample published come first, the rest is what a following step needs.
    // project_id (20261150000000) is null for a deal filed under no project.
    sample: {
      deal_id: "00000000-0000-0000-0000-000000000006",
      project_id: "00000000-0000-0000-0000-000000000002",
      name: "Website enquiry",
      stage: "New",
      stage_id: "00000000-0000-0000-0000-000000000010",
      status: "new",
      value: 45000,
      amount: 45000,
      currency: "INR",
      campaign_id: "00000000-0000-0000-0000-000000000007",
      campaign_name: "Diwali leads (CRM)",
      // The CRM campaign's channel — "meta", "google", …
      source: "meta",
      // The deal's own origin: "webhook", "website", "workflow", or null for one typed in.
      deal_source: "webhook",
      source_ref: { utm_source: "google", utm_medium: "cpc", utm_campaign: "diwali-2026", page: "/offer" },
      company_id: null,
      contact_id: "00000000-0000-0000-0000-000000000012",
      contact_name: "Asha Verma",
      email: "asha@example.com",
      phone: "+91 98765 43210",
      owner_id: null,
      created_by: null,
      close_date: null,
      created_at: "2026-09-20T07:30:00Z",
    },
  },
  {
    key: "sheets.row_created",
    appKey: "sheets",
    label: "A row was added to a sheet",
    description: "A row appeared in a sheet — from the app, or pulled in from Google.",
    sample: {
      sheet_id: "00000000-0000-0000-0000-00000000000a",
      sheet_name: "Leads",
      row_id: "00000000-0000-0000-0000-00000000000b",
      values: { name: "New lead", email: "lead@example.com", phone: "+91…" },
      created_at: "2026-09-20T11:00:00Z",
    },
  },
  {
    key: "sheets.changed",
    appKey: "sheets",
    label: "Someone edited the linked Google Sheet",
    description:
      "Somebody edited the Google Sheet a sheet is linked to, and the change came into Cubes. " +
      "Where live sync is switched on that is seconds after the edit; otherwise the scheduled " +
      "sync finds it — within fifteen minutes by default — and pressing “Sync now” fires it too. " +
      "An edit that brings nothing in here — a rename, a comment, a cell Cubes could not read — " +
      "fires nothing.",
    // Every field below is one the emitters really send: emitSheetChanged() in
    // src/lib/google/sheet-watch.ts and emitSheetChange() in
    // src/lib/sheets/google-sync.ts build the same shape, on purpose. The counts
    // appear twice — flat for conditions ({{trigger.pulled}}) and nested under
    // `counts` — because that is what the payload carries, not because it reads
    // nicely.
    sample: {
      sheet_id: "00000000-0000-0000-0000-00000000000c",
      sheet_name: "Leads",
      project_id: null,
      source: "custom",
      spreadsheet_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      spreadsheet_url: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit",
      sheet_gid: 0,
      sheet_title: "Leads",
      // How the change was NOTICED. Four values reach a workflow:
      //   poll                 the scheduled sync found it (google-sync.ts)
      //   manual               somebody pressed "Sync now"
      //   google_push          a live notification from Google (sheet-watch.ts)
      //   google_push_deferred the tail of a burst of typing that the debounce
      //                        window held back
      // The sample shows "poll" because that is what a deployment WITHOUT live
      // sync receives, and live sync needs a public HTTPS address on a domain
      // Google has verified. A condition written as trigger = "google_push"
      // against a sample that promised it would simply never run. Test
      // changed_rows, or leave the trigger alone, unless live edits really are
      // the only ones that matter.
      trigger: "poll",
      // Drive's resource state. The push path passes Google's own; the other
      // two send "update", the state Drive uses for a content change, so one
      // condition behaves the same whichever path noticed the edit.
      resource_state: "update",
      // Drive's X-Goog-Changed list — the only hint Google gives about the KIND
      // of edit, and only the live path ever has one. It is ["content"] on a
      // pushed edit and empty everywhere else, so a step that reads it must
      // cope with an empty list.
      changed: [],
      pushed: 0,
      pulled: 3,
      created: 1,
      deleted: 0,
      conflicts: 0,
      skipped: 0,
      changed_rows: 4,
      counts: { pushed: 0, pulled: 3, created: 1, deleted: 0, conflicts: 0, skipped: 0 },
      changed_at: "2026-09-20T11:42:00Z",
    },
  },
  {
    key: "crm.deal_status_changed",
    appKey: "crm",
    label: "A CRM deal changed status",
    description: "A deal's lead status moved — contacted, qualified, converted, junk… Filter on to_status for the one you mean.",
    sample: {
      deal_id: "00000000-0000-0000-0000-000000000006",
      project_id: "00000000-0000-0000-0000-000000000002",
      name: "Website enquiry",
      stage: "Meeting",
      stage_id: "00000000-0000-0000-0000-000000000013",
      status: "qualified",
      value: 45000,
      amount: 45000,
      currency: "INR",
      campaign_id: "00000000-0000-0000-0000-000000000007",
      campaign_name: "Diwali leads (CRM)",
      source: "meta",
      deal_source: "webhook",
      source_ref: { utm_source: "google", utm_medium: "cpc", utm_campaign: "diwali-2026", page: "/offer" },
      company_id: null,
      contact_id: "00000000-0000-0000-0000-000000000012",
      contact_name: "Asha Verma",
      email: "asha@example.com",
      phone: "+91 98765 43210",
      owner_id: null,
      created_by: null,
      close_date: null,
      created_at: "2026-09-20T07:30:00Z",
      from_status: "contacted",
      to_status: "qualified",
      changed_at: "2026-09-21T10:15:00Z",
    },
  },
  {
    key: "crm.deal_stage_changed",
    appKey: "crm",
    label: "A CRM deal moved to another stage",
    description: "A deal was moved between columns on the CRM board.",
    sample: {
      deal_id: "00000000-0000-0000-0000-000000000006",
      project_id: "00000000-0000-0000-0000-000000000002",
      name: "Website enquiry",
      stage: "Meeting",
      stage_id: "00000000-0000-0000-0000-000000000013",
      status: "qualified",
      value: 45000,
      amount: 45000,
      currency: "INR",
      campaign_id: "00000000-0000-0000-0000-000000000007",
      campaign_name: "Diwali leads (CRM)",
      source: "meta",
      deal_source: "webhook",
      source_ref: { utm_source: "google", utm_medium: "cpc", utm_campaign: "diwali-2026", page: "/offer" },
      company_id: null,
      contact_id: "00000000-0000-0000-0000-000000000012",
      contact_name: "Asha Verma",
      email: "asha@example.com",
      phone: "+91 98765 43210",
      owner_id: null,
      created_by: null,
      close_date: null,
      created_at: "2026-09-20T07:30:00Z",
      from_stage: "Screening",
      from_stage_id: "00000000-0000-0000-0000-000000000015",
      to_stage: "Meeting",
      to_stage_id: "00000000-0000-0000-0000-000000000013",
      changed_at: "2026-09-21T10:15:00Z",
    },
  },
];

export const workflowEventByKey = (key: string): WorkflowEventDescriptor | undefined =>
  WORKFLOW_EVENT_KEYS.find((e) => e.key === key);

/**
 * workflows.trigger_config when trigger_type = 'schedule'. next_run_at is
 * always computed server-side (SQL workflow_schedule_next_run) from this plus
 * the zone — never trusted from the browser.
 */
export interface ScheduleTriggerConfig {
  frequency: "every_n_minutes" | "hourly" | "daily" | "weekly";
  /** every_n_minutes: 15..720 */
  interval_minutes?: number;
  /** daily / weekly: local "HH:MM" (24h). hourly: minute past the hour via "00:MM". */
  time?: string;
  /** weekly: 0 = Sunday … 6 = Saturday; at least one. */
  days?: number[];
  /** IANA zone, e.g. "Asia/Kolkata" (browsers may report "Asia/Calcutta"). */
  timezone: string;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeSchedule(c: ScheduleTriggerConfig): string {
  switch (c.frequency) {
    case "every_n_minutes":
      return `Every ${c.interval_minutes ?? 60} minutes`;
    case "hourly":
      return `Every hour at :${(c.time ?? "00:00").slice(3, 5)}`;
    case "daily":
      return `Every day at ${c.time ?? "09:00"}`;
    case "weekly":
      return `Every ${(c.days ?? [1]).map((d) => DAY[d]).join(", ")} at ${c.time ?? "09:00"}`;
  }
}
