import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { emailServiceClient } from "@/lib/email/server";
import { invokeSendEmailEdge } from "@/lib/email/edge";
import { runPlatformDispatch } from "@/lib/email/engine";
import { composeEmail } from "@/lib/email/compose";

/**
 * Sends (or re-sends) the invitation email for an email_invitations row, from
 * the PLATFORM sender — a brand-new invitee has no workspace sender yet.
 * Authorization is the invitation itself: the caller must be able to READ the
 * row (RLS: team members + the invited address), which proves the invite is
 * real; the edge function re-validates the same fact independently. Content is
 * composed here from the account.invitation_sent template.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { invitationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const invitationId =
    typeof body.invitationId === "string" ? body.invitationId : "";
  if (!invitationId) {
    return NextResponse.json({ error: "invitationId is required." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS-scoped read: null = doesn't exist OR the caller can't see it.
  const { data: invitation, error } = await supabase
    .from("email_invitations")
    .select("id, email, name, team_id, teams(name)")
    .eq("id", invitationId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  const { data: inviterProfile } = await supabase
    .from("users")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();

  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }

  const inviteeFirst = invitation.name?.trim().split(/\s+/)[0] ?? "";
  const teamName =
    (invitation.teams as { name: string } | null)?.name ?? "a workspace";
  const rendered = await composeEmail(admin, "account.invitation_sent", {
    name: inviteeFirst,
    comma_name: inviteeFirst ? `, ${inviteeFirst}` : "",
    inviter: inviterProfile?.name?.trim() || "A teammate",
    team: teamName,
    email: invitation.email,
    app_url: process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im",
  });
  if (!rendered) {
    return NextResponse.json(
      { ok: false, status: "skipped", reason: "No template for this scenario." },
      { status: 200 },
    );
  }

  const payload = {
    scope: "platform" as const,
    eventKey: "account.invitation_sent",
    to: invitation.email.trim().toLowerCase(),
    subject: rendered.subject,
    html: rendered.html,
  };

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const edge = await invokeSendEmailEdge(payload, session?.access_token ?? "");
  if (edge) return NextResponse.json(edge.body, { status: edge.httpStatus });

  console.warn(
    "email: send-email edge function unreachable — sending in-process. Deploy it with: npx supabase functions deploy send-email",
  );
  try {
    const result = await runPlatformDispatch(admin, {
      eventKey: payload.eventKey,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      userId: user.id,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed." },
      { status: 500 },
    );
  }
}
