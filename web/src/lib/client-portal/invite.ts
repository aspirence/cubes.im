import type { SupabaseClient } from "@supabase/supabase-js";
import { commaName, magicLinkUrl, sendClientEmail } from "./email";
import type { ClientEmailResult, Sender } from "./email";
import { issueMagicLinks } from "./rpc";

/**
 * Mints a sign-in link for a contact and mails it as the invitation (or as a
 * re-send). Shared by POST /api/client/contacts and the contact's own
 * ?action=resend, so both behave identically.
 *
 * Returns the dispatcher's verdict AND, when nothing was sent, the link
 * itself — the agency still has to get the client in, and a copyable link is
 * the honest fallback. This is deliberately the opposite of the workspace
 * invite modal, which says "Invitation sent" even when Resend is not
 * configured and the mail went nowhere.
 */
export interface InviteEmailOutcome {
  email: { status: ClientEmailResult["status"]; reason?: string };
  /** Present only when the email did NOT go out. Single use, 15 minutes. */
  link?: string;
}

export async function sendInviteLink(
  admin: SupabaseClient,
  input: {
    teamId: string;
    contactId: string;
    email: string;
    projectId?: string | null;
  },
  /** Injectable for tests; production always uses the real Resend call. */
  send?: Sender,
): Promise<InviteEmailOutcome> {
  const targets = await issueMagicLinks(admin, input.email);
  const target = targets.find((t) => t.contact_id === input.contactId);
  if (!target) {
    // Throttled, or the contact was revoked between the write and here. Say so
    // rather than implying an email is on its way.
    return {
      email: {
        status: "skipped",
        reason: "Too many sign-in links for this contact in the last 15 minutes.",
      },
    };
  }

  let projectName = "";
  if (input.projectId) {
    const { data } = await admin
      .from("projects")
      .select("name")
      .eq("id", input.projectId)
      .maybeSingle();
    projectName = (data?.name as string | undefined) ?? "";
  }

  const link = magicLinkUrl(target.token);
  const result = await sendClientEmail(admin, {
    teamId: input.teamId,
    eventKey: "client.invitation",
    to: target.email,
    vars: {
      name: target.name ?? "",
      comma_name: commaName(target.name),
      agency: target.team_name,
      project: projectName || "your project",
      link_url: link,
      expires_minutes: "15",
      email: target.email,
    },
  }, send);

  return {
    email: { status: result.status, reason: result.reason },
    ...(result.status === "sent" ? {} : { link }),
  };
}
