import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google OAuth — the first third-party OAuth flow in this product. Everything
 * else that talks outward holds a static key (Resend, Dodo); Google hands back a
 * refresh token that has to be kept, spent for short-lived access tokens, and
 * revoked cleanly.
 *
 * Scopes are deliberately narrow. `drive.file` grants access only to files the
 * user hands over through the Google Picker, and Google classes it
 * non-sensitive — where the broader `auth/spreadsheets` scope is sensitive and
 * drags the whole app into a security assessment. `openid` and `userinfo.email`
 * are here because `drive.file` alone does not authorize reading the profile, so
 * without them we could not record WHICH Google account is connected, and both
 * "Connected as …" and the revocation story would be blind.
 *
 * Server-only. Nothing in this module may be imported from a client component:
 * it reads the client secret.
 */

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Matches the 10s AbortController budget used by the Resend sender. */
const GOOGLE_TIMEOUT_MS = 10_000;

/** How long a half-finished consent may sit before the state is stale. */
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** Name of the cookie carrying the PKCE verifier and the CSRF nonce. */
export const OAUTH_COOKIE = "gs_oauth";

export interface StatePayload {
  teamId: string;
  userId: string;
  nonce: string;
  /** Issued-at, epoch ms. */
  iat: number;
  /** Same-origin path to send the browser back to. */
  returnTo: string;
}

export interface GoogleTokens {
  accessToken: string;
  /** Absent on a refresh, and absent on a re-consent without prompt=consent. */
  refreshToken: string | null;
  expiresInSeconds: number;
  scope: string;
  /** Present because `openid` is requested; carries sub + email. */
  idToken: string | null;
}

/** Config is read lazily, never at module scope, so the app still builds with
 *  placeholder env — the convention set by lib/supabase/server.ts. */
function config() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
    stateSecret: process.env.GOOGLE_OAUTH_STATE_SECRET ?? "",
  };
}

/** False when any required env is missing, so routes can answer
 *  "not configured" instead of throwing — the dodoConfigured() pattern. */
export function googleConfigured(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri && c.stateSecret);
}

// -----------------------------------------------------------------------------
// state — signed, not encrypted (nothing in it is secret)
// -----------------------------------------------------------------------------

const b64url = (b: Buffer) => b.toString("base64url");

function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payloadB64).digest());
}

export function signState(payload: StatePayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body, config().stateSecret)}`;
}

/**
 * Verifies the signature and age only. The caller MUST additionally check that
 * `userId` matches the live session and that `nonce` matches the cookie — a
 * signed state on its own is bearer-ish, and the double-submit cookie is what
 * actually stops it being replayed into someone else's session.
 */
export function verifyState(raw: string): StatePayload | null {
  const secret = config().stateSecret;
  if (!secret || !raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);

  const expected = sign(body, secret);
  // timingSafeEqual throws on a length mismatch, so guard first.
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  let parsed: StatePayload;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed?.iat !== "number") return null;
  if (Date.now() - parsed.iat > STATE_MAX_AGE_MS) return null;
  if (!parsed.teamId || !parsed.userId || !parsed.nonce) return null;
  return parsed;
}

/**
 * Only same-origin paths may be returned to. An open redirect here would let a
 * crafted consent link bounce a signed-in user to an attacker's page carrying
 * whatever is in the query string. `//evil.com` is protocol-relative and is the
 * case a bare startsWith("/") check misses.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/apps";
  return raw;
}

// -----------------------------------------------------------------------------
// PKCE
// -----------------------------------------------------------------------------

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createNonce(): string {
  return b64url(randomBytes(16));
}

// -----------------------------------------------------------------------------
// The authorization URL
// -----------------------------------------------------------------------------

export function buildAuthUrl(input: {
  state: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const c = config();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    // Required for a refresh token to be issued at all.
    access_type: "offline",
    // NOT cosmetic. Without it, a user who has already granted comes back with a
    // code that exchanges to an access token and NO refresh token, so the
    // connection appears to succeed and background sync silently never runs.
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.loginHint) params.set("login_hint", input.loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// -----------------------------------------------------------------------------
// Token calls
// -----------------------------------------------------------------------------

async function postForm(
  endpoint: string,
  form: Record<string, string>,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const code =
        (body as { error?: string } | null)?.error ?? `http_${res.status}`;
      return { ok: false, status: res.status, error: code };
    }
    return { ok: true, body };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      error: aborted ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function readTokens(body: unknown): GoogleTokens | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.access_token !== "string") return null;
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
    expiresInSeconds: typeof b.expires_in === "number" ? b.expires_in : 3600,
    scope: typeof b.scope === "string" ? b.scope : "",
    idToken: typeof b.id_token === "string" ? b.id_token : null,
  };
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<
  { ok: true; tokens: GoogleTokens } | { ok: false; error: string }
> {
  const c = config();
  const res = await postForm(TOKEN_ENDPOINT, {
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  if (!res.ok) return { ok: false, error: res.error };
  const tokens = readTokens(res.body);
  return tokens ? { ok: true, tokens } : { ok: false, error: "malformed_token_response" };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<
  | { ok: true; tokens: GoogleTokens }
  /** `revoked` distinguishes "the user took access away" (needs a reconnect,
   *  and every sync on this connection should stop) from a transient blip
   *  (retry later). Collapsing the two into "sync failed" makes the product
   *  unable to tell someone what to actually do about it. */
  | { ok: false; error: string; revoked: boolean }
> {
  const c = config();
  const res = await postForm(TOKEN_ENDPOINT, {
    refresh_token: refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "refresh_token",
  });
  if (!res.ok) {
    return { ok: false, error: res.error, revoked: res.error === "invalid_grant" };
  }
  const tokens = readTokens(res.body);
  return tokens
    ? { ok: true, tokens }
    : { ok: false, error: "malformed_token_response", revoked: false };
}

/** Best-effort: a failure here must not block clearing our own rows, or a user
 *  who revoked on Google's side could never disconnect on ours. */
export async function revokeRefreshToken(refreshToken: string): Promise<boolean> {
  const res = await postForm(REVOKE_ENDPOINT, { token: refreshToken });
  return res.ok;
}

// -----------------------------------------------------------------------------
// id_token
// -----------------------------------------------------------------------------

/**
 * Reads `sub` and `email` from the id_token WITHOUT verifying its signature.
 * That is sound here and only here: the token arrived over TLS as the direct
 * response to our own authenticated back-channel exchange with Google, so there
 * is no untrusted party in between. Signature verification is for id_tokens
 * received from a client. Never reuse this on a token that came from a browser.
 */
export function readIdentityFromIdToken(
  idToken: string | null,
): { sub: string; email: string | null } | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      sub?: unknown;
      email?: unknown;
    };
    if (typeof claims.sub !== "string" || !claims.sub) return null;
    return {
      sub: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
    };
  } catch {
    return null;
  }
}

/**
 * Maps a Google failure to something safe to store in a member-readable column.
 * last_test_error is visible to every workspace member, so raw provider text —
 * which can echo URLs and token fragments — must never reach it.
 */
export function sanitizeGoogleError(code: string): string {
  switch (code) {
    case "invalid_grant":
      return "Google access was revoked or expired. Reconnect to resume syncing.";
    case "invalid_client":
      return "The Google app credentials are not valid. Check the OAuth client configuration.";
    case "redirect_uri_mismatch":
      return "The redirect URI does not match the one registered in Google Cloud.";
    case "access_denied":
      return "Access was declined on the Google consent screen.";
    case "timeout":
      return "Google did not respond in time. Try again.";
    case "network_error":
      return "Could not reach Google. Try again.";
    default:
      return "Google rejected the request. Try reconnecting.";
  }
}
