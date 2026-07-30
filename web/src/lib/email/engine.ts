import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSender, sendResendEmail } from "./resend";

/**
 * In-process email engine — the FALLBACK path. The primary dispatcher is the
 * `send-email` Supabase Edge Function (supabase/functions/send-email), which
 * implements this exact logic; the routes call it first and only run this
 * while the function isn't deployed. Change the two together.
 */

export type EmailDispatchStatus = "sent" | "failed" | "skipped";

export interface EmailDispatchInput {
  teamId: string;
  eventKey: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Caller recorded as email_log.created_by. */
  userId: string;
}

async function logAttempt(
  admin: SupabaseClient,
  input: EmailDispatchInput,
  status: EmailDispatchStatus,
  reason?: string,
): Promise<void> {
  await admin.from("email_log").insert({
    team_id: input.teamId,
    event_key: input.eventKey,
    to_email: input.to,
    subject: input.subject,
    status,
    detail: reason ?? null,
    created_by: input.userId,
  });
}

/**
 * Re-checks both platform switches, sends via the workspace's Resend sender,
 * and records the attempt. Never throws for send-path outcomes — they come
 * back as sent/failed/skipped; only unexpected DB read errors throw.
 */
export async function runEmailDispatch(
  admin: SupabaseClient,
  input: EmailDispatchInput,
  options?: { skipTriggerCheck?: boolean },
): Promise<{ ok: boolean; status: EmailDispatchStatus; reason?: string }> {
  const finish = async (status: EmailDispatchStatus, reason?: string) => {
    await logAttempt(admin, input, status, reason);
    return { ok: status === "sent", status, reason };
  };

  if (!options?.skipTriggerCheck) {
    const { data: trigger, error: triggerError } = await admin
      .from("platform_email_triggers")
      .select("enabled")
      .eq("event_key", input.eventKey)
      .maybeSingle();
    if (triggerError) throw new Error(triggerError.message);
    if (!trigger) return finish("skipped", `Unknown email trigger "${input.eventKey}".`);
    if (!trigger.enabled) return finish("skipped", "Trigger disabled platform-wide.");
  }

  const { data: connection, error: connError } = await admin
    .from("app_resend_connections")
    .select("from_email, from_name, reply_to, enabled")
    .eq("team_id", input.teamId)
    .maybeSingle();
  if (connError) throw new Error(connError.message);
  if (!connection?.from_email) {
    return finish("skipped", "No sender configured for this workspace.");
  }
  if (!connection.enabled) {
    return finish("skipped", "Sender disabled for this workspace.");
  }

  const { data: secret } = await admin
    .from("app_resend_secrets")
    .select("api_key")
    .eq("team_id", input.teamId)
    .maybeSingle();
  if (!secret?.api_key) return finish("skipped", "No API key stored.");

  const result = await sendResendEmail({
    apiKey: secret.api_key,
    from: formatSender(connection.from_email, connection.from_name),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: connection.reply_to ?? undefined,
  });

  return result.ok ? finish("sent") : finish("failed", result.reason ?? "Send failed.");
}

/* ------------------------------------------------------------- platform --- */

export interface PlatformDispatchInput {
  eventKey: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  userId: string;
}

async function logPlatformAttempt(
  admin: SupabaseClient,
  input: PlatformDispatchInput,
  status: EmailDispatchStatus,
  reason?: string,
): Promise<void> {
  await admin.from("email_log").insert({
    team_id: null,
    event_key: input.eventKey,
    to_email: input.to,
    subject: input.subject,
    status,
    detail: reason ?? null,
    created_by: input.userId,
  });
}

/**
 * Platform-scope dispatch: Cubes' own sender (platform_email_sender), logged
 * with team_id NULL. Welcome emails dedupe on a prior sent row so the signup
 * page and the auth callback can both fire safely.
 */
export async function runPlatformDispatch(
  admin: SupabaseClient,
  input: PlatformDispatchInput,
  options?: { skipTriggerCheck?: boolean },
): Promise<{ ok: boolean; status: EmailDispatchStatus; reason?: string }> {
  const finish = async (status: EmailDispatchStatus, reason?: string) => {
    await logPlatformAttempt(admin, input, status, reason);
    return { ok: status === "sent", status, reason };
  };

  if (!options?.skipTriggerCheck) {
    const { data: trigger, error } = await admin
      .from("platform_email_triggers")
      .select("enabled")
      .eq("event_key", input.eventKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!trigger) return finish("skipped", `Unknown email trigger "${input.eventKey}".`);
    if (!trigger.enabled) return finish("skipped", "Trigger disabled platform-wide.");
  }

  if (input.eventKey === "account.signup_welcome") {
    const { data: already, error } = await admin
      .from("email_log")
      .select("id")
      .is("team_id", null)
      .eq("event_key", "account.signup_welcome")
      .eq("to_email", input.to)
      .eq("status", "sent")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (already) {
      return { ok: false, status: "skipped", reason: "Welcome email already sent." };
    }
  }

  const { data: sender, error: senderError } = await admin
    .from("platform_email_sender")
    .select("from_email, from_name, reply_to, enabled")
    .eq("id", "default")
    .maybeSingle();
  if (senderError) throw new Error(senderError.message);
  if (!sender?.from_email) return finish("skipped", "No platform sender configured.");
  if (!sender.enabled) return finish("skipped", "Platform sender disabled.");

  const { data: secret } = await admin
    .from("platform_email_secrets")
    .select("api_key")
    .eq("id", "default")
    .maybeSingle();
  if (!secret?.api_key) return finish("skipped", "No API key stored.");

  const result = await sendResendEmail({
    apiKey: secret.api_key,
    from: formatSender(sender.from_email, sender.from_name),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: sender.reply_to ?? undefined,
  });

  return result.ok ? finish("sent") : finish("failed", result.reason ?? "Send failed.");
}

/** Platform test send: trigger switch bypassed, platform health stamped. */
export async function runPlatformTest(
  admin: SupabaseClient,
  input: { to: string; userId: string },
): Promise<{ ok: boolean; reason?: string }> {
  const result = await runPlatformDispatch(
    admin,
    {
      eventKey: "system.test",
      to: input.to,
      subject: "Cubes email test",
      html: "<p>✅ This is a test message from <strong>Cubes</strong> — the platform sender works.</p>",
      userId: input.userId,
    },
    { skipTriggerCheck: true },
  );

  const ok = result.status === "sent";
  await admin
    .from("platform_email_sender")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: ok,
      last_test_error: ok ? null : (result.reason ?? "Unknown failure."),
    })
    .eq("id", "default");

  return { ok, reason: result.reason };
}

/**
 * Test send: bypasses the trigger switch (it validates the sender, not a
 * scenario) and stamps the connection's last_test_* health columns.
 */
export async function runResendTest(
  admin: SupabaseClient,
  input: { teamId: string; to: string; userId: string },
): Promise<{ ok: boolean; reason?: string }> {
  const result = await runEmailDispatch(
    admin,
    {
      teamId: input.teamId,
      eventKey: "system.test",
      to: input.to,
      subject: "Cubes email test",
      html: "<p>✅ This is a test message from your <strong>Cubes</strong> workspace — your Resend sender works.</p>",
      userId: input.userId,
    },
    { skipTriggerCheck: true },
  );

  const ok = result.status === "sent";
  await admin
    .from("app_resend_connections")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: ok,
      last_test_error: ok ? null : (result.reason ?? "Unknown failure."),
    })
    .eq("team_id", input.teamId);

  return { ok, reason: result.reason };
}
