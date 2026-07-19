/**
 * Minimal Resend sender — a plain fetch to their REST API, no SDK dependency.
 * Returns SANITIZED outcomes only: `reason` strings are authored here, never
 * raw provider text, so callers can safely persist them into member-readable
 * columns (app_resend_connections.last_test_error, email_log.detail) without
 * risking an echoed key fragment or URL.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export interface SendEmailInput {
  apiKey: string;
  /** Verified sender, e.g. "Cubes <team@cubes.im>". */
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Safe to render and to store in member-readable columns. */
  reason?: string;
}

export async function sendResendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        ...(input.html ? { html: input.html } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Resend rejected the API key. Check the key and try again." };
    }
    if (res.status === 422) {
      return {
        ok: false,
        reason:
          "Resend rejected the message — usually an unverified sender domain or a bad address. Verify the from-address domain in Resend.",
      };
    }
    if (res.status === 429) {
      return { ok: false, reason: "Resend rate limit hit. Try again shortly." };
    }
    return { ok: false, reason: `Resend returned HTTP ${res.status}.` };
  } catch (err) {
    return {
      ok: false,
      reason:
        (err as Error)?.name === "AbortError"
          ? "The request to Resend timed out."
          : "Could not reach Resend.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** "Name <email>" when a display name is set, else the bare address. */
export function formatSender(fromEmail: string, fromName?: string | null): string {
  const name = fromName?.trim();
  return name ? `${name} <${fromEmail}>` : fromEmail;
}
