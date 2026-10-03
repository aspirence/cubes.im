import { NextResponse } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { UUID_RE, readJson } from "@/lib/client-portal/http";
import { decideApproval } from "@/lib/client-portal/rpc";
import { readClientSessionCookie } from "@/lib/client-portal/session";

/**
 * The client approves, or asks for changes.
 *
 * The permission check is inside client_decide_approval: the contact's role
 * ('approver'/'manager') OR can_approve on their project-access row. A viewer
 * with the approval's id gets 403 and nothing is written — "approving is its
 * own permission" is enforced one layer below this route.
 *
 * The decision is recorded with the contact's identity and the timestamp, which
 * is what makes it a proof link rather than a message in a chat.
 */

export const runtime = "nodejs";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const token = await readClientSessionCookie();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const body = await readJson<{ state?: unknown; note?: unknown }>(request);
  const state = body?.state;
  if (state !== "approved" && state !== "changes_requested") {
    return NextResponse.json(
      { error: "state must be 'approved' or 'changes_requested'." },
      { status: 400 },
    );
  }
  // Asking for changes without saying what is the thing that starts another
  // round for nothing, so it is required.
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (state === "changes_requested" && !note) {
    return NextResponse.json(
      { error: "Tell them what to change." },
      { status: 400 },
    );
  }

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const result = await decideApproval(admin, token, id, state, note || null);
  if (!result.ok) {
    const status =
      result.reason === "unauthenticated"
        ? 401
        : result.reason === "forbidden"
          ? 403
          : result.reason === "already_decided"
            ? 409
            : 404;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
