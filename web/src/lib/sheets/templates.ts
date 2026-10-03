/**
 * Sheets app — built-in templates. A template only fills in the new-sheet
 * draft; everything stays editable before and after creating the sheet. Team
 * templates (app_sheet_templates) use the same SheetTemplate shape.
 */
import type { SheetColumn, SheetTemplate } from "./types";

type Col = Omit<SheetColumn, "id">;

const f = (field: string, label: string, type: Col["type"], extra: Partial<Col> = {}): Col => ({
  field,
  label,
  type,
  ...extra,
});
const c = (label: string, type: Col["type"], extra: Partial<Col> = {}): Col => ({ label, type, ...extra });

export const BUILT_IN_TEMPLATES: SheetTemplate[] = [
  {
    /*
     * The social media calendar an agency runs, on top of Content Studio.
     *
     * f(...) columns are Content Studio's own fields and sync both ways with
     * the app, so the two never disagree. None sets options: a bound column's
     * own options would replace the source's, and Content Studio only knows
     * its own statuses and types. c(...) columns are the production details it
     * has no field for; they live with the sheet, round-trip to Google, and the
     * app never sees them. Hence two status-like columns, named so nobody has
     * to ask: "Publish status" is Content Studio's, "Production stage" is the
     * team's pipeline before it.
     *
     * Order is how an agency scans a calendar: when and what (date, title —
     * the two columns Google keeps frozen, google-layout frozenColumnCount),
     * where, then STATUS — stage, publish status, owner — before any of the
     * detail. Both status columns used to sit at 15 and 18 of 23, behind the
     * long-text Caption and Visual brief, off-screen in Google. Then what it
     * is, the words, the creative, going live, results. Labels stay unique —
     * Google columns are matched by header text.
     */
    key: "content_calendar",
    name: "Content calendar",
    description:
      "Every social post from idea to results — format, copy, creative, owner, numbers. " +
      "Production stage tracks your team's work; Publish status is Content Studio's.",
    icon: "calendar_month",
    category: "Content",
    source: "content_studio_items",
    sourceConfig: { include_shared: false },
    columns: [
      // When and what — frozen in Google, so they stay in view.
      f("scheduled_for", "Publish date", "datetime"),
      // Title and caption are what Content Studio needs to create a post.
      f("title", "Title", "text"),
      // Where it goes out.
      f("destinations", "Platforms", "multi_select", { dynamicOptions: "cs_destinations" }),
      // Status, scanned first. Production stage is the team's pipeline and
      // ends where Publish status (Content Studio's) takes over, so the two
      // sit side by side in that order. Colours follow the column editor's
      // palette and reach Google as conditional formats.
      c("Production stage", "select", {
        options: [
          { value: "idea", label: "Idea", color: "#8a8d98" },
          { value: "copywriting", label: "Copywriting", color: "#1c7ed6" },
          { value: "design", label: "Design / edit", color: "#862e9c" },
          { value: "internal_review", label: "Internal review", color: "#4a4ad0" },
          { value: "client_review", label: "Client review", color: "#b8842a" },
          { value: "changes_requested", label: "Changes requested", color: "#c0453c" },
          { value: "approved", label: "Approved", color: "#2f8f5f" },
        ],
      }),
      f("status", "Publish status", "select"),
      c("Owner", "person", { dynamicOptions: "team_members" }),
      // What it is. Content Studio's type is coarse (Social post, Blog post…);
      // the social format a designer works to is ours.
      f("content_type", "Content type", "select"),
      c("Format", "select", {
        options: [
          { value: "reel", label: "Reel / Short" },
          { value: "carousel", label: "Carousel" },
          { value: "static", label: "Static post" },
          { value: "story", label: "Story" },
          { value: "video", label: "Video" },
          { value: "text", label: "Text post" },
        ],
      }),
      // Pillars are each brand's own, so the list starts empty: an empty
      // select accepts whatever the team types (in Cubes or in Google) until
      // they fix a list, where a preset one would reject their real pillars.
      c("Content pillar", "select", { options: [] }),
      f("campaign", "Campaign", "select", { dynamicOptions: "cs_campaigns" }),
      // The words: hook, hashtags and CTA are the copywriter's working parts.
      c("Hook", "text"),
      f("body", "Caption", "long_text"),
      c("Hashtags", "text"),
      c("CTA", "text"),
      f("target_url", "Link", "url"),
      // The creative.
      c("Visual brief", "long_text"),
      c("Creative link", "url"),
      // Going live — Content Studio's.
      f("approval_required", "Approval required", "checkbox"),
      f("published_at", "Published at", "datetime"),
      // Results, then everything else.
      f("impressions", "Impressions", "number"),
      f("engagements", "Engagements", "number"),
      f("clicks", "Clicks", "number"),
      c("Feedback & notes", "long_text"),
    ],
    builtIn: true,
  },
  {
    key: "content_ideas",
    name: "Content ideas backlog",
    description: "Collect ideas before they become posts: platform, owner, status and a reference link.",
    icon: "lightbulb",
    category: "Content",
    source: "custom",
    sourceConfig: {},
    columns: [
      c("Idea", "text"),
      c("Platform", "select", {
        options: [
          { value: "instagram", label: "Instagram" },
          { value: "facebook", label: "Facebook" },
          { value: "linkedin", label: "LinkedIn" },
          { value: "youtube", label: "YouTube" },
          { value: "x", label: "X" },
          { value: "blog", label: "Blog" },
        ],
      }),
      c("Format", "select", {
        options: [
          { value: "reel", label: "Reel" },
          { value: "carousel", label: "Carousel" },
          { value: "static", label: "Static" },
          { value: "story", label: "Story" },
          { value: "video", label: "Video" },
          { value: "article", label: "Article" },
        ],
      }),
      c("Owner", "person", { dynamicOptions: "team_members" }),
      c("Status", "select", {
        options: [
          { value: "idea", label: "Idea", color: "#8a8d98" },
          { value: "approved", label: "Approved", color: "#4a4ad0" },
          { value: "in_production", label: "In production", color: "#b8842a" },
          { value: "done", label: "Done", color: "#2f8f5f" },
          { value: "dropped", label: "Dropped", color: "#c0453c" },
        ],
      }),
      c("Target date", "date"),
      c("Reference", "url"),
      c("Notes", "long_text"),
    ],
    builtIn: true,
  },
  {
    key: "task_tracker",
    name: "Task tracker",
    description: "This project's tasks as a sheet — status, priority, owners and dates, all editable.",
    icon: "task_alt",
    category: "Tasks",
    source: "tasks",
    sourceConfig: { include_subtasks: false, include_done: true },
    columns: [
      f("task_no", "#", "number"),
      f("name", "Task", "text"),
      f("status", "Status", "select", { dynamicOptions: "task_statuses" }),
      f("priority", "Priority", "select", { dynamicOptions: "task_priorities" }),
      f("assignees", "Assignees", "people", { dynamicOptions: "team_members" }),
      f("start_date", "Start", "date"),
      f("due_date", "Due", "date"),
      c("Notes", "long_text"),
    ],
    builtIn: true,
  },
  {
    key: "ad_campaign_plan",
    name: "Ad campaign plan",
    description: "Plan campaigns before they go live: objective, budget, dates, owner and status.",
    icon: "event_note",
    category: "Planning",
    source: "custom",
    sourceConfig: {},
    columns: [
      c("Campaign", "text"),
      c("Objective", "select", {
        options: [
          { value: "leads", label: "Leads" },
          { value: "sales", label: "Sales" },
          { value: "traffic", label: "Traffic" },
          { value: "awareness", label: "Awareness" },
          { value: "engagement", label: "Engagement" },
          { value: "app", label: "App promotion" },
        ],
      }),
      c("Daily budget", "currency", { currency: "INR" }),
      c("Start", "date"),
      c("End", "date"),
      c("Owner", "person", { dynamicOptions: "team_members" }),
      c("Status", "select", {
        options: [
          { value: "planned", label: "Planned", color: "#8a8d98" },
          { value: "live", label: "Live", color: "#2f8f5f" },
          { value: "paused", label: "Paused", color: "#b8842a" },
          { value: "ended", label: "Ended", color: "#c0453c" },
        ],
      }),
      c("Brief", "url"),
    ],
    builtIn: true,
  },
  {
    key: "client_report",
    name: "Client reporting sheet",
    description: "A monthly client report: deliverables, results and next steps per line.",
    icon: "summarize",
    category: "Planning",
    source: "custom",
    sourceConfig: {},
    columns: [
      c("Month", "date"),
      c("Deliverable", "text"),
      c("Platform", "text"),
      c("Result", "text"),
      c("Spend", "currency", { currency: "INR" }),
      c("Status", "select", {
        options: [
          { value: "on_track", label: "On track", color: "#2f8f5f" },
          { value: "at_risk", label: "At risk", color: "#b8842a" },
          { value: "off_track", label: "Off track", color: "#c0453c" },
        ],
      }),
      c("Next steps", "long_text"),
    ],
    builtIn: true,
  },
  {
    key: "blank",
    name: "Blank sheet",
    description: "Start with three columns and build your own.",
    icon: "grid_on",
    category: "Custom",
    source: "custom",
    sourceConfig: {},
    columns: [c("Name", "text"), c("Status", "select", { options: [] }), c("Notes", "long_text")],
    builtIn: true,
  },
];
