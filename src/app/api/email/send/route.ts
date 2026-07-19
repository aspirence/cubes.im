import { NextResponse, type NextRequest } from "next/server";
import {
  authorizePlatform,
  authorizeTeam,
  emailServiceClient,
} from "@/lib/email/server";
import { invokeSendEmailEdge } from "@/lib/email/edge";
import { runEmailDispatch, runPlatformDispatch } from "@/lib/email/engine";

/**
 * The email engine's dispatch endpoint — app code calls this AFTER the
 * originating write succeeds. The actual sending happens in the `send-email`
 * Supabase Edge Function (cloud); this route authenticates the caller,
 * forwards the request there, and only runs the in-process engine as a
 * fallback while the function isn't deployed. Both platform switches are
 * re-checked by whichever engine runs — the caller's UI state is never
 * trusted.
 *
 * Caller contract (workspace member session required):
 *   POST { teamId, eventKey, to, subject, html?, text? }
 *   → { ok, status: "sent" | "failed" | "skipped", reason? }
 */

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SUBJECT = 500;
const MAX_BODY_CHARS = 100_000;

export async function POST(request: NextRequest) {
  let body: {
    scope?: string;
    teamId?: string;
    eventKey?: string;
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const scope = body.scope === "platform" ? "platform" : "workspace";
  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const eventKey = typeof body.eventKey === "string" ? body.eventKey.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const html = typeof body.html === "string" ? body.html : undefined;
  const text = typeof body.text === "string" ? body.text : undefined;

  if (
    (scope === "workspace" && !teamId) ||
    !eventKey ||
    !EMAIL_RE.test(to) ||
    !subject ||
    subject.length > MAX_SUBJECT ||
    (!html && !text) ||
    (html ?? text ?? "").length > MAX_BODY_CHARS
  ) {
    return NextResponse.json(
      { error: "scope/teamId, eventKey, to, subject and html or text are required." },
      { status: 400 },
    );
  }

  // Workspace scope: any member of the team. Platform scope: platform admins
  // send anywhere; everyone else only to their own address (the welcome path).
  let userId: string;
  let accessToken: string;
  if (scope === "platform") {
    const auth = await authorizePlatform(false);
    if (!auth.ok) return auth.response;
    if (!auth.isPlatformAdmin && to !== auth.email) {
      return NextResponse.json(
        { error: "Platform emails can only be sent to your own address." },
        { status: 403 },
      );
    }
    userId = auth.userId;
    accessToken = auth.accessToken;
  } else {
    const auth = await authorizeTeam(teamId, "member");
    if (!auth.ok) return auth.response;
    userId = auth.userId;
    accessToken = auth.accessToken;
  }

  // Primary: the cloud dispatcher.
  const edge = await invokeSendEmailEdge(
    { scope, teamId, eventKey, to, subject, html, text },
    accessToken,
  );
  if (edge) return NextResponse.json(edge.body, { status: edge.httpStatus });

  // Fallback: in-process engine, until the function is deployed.
  console.warn(
    "email: send-email edge function unreachable — sending in-process. Deploy it with: npx supabase functions deploy send-email",
  );
  const admin = emailServiceClient();
  if (!admin) {
    return NextResponse.json({ error: "Email is not configured." }, { status: 500 });
  }
  try {
    const result =
      scope === "platform"
        ? await runPlatformDispatch(admin, { eventKey, to, subject, html, text, userId })
        : await runEmailDispatch(admin, { teamId, eventKey, to, subject, html, text, userId });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed." },
      { status: 500 },
    );
  }
}
