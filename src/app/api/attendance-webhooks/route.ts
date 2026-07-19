import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/apps/server";
import { resolveAttendanceWebhookConfig } from "@/lib/attendance-webhook/config";
import type { Json } from "@/types/database";

/**
 * Mints a new attendance webhook (HR admins only). Creation lives in a route —
 * not a direct RLS insert — because the bearer token and signing secret are
 * generated server-side and only their hash / secret-table copy is stored; the
 * raw values are returned ONCE in this response (the mcp_tokens pattern).
 */

export const runtime = "nodejs";

const TOKEN_PREFIX = "cubes_att_";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { orgId?: string; name?: string; config?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!orgId || !name || name.length > 200) {
    return NextResponse.json(
      { error: "orgId and a name (≤200 chars) are required." },
      { status: 400 },
    );
  }

  // HR-admin gate via the caller's own session (never the service role).
  const { data: isHrAdmin, error: adminErr } = await supabase.rpc(
    "is_hr_admin",
    { _org_id: orgId },
  );
  if (adminErr) {
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }
  if (!isHrAdmin) {
    return NextResponse.json(
      { error: "Only HR admins can create attendance webhooks." },
      { status: 403 },
    );
  }

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Attendance webhooks are not configured." },
      { status: 500 },
    );
  }

  const token = `${TOKEN_PREFIX}${randomBytes(24).toString("hex")}`;
  const signingSecret = `whsec_${randomBytes(24).toString("hex")}`;
  const config = resolveAttendanceWebhookConfig(body.config);

  const { data: webhook, error } = await admin
    .from("attendance_webhooks")
    .insert({
      org_id: orgId,
      name,
      token_prefix: token.slice(0, TOKEN_PREFIX.length + 6),
      token_hash: createHash("sha256").update(token).digest("hex"),
      config: config as unknown as Json,
      created_by: user.id,
    })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: secretError } = await admin
    .from("attendance_webhook_secrets")
    .insert({ webhook_id: webhook.id, signing_secret: signingSecret });
  if (secretError) {
    // Don't leave a webhook whose signing secret was never stored.
    await admin.from("attendance_webhooks").delete().eq("id", webhook.id);
    return NextResponse.json({ error: secretError.message }, { status: 500 });
  }

  // token / signingSecret are shown once and never retrievable again.
  return NextResponse.json({ webhook, token, signingSecret }, { status: 201 });
}
