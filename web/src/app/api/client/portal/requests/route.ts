import { NextResponse } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { UUID_RE, appUrl, readJson } from "@/lib/client-portal/http";
import { commaName, sendClientEmail } from "@/lib/client-portal/email";
import { submitRequest } from "@/lib/client-portal/rpc";
import { readClientSessionCookie } from "@/lib/client-portal/session";

/**
 * The client submits a request. It becomes a row the agency must Accept or
 * Decline — never a task on its own, because that gate is the change-order
 * moment the whole scope-creep problem turns on.
 *
 * The RPC also returns who to email, resolved from project membership in SQL;
 * the browser never says who should hear about it.
 */

export const runtime = "nodejs";

interface Body {
  projectId?: unknown;
  title?: unknown;
  details?: unknown;
  priority?: unknown;
  requestType?: unknown;
  dueBy?: unknown;
}

const PRIORITIES = new Set(["low", "normal", "high"]);

export async function POST(request: Request) {
  const token = await readClientSessionCookie();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const body = await readJson<Body>(request);
  if (!body) return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!UUID_RE.test(projectId)) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json(
      { error: "Give the request a one-line title." },
      { status: 400 },
    );
  }

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const priority =
    typeof body.priority === "string" && PRIORITIES.has(body.priority)
      ? body.priority
      : "normal";
  const details = typeof body.details === "string" ? body.details : null;

  const result = await submitRequest(admin, token, {
    projectId,
    title,
    details,
    priority,
    requestType: typeof body.requestType === "string" ? body.requestType : "general",
    dueBy: typeof body.dueBy === "string" && body.dueBy ? body.dueBy : null,
  });

  if (!result.ok) {
    const status =
      result.reason === "unauthenticated"
        ? 401
        : result.reason === "forbidden"
          ? 403
          : result.reason === "title_required"
            ? 400
            : 404;
    return NextResponse.json(result, { status });
  }

  // Tell the agency. In-app notifications are already written by the RPC; the
  // email is the part that reaches someone who isn't looking at the app.
  const session = await admin.rpc("client_session_context", { p_token: token });
  const contact = (session.data as { contact?: { name?: string | null; email?: string } } | null)
    ?.contact;
  const teamId = (session.data as { workspace?: { id?: string } } | null)?.workspace?.id;

  if (teamId) {
    for (const person of result.notify ?? []) {
      await sendClientEmail(admin, {
        teamId,
        eventKey: "client.request_received",
        to: person.email,
        vars: {
          name: person.name ?? "",
          comma_name: commaName(person.name),
          requester: contact?.name || contact?.email || "A client contact",
          project: result.project_name ?? "",
          title: result.title ?? title,
          details: details ?? "",
          link_url: `${appUrl()}/projects/${projectId}?view=client&request=${result.request_id}`,
        },
      });
    }
  }

  // The response tells the client their request landed and nothing else — who
  // at the agency was emailed is the agency's business, not theirs.
  return NextResponse.json(
    { ok: true, request_id: result.request_id },
    { status: 201 },
  );
}
