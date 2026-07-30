// Supabase Edge Function: send-email — the email engine's cloud dispatcher.
//
// The Next.js routes (/api/email/send, /api/apps/resend/test) invoke this
// function first and only fall back to in-process sending while it isn't
// deployed, so email leaves from Supabase's edge, not the web server. The
// contract mirrors src/lib/email/engine.ts exactly — change them together.
//
//   POST { teamId, to, test: true }                       → test send (team admin)
//   POST { teamId, eventKey, to, subject, html?|text? }   → dispatch   (team member)
//   → 200 { ok, status: "sent"|"failed"|"skipped", reason? }
//
// Structure:
//   ../_shared/cors.ts      — CORS + JSON response helpers
//   ../_shared/supabase.ts  — admin / caller-scoped client factories
//   ../_shared/resend.ts    — the Resend sender (sanitized outcomes)
//   ./payload.ts            — request parsing + validation
//   ./auth.ts               — JWT caller resolution + team gate
//   ./dispatch.ts           — switches, send, email_log, test health
//
// Deploy: npx supabase functions deploy send-email --project-ref <ref>

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import {
  authenticateCaller,
  authorizeInvitationSend,
  authorizePlatform,
  authorizeTeam,
} from "./auth.ts";
import { parseSendPayload } from "./payload.ts";
import { dispatchEmail } from "./dispatch.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const admin = adminClient();
  if (!admin) return jsonResponse({ error: "Function is not configured." }, 500);

  const caller = await authenticateCaller(admin, req);
  if (caller instanceof Response) return caller;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON." }, 400);
  }
  const payload = parseSendPayload(raw);
  if (typeof payload === "string") return jsonResponse({ error: payload }, 400);

  let denied =
    payload.scope === "platform"
      ? await authorizePlatform(caller.authHeader, caller.email, payload.to, payload.isTest)
      : await authorizeTeam(caller.authHeader, payload.teamId, payload.isTest);
  // Invitations legitimately go to someone ELSE's address — allowed when a
  // matching pending invitation exists in one of the caller's teams.
  if (denied && !payload.isTest && payload.scope === "platform" &&
      payload.eventKey === "account.invitation_sent") {
    denied = await authorizeInvitationSend(admin, caller.authHeader, payload.to);
  }
  if (denied) return denied;

  try {
    const result = await dispatchEmail(admin, payload, caller.userId);
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Send failed." },
      500,
    );
  }
});
