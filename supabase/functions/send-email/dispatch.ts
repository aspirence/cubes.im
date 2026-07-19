// The dispatch pipeline for the send-email function: both platform switches,
// the Resend send, the email_log audit row, and (test mode) the sender's
// last_test_* health stamp. Workspace scope uses the team's Resend sender;
// platform scope uses Cubes' global one (platform_email_sender, team_id NULL
// in the log). Mirrors src/lib/email/engine.ts — change together.

import { formatSender, sendResendEmail } from "../_shared/resend.ts";
import type { SupabaseClient } from "../_shared/supabase.ts";
import type { SendEmailPayload } from "./payload.ts";

export type DispatchStatus = "sent" | "failed" | "skipped";

export interface DispatchResult {
  ok: boolean;
  status: DispatchStatus;
  reason?: string;
}

/** Throws only on unexpected DB read failures; send outcomes come back as
 *  sent / failed / skipped. */
export async function dispatchEmail(
  admin: SupabaseClient,
  payload: SendEmailPayload,
  userId: string,
): Promise<DispatchResult> {
  const isPlatform = payload.scope === "platform";

  const finish = async (
    status: DispatchStatus,
    reason?: string,
  ): Promise<DispatchResult> => {
    if (payload.isTest) {
      const health = {
        last_test_at: new Date().toISOString(),
        last_test_ok: status === "sent",
        last_test_error:
          status === "sent" ? null : (reason ?? "Unknown failure."),
      };
      if (isPlatform) {
        await admin.from("platform_email_sender").update(health).eq("id", "default");
      } else {
        await admin
          .from("app_resend_connections")
          .update(health)
          .eq("team_id", payload.teamId);
      }
    }
    await admin.from("email_log").insert({
      team_id: isPlatform ? null : payload.teamId,
      event_key: payload.eventKey,
      to_email: payload.to,
      subject: payload.subject,
      status,
      detail: reason ?? null,
      created_by: userId,
    });
    return { ok: status === "sent", status, reason };
  };

  // Switch 1: the platform-wide trigger (test sends bypass it — they validate
  // the sender, and system.test isn't a registered scenario).
  if (!payload.isTest) {
    const { data: trigger, error } = await admin
      .from("platform_email_triggers")
      .select("enabled")
      .eq("event_key", payload.eventKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!trigger) {
      return finish("skipped", `Unknown email trigger "${payload.eventKey}".`);
    }
    if (!trigger.enabled) {
      return finish("skipped", "Trigger disabled platform-wide.");
    }
  }

  // Welcome emails are once-per-address: the signup page AND the auth callback
  // can both fire — a duplicate call must not double-send. Skips are not
  // logged here so the log stays one row per real attempt.
  if (!payload.isTest && payload.eventKey === "account.signup_welcome") {
    const { data: already, error } = await admin
      .from("email_log")
      .select("id")
      .is("team_id", null)
      .eq("event_key", "account.signup_welcome")
      .eq("to_email", payload.to)
      .eq("status", "sent")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (already) {
      return { ok: false, status: "skipped", reason: "Welcome email already sent." };
    }
  }

  // Switch 2: the sender for this scope.
  const sender = isPlatform
    ? await admin
        .from("platform_email_sender")
        .select("from_email, from_name, reply_to, enabled")
        .eq("id", "default")
        .maybeSingle()
    : await admin
        .from("app_resend_connections")
        .select("from_email, from_name, reply_to, enabled")
        .eq("team_id", payload.teamId)
        .maybeSingle();
  if (sender.error) throw new Error(sender.error.message);
  const connection = sender.data;
  if (!connection?.from_email) {
    return finish(
      "skipped",
      isPlatform
        ? "No platform sender configured."
        : "No sender configured for this workspace.",
    );
  }
  if (!connection.enabled) {
    return finish(
      "skipped",
      isPlatform ? "Platform sender disabled." : "Sender disabled for this workspace.",
    );
  }

  const secretQuery = isPlatform
    ? admin.from("platform_email_secrets").select("api_key").eq("id", "default")
    : admin.from("app_resend_secrets").select("api_key").eq("team_id", payload.teamId);
  const { data: secret } = await secretQuery.maybeSingle();
  if (!secret?.api_key) return finish("skipped", "No API key stored.");

  const result = await sendResendEmail({
    apiKey: secret.api_key,
    from: formatSender(connection.from_email, connection.from_name),
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    replyTo: connection.reply_to ?? undefined,
  });

  return result.ok
    ? finish("sent")
    : finish("failed", result.reason ?? "Send failed.");
}
