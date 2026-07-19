import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { authorizePlatform, emailServiceClient } from "@/lib/email/server";
import { invokeSendEmailEdge } from "@/lib/email/edge";
import { runPlatformDispatch } from "@/lib/email/engine";
import { composeEmail } from "@/lib/email/compose";
import { welcomeVars } from "@/lib/email/welcome";

/**
 * Sends the signup welcome email (account.signup_welcome) from the PLATFORM
 * sender to the CALLER'S OWN address — content is composed here, never taken
 * from the client. Idempotent: the dispatch pipeline skips when a welcome was
 * already sent to this address, so the signup page and the auth callback can
 * both fire it safely. No body required.
 */

export const runtime = "nodejs";

export async function POST() {
  const auth = await authorizePlatform(false);
  if (!auth.ok) return auth.response;
  if (!auth.email) {
    return NextResponse.json({ error: "No email on the account." }, { status: 400 });
  }

  // Greet by profile name when it exists (signup collects it).
  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from("users")
    .select("name")
    .eq("id", auth.userId)
    .maybeSingle();

  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }
  const rendered = await composeEmail(
    admin,
    "account.signup_welcome",
    welcomeVars(auth.email, profile?.name),
  );
  if (!rendered) {
    return NextResponse.json(
      { ok: false, status: "skipped", reason: "No template for this scenario." },
      { status: 200 },
    );
  }

  const payload = {
    scope: "platform" as const,
    eventKey: "account.signup_welcome",
    to: auth.email,
    subject: rendered.subject,
    html: rendered.html,
  };

  const edge = await invokeSendEmailEdge(payload, auth.accessToken);
  if (edge) return NextResponse.json(edge.body, { status: edge.httpStatus });

  console.warn(
    "email: send-email edge function unreachable — sending in-process. Deploy it with: npx supabase functions deploy send-email",
  );
  try {
    const result = await runPlatformDispatch(admin, {
      eventKey: payload.eventKey,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      userId: auth.userId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed." },
      { status: 500 },
    );
  }
}
