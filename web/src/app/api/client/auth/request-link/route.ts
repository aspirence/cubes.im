import { NextResponse } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { cleanEmail, readJson } from "@/lib/client-portal/http";
import { commaName, magicLinkUrl, sendClientEmail } from "@/lib/client-portal/email";
import { issueMagicLinks } from "@/lib/client-portal/rpc";

/**
 * "Email me a sign-in link." Public — there is no session yet.
 *
 * The answer is IDENTICAL whether or not the address belongs to a contact:
 * this form must not become a way to find out which of an agency's clients use
 * the product. Everything interesting (does the contact exist, is it revoked,
 * has it been throttled) is decided inside client_issue_magic_links and never
 * reaches the response body.
 *
 * The one thing we do report honestly is whether the mail could actually be
 * dispatched — `emailConfigured: false` lets the sign-in page say "we couldn't
 * send it, ask your agency" instead of leaving someone waiting for a mail that
 * was never going anywhere.
 */

export const runtime = "nodejs";

const GENERIC = {
  ok: true,
  message: "If that address has access, a sign-in link is on its way.",
};

export async function POST(request: Request) {
  const body = await readJson<{ email?: unknown }>(request);
  const email = cleanEmail(body?.email);
  if (!email) {
    // A malformed address is a client-side mistake, not an enumeration vector.
    return NextResponse.json(
      { error: "Enter the email address your agency shared the work with." },
      { status: 400 },
    );
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Sign-in is not configured on this deployment." },
      { status: 500 },
    );
  }

  let targets;
  try {
    targets = await issueMagicLinks(admin, email);
  } catch {
    // An unknown address does NOT land here — client_issue_magic_links returns
    // no rows for it, quietly. Only a database failure throws, which is a fact
    // about the server, so saying "nothing went out" leaks nothing and beats
    // "check your email" to someone who will be watching an empty inbox.
    return NextResponse.json(
      { error: "We could not send the link just now. Please try again in a minute." },
      { status: 503 },
    );
  }

  for (const target of targets) {
    await sendClientEmail(admin, {
      teamId: target.team_id,
      eventKey: "client.magic_link",
      to: target.email,
      vars: {
        name: target.name ?? "",
        comma_name: commaName(target.name),
        agency: target.team_name,
        link_url: magicLinkUrl(target.token),
        expires_minutes: "15",
        email: target.email,
      },
    });
  }

  // Whether this DEPLOYMENT can send mail at all — a fact about the server, not
  // about the address, so reporting it honestly leaks nothing. The sign-in page
  // uses it to say "email isn't set up here, ask your agency for a link" rather
  // than leaving someone watching an inbox forever.
  const { data: sender, error: senderError } = await admin
    .from("platform_email_sender")
    .select("from_email, enabled")
    .eq("id", "default")
    .maybeSingle();
  const { data: secret, error: secretError } = await admin
    .from("platform_email_secrets")
    .select("api_key")
    .eq("id", "default")
    .maybeSingle();

  // If the config itself could not be read, we do not know — and `false` would
  // claim "this workspace cannot send mail", which may be untrue. Leaving the
  // key out lets the page fall back to the neutral "check your email", which is
  // exactly what was attempted a few lines above.
  const known = !senderError && !secretError;

  return NextResponse.json(
    {
      ...GENERIC,
      ...(known
        ? {
            emailConfigured: Boolean(
              sender?.from_email && sender.enabled && secret?.api_key,
            ),
          }
        : {}),
    },
    { status: 200 },
  );
}
