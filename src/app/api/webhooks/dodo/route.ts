import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { dodoConfigured, dodoClient } from "@/lib/dodo/client";

/**
 * Dodo Payments webhook. Verifies the Standard-Webhooks signature, dedupes by
 * webhook-id, then reconciles our records:
 *   subscription.active/renewed/updated  -> team active
 *   subscription.on_hold                 -> team paused
 *   subscription.cancelled/failed/expired-> team canceled
 *   payment.succeeded (early_access)     -> mark the early-access order paid
 * The subscription/payment metadata carries the team_id / early_access_id we set
 * at checkout, so we always know what to update.
 */
export const runtime = "nodejs";

const ACTIVE = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.updated",
  "subscription.plan_changed",
]);
const PAUSED = new Set(["subscription.on_hold"]);
const CANCELED = new Set([
  "subscription.cancelled",
  "subscription.failed",
  "subscription.expired",
]);

interface DodoData {
  subscription_id?: string;
  payment_id?: string;
  customer?: { customer_id?: string };
  customer_id?: string;
  next_billing_date?: string;
  cancel_at_next_billing_date?: boolean;
  metadata?: Record<string, string>;
}

export async function POST(request: NextRequest) {
  const secret = process.env.DODO_WEBHOOK_SECRET ?? "";
  if (!dodoConfigured() || !secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const raw = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let event: { type: string; data: DodoData };
  try {
    event = dodoClient().webhooks.unwrap(raw, { headers, key: secret }) as unknown as {
      type: string;
      data: DodoData;
    };
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  // Loose client — the dodo_* columns / dodo_webhook_events are newer than the
  // generated types.
  const db = createSupabaseAdmin(url, key, {
    auth: { persistSession: false },
  }) as unknown as SupabaseClient;

  const data = event.data ?? {};
  const meta = data.metadata ?? {};

  // Idempotency: record the webhook id; a duplicate insert means we're done.
  const eventId =
    headers["webhook-id"] ||
    `${event.type}:${data.subscription_id ?? data.payment_id ?? ""}`;
  const { error: dupErr } = await db.from("dodo_webhook_events").insert({
    event_id: eventId,
    type: event.type,
  });
  if (dupErr) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if (event.type.startsWith("subscription.") && meta.team_id) {
      const status = ACTIVE.has(event.type)
        ? "active"
        : PAUSED.has(event.type)
          ? "paused"
          : CANCELED.has(event.type)
            ? "canceled"
            : null;
      const patch: Record<string, unknown> = {
        team_id: meta.team_id,
        dodo_subscription_id: data.subscription_id ?? null,
        dodo_customer_id: data.customer?.customer_id ?? data.customer_id ?? null,
        current_period_end: data.next_billing_date ?? null,
        cancel_at_period_end: Boolean(data.cancel_at_next_billing_date),
        updated_at: new Date().toISOString(),
      };
      if (status) patch.status = status;
      if (meta.storage_gb) patch.storage_gb = Number(meta.storage_gb);
      if (meta.seats) patch.seats = Number(meta.seats);
      await db.from("team_subscriptions").upsert(patch, { onConflict: "team_id" });
    } else if (event.type === "payment.succeeded" && meta.kind === "early_access" && meta.early_access_id) {
      await db
        .from("early_access_requests")
        .update({
          payment_status: "paid",
          provider: "dodo",
          provider_payment_id: data.payment_id ?? null,
          paid_at: new Date().toISOString(),
        })
        .eq("id", meta.early_access_id)
        .eq("payment_status", "pending");
    }
  } catch {
    // Let Dodo retry: drop the idempotency row so the redelivery re-processes.
    await db.from("dodo_webhook_events").delete().eq("event_id", eventId);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
