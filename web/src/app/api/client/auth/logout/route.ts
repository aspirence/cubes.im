import { NextResponse } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { endClientSession } from "@/lib/client-portal/rpc";
import {
  clearClientSessionCookie,
  readClientSessionCookie,
} from "@/lib/client-portal/session";

/**
 * Sign out: delete the session row, then clear the cookie. The row goes first,
 * so a cookie that somehow survives (a copy taken from another device) is
 * already worthless — logout is a server-side revoke, not a cosmetic one.
 */

export const runtime = "nodejs";

export async function POST() {
  const token = await readClientSessionCookie();
  if (token) {
    const admin = adminClient();
    if (admin) {
      try {
        await endClientSession(admin, token);
      } catch {
        // Even if the delete fails we still clear the cookie — the person
        // pressed Sign out and must end up signed out of this browser.
      }
    }
  }
  return clearClientSessionCookie(NextResponse.json({ ok: true }));
}
