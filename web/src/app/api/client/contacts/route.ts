import { NextResponse } from "next/server";
import {
  adminClient,
  authorizeTeamRequest,
  callerCanAccessProject,
} from "@/lib/apps/auth";
import { UUID_RE, cleanEmail, readJson } from "@/lib/client-portal/http";
import { sendInviteLink } from "@/lib/client-portal/invite";
import type { ClientContactRole } from "@/lib/client-portal/types";

/**
 * The agency invites a client contact and (optionally) shares a project with
 * them in the same action — which is the whole point: an identity with no
 * project is not access to anything.
 *
 * Writes go through the CALLER's client so the RLS policies are the real gate;
 * the service role is used only for the invitation email, which needs the
 * Resend key.
 *
 * Honesty: the response carries the dispatcher's own verdict and, when nothing
 * could be sent, the sign-in link so the agency can paste it into WhatsApp.
 * The UI must not say "Invitation sent" unless `email.status === "sent"`.
 */

export const runtime = "nodejs";

const ROLES: ClientContactRole[] = ["viewer", "approver", "requester", "manager"];

interface Body {
  teamId?: unknown;
  email?: unknown;
  name?: unknown;
  role?: unknown;
  clientId?: unknown;
  projectId?: unknown;
  canRequest?: unknown;
  canApprove?: unknown;
  /** false when the agency wants the link to copy rather than an email. */
  sendEmail?: unknown;
}

export async function POST(request: Request) {
  const body = await readJson<Body>(request);
  if (!body) return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });

  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  if (!UUID_RE.test(teamId)) {
    return NextResponse.json({ error: "teamId is required." }, { status: 400 });
  }
  const auth = await authorizeTeamRequest(teamId, "member");
  if (!auth.ok) return auth.response;

  const email = cleanEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "Enter the contact's email address." },
      { status: 400 },
    );
  }
  const role: ClientContactRole = ROLES.includes(body.role as ClientContactRole)
    ? (body.role as ClientContactRole)
    : "viewer";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : null;
  const clientId =
    typeof body.clientId === "string" && UUID_RE.test(body.clientId)
      ? body.clientId
      : null;

  const projectId =
    typeof body.projectId === "string" && UUID_RE.test(body.projectId)
      ? body.projectId
      : null;
  if (projectId && !(await callerCanAccessProject(auth.supabase, projectId))) {
    // 404 rather than 403: an id outside the caller's reach does not exist.
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  // Upsert on (team_id, email): re-inviting the same address must reuse the
  // contact, not fail, and must never resurrect a revoked one silently.
  const { data: existing } = await auth.supabase
    .from("app_client_contacts")
    .select("id, status, name, role")
    .eq("team_id", teamId)
    .eq("email", email)
    .maybeSingle();

  let contactId: string;
  if (existing) {
    contactId = existing.id as string;
    const { error } = await auth.supabase
      .from("app_client_contacts")
      .update({
        name: name ?? existing.name,
        role,
        client_id: clientId,
        // Re-inviting a revoked contact is an explicit, logged reinstatement.
        status: existing.status === "revoked" ? "invited" : existing.status,
      })
      .eq("id", contactId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { data, error } = await auth.supabase
      .from("app_client_contacts")
      .insert({
        team_id: teamId,
        client_id: clientId,
        email,
        name,
        role,
        status: "invited",
        invited_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    contactId = data.id as string;
  }

  if (projectId) {
    const { error } = await auth.supabase.from("app_client_project_access").upsert(
      {
        contact_id: contactId,
        project_id: projectId,
        team_id: teamId,
        can_request: body.canRequest !== false,
        can_approve: body.canApprove === true || role === "approver" || role === "manager",
        shared_by: auth.userId,
      },
      { onConflict: "contact_id,project_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: true, contactId, email: { status: "skipped", reason: "Email is not configured." } },
      { status: 201 },
    );
  }

  await admin.from("app_client_events").insert({
    team_id: teamId,
    contact_id: contactId,
    project_id: projectId,
    kind: "contact_invited",
    detail: { role, by: auth.userId },
  });

  if (body.sendEmail === false) {
    return NextResponse.json(
      { ok: true, contactId, email: { status: "skipped", reason: "Not requested." } },
      { status: 201 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      contactId,
      ...(await sendInviteLink(admin, { teamId, contactId, email, projectId })),
    },
    { status: 201 },
  );
}
