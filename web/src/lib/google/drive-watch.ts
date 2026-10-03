import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * The pure half of Drive push sync: the numbers, the URL and the header
 * contract. No database, no network — everything here is a function of its
 * arguments, which is the only part of push that can be proved without a real
 * Google account and a public hostname.
 *
 * The moving parts it pins down:
 *
 *   ADDRESS. Drive refuses to register a channel whose address is not HTTPS on
 *   a resolvable public host, and there is no error worth reading when it does —
 *   so we decide up front, in one place, whether this deployment can receive
 *   push at all. On localhost the answer is no, push is simply off, and polling
 *   carries the feature exactly as it did before.
 *
 *   EXPIRY. A Drive channel on a FILES resource lives at most 24 hours and
 *   defaults to ONE HOUR (the week-long ceiling in Google's docs belongs to
 *   `changes`, not `files`). Renewal is therefore the normal case, not an edge
 *   case: at the five-minute runner tick, a two-hour renewal window gives about
 *   twenty-four chances to hand over before a channel dies, which is enough to
 *   survive a deploy, a quota blip and a failed attempt in the same window.
 *
 *   TOKEN. The receiving endpoint is public — anyone can POST at it. The channel
 *   token is what separates Google from everyone else, so it is 32 random bytes
 *   and only its SHA-256 is ever written down.
 */

/** Drive's ceiling for a files channel. Asking for more is silently clamped. */
export const WATCH_MAX_TTL_SECONDS = 86_400;
/** What we ask for: the ceiling, so renewals are as rare as Drive allows. */
export const WATCH_TTL_SECONDS = WATCH_MAX_TTL_SECONDS;
/** Renew once less than this is left. See the note on EXPIRY above. */
export const RENEW_BEFORE_SECONDS = 7_200;
/**
 * A burst of typing in Google is a burst of notifications. The first one syncs,
 * the rest inside this window are deferred to the tick — one sync per edit
 * keystroke would spend our Sheets quota on nothing.
 */
export const NOTIFY_COOLDOWN_SECONDS = 20;

/** Registration backoff: 5 min, 10, 20 … capped at 6 h. */
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;

/** The path Drive is pointed at. Must match the route handler's location. */
export const DRIVE_WEBHOOK_PATH = "/api/hooks/google/drive";

export type WebhookAddress = { url: string } | { url: null; reason: string };

/**
 * Where Drive should POST, or why it cannot.
 *
 * GOOGLE_DRIVE_WEBHOOK_URL wins when set, which is how a developer points a
 * tunnel (ngrok, cloudflared) at a laptop; otherwise it is derived from
 * NEXT_PUBLIC_APP_URL, the same origin every other absolute link in the app is
 * built from. The env is a parameter so this is testable without mutating
 * process.env.
 */
export function driveWebhookAddress(env: NodeJS.ProcessEnv = process.env): WebhookAddress {
  const explicit = (env.GOOGLE_DRIVE_WEBHOOK_URL ?? "").trim();
  const base = (env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const raw = explicit || (base ? `${base.replace(/\/$/, "")}${DRIVE_WEBHOOK_PATH}` : "");
  if (!raw) {
    return { url: null, reason: "No NEXT_PUBLIC_APP_URL or GOOGLE_DRIVE_WEBHOOK_URL is set." };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: null, reason: "The webhook address is not a URL." };
  }
  if (parsed.protocol !== "https:") {
    return { url: null, reason: "Google only delivers push notifications over HTTPS." };
  }
  const host = parsed.hostname.toLowerCase();
  // Google resolves the host from its own network, so anything that only means
  // something on this machine can never receive a notification.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) {
    return { url: null, reason: `Google cannot reach "${host}" — push needs a public host.` };
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return { url: null, reason: "Google needs a domain with a valid certificate, not an IP address." };
  }
  // A query string would come back on every notification and buys nothing; the
  // channel id already identifies the subscription.
  return { url: `${parsed.origin}${parsed.pathname.replace(/\/$/, "") || DRIVE_WEBHOOK_PATH}` };
}

/** The id we mint and Drive echoes back as X-Goog-Channel-ID (max 64 chars). */
export function newChannelId(): string {
  return randomUUID();
}

/** The shared secret Drive echoes back as X-Goog-Channel-Token (max 256 chars). */
export function newChannelToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored. The token itself never reaches the database. */
export function hashChannelToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Drive's notification, read off the headers. There is no body — everything
 * Google tells us is here, which is why getting these names right is the whole
 * integration.
 *
 * Returns null for anything that is not recognisably a Drive notification, so
 * the route can answer a crawler or a probe without touching the database.
 */
export interface DriveNotification {
  channelId: string;
  /** Absent when the channel was registered without a token — never ours. */
  token: string | null;
  resourceId: string | null;
  resourceUri: string | null;
  /** sync | add | remove | update | trash | untrash (| change, on `changes`). */
  state: string;
  /** Per-channel and monotonically increasing; 1 for the sync handshake. */
  messageNumber: number | null;
  /** Only on `update`: content, properties, parents, children, permissions. */
  changed: string[];
  /** Human-readable, from X-Goog-Channel-Expiration. Informational only. */
  expiration: string | null;
}

export function parseDriveNotification(headers: Headers): DriveNotification | null {
  const channelId = (headers.get("x-goog-channel-id") ?? "").trim();
  const state = (headers.get("x-goog-resource-state") ?? "").trim().toLowerCase();
  if (!channelId || !state) return null;

  const rawNumber = headers.get("x-goog-message-number");
  const messageNumber = rawNumber === null ? NaN : Number(rawNumber.trim());

  return {
    channelId: channelId.slice(0, 64),
    token: headers.get("x-goog-channel-token")?.trim() || null,
    resourceId: headers.get("x-goog-resource-id")?.trim() || null,
    resourceUri: headers.get("x-goog-resource-uri")?.trim() || null,
    state,
    messageNumber: Number.isSafeInteger(messageNumber) && messageNumber > 0 ? messageNumber : null,
    changed: (headers.get("x-goog-changed") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    expiration: headers.get("x-goog-channel-expiration")?.trim() || null,
  };
}

/**
 * When to tell Drive the channel should die. Sent as a request, not a promise —
 * Drive clamps it, and `channelExpiry` below records what actually came back.
 */
export function requestedExpirationMs(now: number = Date.now()): number {
  return now + WATCH_TTL_SECONDS * 1000;
}

/**
 * What to store as expires_at.
 *
 * Trusting Google's number is right, with two guards: a value in the past (clock
 * skew, or a malformed response) would make the channel look dead on arrival and
 * be renewed forever, and a value beyond the documented ceiling would let a
 * renewal be scheduled after the channel has really stopped. Both are clamped
 * into the window Drive actually honours.
 */
export function channelExpiry(expirationMs: number | null, now: number = Date.now()): Date {
  const ceiling = now + WATCH_MAX_TTL_SECONDS * 1000;
  // Drive's own default when it is not asked for anything: one hour.
  const fallback = now + 3_600_000;
  if (expirationMs === null || !Number.isFinite(expirationMs)) return new Date(fallback);
  if (expirationMs <= now) return new Date(fallback);
  return new Date(Math.min(expirationMs, ceiling));
}

/** True when this channel is close enough to death to hand over to a new one. */
export function needsRenewal(expiresAt: Date | string, now: number = Date.now()): boolean {
  const at = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(at)) return true;
  return at - now <= RENEW_BEFORE_SECONDS * 1000;
}

/** Exponential backoff for a registration Drive keeps refusing. */
export function retryAfter(failCount: number, now: number = Date.now()): Date {
  const step = Math.max(0, Math.min(failCount, 20));
  return new Date(now + Math.min(RETRY_BASE_MS * 2 ** step, RETRY_MAX_MS));
}
