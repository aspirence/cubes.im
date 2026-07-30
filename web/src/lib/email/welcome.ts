import { emailServiceClient } from "./server";
import { invokeSendEmailEdge } from "./edge";
import { runPlatformDispatch } from "./engine";
import { composeEmail } from "./compose";
import type { TemplateVars } from "./templates";

/** Event key for the "new workspace signed up" super-admin alert. Not registered
 *  in platform_email_triggers (it always fires), so dispatch skips the switch. */
const SIGNUP_NOTIFY_EVENT = "platform.new_signup";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function signupNotifyHtml(v: {
  name: string;
  email: string;
  workspace: string | null;
  when: string;
  appUrl: string;
}): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#8b90a0;font-size:13px;width:120px">${label}</td>` +
    `<td style="padding:6px 0;color:#16203a;font-size:13px;font-weight:600">${value}</td></tr>`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px">
    <div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:14px">
      <span style="width:34px;height:34px;border-radius:9px;background:linear-gradient(140deg,#34346a,#4a4ad0);display:inline-block"></span>
      <span style="font-size:18px;font-weight:800;color:#16203a">Cubes</span>
    </div>
    <h1 style="font-size:18px;color:#16203a;margin:0 0 4px">New account signup 🎉</h1>
    <p style="font-size:13px;color:#5b5f74;margin:0 0 16px">A new owner just created a workspace on Cubes.</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eceef6;border-bottom:1px solid #eceef6;margin-bottom:18px">
      ${row("Name", esc(v.name))}
      ${row("Email", esc(v.email))}
      ${row("Workspace", esc(v.workspace ?? "—"))}
      ${row("Signed up", esc(v.when))}
    </table>
    <a href="${v.appUrl}/home" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:9px">Open platform dashboard</a>
    <p style="font-size:11px;color:#9aa0b0;margin:18px 0 0">You're receiving this because you're a Cubes platform super-admin.</p>
  </div>`;
}

/**
 * Notifies every platform super-admin that a new workspace/account signed up.
 * Fire-and-forget, NEVER throws (must not break signup/login). Deduped per new
 * user via email_log, so the signup page and the auth callback can't double-send.
 */
export async function notifyAdminsOfSignupSafely(input: {
  userId: string;
  email: string;
  name?: string | null;
}): Promise<void> {
  try {
    const email = input.email.trim().toLowerCase();
    if (!email) return;

    const admin = emailServiceClient();
    if (!admin) return;

    // Dedupe: bail if this signup was already announced.
    const { data: already } = await admin
      .from("email_log")
      .select("id")
      .eq("event_key", SIGNUP_NOTIFY_EVENT)
      .eq("created_by", input.userId)
      .eq("status", "sent")
      .limit(1)
      .maybeSingle();
    if (already) return;

    // Recipients = super-admins' addresses (exclude the new user themselves).
    const { data: adminRows } = await admin.from("platform_admins").select("user_id");
    const ids = (adminRows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean);
    if (ids.length === 0) return;
    const { data: recipients } = await admin.from("users").select("email").in("id", ids);
    const emails = Array.from(
      new Set(
        (recipients ?? [])
          .map((u: { email: string | null }) => (u.email ?? "").trim().toLowerCase())
          .filter((e: string) => e && e !== email),
      ),
    );
    if (emails.length === 0) return;

    // Workspace name for context (owner's org).
    const { data: org } = await admin
      .from("organizations")
      .select("organization_name")
      .eq("user_id", input.userId)
      .maybeSingle();

    const name = input.name?.trim() || email.split("@")[0];
    const subject = `New Cubes signup: ${name}`;
    const html = signupNotifyHtml({
      name,
      email,
      workspace: (org?.organization_name as string | undefined) ?? null,
      when: new Date().toUTCString(),
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im",
    });

    for (const to of emails) {
      await runPlatformDispatch(
        admin,
        { eventKey: SIGNUP_NOTIFY_EVENT, to, subject, html, userId: input.userId },
        { skipTriggerCheck: true },
      );
    }
  } catch (err) {
    console.error("signup admin-notify failed:", err);
  }
}

/** Variables the signup-welcome template can reference. */
export function welcomeVars(email: string, name?: string | null): TemplateVars {
  const first = name?.trim().split(/\s+/)[0] ?? "";
  return {
    name: first,
    comma_name: first ? `, ${first}` : "",
    email,
    app_url: process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im",
  };
}

/**
 * Fires the signup welcome email (platform scope, to the user's own address)
 * using the DB-overridable template. NEVER throws — a welcome email must not
 * break signup or login. Duplicate calls are safe: the dispatch pipeline
 * skips when one was already sent.
 */
export async function sendWelcomeEmailSafely(input: {
  userId: string;
  email: string;
  name?: string | null;
  accessToken: string;
}): Promise<void> {
  try {
    const email = input.email.trim().toLowerCase();
    if (!email) return;

    const admin = emailServiceClient();
    if (!admin) return;

    const rendered = await composeEmail(
      admin,
      "account.signup_welcome",
      welcomeVars(email, input.name),
    );
    if (!rendered) return;

    const payload = {
      scope: "platform" as const,
      eventKey: "account.signup_welcome",
      to: email,
      subject: rendered.subject,
      html: rendered.html,
    };

    const edge = await invokeSendEmailEdge(payload, input.accessToken);
    if (edge) return;

    await runPlatformDispatch(admin, {
      eventKey: payload.eventKey,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      userId: input.userId,
    });
  } catch (err) {
    console.error("welcome email failed:", err);
  }
}
