import { emailServiceClient } from "./server";
import { invokeSendEmailEdge } from "./edge";
import { runPlatformDispatch } from "./engine";
import { composeEmail } from "./compose";
import type { TemplateVars } from "./templates";

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
