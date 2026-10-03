import { NextResponse } from "next/server";
import {
  adminClient,
  authorizeTeamRequest,
  callerCanAccessProject,
} from "@/lib/apps/auth";
import { UUID_RE, appUrl, readJson } from "@/lib/client-portal/http";
import { commaName, sendClientEmail } from "@/lib/client-portal/email";
import type { ClientApprovalSubject } from "@/lib/client-portal/types";

/**
 * The agency asks a client for a decision.
 *
 * client_request_approval picks the next version (so round 3 is its own record
 * and round 2's decision survives) and returns exactly the contacts who may
 * decide — role 'approver'/'manager' or can_approve on their project-access
 * row. The email goes to those and nobody else, and the per-recipient result is
 * reported honestly: the UI must not say "asked" for an address the dispatcher
 * skipped.
 */

export const runtime = "nodejs";

const SUBJECTS: ClientApprovalSubject[] = [
  "task",
  "content_item",
  "video_review",
  "file",
];

interface Body {
  projectId?: unknown;
  subjectKind?: unknown;
  subjectId?: unknown;
  title?: unknown;
  note?: unknown;
  version?: unknown;
  notify?: unknown;
}

export async function POST(request: Request) {
  const body = await readJson<Body>(request);
  if (!body) return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
  if (!UUID_RE.test(projectId) || !UUID_RE.test(subjectId)) {
    return NextResponse.json(
      { error: "projectId and subjectId are required." },
      { status: 400 },
    );
  }
  const subjectKind = body.subjectKind as ClientApprovalSubject;
  if (!SUBJECTS.includes(subjectKind)) {
    return NextResponse.json({ error: "Unknown subject kind." }, { status: 400 });
  }

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 500 });

  const { data: project } = await admin
    .from("projects")
    .select("id, team_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const auth = await authorizeTeamRequest(project.team_id as string, "member");
  if (!auth.ok) return auth.response;
  if (!(await callerCanAccessProject(auth.supabase, projectId))) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const { data, error } = await auth.supabase.rpc("client_request_approval", {
    p_project_id: projectId,
    p_subject_kind: subjectKind,
    p_subject_id: subjectId,
    p_title: typeof body.title === "string" ? body.title : null,
    p_note: typeof body.note === "string" ? body.note : null,
    p_version: typeof body.version === "number" ? body.version : null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const result = data as {
    ok?: boolean;
    reason?: string;
    approval_id?: string;
    version?: number;
    notify?: Array<{ contact_id: string; email: string; name: string | null }>;
  } | null;
  if (!result?.ok) {
    return NextResponse.json(
      { error: result?.reason ?? "Could not request the approval." },
      { status: result?.reason === "version_exists" ? 409 : 400 },
    );
  }

  const teamId = project.team_id as string;
  const { data: agency } = await admin
    .from("teams")
    .select("name")
    .eq("id", teamId)
    .maybeSingle();

  const notified: Array<{ contactId: string; status: string; reason?: string }> = [];
  if (body.notify !== false) {
    for (const target of result.notify ?? []) {
      const sent = await sendClientEmail(admin, {
        teamId,
        eventKey: "client.approval_requested",
        to: target.email,
        vars: {
          name: target.name ?? "",
          comma_name: commaName(target.name),
          agency: (agency?.name as string | undefined) ?? "Your agency",
          project: (project.name as string | undefined) ?? "",
          item: typeof body.title === "string" && body.title ? body.title : "an item",
          note: typeof body.note === "string" ? body.note : "",
          link_url: `${appUrl()}/portal/p/${projectId}?approval=${result.approval_id}`,
        },
        userId: auth.userId,
      });
      notified.push({
        contactId: target.contact_id,
        status: sent.status,
        reason: sent.reason,
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      approvalId: result.approval_id,
      version: result.version,
      // Per recipient, and never rounded up to "sent".
      notified,
    },
    { status: 201 },
  );
}
