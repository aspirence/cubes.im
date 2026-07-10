/**
 * Integrations catalog — the code registry powering the App Center's directory
 * of third-party integrations. This is a browsable catalog:
 * entries whose `connectionProvider` maps to a real org connector
 * (app_connections: slack / webhook / email / whatsapp) show live "Connected"
 * state and are managed in Settings → Apps; the rest are directory listings.
 *
 * First-party installable apps live in a separate registry (./catalog.ts) and
 * are surfaced under the "Cubes Apps" category by the App Center page.
 */

export type ConnectionProvider = "slack" | "webhook" | "email" | "whatsapp";

/** Category keys. `order` drives the rail; `icon` is a Material Symbol. */
export interface IntegrationCategory {
  key: string;
  label: string;
  icon: string;
}

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  { key: "communication", label: "Communication", icon: "forum" },
  { key: "development", label: "Development", icon: "code" },
  { key: "cloud-storage", label: "Cloud Storage", icon: "cloud" },
  { key: "calendars", label: "Calendars", icon: "calendar_month" },
  { key: "design", label: "Design", icon: "brush" },
  { key: "crm-support", label: "CRM & Support", icon: "support_agent" },
  { key: "analytics", label: "Analytics", icon: "monitoring" },
  { key: "email", label: "Email", icon: "mail" },
  { key: "finance", label: "Finance & Accounting", icon: "account_balance" },
  { key: "knowledge", label: "Knowledge Base", icon: "menu_book" },
  { key: "time-tracking", label: "Time Tracking", icon: "schedule" },
  { key: "automation", label: "Automation", icon: "bolt" },
];

export interface Integration {
  key: string;
  name: string;
  description: string;
  /** category key (see INTEGRATION_CATEGORIES). */
  category: string;
  /** Shown in the Featured section / tab. */
  featured?: boolean;
  /** 1–2 char monogram for the icon tile. */
  mono: string;
  /** Brand-ish tile color. */
  color: string;
  /** When set, this integration is backed by a real org connector. */
  connectionProvider?: ConnectionProvider;
}

const I = (
  key: string,
  name: string,
  category: string,
  mono: string,
  color: string,
  description: string,
  extra?: Partial<Integration>,
): Integration => ({ key, name, category, mono, color, description, ...extra });

export const INTEGRATIONS: Integration[] = [
  // Communication
  I("slack", "Slack", "communication", "S", "#4a154b", "Send task updates and alerts into Slack channels, and turn messages into tasks.", { featured: true, connectionProvider: "slack" }),
  I("ms-teams", "Microsoft Teams", "communication", "T", "#5059c9", "Transform conversations into action — create and update tasks from Teams.", { featured: true }),
  I("zoom", "Zoom", "communication", "Z", "#2d8cff", "Start Zoom calls with one click from a task and attach recordings.", { featured: true }),
  I("discord", "Discord", "communication", "D", "#5865f2", "Post project activity to Discord channels and create tasks from messages."),
  I("whatsapp", "WhatsApp", "communication", "W", "#25d366", "Send task reminders and notifications over WhatsApp."),
  I("twilio", "Twilio", "communication", "Tw", "#f22f46", "Send SMS notifications for due dates, assignments, and mentions."),

  // Development
  I("github", "GitHub", "development", "Gh", "#24292e", "Link pull requests, branches, and commits to tasks and auto-update status.", { featured: true }),
  I("gitlab", "GitLab", "development", "Gl", "#fc6d26", "Connect merge requests and pipelines to tasks."),
  I("bitbucket", "Bitbucket", "development", "Bb", "#2684ff", "Link Bitbucket commits, branches, and pull requests to your work."),
  I("jira", "Jira", "development", "J", "#0052cc", "Preview, create, and search Jira issues without leaving your tasks.", { featured: true }),
  I("linear", "Linear", "development", "L", "#5e6ad2", "Sync Linear issues with tasks two ways."),
  I("sentry", "Sentry", "development", "Se", "#362d59", "Turn Sentry issues into tasks and track resolution."),
  I("azure-devops", "Azure DevOps", "development", "Az", "#0078d4", "Boost your engineering team's efficiency by syncing work items."),

  // Cloud Storage
  I("dropbox", "Dropbox", "cloud-storage", "Db", "#0061ff", "Attach Dropbox files to tasks and search your files.", { featured: true }),
  I("google-drive", "Google Drive", "cloud-storage", "Dr", "#1fa463", "Easily attach, create, and search Google Drive files.", { featured: true }),
  I("box", "Box", "cloud-storage", "Bx", "#0061d5", "Attach Box files and keep documents in sync with your tasks."),
  I("onedrive", "OneDrive", "cloud-storage", "Od", "#0364b8", "Attach and preview OneDrive files on tasks."),

  // Calendars
  I("google-calendar", "Google Calendar", "calendars", "GC", "#4285f4", "Two-way sync between Google Calendar and your tasks' due dates.", { featured: true }),
  I("outlook-calendar", "Outlook Calendar", "calendars", "OC", "#0f6cbd", "Sync between Outlook Calendar and your schedule.", { featured: true }),
  I("calendly", "Calendly", "calendars", "Cy", "#006bff", "Create tasks automatically when meetings are booked."),
  I("ical", "Calendar subscription (iCal)", "calendars", "iC", "#8a8d98", "Add Cubes tasks to any calendar via an iCal feed."),

  // Design
  I("figma", "Figma", "design", "Fi", "#a259ff", "View Figma designs, create new files, and embed frames on tasks.", { featured: true }),
  I("miro", "Miro", "design", "Mi", "#ffd02f", "Embed Miro boards on tasks for whiteboarding and planning."),
  I("loom", "Loom", "design", "Lo", "#625df5", "Record and embed Loom videos directly on tasks."),

  // CRM & Support
  I("salesforce", "Salesforce", "crm-support", "Sf", "#00a1e0", "Preview Salesforce links, create records, and link opportunities to work.", { featured: true }),
  I("hubspot", "HubSpot", "crm-support", "Hs", "#ff7a59", "Connect deals and tickets to projects and tasks."),
  I("zendesk", "Zendesk", "crm-support", "Zd", "#03363d", "Create tasks from Zendesk tickets and track resolution."),
  I("intercom", "Intercom", "crm-support", "In", "#1f8ded", "Turn Intercom conversations into actionable tasks."),

  // Analytics
  I("google-analytics", "Google Analytics", "analytics", "GA", "#e37400", "Surface site metrics next to your project work."),
  I("amplitude", "Amplitude", "analytics", "Am", "#1f6fff", "Let AI query product analytics and attach insights to tasks."),
  I("mixpanel", "Mixpanel", "analytics", "Mx", "#7856ff", "Track product events and tie experiments to tasks."),
  I("datadog", "Datadog", "analytics", "Dd", "#632ca6", "Create tasks from Datadog monitors and incidents."),

  // Email
  I("gmail", "Gmail", "email", "Gm", "#ea4335", "Create tasks from emails and reply from within a task."),
  I("outlook", "Outlook", "email", "Ol", "#0f6cbd", "Turn Outlook emails into tasks and keep threads attached."),
  I("mailchimp", "Mailchimp", "email", "Mc", "#ffe01b", "Trigger tasks from campaign events and audience changes."),
  I("smtp-email", "Email (SMTP)", "email", "@", "#4a4ad0", "Send task notifications and digests over your own SMTP server."),

  // Finance & Accounting
  I("stripe", "Stripe", "finance", "St", "#635bff", "Create tasks from payments, disputes, and failed charges."),
  I("quickbooks", "QuickBooks", "finance", "Qb", "#2ca01c", "Link invoices and expenses to client projects."),
  I("xero", "Xero", "finance", "Xe", "#13b5ea", "Connect Xero invoices and bills to project budgets."),

  // Knowledge Base
  I("notion", "Notion", "knowledge", "N", "#111111", "Embed Notion pages on tasks and link docs to projects."),
  I("confluence", "Confluence", "knowledge", "Cf", "#172b4d", "Attach Confluence pages and keep specs next to the work."),
  I("airtable", "Airtable", "knowledge", "At", "#fcb400", "Sync Airtable records with tasks two ways."),

  // Time Tracking
  I("harvest", "Harvest", "time-tracking", "Hv", "#fa5d00", "Track time on tasks and sync entries to Harvest."),
  I("toggl", "Toggl Track", "time-tracking", "Tg", "#e57cd8", "Start Toggl timers from tasks and sync durations."),
  I("clockify", "Clockify", "time-tracking", "Ck", "#03a9f4", "Log time against tasks and export timesheets."),

  // Automation
  I("zapier", "Zapier", "automation", "Zp", "#ff4a00", "Connect Cubes to 6,000+ apps with automated Zaps."),
  I("make", "Make", "automation", "Mk", "#6d00cc", "Build visual automations across your stack."),
  I("webhooks", "Webhooks", "automation", "Wh", "#2b2b31", "Send events to any URL, or receive them to create and update tasks.", { connectionProvider: "webhook" }),
];

export const FEATURED_INTEGRATIONS = INTEGRATIONS.filter((i) => i.featured);

export function integrationsByCategory(catKey: string): Integration[] {
  return INTEGRATIONS.filter((i) => i.category === catKey);
}
