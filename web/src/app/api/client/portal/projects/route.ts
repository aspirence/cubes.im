import { NextResponse } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { portalProjects } from "@/lib/client-portal/rpc";
import { readClientSessionCookie } from "@/lib/client-portal/session";

/**
 * The client's own project list. The filter is `contact_id = me` inside
 * client_portal_projects — there is no "all projects, then hide some" step
 * anywhere on this path.
 */

export const runtime = "nodejs";

export async function GET() {
  const token = await readClientSessionCookie();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured" }, { status: 500 });

  const result = await portalProjects(admin, token);
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }
  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
