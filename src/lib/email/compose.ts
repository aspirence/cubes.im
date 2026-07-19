import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_TEMPLATES,
  renderEmail,
  type EmailTemplate,
  type TemplateVars,
} from "./templates";

/**
 * Server-side template resolution: DB override (platform_email_templates) if a
 * super admin saved one, else the code default. Returns null for scenarios
 * with neither — caller should treat that as "nothing to send".
 */
export async function composeEmail(
  admin: SupabaseClient,
  eventKey: string,
  vars: TemplateVars,
): Promise<{ subject: string; html: string } | null> {
  let template: EmailTemplate | null = DEFAULT_TEMPLATES[eventKey] ?? null;

  const { data: override } = await admin
    .from("platform_email_templates")
    .select("subject, body_html")
    .eq("event_key", eventKey)
    .maybeSingle();
  if (override?.subject && override?.body_html) {
    template = { subject: override.subject, body: override.body_html };
  }

  if (!template) return null;
  return renderEmail(template, vars);
}
