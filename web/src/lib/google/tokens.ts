import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { refreshAccessToken, sanitizeGoogleError } from "./oauth";

/**
 * Hands out a usable Google access token for a connection, refreshing it when
 * it has aged out.
 *
 * The cached token lives in app_google_secrets, NOT in a module-level variable.
 * Serverless instances are ephemeral and there may be many of them at once, so
 * an in-memory cache would mean a refresh per cold start — burning quota and
 * pushing against Google's cap on live refresh tokens per client for no benefit.
 * Postgres is the only thing every instance shares.
 *
 * Callers must pass a SERVICE-ROLE client: app_google_secrets denies
 * authenticated at both the grant and the RLS level.
 */

/** Refresh this far before actual expiry, so a token can't die mid-request. */
const EXPIRY_SKEW_MS = 120_000;
/** Shave a minute off what Google reports, for clock drift between us and them. */
const STORE_SKEW_SECONDS = 60;

export type AccessTokenResult =
  | { ok: true; token: string; refreshed: boolean }
  | {
      ok: false;
      /** Safe to show a member — already sanitized. */
      message: string;
      /** True when Google has stopped honouring the refresh token entirely.
       *  The remedy is a reconnect, not a retry, and every sync on this
       *  connection should stop rather than hammer a dead grant. */
      revoked: boolean;
    };

export async function getAccessToken(
  admin: SupabaseClient<Database>,
  connectionId: string,
): Promise<AccessTokenResult> {
  const { data: secret, error } = await admin
    .from("app_google_secrets")
    .select("refresh_token, access_token, access_token_expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: "Could not read the Google credentials.", revoked: false };
  }
  if (!secret?.refresh_token) {
    return {
      ok: false,
      message: "Google is not connected for this workspace. Connect it to continue.",
      revoked: true,
    };
  }

  // Still good? Hand it back untouched.
  const expiresAt = secret.access_token_expires_at
    ? Date.parse(secret.access_token_expires_at)
    : 0;
  if (secret.access_token && expiresAt > Date.now() + EXPIRY_SKEW_MS) {
    return { ok: true, token: secret.access_token, refreshed: false };
  }

  // Two requests refreshing at once is harmless — Google does not invalidate the
  // previous access token when it issues a new one, so both callers end up with
  // something valid and the last write wins. Deliberately no lock: the
  // contention is rare and a lock here would be a new stall mode.
  const refreshed = await refreshAccessToken(secret.refresh_token);

  if (!refreshed.ok) {
    if (refreshed.revoked) {
      await markRevoked(admin, connectionId, sanitizeGoogleError(refreshed.error));
    }
    return {
      ok: false,
      message: sanitizeGoogleError(refreshed.error),
      revoked: refreshed.revoked,
    };
  }

  const { tokens } = refreshed;
  const newExpiry = new Date(
    Date.now() + Math.max(0, tokens.expiresInSeconds - STORE_SKEW_SECONDS) * 1000,
  ).toISOString();

  await admin
    .from("app_google_secrets")
    .update({
      access_token: tokens.accessToken,
      access_token_expires_at: newExpiry,
      // A refresh may return a rotated refresh token; when it does, the old one
      // may stop working, so it has to replace what we hold.
      ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", connectionId);

  // A refresh that works is also the cheapest possible health check, so record
  // it — it keeps "last checked" honest without a separate test call.
  await admin
    .from("app_google_connections")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: true,
      last_test_error: null,
      revoked_at: null,
    })
    .eq("id", connectionId);

  return { ok: true, token: tokens.accessToken, refreshed: true };
}

/**
 * Records that Google has stopped honouring this grant. The refresh token is
 * cleared because it is now worthless, and keeping a dead credential around
 * only invites a later code path to try it again.
 *
 * The connection ROW survives, so the UI can say "reconnect <account>" against a
 * named account instead of forgetting the connection existed.
 */
async function markRevoked(
  admin: SupabaseClient<Database>,
  connectionId: string,
  message: string,
): Promise<void> {
  await admin
    .from("app_google_connections")
    .update({
      has_refresh_token: false,
      revoked_at: new Date().toISOString(),
      enabled: false,
      last_test_at: new Date().toISOString(),
      last_test_ok: false,
      last_test_error: message,
    })
    .eq("id", connectionId);

  await admin
    .from("app_google_secrets")
    .delete()
    .eq("connection_id", connectionId);
}
