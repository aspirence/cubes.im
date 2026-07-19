import { NextResponse, type NextRequest } from "next/server";
import { authorizePlatform, emailServiceClient } from "@/lib/email/server";
import { invokeSendEmailEdge } from "@/lib/email/edge";
import { runPlatformTest } from "@/lib/email/engine";

/**
 * Sends a real test email through the PLATFORM sender (platform admins only).
 * Runs in the send-email edge function (platform test mode); the in-process
 * engine is the not-yet-deployed fallback. Stamps platform_email_sender's
 * last_test_* health and logs to email_log with team_id NULL.
 */

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: { to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: "A valid recipient is required." }, { status: 400 });
  }

  const auth = await authorizePlatform(true);
  if (!auth.ok) return auth.response;

  const edge = await invokeSendEmailEdge(
    { scope: "platform", to, test: true },
    auth.accessToken,
  );
  if (edge) return NextResponse.json(edge.body, { status: edge.httpStatus });

  console.warn(
    "email: send-email edge function unreachable — testing in-process. Deploy it with: npx supabase functions deploy send-email",
  );
  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }
  try {
    const result = await runPlatformTest(admin, { to, userId: auth.userId });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The test couldn't run." },
      { status: 500 },
    );
  }
}
