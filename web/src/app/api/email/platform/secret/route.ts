import { NextResponse, type NextRequest } from "next/server";
import { authorizePlatform, emailServiceClient } from "@/lib/email/server";

/**
 * Stores / removes the PLATFORM Resend API key (platform admins only). Same
 * write-only contract as the workspace secret route: the key lives in the
 * service-role-only platform_email_secrets row and can never be read back;
 * this route owns the sender row's has_key mirror.
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 500) {
    return NextResponse.json({ error: "A Resend API key is required." }, { status: 400 });
  }

  const auth = await authorizePlatform(true);
  if (!auth.ok) return auth.response;

  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }

  const { data: sender, error: senderError } = await admin
    .from("platform_email_sender")
    .select("id")
    .eq("id", "default")
    .maybeSingle();
  if (senderError) {
    return NextResponse.json({ error: senderError.message }, { status: 500 });
  }
  if (!sender) {
    return NextResponse.json(
      { error: "Save the platform sender (from address) first." },
      { status: 400 },
    );
  }

  const { error: secretError } = await admin
    .from("platform_email_secrets")
    .upsert(
      { id: "default", api_key: apiKey, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
  if (secretError) {
    return NextResponse.json({ error: secretError.message }, { status: 500 });
  }

  const { error: flagError } = await admin
    .from("platform_email_sender")
    .update({ has_key: true, updated_at: new Date().toISOString() })
    .eq("id", "default");
  if (flagError) {
    return NextResponse.json({ error: flagError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function DELETE() {
  const auth = await authorizePlatform(true);
  if (!auth.ok) return auth.response;

  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }

  const { error: deleteError } = await admin
    .from("platform_email_secrets")
    .delete()
    .eq("id", "default");
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { error: flagError } = await admin
    .from("platform_email_sender")
    .update({ has_key: false, updated_at: new Date().toISOString() })
    .eq("id", "default");
  if (flagError) {
    return NextResponse.json({ error: flagError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
