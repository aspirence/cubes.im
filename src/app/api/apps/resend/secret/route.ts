import { NextResponse, type NextRequest } from "next/server";
import { authorizeTeam, emailServiceClient } from "@/lib/email/server";

/**
 * Stores / removes a workspace's Resend API key (team admins only). The key
 * lives in the service-role-only app_resend_secrets table and is write-only:
 * it can never be read back, not even by the admin who saved it. This route
 * also owns the `has_key` mirror on app_resend_connections — nothing else may
 * write that column (see the useSaveResendConnection comment).
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { teamId?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!teamId || !apiKey || apiKey.length > 500) {
    return NextResponse.json(
      { error: "teamId and a Resend API key are required." },
      { status: 400 },
    );
  }

  const auth = await authorizeTeam(teamId, "admin");
  if (!auth.ok) return auth.response;

  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }

  // The sender row carries from_email (NOT NULL) — it must exist before a key
  // can be attached, so has_key never points at a half-configured sender.
  const { data: connection, error: connError } = await admin
    .from("app_resend_connections")
    .select("team_id")
    .eq("team_id", teamId)
    .maybeSingle();
  if (connError) {
    return NextResponse.json({ error: connError.message }, { status: 500 });
  }
  if (!connection) {
    return NextResponse.json(
      { error: "Save the sender settings (from address) first." },
      { status: 400 },
    );
  }

  const { error: secretError } = await admin
    .from("app_resend_secrets")
    .upsert(
      { team_id: teamId, api_key: apiKey, updated_at: new Date().toISOString() },
      { onConflict: "team_id" },
    );
  if (secretError) {
    return NextResponse.json({ error: secretError.message }, { status: 500 });
  }

  const { error: flagError } = await admin
    .from("app_resend_connections")
    .update({ has_key: true, updated_at: new Date().toISOString() })
    .eq("team_id", teamId);
  if (flagError) {
    return NextResponse.json({ error: flagError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  let body: { teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required." }, { status: 400 });
  }

  const auth = await authorizeTeam(teamId, "admin");
  if (!auth.ok) return auth.response;

  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }

  const { error: deleteError } = await admin
    .from("app_resend_secrets")
    .delete()
    .eq("team_id", teamId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { error: flagError } = await admin
    .from("app_resend_connections")
    .update({ has_key: false, updated_at: new Date().toISOString() })
    .eq("team_id", teamId);
  if (flagError) {
    return NextResponse.json({ error: flagError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
