import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/apps/server";
import { parseSignedRequest } from "@/lib/meta/oauth";

export const runtime = "nodejs";

/**
 * Meta's data deletion request callback — required before an app can be
 * published. Facebook POSTs a signed_request naming the Facebook user, and
 * expects JSON with a URL the person can open to see the status, plus a
 * confirmation code.
 *
 * What Cubes holds for a Meta identity is the connection, its token and the ad
 * account list; all three go when the connection row is deleted. The ad
 * numbers a workflow already sent to someone's own sheet are that person's
 * data in their own tools, not ours.
 *
 * The confirmation code is derived from the Facebook user id, so the status
 * page can recognise a code without storing one, and it reveals nothing about
 * the person.
 */
function confirmationCode(userId: string): string {
  return createHash("sha256").update(`cubes-meta-deletion:${userId}`).digest("hex").slice(0, 16);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const parsed = parseSignedRequest(String(form?.get("signed_request") ?? ""));
  if (!parsed?.userId) {
    return NextResponse.json({ error: "Invalid signed_request." }, { status: 400 });
  }

  const service = serviceClient();
  if (!service) return NextResponse.json({ error: "Not configured." }, { status: 500 });
  const admin = service as unknown as SupabaseClient;

  const { error } = await admin.from("app_meta_connections").delete().eq("meta_user_id", parsed.userId);
  if (error) return NextResponse.json({ error: "Could not delete the data." }, { status: 500 });

  const code = confirmationCode(parsed.userId);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im").replace(/\/+$/, "");
  return NextResponse.json({ url: `${base}/meta-data-deletion?code=${code}`, confirmation_code: code });
}
