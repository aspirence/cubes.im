import type { SupabaseClient } from "@supabase/supabase-js";
import { composeEmail } from "@/lib/email/compose";
import { formatSender, sendResendEmail } from "@/lib/email/resend";
import type { TemplateVars } from "@/lib/email/templates";
import { appUrl } from "./http";

/**
 * Sending the four client-facing emails.
 *
 * Why this doesn't reuse runEmailDispatch(): the magic-link route is public —
 * there is no signed-in user — so there is no access token for the send-email
 * edge function and no user id for email_log.created_by. This dispatcher takes
 * the same two senders the engine does, in the order that matters for a CLIENT
 * (the agency's own Resend sender first, so the mail comes from the agency's
 * domain; the platform sender only as a fallback), logs the attempt the same
 * way, and never throws for a send outcome.
 *
 * THE HONESTY RULE (docs/AUTOMATION_CLIENT.md): when nothing is
 * configured this returns `skipped` with a reason, and callers must surface
 * that instead of claiming the mail went out. Today's workspace-invite modal
 * says "Invitation sent" regardless; that is the bug this exists not to repeat.
 */

export type ClientEmailStatus = "sent" | "failed" | "skipped";

export interface ClientEmailResult {
  status: ClientEmailStatus;
  /** Safe to show a member: authored here or by sendResendEmail, never raw. */
  reason?: string;
  /** Which sender actually carried it, for the UI's "sent from" line. */
  scope?: "workspace" | "platform";
}

/** Injectable for tests; production always uses the real Resend call. */
export type Sender = typeof sendResendEmail;

interface SenderConfig {
  scope: "workspace" | "platform";
  from: string;
  replyTo: string | null;
  apiKey: string;
}

async function workspaceSender(
  admin: SupabaseClient,
  teamId: string,
): Promise<SenderConfig | null> {
  const { data: connection } = await admin
    .from("app_resend_connections")
    .select("from_email, from_name, reply_to, enabled")
    .eq("team_id", teamId)
    .maybeSingle();
  if (!connection?.from_email || !connection.enabled) return null;

  const { data: secret } = await admin
    .from("app_resend_secrets")
    .select("api_key")
    .eq("team_id", teamId)
    .maybeSingle();
  if (!secret?.api_key) return null;

  return {
    scope: "workspace",
    from: formatSender(connection.from_email, connection.from_name),
    replyTo: connection.reply_to ?? null,
    apiKey: secret.api_key,
  };
}

async function platformSender(
  admin: SupabaseClient,
): Promise<SenderConfig | null> {
  const { data: sender } = await admin
    .from("platform_email_sender")
    .select("from_email, from_name, reply_to, enabled")
    .eq("id", "default")
    .maybeSingle();
  if (!sender?.from_email || !sender.enabled) return null;

  const { data: secret } = await admin
    .from("platform_email_secrets")
    .select("api_key")
    .eq("id", "default")
    .maybeSingle();
  if (!secret?.api_key) return null;

  return {
    scope: "platform",
    from: formatSender(sender.from_email, sender.from_name),
    replyTo: sender.reply_to ?? null,
    apiKey: secret.api_key,
  };
}

export interface ClientEmailInput {
  teamId: string;
  eventKey:
    | "client.invitation"
    | "client.magic_link"
    | "client.approval_requested"
    | "client.request_received";
  to: string;
  vars: TemplateVars;
  /** The agency user who triggered it; null on the public magic-link path. */
  userId?: string | null;
}

export async function sendClientEmail(
  admin: SupabaseClient,
  input: ClientEmailInput,
  send: Sender = sendResendEmail,
): Promise<ClientEmailResult> {
  const log = async (
    status: ClientEmailStatus,
    subject: string,
    reason?: string,
  ) => {
    await admin.from("email_log").insert({
      team_id: input.teamId,
      event_key: input.eventKey,
      to_email: input.to,
      subject,
      status,
      detail: reason ?? null,
      created_by: input.userId ?? null,
    });
  };

  // The platform-wide switch still wins: a super admin can turn any of these
  // four scenarios off for everyone.
  const { data: trigger } = await admin
    .from("platform_email_triggers")
    .select("enabled")
    .eq("event_key", input.eventKey)
    .maybeSingle();
  if (!trigger) {
    return { status: "skipped", reason: `Unknown email trigger "${input.eventKey}".` };
  }
  if (!trigger.enabled) {
    return { status: "skipped", reason: "This email is turned off platform-wide." };
  }

  const rendered = await composeEmail(admin, input.eventKey, {
    app_url: appUrl(),
    ...input.vars,
  });
  if (!rendered) {
    return { status: "skipped", reason: "No template for this scenario." };
  }

  const sender =
    (await workspaceSender(admin, input.teamId)) ??
    (await platformSender(admin));
  if (!sender) {
    await log("skipped", rendered.subject, "No email sender configured.");
    return {
      status: "skipped",
      reason:
        "Email is not configured, so nothing was sent. Connect a Resend sender in Settings, or copy the link and send it yourself.",
    };
  }

  const result = await send({
    apiKey: sender.apiKey,
    from: sender.from,
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    replyTo: sender.replyTo ?? undefined,
  });

  await log(
    result.ok ? "sent" : "failed",
    rendered.subject,
    result.ok ? undefined : (result.reason ?? "Send failed."),
  );
  return result.ok
    ? { status: "sent", scope: sender.scope }
    : { status: "failed", reason: result.reason ?? "Send failed.", scope: sender.scope };
}

/** The URL a magic-link token turns into. One route handles verify + cookie. */
export function magicLinkUrl(token: string): string {
  return `${appUrl()}/api/client/auth/${token}`;
}

/** "name" → ", name" for the templates' {{comma_name}}. */
export function commaName(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0] ?? "";
  return first ? `, ${first}` : "";
}
