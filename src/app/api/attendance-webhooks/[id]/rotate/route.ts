import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/apps/server";

/**
 * Rotates an attendance webhook's bearer token and signing secret (HR admins
 * only). Old credentials stop working immediately; the new values are returned
 * once, exactly like creation.
 */

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS scopes this read: null means "not found OR caller is no HR admin" —
  // 404 either way so outsiders learn nothing.
  const { data: webhook, error } = await supabase
    .from("attendance_webhooks")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!webhook) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Attendance webhooks are not configured." },
      { status: 500 },
    );
  }

  const token = `cubes_att_${randomBytes(24).toString("hex")}`;
  const signingSecret = `whsec_${randomBytes(24).toString("hex")}`;

  const { error: updateError } = await admin
    .from("attendance_webhooks")
    .update({
      token_prefix: token.slice(0, "cubes_att_".length + 6),
      token_hash: createHash("sha256").update(token).digest("hex"),
    })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: secretError } = await admin
    .from("attendance_webhook_secrets")
    .upsert({
      webhook_id: id,
      signing_secret: signingSecret,
      updated_at: new Date().toISOString(),
    });
  if (secretError) {
    return NextResponse.json({ error: secretError.message }, { status: 500 });
  }

  return NextResponse.json({ token, signingSecret }, { status: 200 });
}
