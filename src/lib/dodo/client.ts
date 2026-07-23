import DodoPayments from "dodopayments";

/**
 * Dodo Payments server helpers. Keys live in env and never reach the client.
 *
 *   DODO_PAYMENTS_API_KEY   — secret API key (test or live)
 *   DODO_ENVIRONMENT        — "test_mode" (default) | "live_mode"
 *   DODO_WEBHOOK_SECRET     — webhook signing secret (Standard Webhooks)
 *   DODO_SEAT_PRODUCT_ID    — recurring product priced per seat ($1/user/mo)
 *   DODO_STORAGE_PRODUCT_ID — recurring product priced per extra GB ($0.20/GB)
 *   DODO_DEVICE_PRODUCT_ID  — one-time early-access product
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
  seat: () => process.env.DODO_SEAT_PRODUCT_ID ?? "",
  storage: () => process.env.DODO_STORAGE_PRODUCT_ID ?? "",
  earlyAccess: () => process.env.DODO_DEVICE_PRODUCT_ID ?? "",
};

/** The origin used for checkout return URLs (falls back to the canonical host). */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im").replace(/\/$/, "");
}
