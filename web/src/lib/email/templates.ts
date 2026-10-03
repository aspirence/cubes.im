/**
 * Platform email templates — the branded shell, {{variable}} rendering, and
 * per-scenario defaults. Isomorphic on purpose: the admin template editor
 * renders live previews with exactly the code the send path uses. DB overrides
 * (platform_email_templates) are loaded server-side in ./compose.ts.
 */

export interface EmailTemplate {
  subject: string;
  /** INNER body html — wrapped in the branded shell at render time. */
  body: string;
}

export type TemplateVars = Record<string, string>;

const BRAND = "#4a4ad0";

/** HTML-escapes a variable value before substitution. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Replaces {{name}} placeholders; unknown placeholders render as empty. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) =>
    escapeHtml(vars[key] ?? ""),
  );
}

/**
 * The branded outer shell every platform email ships in: light background,
 * card, logo header (the cube mascot served from the app's /brand assets —
 * hosted <img> because Gmail strips inline SVG), footer. Email-client-safe:
 * inline styles only, explicit img dimensions, alt fallback when images are
 * blocked.
 */
export function brandShell(bodyHtml: string, appUrl?: string): string {
  const origin = (appUrl ?? "https://cubes.im").replace(/\/$/, "");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f8;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="text-align:center;padding:0 0 18px;">
        <img src="${origin}/brand/cubes.im_logo.png" width="48" height="48" alt="Cubes"
             style="display:block;margin:0 auto 4px;border:0;" />
        <span style="display:inline-block;font:800 19px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${BRAND};letter-spacing:-0.3px;">Cubes</span>
      </div>
      <div style="background:#ffffff;border:1px solid #e8e9ee;border-radius:14px;padding:28px 28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2329;">
        ${bodyHtml}
      </div>
      <div style="text-align:center;padding:16px 8px 0;font:400 11.5px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#9a9daa;">
        Sent by Cubes — one workspace for everything your team does.<br/>
        You received this because of activity on your Cubes account.
      </div>
    </div>
  </body>
</html>`;
}

/** A brand-colored CTA button, usable inside template bodies. */
export function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font:600 13.5px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:12px 22px;border-radius:9px;">${label}</a>`;
}

/**
 * Code defaults per scenario. A row in platform_email_templates overrides
 * these; deleting the row resets back here. Variables available per scenario
 * are listed in TEMPLATE_VARIABLES (shown in the editor).
 */
export const DEFAULT_TEMPLATES: Record<string, EmailTemplate> = {
  "account.invitation_sent": {
    subject: "{{inviter}} invited you to {{team}} on Cubes",
    body: `
<h2 style="margin:0 0 14px;font-size:19px;">You're invited{{comma_name}}</h2>
<p style="margin:0 0 12px;line-height:1.6;font-size:14px;">
  <strong>{{inviter}}</strong> invited you to join
  <strong>{{team}}</strong> on Cubes — one workspace for projects, tasks and
  everything the team does.
</p>
<p style="margin:0 0 20px;line-height:1.6;font-size:14px;">
  Sign in with this email address — or create an account if you don't have
  one yet — and the invitation will be waiting for you.
</p>
<p style="margin:0 0 6px;">${ctaButton("{{app_url}}/login", "Join {{team}}")}</p>
<p style="margin:18px 0 0;color:#9a9daa;font-size:12.5px;">— The Cubes team</p>
    `.trim(),
  },
  "account.signup_welcome": {
    subject: "Welcome to Cubes 🎉",
    body: `
<h2 style="margin:0 0 14px;font-size:19px;">Welcome aboard{{comma_name}}</h2>
<p style="margin:0 0 12px;line-height:1.6;font-size:14px;">
  Your Cubes account is ready. Projects, tasks, HR, schedules and workflows —
  everything your team does, flowing in one place.
</p>
<p style="margin:0 0 20px;line-height:1.6;font-size:14px;">
  Set up your workspace, invite your team, and start where the work is.
</p>
<p style="margin:0 0 6px;">${ctaButton("{{app_url}}", "Open Cubes")}</p>
<p style="margin:18px 0 0;color:#9a9daa;font-size:12.5px;">— The Cubes team</p>
    `.trim(),
  },
  // --- Client app (docs/AUTOMATION_CLIENT.md, Part 2) ----------------
  // These four go to a CLIENT, not a teammate, so they name the agency rather
  // than Cubes, they never mention anything internal, and every CTA is a
  // single-use link that expires — the client is not asked to keep a password.
  "client.invitation": {
    subject: "{{agency}} shared {{project}} with you",
    body: `
<h2 style="margin:0 0 14px;font-size:19px;">You've been given access{{comma_name}}</h2>
<p style="margin:0 0 12px;line-height:1.6;font-size:14px;">
  <strong>{{agency}}</strong> shared <strong>{{project}}</strong> with you. You'll
  find the work in progress, anything waiting on your approval, and a place to
  send new requests.
</p>
<p style="margin:0 0 20px;line-height:1.6;font-size:14px;">
  No password to remember — this link signs you in, and from then on you can ask
  for a new one from the sign-in page any time.
</p>
<p style="margin:0 0 6px;">${ctaButton("{{link_url}}", "Open {{project}}")}</p>
<p style="margin:18px 0 0;color:#9a9daa;font-size:12.5px;">
  This link works once and expires in {{expires_minutes}} minutes.
</p>
    `.trim(),
  },
  "client.magic_link": {
    subject: "Your sign-in link for {{agency}}",
    body: `
<h2 style="margin:0 0 14px;font-size:19px;">Here's your sign-in link</h2>
<p style="margin:0 0 20px;line-height:1.6;font-size:14px;">
  Tap the button to sign in to <strong>{{agency}}</strong>. It works once and
  expires in {{expires_minutes}} minutes.
</p>
<p style="margin:0 0 6px;">${ctaButton("{{link_url}}", "Sign in")}</p>
<p style="margin:18px 0 0;color:#9a9daa;font-size:12.5px;">
  If you didn't ask for this, you can ignore it — nothing happens until the link
  is opened.
</p>
    `.trim(),
  },
  "client.approval_requested": {
    subject: "{{agency}} needs your approval on {{item}}",
    body: `
<h2 style="margin:0 0 14px;font-size:19px;">Waiting on you{{comma_name}}</h2>
<p style="margin:0 0 12px;line-height:1.6;font-size:14px;">
  <strong>{{agency}}</strong> asked you to review <strong>{{item}}</strong> on
  {{project}}.
</p>
<p style="margin:0 0 20px;line-height:1.6;font-size:14px;">{{note}}</p>
<p style="margin:0 0 6px;">${ctaButton("{{link_url}}", "Review and decide")}</p>
<p style="margin:18px 0 0;color:#9a9daa;font-size:12.5px;">
  Your decision is recorded with your name and the time, so everyone has the
  same record of it.
</p>
    `.trim(),
  },
  "client.request_received": {
    subject: "New client request: {{title}}",
    body: `
<h2 style="margin:0 0 14px;font-size:19px;">{{requester}} sent a request</h2>
<p style="margin:0 0 12px;line-height:1.6;font-size:14px;">
  On <strong>{{project}}</strong>:<br/><strong>{{title}}</strong>
</p>
<p style="margin:0 0 20px;line-height:1.6;font-size:14px;color:#5b6070;">{{details}}</p>
<p style="margin:0 0 6px;">${ctaButton("{{link_url}}", "Open the request queue")}</p>
<p style="margin:18px 0 0;color:#9a9daa;font-size:12.5px;">
  Accepting it creates a real task on the project; declining records why.
</p>
    `.trim(),
  },
};

/** Editor hint: which {{variables}} each scenario supports. */
export const TEMPLATE_VARIABLES: Record<string, string[]> = {
  "account.signup_welcome": ["name", "comma_name", "email", "app_url"],
  "account.invitation_sent": [
    "name",
    "comma_name",
    "inviter",
    "team",
    "email",
    "app_url",
  ],
  "client.invitation": [
    "name",
    "comma_name",
    "agency",
    "project",
    "link_url",
    "expires_minutes",
    "email",
    "app_url",
  ],
  "client.magic_link": [
    "name",
    "comma_name",
    "agency",
    "link_url",
    "expires_minutes",
    "email",
    "app_url",
  ],
  "client.approval_requested": [
    "name",
    "comma_name",
    "agency",
    "project",
    "item",
    "note",
    "link_url",
    "app_url",
  ],
  "client.request_received": [
    "name",
    "comma_name",
    "requester",
    "project",
    "title",
    "details",
    "link_url",
    "app_url",
  ],
};

/** Sample values used for editor previews. */
export const PREVIEW_VARS: TemplateVars = {
  name: "Rahul",
  comma_name: ", Rahul",
  inviter: "Vinay",
  team: "Acme Inc",
  email: "rahul@example.com",
  app_url: "https://cubes.im",
};

/** Renders subject + full html from a template and variables. */
export function renderEmail(
  template: EmailTemplate,
  vars: TemplateVars,
): { subject: string; html: string } {
  return {
    subject: renderTemplate(template.subject, vars),
    html: brandShell(renderTemplate(template.body, vars), vars.app_url),
  };
}
