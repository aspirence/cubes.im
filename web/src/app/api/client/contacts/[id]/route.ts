import { NextResponse } from "next/server";
import {
  adminClient,
  authorizeTeamRequest,
  callerCanAccessProject,
} from "@/lib/apps/auth";
import { UUID_RE, readJson } from "@/lib/client-portal/http";
import { sendInviteLink } from "@/lib/client-portal/invite";
import type { ClientContactRole } from "@/lib/client-portal/types";

/**
 * One contact: change their role, share or unshare a project, revoke them, or
 * send a fresh sign-in link.
 *
 * Revoke is the load-bearing one. Setting status='revoked' fires the
 * app_client_contacts_revoke trigger, which deletes every session row and every
 * unused magic link and writes the audit entry — so revocation cannot be half
 * done by forgetting a code path here.
 */

export const runtime = "nodejs";

const ROLES: ClientContactRole[] = ["viewer", "approver", "requester", "manager"];

interface Body {
  action?: unknown;
  role?: unknown;
  name?: unknown;
  projectId?: unknown;
  canRequest?: unknown;
  canApprove?: unknown;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  }
  const body = await readJson<Body>(request);
  if (!body) return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  // Which workspace is this contact in? Service-role read, then the caller is
  // authorized against THAT team — never the other way round.
  const { data: contact } = await admin
    .from("app_client_contacts")
    .select("id, team_id, email, status, role")
    .eq("id", id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  }
  const teamId = contact.team_id as string;
  const auth = await authorizeTeamRequest(teamId, "member");
  if (!auth.ok) return auth.response;

  const action = typeof body.action === "string" ? body.action : "update";

  if (action === "revoke") {
    const { error } = await auth.supabase
      .from("app_client_contacts")
      .update({ status: "revoked" })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    // Confirm the cascade actually happened — this is the promise the whole
    // feature rests on, so it is verified rather than assumed.
    const { count } = await admin
      .from("app_client_sessions")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id);
    return NextResponse.json({ ok: true, status: "revoked", sessionsLeft: count ?? 0 });
  }

  if (action === "reinstate") {
    const { error } = await auth.supabase
      .from("app_client_contacts")
      .update({ status: "invited" })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, status: "invited" });
  }

  if (action === "resend") {
    if (contact.status === "revoked") {
      return NextResponse.json(
        { error: "This contact is revoked. Reinstate them first." },
        { status: 409 },
      );
    }
    const projectId =
      typeof body.projectId === "string" && UUID_RE.test(body.projectId)
        ? body.projectId
        : null;
    const outcome = await sendInviteLink(admin, {
      teamId,
      contactId: id,
      email: contact.email as string,
      projectId,
    });
    return NextResponse.json({ ok: true, ...outcome });
  }

  if (action === "unshare") {
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!UUID_RE.test(projectId)) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }
    const { error } = await auth.supabase
      .from("app_client_project_access")
      .delete()
      .eq("contact_id", id)
      .eq("project_id", projectId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // Plain update: role / name, and optionally this contact's access to one
  // project. Sharing a project needs project membership, not just workspace
  // membership — the two checks are separate on purpose.
  const patch: Record<string, unknown> = {};
  if (ROLES.includes(body.role as ClientContactRole)) patch.role = body.role;
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 120) || null;
  if (Object.keys(patch).length) {
    const { error } = await auth.supabase
      .from("app_client_contacts")
      .update(patch)
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (typeof body.projectId === "string" && UUID_RE.test(body.projectId)) {
    if (!(await callerCanAccessProject(auth.supabase, body.projectId))) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    const { error } = await auth.supabase.from("app_client_project_access").upsert(
      {
        contact_id: id,
        project_id: body.projectId,
        team_id: teamId,
        can_request: body.canRequest !== false,
        can_approve: body.canApprove === true,
        shared_by: auth.userId,
      },
      { onConflict: "contact_id,project_id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
