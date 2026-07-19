import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { serviceClient } from "@/lib/apps/server";
import {
  getByPath,
  parsePunchTimestamp,
  resolveAttendanceWebhookConfig,
  type AttendanceWebhookConfig,
} from "@/lib/attendance-webhook/config";

/**
 * Attendance webhook receiver — the machine-facing endpoint external systems
 * (biometric devices, door controllers, Zapier, other HR tools) POST punches
 * to. Fully customizable per webhook via attendance_webhooks.config: which
 * field identifies the employee (and against which hr_employees column), which
 * field/values mean IN vs OUT, where the punch time lives, batch payload
 * shape, and the timezone for the attendance date.
 *
 * Auth (the mcp_tokens pattern): the caller presents the raw token minted at
 * creation (`x-webhook-token`, `Authorization: Bearer …`, or `?token=` for
 * devices that can only configure a URL); its SHA-256 hash must match the
 * stored token_hash. Optionally HMAC-signed with the exact scheme the outbound
 * connector uses (X-Signature: sha256=<hex over "<unix_ts>.<body>">).
 *
 * Punches land in hr_attendance via the attendance_webhook_punch RPC
 * (earliest-in / latest-out merge, shift-break-aware work_minutes,
 * source='system'); every event is recorded in attendance_webhook_events for
 * the HR admin's delivery log.
 */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 200_000;
const MAX_EVENTS = 200;
const SIGNATURE_TOLERANCE_SECONDS = 300;

type Admin = SupabaseClient<Database>;
type WebhookRow = Database["public"]["Tables"]["attendance_webhooks"]["Row"];

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

/** Constant-time equality over the hex digests of two strings. */
function digestsMatch(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

/** Pulls the presented token from header, bearer, or query string. */
function presentedToken(req: NextRequest): string {
  const header = req.headers.get("x-webhook-token");
  if (header) return header.trim();
  const bearer = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return req.nextUrl.searchParams.get("token")?.trim() ?? "";
}

/**
 * Loads the webhook and authenticates the caller's token against its hash.
 * 404 before 401 on purpose is avoided — an unknown id and a bad token both
 * end in 401 so the endpoint discloses nothing about which ids exist.
 */
async function authenticate(
  req: NextRequest,
  admin: Admin,
  id: string,
): Promise<{ webhook: WebhookRow } | NextResponse> {
  const token = presentedToken(req);
  if (!token) {
    return json({ error: "Missing webhook token." }, 401);
  }

  const { data: webhook, error } = await admin
    .from("attendance_webhooks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return json({ error: "Webhook lookup failed." }, 500);

  const hash = createHash("sha256").update(token).digest("hex");
  if (!webhook || !digestsMatch(hash, webhook.token_hash)) {
    return json({ error: "Unknown webhook or invalid token." }, 401);
  }
  if (!webhook.enabled) {
    return json({ error: "This webhook is disabled." }, 403);
  }
  return { webhook };
}

/**
 * Verifies the HMAC signature when required (and opportunistically when the
 * headers are present anyway). Same scheme as the outbound connector:
 * sha256 over "<unix_ts>.<rawBody>" with a bounded timestamp skew.
 */
function verifySignature(
  req: NextRequest,
  rawBody: string,
  secret: string | null,
  config: AttendanceWebhookConfig,
): string | null {
  const header = req.headers.get("x-signature") ?? "";
  const ts = req.headers.get("x-signature-timestamp") ?? "";
  const presented = header.replace(/^sha256=/i, "").trim();

  if (!config.require_signature && !presented) return null;
  if (!secret) {
    return config.require_signature
      ? "Signature required but no signing secret is stored for this webhook."
      : null;
  }
  if (!presented || !ts) {
    return "Missing X-Signature / X-Signature-Timestamp header.";
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(skew) || skew > SIGNATURE_TOLERANCE_SECONDS) {
    return "Signature timestamp is too far from the current time.";
  }
  const expected = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");
  return digestsMatch(presented, expected) ? null : "Invalid signature.";
}

/** Extracts the punch events from the body per the configured shape. `dropped`
 *  counts non-object entries — reported back so a malformed batch is never
 *  silently under-counted as full success. */
function extractEvents(
  body: unknown,
  config: AttendanceWebhookConfig,
): { events: Record<string, unknown>[]; dropped: number } | string {
  const source = config.events_field ? getByPath(body, config.events_field) : body;
  const list = Array.isArray(source) ? source : [source];
  if (list.length > MAX_EVENTS) {
    return `Too many events in one delivery (max ${MAX_EVENTS}).`;
  }
  const events = list.filter(
    (e): e is Record<string, unknown> => typeof e === "object" && e !== null,
  );
  if (events.length === 0) {
    return config.events_field
      ? `No events found at "${config.events_field}" in the payload.`
      : "The payload contains no event objects.";
  }
  return { events, dropped: list.length - events.length };
}

/** Maps the configured event value onto a punch direction. */
function resolveDirection(
  event: Record<string, unknown>,
  config: AttendanceWebhookConfig,
): "in" | "out" | "auto" {
  const raw = config.event_field ? getByPath(event, config.event_field) : undefined;
  const value = typeof raw === "string" || typeof raw === "number" ? String(raw).trim().toLowerCase() : "";
  if (value) {
    if (config.in_values.some((v) => v.toLowerCase() === value)) return "in";
    if (config.out_values.some((v) => v.toLowerCase() === value)) return "out";
  }
  return config.default_direction;
}

/** Looks up the employee for a payload key, memoized per delivery. Throws on a
 *  QUERY failure — "the database hiccuped" must surface as an error outcome,
 *  not be cached and logged as "employee doesn't exist" (which would tell the
 *  sender the delivery succeeded and lose the punches for good). */
async function resolveEmployee(
  admin: Admin,
  orgId: string,
  config: AttendanceWebhookConfig,
  key: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let query = admin.from("hr_employees").select("id").eq("org_id", orgId);
  if (config.employee_match === "employee_id") query = query.eq("id", key);
  else if (config.employee_match === "work_email") query = query.eq("work_email", key);
  else query = query.eq("employee_code", key);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("employee lookup failed");
  const id = data?.id ?? null;
  cache.set(key, id);
  return id;
}

/** Event payload for the log, capped so a huge delivery can't bloat the table. */
function logPayload(event: Record<string, unknown>): Json {
  const str = JSON.stringify(event);
  if (str.length <= 2000) return event as Json;
  return { _truncated: true, preview: str.slice(0, 2000) };
}

interface EventOutcome {
  employee_key: string | null;
  employee_id: string | null;
  direction: "in" | "out" | null;
  outcome: "processed" | "ignored" | "error";
  error: string | null;
  payload: Json;
}

async function processEvent(
  admin: Admin,
  webhook: WebhookRow,
  config: AttendanceWebhookConfig,
  event: Record<string, unknown>,
  employeeCache: Map<string, string | null>,
): Promise<EventOutcome> {
  const payload = logPayload(event);
  const base: EventOutcome = {
    employee_key: null,
    employee_id: null,
    direction: null,
    outcome: "error",
    error: null,
    payload,
  };

  const keyRaw = getByPath(event, config.employee_field);
  const key =
    typeof keyRaw === "string" || typeof keyRaw === "number"
      ? String(keyRaw).trim()
      : "";
  if (!key) {
    return { ...base, outcome: "ignored", error: `No employee key at "${config.employee_field}".` };
  }
  base.employee_key = key.slice(0, 200);

  // employee_id matching feeds the key into a uuid column — pre-validate so a
  // junk key reads as "unknown employee", not a Postgres cast error.
  if (
    config.employee_match === "employee_id" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  ) {
    return { ...base, outcome: "ignored", error: "Employee key is not a valid id." };
  }

  let employeeId: string | null;
  try {
    employeeId = await resolveEmployee(admin, webhook.org_id, config, key, employeeCache);
  } catch {
    return { ...base, outcome: "error", error: "Employee lookup failed — retry the delivery." };
  }
  if (!employeeId) {
    return {
      ...base,
      outcome: "ignored",
      error: `No employee matched ${config.employee_match} "${key.slice(0, 100)}".`,
    };
  }
  base.employee_id = employeeId;

  const direction = resolveDirection(event, config);

  const tsRaw = config.timestamp_field
    ? getByPath(event, config.timestamp_field)
    : undefined;
  // Zone-less device timestamps are wall-clock times in the org's configured
  // zone — never the server's.
  const at = tsRaw === undefined || tsRaw === null || tsRaw === ""
    ? new Date()
    : parsePunchTimestamp(tsRaw, config.timezone);
  if (!at) {
    return { ...base, outcome: "error", error: `Unparseable timestamp at "${config.timestamp_field}".` };
  }

  const { error } = await admin.rpc("attendance_webhook_punch", {
    _employee_id: employeeId,
    _at: at.toISOString(),
    _direction: direction,
    _tz: config.timezone,
  });
  if (error) {
    // RPC failures can carry row data in their message; keep it generic.
    return { ...base, outcome: "error", error: "Failed to record the punch." };
  }

  return {
    ...base,
    // 'auto' resolves inside the RPC; log the explicit direction when we know it.
    direction: direction === "auto" ? null : direction,
    outcome: "processed",
  };
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const admin = serviceClient();
  if (!admin) {
    return json({ error: "Attendance webhooks are not configured." }, 500);
  }

  const auth = await authenticate(request, admin, id);
  if (auth instanceof NextResponse) return auth;
  const { webhook } = auth;
  const config = resolveAttendanceWebhookConfig(webhook.config);

  const declaredLen = Number(request.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_BODY_BYTES) {
    return json({ error: "Request body too large." }, 413);
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ error: "Request body too large." }, 413);
  }

  const { data: secretRow } = await admin
    .from("attendance_webhook_secrets")
    .select("signing_secret")
    .eq("webhook_id", webhook.id)
    .maybeSingle();
  const signatureError = verifySignature(
    request,
    rawBody,
    secretRow?.signing_secret ?? null,
    config,
  );
  if (signatureError) return json({ error: signatureError }, 401);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const extracted = extractEvents(body, config);
  if (typeof extracted === "string") return json({ error: extracted }, 400);
  const { events, dropped } = extracted;

  const employeeCache = new Map<string, string | null>();
  const outcomes: EventOutcome[] = [];
  // Sequential on purpose: punches for the same employee/day must not race
  // each other, and one delivery must not fan out into a burst of DB work.
  for (const event of events) {
    outcomes.push(
      await processEvent(admin, webhook, config, event, employeeCache),
    );
  }

  const processed = outcomes.filter((o) => o.outcome === "processed").length;
  const ignored = outcomes.filter((o) => o.outcome === "ignored").length;
  const errors = outcomes.filter((o) => o.outcome === "error");

  const { error: logError } = await admin.from("attendance_webhook_events").insert(
    outcomes.map((o) => ({
      webhook_id: webhook.id,
      org_id: webhook.org_id,
      employee_id: o.employee_id,
      employee_key: o.employee_key,
      direction: o.direction,
      outcome: o.outcome,
      error: o.error?.slice(0, 1000) ?? null,
      payload: o.payload,
    })),
  );
  if (logError) console.error("attendance webhook: delivery log insert failed:", logError.message);

  // Atomic increment via RPC — a read-modify-write here would lose counts
  // whenever two deliveries overlap.
  const lastError =
    errors.length > 0
      ? (errors[0].error ?? "Delivery had errors.")
      : dropped > 0
        ? `${dropped} non-object ${dropped === 1 ? "entry" : "entries"} in the batch were skipped.`
        : null;
  await admin.rpc("attendance_webhook_touch", {
    _webhook_id: webhook.id,
    _events: outcomes.length,
    _error: lastError,
  });

  // All-events-failed → 5xx so well-behaved senders retry the delivery.
  const status = errors.length > 0 && processed === 0 && ignored === 0 ? 500 : 200;
  return json(
    {
      ok: errors.length === 0 && dropped === 0,
      received: outcomes.length + dropped,
      processed,
      ignored,
      dropped,
      failed: errors.length,
    },
    status,
  );
}

/** Endpoint verification ping for device platforms that validate with a GET. */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const admin = serviceClient();
  if (!admin) {
    return json({ error: "Attendance webhooks are not configured." }, 500);
  }
  const auth = await authenticate(request, admin, id);
  if (auth instanceof NextResponse) return auth;
  return json({ ok: true, name: auth.webhook.name }, 200);
}
