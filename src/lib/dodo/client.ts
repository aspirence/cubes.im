import DodoPayments from "dodopayments";

/**
 * Dodo Payments server helpers. Keys live in env and never reach the client.
 *
 *   DODO_PAYMENTS_API_KEY   — secret API key (test or live)
 *   DODO_ENVIRONMENT        — "test_mode" (default) | "live_mode"
 *   DODO_WEBHOOK_SECRET     — webhook signing secret (Standard Webhooks)
 *   DODO_SEAT_PRODUCT_ID    — recurring product priced per seat ($1/user/mo)
 *   DODO_STORAGE_ADDON_ID   — recurring ADDON priced per extra GB ($0.20/GB)
 *   DODO_DEVICE_PRODUCT_ID  — one-time early-access product
 *   DODO_TRIAL_DAYS         — free-trial length (default 7)
 */

export function dodoConfigured(): boolean {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY);
}

export function dodoClient(): DodoPayments {
  return new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY ?? "",
    environment:
      (process.env.DODO_ENVIRONMENT as "test_mode" | "live_mode") ?? "test_mode",
  });
}

export const DODO_PRODUCTS = {
  /** The subscription's main product — priced per seat. */
  seat: () => process.env.DODO_SEAT_PRODUCT_ID ?? "",
  /** A recurring addon on the seat product — priced per extra GB. */
  storageAddon: () => process.env.DODO_STORAGE_ADDON_ID ?? "",
  earlyAccess: () => process.env.DODO_DEVICE_PRODUCT_ID ?? "",
};

/** How many seats + extra GB a team is billed for right now. */
export function billableSeats(
  members: { user_id?: string | null; active?: boolean | null; member_type?: string | null }[],
): number {
  return Math.max(
    1,
    members.filter((m) => m.user_id && m.active !== false && m.member_type !== "guest").length,
  );
}

/** The origin used for checkout return URLs (falls back to the canonical host). */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im").replace(/\/$/, "");
}
