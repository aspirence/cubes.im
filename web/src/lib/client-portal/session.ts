import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";

/**
 * The client session cookie.
 *
 * The value is 32 random bytes minted in Postgres and handed back exactly once;
 * only its sha256 is stored (app_client_sessions.token_hash). It is httpOnly so
 * no portal script can read it, SameSite=Lax so the magic-link redirect still
 * carries it, and Secure everywhere but local http development.
 *
 * `__Host-` is deliberately NOT used: that prefix forbids a Domain attribute
 * and demands Secure, which would break the plain-http dev server the whole
 * team runs on.
 */
export const CLIENT_SESSION_COOKIE = "cubes_client_session";

/** 30 days, matching the sliding window app_client_sessions enforces in SQL. */
export const CLIENT_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function secureCookies(): boolean {
  // NEXT_PUBLIC_APP_URL is the deployed origin; http only ever means local dev.
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (url.startsWith("http://")) return false;
  return process.env.NODE_ENV === "production" || url.startsWith("https://");
}

/** Reads the session cookie inside a Route Handler or Server Component. */
export async function readClientSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(CLIENT_SESSION_COOKIE)?.value ?? null;
}

/** Attaches a freshly minted session to a response. */
export function setClientSessionCookie(
  response: NextResponse,
  token: string,
): NextResponse {
  response.cookies.set({
    name: CLIENT_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: CLIENT_SESSION_MAX_AGE,
  });
  return response;
}

/** Clears it — used on sign-out and on a rejected/expired session. */
export function clearClientSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: CLIENT_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 0,
  });
  return response;
}

/**
 * A stable, non-reversible fingerprint of the caller's IP for the audit trail.
 * Salted with the service-role key so the same address in two deployments does
 * not produce the same hash, and truncated because we only ever need "same or
 * different machine", never the address itself.
 */
export function hashIp(request: Request): string | null {
  const header =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const ip = header.split(",")[0]?.trim();
  if (!ip) return null;
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "cubes";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** The User-Agent, clipped to what app_client_sessions accepts. */
export function userAgentOf(request: Request): string | null {
  const ua = request.headers.get("user-agent");
  return ua ? ua.slice(0, 400) : null;
}
