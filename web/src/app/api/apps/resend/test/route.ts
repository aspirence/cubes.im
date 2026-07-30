import { NextResponse, type NextRequest } from "next/server";
import { authorizeTeam, emailServiceClient } from "@/lib/email/server";
import { invokeSendEmailEdge } from "@/lib/email/edge";
import { runResendTest } from "@/lib/email/engine";

/**
 * Sends a real test email through the workspace's Resend sender (team admins
 * only). The send itself runs in the `send-email` edge function (test mode);
 * the in-process engine is only the not-yet-deployed fallback. Outcome lands
 * on the connection's last_test_* health columns and in email_log; `reason`
 * is always a sanitized string, never raw provider text.
 */

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let body: { teamId?: string; to?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  if (!teamId || !EMAIL_RE.test(to)) {
    return NextResponse.json(
      { error: "teamId and a valid recipient are required." },
      { status: 400 },
    );
  }

  const auth = await authorizeTeam(teamId, "admin");
  if (!auth.ok) return auth.response;

  // Primary: the cloud dispatcher in test mode.
  const edge = await invokeSendEmailEdge(
    { teamId, to, test: true },
    auth.accessToken,
  );
  if (edge) return NextResponse.json(edge.body, { status: edge.httpStatus });

  // Fallback: in-process engine, until the function is deployed.
  console.warn(
    "email: send-email edge function unreachable — testing in-process. Deploy it with: npx supabase functions deploy send-email",
  );
  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }
  try {
    const result = await runResendTest(admin, {
      teamId,
      to,
      userId: auth.userId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The test couldn't run." },
      { status: 500 },
    );
  }
}
