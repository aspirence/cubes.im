import { NextResponse } from "next/server";

/**
 * Tiny route plumbing shared by /api/client/**. Deliberately local rather than
 * borrowed from another app's route helpers: these routes must not move when
 * that app does.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A magic-link / session token as this app mints them: 32 bytes, hex. */
export const TOKEN_RE = /^[0-9a-f]{64}$/;

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Normalizes an email for lookup: trimmed, lowercased, obviously shaped. */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** The public origin, for links that must survive an email client. */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://cubes.im").replace(
    /\/$/,
    "",
  );
}
