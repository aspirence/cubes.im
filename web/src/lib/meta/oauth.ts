import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { graphVersion } from "./graph";

/**
 * "Continue with Facebook" — the Meta Ads connection for workflows.
 *
 * Two shapes, picked by env:
 *  - META_LOGIN_CONFIG_ID set (recommended): Facebook Login for Business with a
 *    configuration whose token type is "System user". The admin chooses the
 *    business and ad accounts in Facebook's own dialog, and the code exchanges
 *    for a business-integration system-user token that does not expire.
 *  - Not set: classic Facebook Login with the ads_read scope. The code
 *    exchanges for a short-lived user token, which is swapped for a long-lived
 *    one (about 60 days); the connection then shows when it needs a reconnect.
 *
 * The `state` parameter is signed (HMAC keyed off the app secret) and doubled
 * by a nonce cookie, exactly like the Google flow: the callback requires both
 * to agree, which is what stops a crafted callback being replayed into another
 * browser.
 *
 * Server-only: it reads the app secret.
 */

const DIALOG_HOST = "https://www.facebook.com";
const GRAPH_HOST = "https://graph.facebook.com";
const META_TIMEOUT_MS = 10_000;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** Permissions for the classic flow (a Login for Business config sets its own). */
export const META_SCOPES = "ads_read,business_management";

/** Name of the cookie carrying the CSRF nonce. */
export const META_OAUTH_COOKIE = "meta_oauth";

export interface MetaStatePayload {
  teamId: string;
  userId: string;
  nonce: string;
  iat: number;
  returnTo: string;
}

function config() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return {
    appId: (process.env.META_APP_ID ?? "").trim(),
    appSecret: (process.env.META_APP_SECRET ?? "").trim(),
    loginConfigId: (process.env.META_LOGIN_CONFIG_ID ?? "").trim(),
    redirectUri:
      (process.env.META_OAUTH_REDIRECT_URI ?? "").trim() ||
      (appUrl ? `${appUrl}/api/integrations/meta/callback` : ""),
  };
}

/** False when the app id, secret or redirect URI is missing — routes answer
 *  "not configured" instead of throwing. */
export function metaConfigured(): boolean {
  const c = config();
  return Boolean(c.appId && c.appSecret && c.redirectUri);
}

/** Which login shape is configured (for the settings screen). */
export function metaLoginMode(): "business" | "classic" {
  return config().loginConfigId ? "business" : "classic";
}

// -----------------------------------------------------------------------------
// state
// -----------------------------------------------------------------------------

const b64url = (b: Buffer) => b.toString("base64url");

/** The state key is derived from the app secret, so no extra env var is needed. */
function stateKey(): string {
  const secret = config().appSecret;
  return secret ? createHash("sha256").update(`cubes-meta-oauth-state:${secret}`).digest("hex") : "";
}

function sign(body: string, key: string): string {
  return b64url(createHmac("sha256", key).update(body).digest());
}

export function signMetaState(payload: MetaStatePayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body, stateKey())}`;
}

/**
 * Signature and age only. The caller must also check the user against the live
 * session and the nonce against the cookie.
 */
export function verifyMetaState(raw: string): MetaStatePayload | null {
  const key = stateKey();
  if (!key || !raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(body, key);
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  let parsed: MetaStatePayload;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed?.iat !== "number" || Date.now() - parsed.iat > STATE_MAX_AGE_MS) return null;
  if (!parsed.teamId || !parsed.userId || !parsed.nonce) return null;
  return parsed;
}

export function createMetaNonce(): string {
  return b64url(randomBytes(16));
}

/** Same-origin paths only; anything else goes back to the integrations page. */
export function safeMetaReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/workflows/integrations";
  return raw;
}

// -----------------------------------------------------------------------------
// The dialog URL
// -----------------------------------------------------------------------------

export function buildMetaAuthUrl(state: string): string {
  const c = config();
  const params = new URLSearchParams({
    client_id: c.appId,
    redirect_uri: c.redirectUri,
    state,
    response_type: "code",
  });
  if (c.loginConfigId) {
    // Login for Business: the configuration decides permissions and assets, and
    // this flag makes Facebook honour its "System user" token type.
    params.set("config_id", c.loginConfigId);
    params.set("override_default_response_type", "true");
  } else {
    params.set("scope", META_SCOPES);
  }
  return `${DIALOG_HOST}/${graphVersion()}/dialog/oauth?${params.toString()}`;
}

// -----------------------------------------------------------------------------
// Server-to-server calls (never logged: their URLs carry the app secret)
// -----------------------------------------------------------------------------

async function graphCall(
  path: string,
  params: Record<string, string>,
  bearer?: string,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const url = new URL(`${GRAPH_HOST}/${graphVersion()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !body || body.error) {
      const e = (body?.error ?? {}) as { code?: number; type?: string };
      return { ok: false, error: e.code === 190 ? "invalid_token" : e.type === "OAuthException" ? "oauth_error" : `http_${res.status}` };
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** The code from the dialog → an access token (short-lived for the classic flow). */
export async function exchangeMetaCode(
  code: string,
): Promise<{ ok: true; token: string; expiresIn: number | null } | { ok: false; error: string }> {
  const c = config();
  const res = await graphCall("oauth/access_token", {
    client_id: c.appId,
    client_secret: c.appSecret,
    redirect_uri: c.redirectUri,
    code,
  });
  if (!res.ok) return res;
  const token = typeof res.body.access_token === "string" ? res.body.access_token : "";
  if (!token) return { ok: false, error: "malformed_token_response" };
  return { ok: true, token, expiresIn: typeof res.body.expires_in === "number" ? res.body.expires_in : null };
}

/** A short-lived user token → a long-lived one (about 60 days). */
export async function longLivedMetaToken(
  token: string,
): Promise<{ ok: true; token: string; expiresIn: number | null } | { ok: false; error: string }> {
  const c = config();
  const res = await graphCall("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: c.appId,
    client_secret: c.appSecret,
    fb_exchange_token: token,
  });
  if (!res.ok) return res;
  const next = typeof res.body.access_token === "string" ? res.body.access_token : "";
  if (!next) return { ok: false, error: "malformed_token_response" };
  return { ok: true, token: next, expiresIn: typeof res.body.expires_in === "number" ? res.body.expires_in : null };
}

export interface MetaTokenInfo {
  valid: boolean;
  /** "USER" or "SYSTEM_USER" (Login for Business). */
  type: string;
  userId: string | null;
  /** null = never expires. */
  expiresAt: string | null;
  scopes: string[];
}

/** What Facebook says about a token, asked with the app's own credentials. */
export async function debugMetaToken(
  token: string,
): Promise<{ ok: true; info: MetaTokenInfo } | { ok: false; error: string }> {
  const c = config();
  const res = await graphCall("debug_token", { input_token: token }, `${c.appId}|${c.appSecret}`);
  if (!res.ok) return res;
  const d = (res.body.data ?? {}) as {
    is_valid?: boolean;
    type?: string;
    user_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: string[];
  };
  const exp = typeof d.expires_at === "number" && d.expires_at > 0 ? new Date(d.expires_at * 1000).toISOString() : null;
  return {
    ok: true,
    info: {
      valid: Boolean(d.is_valid),
      type: String(d.type ?? "USER").toUpperCase(),
      userId: d.user_id ? String(d.user_id) : null,
      expiresAt: exp,
      scopes: Array.isArray(d.scopes) ? d.scopes.map(String) : [],
    },
  };
}

/** Best-effort removal of the app's grant (a failure never blocks a local disconnect). */
export async function revokeMetaToken(token: string): Promise<boolean> {
  const url = new URL(`${GRAPH_HOST}/${graphVersion()}/me/permissions`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A login failure → text safe for a member-readable column or a toast. */
export function sanitizeMetaError(code: string): string {
  switch (code) {
    case "access_denied":
      return "Access was declined in the Facebook dialog.";
    case "invalid_token":
      return "Facebook access expired or was revoked. Connect again.";
    case "no_ad_accounts":
      return "That Facebook login can't see any ad accounts. Share at least one ad account in the dialog.";
    case "timeout":
      return "Facebook did not respond in time. Try again.";
    case "network_error":
      return "Could not reach Facebook. Try again.";
    case "not_configured":
      return "The Facebook app isn't configured on this server yet.";
    default:
      return "Facebook rejected the request. Try connecting again.";
  }
}
