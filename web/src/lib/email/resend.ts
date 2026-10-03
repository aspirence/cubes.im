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
    if (res.status === 422 || res.status === 400) {
      // Resend answers a rejected message with {name, message}. Blaming the
      // sender domain for every one of them sent people to verify a domain that
      // was already verified, when the real problem was the address they typed.
      // The mapped strings below are authored here, never echoed from Resend.
      return { ok: false, reason: await rejectionReason(res) };
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

/**
 * Turn a Resend rejection into something the person reading it can act on.
 * Their body is `{ statusCode, name, message }`; we match on it and answer with
 * our own sentence, so no provider text (which can quote headers) is stored in
 * the member-readable columns.
 */
async function rejectionReason(res: Response): Promise<string> {
  let name = "";
  let message = "";
  try {
    const body = (await res.json()) as { name?: string; message?: string };
    name = (body.name ?? "").toLowerCase();
    message = (body.message ?? "").toLowerCase();
  } catch {
    // A non-JSON body tells us nothing; fall through to the generic answer.
  }

  if (name === "invalid_from_address" || message.includes("domain is not verified") || message.includes("verify a domain")) {
    return "The from-address domain isn't verified in Resend. Verify it there, then try again.";
  }
  if (message.includes("testing emails") || message.includes("your own email address")) {
    return "This Resend account is still in testing, so it can only email the account owner. Verify a domain in Resend to email anyone else.";
  }
  if (message.includes("invalid `to`") || message.includes("invalid to") || (name === "validation_error" && message.includes("to"))) {
    return "That recipient address was rejected as invalid — check the spelling of the email address.";
  }
  if (name === "validation_error") {
    return "Resend rejected the message as invalid. Check the recipient address and the sender address.";
  }
  return "Resend rejected the message. Check the recipient address, then the sender domain in Resend.";
}

/** "Name <email>" when a display name is set, else the bare address. */
export function formatSender(fromEmail: string, fromName?: string | null): string {
  const name = fromName?.trim();
  return name ? `${name} <${fromEmail}>` : fromEmail;
}
