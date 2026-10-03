import { NextResponse } from "next/server";
import { authorizeTeamRequest } from "@/lib/apps/auth";
import { adminClient } from "@/lib/apps/auth";
import { UUID_RE, readJson } from "@/lib/client-portal/http";

/**
 * Accept a client request — the moment it becomes real work.
 *
 * The task is created through the ordinary create_task RPC, as the signed-in
 * agency user, so can_create_tasks (workspace capability + the project's
 * limited_task_creation override) applies exactly as it does when a person
 * presses "New task". We do not have a private door into the tasks table.
 *
 * Only then does client_link_request_task record the decision and write
 * task_id back, so a request can never claim a task that was never made.
 */

export const runtime = "nodejs";

interface Body {
  statusId?: unknown;
  priorityId?: unknown;
  assignees?: unknown;
  note?: unknown;
  /** Copy the client's details into the task description. Default true. */
  copyDetails?: unknown;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const body = (await readJson<Body>(request)) ?? {};

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 500 });

  const { data: req } = await admin
    .from("app_client_requests")
    .select("id, team_id, project_id, title, details, status, task_id, contact_id")
    .eq("id", id)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Request not found." }, { status: 404 });

  const auth = await authorizeTeamRequest(req.team_id as string, "member");
  if (!auth.ok) return auth.response;

  if (req.status !== "new") {
    return NextResponse.json(
      { error: `This request was already ${req.status}.` },
      { status: 409 },
    );
  }

  const assignees = Array.isArray(body.assignees)
    ? body.assignees.filter((a): a is string => typeof a === "string" && UUID_RE.test(a))
    : null;

  const { data: taskId, error: taskError } = await auth.supabase.rpc("create_task", {
    p_name: req.title,
    p_project_id: req.project_id,
    p_status_id:
      typeof body.statusId === "string" && UUID_RE.test(body.statusId)
        ? body.statusId
        : null,
    p_priority_id:
      typeof body.priorityId === "string" && UUID_RE.test(body.priorityId)
        ? body.priorityId
        : null,
    p_parent_task_id: null,
    p_assignees: assignees && assignees.length ? assignees : null,
  });
  if (taskError || !taskId) {
    // create_task raises when the caller cannot author in this project; that is
    // a real 403, not a server fault.
    return NextResponse.json(
      { error: taskError?.message ?? "Could not create the task." },
      { status: 403 },
    );
  }

  // The client's own words, on the task, so whoever picks it up has the brief.
  if (body.copyDetails !== false && req.details) {
    await auth.supabase
      .from("tasks")
      .update({ description: String(req.details).slice(0, 8000) })
      .eq("id", taskId);
  }

  const { data: linked, error: linkError } = await auth.supabase.rpc(
    "client_link_request_task",
    {
      p_request_id: id,
      p_task_id: taskId,
      p_note: typeof body.note === "string" ? body.note : null,
    },
  );
  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 400 });
  }
  const result = linked as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) {
    return NextResponse.json(
      { error: result?.reason ?? "Could not link the task." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, requestId: id, taskId }, { status: 201 });
}
