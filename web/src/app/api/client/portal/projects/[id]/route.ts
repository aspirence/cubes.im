import { NextResponse } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { UUID_RE } from "@/lib/client-portal/http";
import { projectOverview } from "@/lib/client-portal/rpc";
import { readClientSessionCookie } from "@/lib/client-portal/session";

/**
 * Everything the client may see about one project, built in SQL.
 *
 * A project this contact was not given answers 404 — the same answer as a
 * project that does not exist — so the id space cannot be walked to discover
 * another client's work.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
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
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const result = await projectOverview(admin, token, id);
  if (!result.ok) {
    return NextResponse.json(result, {
      status: result.reason === "unauthenticated" ? 401 : 404,
    });
  }
  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
