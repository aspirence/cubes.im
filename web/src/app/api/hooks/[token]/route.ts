import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/apps/auth";
import { continueRun } from "@/lib/workflows/runner";

/**
 * The inbound webhook: the one URL a person can paste into anything on the
 * internet and have a workflow start.
 *
 * Public on purpose — no session, no team header. The token IS the authority,
 * which is why it is 32 random bytes and why an unknown one answers 404 with
 * no hint that a workspace or a workflow was ever involved. Everything else
 * answers 200 `{received: true}`: a sender that gets a 500 will retry forever,
 * and a sender that gets a 403 learns that the token was right.
 *
 * What happens to a request, in order:
 *  1. Body read raw (≤ 1 MB) — raw, because an HMAC is over the bytes that
 *     arrived, not over a re-serialized object.
 *  2. Optional x-cubes-signature checked against the webhook's signing secret.
 *     A wrong signature is the one case that does get a hard answer (401): the
 *     token was right, so the caller is the integrator and needs to know their
 *     secret is wrong. Nothing is stored — otherwise anyone holding the URL
 *     could fill the capture buffer with whatever they liked.
 *  3. The event is recorded. If the webhook has a dedupe_path, the value at
 *     that path must be unique for this webhook, and a repeat is answered
 *     200 `{duplicate: true}` without running anything.
 *  4. In capture mode it stops there — that is the builder's "waiting for a
 *     request…" state, and the captured body becomes the trigger sample.
 *  5. Otherwise a run starts with trigger_payload = the payload, and the app
 *     steps are driven immediately instead of waiting for the next tick.
 *
 * GET answers a hub.challenge echo so a Meta-style subscription verification
 * works when we add one.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** 1 MB, the same ceiling Zapier's raw hook uses. */
const MAX_BODY_BYTES = 1_048_576;
/** base64url of 32 bytes is 43 chars; the range allows for a rotated format. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Request headers worth keeping for the builder, minus anything secret. */
const DROPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "x-cubes-signature",
  "proxy-authorization",
]);

interface WebhookRow {
  id: string;
  workflow_id: string;
  team_id: string;
  signing_secret: string | null;
  capture_mode: boolean;
  dedupe_path: string | null;
  enabled: boolean;
}

function headersOf(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (DROPPED_HEADERS.has(name)) return;
    out[name] = value.slice(0, 2000);
  });
  return out;
}

/** Constant-time compare of a hex signature, tolerating a "sha256=" prefix. */
function signatureMatches(secret: string, body: string, provided: string | null): boolean {
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const given = provided.trim().replace(/^sha256=/i, "").toLowerCase();
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Bodies arrive as JSON, as a form post, or as something we have never seen.
 * Anything that is not a JSON object is wrapped, because the run context
 * addresses the payload by key and an array or a bare string has none.
 */
function parseBody(raw: string, contentType: string): Record<string, unknown> {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!raw) return {};
  if (type === "application/x-www-form-urlencoded") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of new URLSearchParams(raw)) out[key] = value;
    return out;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

/** The value at a dot-path, as text, or null when it is missing or not scalar. */
function dedupeValue(payload: Record<string, unknown>, path: string | null): string | null {
  if (!path) return null;
  let node: unknown = payload;
  for (const segment of path.split(".")) {
    if (node === null || node === undefined || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[segment];
  }
  if (node === null || node === undefined) return null;
  if (typeof node === "object") return null;
  return String(node).slice(0, 300);
}

async function findWebhook(admin: SupabaseClient, token: string): Promise<WebhookRow | null> {
  const { data, error } = await admin
    .from("workflow_webhooks")
    .select("id, workflow_id, team_id, signing_secret, capture_mode, dedupe_path, enabled")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WebhookRow | null) ?? null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  let webhook: WebhookRow | null;
  try {
    webhook = await findWebhook(admin, token);
  } catch {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  if (!webhook) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  if (webhook.signing_secret) {
    if (!signatureMatches(webhook.signing_secret, raw, request.headers.get("x-cubes-signature"))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const payload = parseBody(raw, request.headers.get("content-type") ?? "");
  const dedupeKey = dedupeValue(payload, webhook.dedupe_path);
  // A webhook that is switched off still shows its owner that traffic is
  // arriving; it simply never starts a run.
  const capture = webhook.capture_mode || !webhook.enabled;

  const { data: inserted, error: insertErr } = await admin
    .from("workflow_webhook_events")
    .insert({
      webhook_id: webhook.id,
      team_id: webhook.team_id,
      headers: headersOf(request),
      payload,
      dedupe_key: dedupeKey,
      status: capture ? "captured" : "queued",
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    // 23505 is the partial unique on (webhook_id, dedupe_key): this exact
    // record has been delivered before, which is a success from the sender's
    // point of view — it should stop retrying, not escalate.
    if (insertErr.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }

  const eventId = (inserted as { id: string } | null)?.id ?? null;
  await admin
    .from("workflow_webhooks")
    .update({ last_event_at: new Date().toISOString() })
    .eq("id", webhook.id);

  if (capture) {
    return NextResponse.json({ received: true, captured: true });
  }

  // Start the run. wf_start_run records the raw payload so a replay can resend
  // exactly this, then runs every in-SQL step and parks on the first app step.
  const { data: runId, error: runErr } = await admin.rpc("wf_start_run", {
    p_workflow_id: webhook.workflow_id,
    p_trigger: {
      trigger: "webhook",
      webhook_event_id: eventId,
      received_at: new Date().toISOString(),
    },
    p_payload: payload,
    p_replay_of: null,
  });
  if (runErr || !runId) {
    if (eventId) {
      await admin
        .from("workflow_webhook_events")
        .update({ status: "error", error: (runErr?.message ?? "The run could not be started.").slice(0, 1000) })
        .eq("id", eventId);
    }
    // Still 200: the request was received and recorded, and a sender retrying
    // into a broken workflow helps nobody.
    return NextResponse.json({ received: true, started: false });
  }

  if (eventId) {
    await admin
      .from("workflow_webhook_events")
      .update({ status: "ran", run_id: runId as string })
      .eq("id", eventId);
  }

  // Drive the app steps now rather than up to five minutes from now: a webhook
  // sender that waits for the response expects the work to have happened.
  await continueRun(admin, runId as string, null).catch(() => undefined);

  return NextResponse.json({ received: true, run_id: runId });
}

/**
 * Subscription verification. Meta (and anything modelled on it) confirms a
 * webhook by GETting it with hub.challenge and expecting the challenge back as
 * plain text. Answering it here means the URL can be registered before the
 * feature that uses it exists.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  let webhook: WebhookRow | null;
  try {
    webhook = await findWebhook(admin, token);
  } catch {
    return NextResponse.json({ error: "Not available" }, { status: 503 });
  }
  if (!webhook) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (challenge) {
    return new NextResponse(challenge.slice(0, 500), {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json({ ok: true });
}
