import { NextResponse } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { sessionContext } from "@/lib/client-portal/rpc";
import {
  clearClientSessionCookie,
  readClientSessionCookie,
} from "@/lib/client-portal/session";

/** Who the portal is talking to, plus the agency branding to wear. */

export const runtime = "nodejs";

export async function GET() {
  const token = await readClientSessionCookie();
  if (!token) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const context = await sessionContext(admin, token);
  if (!context.ok) {
    // Expired, revoked, or a cookie from a wiped database: drop it so the
    // browser stops presenting a session that no longer exists.
    return clearClientSessionCookie(
      NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 }),
    );
  }
  return NextResponse.json(context, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
