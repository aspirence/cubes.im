import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/apps/server";
import { parseSignedRequest } from "@/lib/meta/oauth";

export const runtime = "nodejs";

/**
 * Meta's deauthorize callback: Facebook calls this when someone removes Cubes
 * from their Facebook settings. We delete that identity's connections, which
 * takes their token and ad accounts with them (ON DELETE CASCADE), so a
 * workflow stops reading an account the person has revoked.
 *
 * There is no session here — the `signed_request` signature is the proof, so a
 * bad signature is answered 400 and nothing is touched. Facebook retries on a
 * non-2xx, so a genuine failure is reported rather than swallowed.
 */
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
  if (error) return NextResponse.json({ error: "Could not remove the connection." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
