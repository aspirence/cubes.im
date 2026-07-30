// Request-payload parsing + validation for the send-email function.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT = 500;
const MAX_BODY_CHARS = 100_000;

export interface SendEmailPayload {
  /** "workspace": the team's own Resend sender. "platform": Cubes' global sender. */
  scope: "workspace" | "platform";
  /** Empty for platform scope. */
  teamId: string;
  to: string;
  eventKey: string;
  subject: string;
  html?: string;
  text?: string;
  /** Test mode: admin-gated, bypasses the trigger switch, stamps health. */
  isTest: boolean;
}

/**
 * Normalizes the accepted shapes into one payload:
 *   { teamId, to, test: true }                            — workspace test
 *   { scope: "platform", to, test: true }                 — platform test
 *   { teamId, eventKey, to, subject, html?|text? }        — workspace dispatch
 *   { scope: "platform", eventKey, to, subject, … }       — platform dispatch
 * Returns an error string when the payload is invalid.
 */
export function parseSendPayload(raw: unknown): SendEmailPayload | string {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;

  const scope = body.scope === "platform" ? "platform" : "workspace";
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  const isTest = body.test === true;

  const eventKey = isTest
    ? "system.test"
    : typeof body.eventKey === "string"
      ? body.eventKey.trim()
      : "";
  const subject = isTest
    ? "Cubes email test"
    : typeof body.subject === "string"
      ? body.subject.trim()
      : "";
  const html = isTest
    ? "<p>✅ This is a test message from <strong>Cubes</strong> — the sender works.</p>"
    : typeof body.html === "string"
      ? body.html
      : undefined;
  const text = !isTest && typeof body.text === "string" ? body.text : undefined;

  if (
    (scope === "workspace" && !teamId) ||
    !eventKey ||
    !EMAIL_RE.test(to) ||
    !subject ||
    subject.length > MAX_SUBJECT ||
    (!html && !text) ||
    (html ?? text ?? "").length > MAX_BODY_CHARS
  ) {
    return "scope/teamId, eventKey, to, subject and html or text are required.";
  }

  return { scope, teamId, to, eventKey, subject, html, text, isTest };
}
