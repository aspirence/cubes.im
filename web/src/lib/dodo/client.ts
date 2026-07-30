import DodoPayments from "dodopayments";

/**
 * Dodo Payments server helpers. Keys live in env and never reach the client.
 *
 *   DODO_PAYMENTS_API_KEY   — secret API key (test or live)
 *   DODO_ENVIRONMENT        — "test_mode" (default) | "live_mode"
 *   DODO_WEBHOOK_SECRET     — webhook signing secret (Standard Webhooks)
 *   DODO_SEAT_PRODUCT_ID    — recurring product priced per seat ($1/user/mo)
 *   DODO_STORAGE_ADDON_ID   — recurring ADDON, priced per storage BLOCK
 *   DODO_STORAGE_BLOCK_GB   — GB per addon unit (default 10). Dodo has a min
 *                             price, so sell storage in blocks (e.g. 10 GB = $2
 *                             = $0.20/GB) instead of per single GB.
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

/** How many seats a team is billed for right now (active, non-guest members). */
export function billableSeats(
  members: { user_id?: string | null; active?: boolean | null; member_type?: string | null }[],
): number {
  return Math.max(
    1,
    members.filter((m) => m.user_id && m.active !== false && m.member_type !== "guest").length,
  );
}

/** GB of storage per addon unit (Dodo min-price → sell in blocks). */
export function storageBlockGb(): number {
  return Math.max(1, Number(process.env.DODO_STORAGE_BLOCK_GB ?? 10) || 10);
}

/** Addon units needed to cover `extraGb` of storage (rounded up to a block). */
export function storageAddonQty(extraGb: number): number {
  return extraGb > 0 ? Math.ceil(extraGb / storageBlockGb()) : 0;
}

/** The origin used for checkout return URLs (falls back to the canonical host). */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im").replace(/\/$/, "");
}
