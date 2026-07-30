/**
 * Bridge to the `send-email` Supabase Edge Function — the email engine's
 * primary dispatcher. Returns the function's HTTP status + parsed body, or
 * null when the function isn't reachable AS a function (not deployed yet,
 * network failure, non-JSON response) — null tells the caller to fall back to
 * the in-process engine. Real answers (400/401/403/…) are passed through, NOT
 * retried locally: "you may not do this" from the edge is final.
 */

const TIMEOUT_MS = 15_000;

export interface EdgeInvokeResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

export async function invokeSendEmailEdge(
  payload: unknown,
  accessToken: string,
): Promise<EdgeInvokeResult | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey || !accessToken) return null;

  try {
    const res = await fetch(`${url}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 404 from the functions gateway = not deployed. (The function itself
    // never returns 404.)
    if (res.status === 404) return null;
    const body = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") return null;
    return { httpStatus: res.status, body };
  } catch {
    return null;
  }
}
