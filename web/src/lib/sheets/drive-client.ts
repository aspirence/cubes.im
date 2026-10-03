import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAccessToken } from "@/lib/google/tokens";
import { GoogleSheetsError } from "@/lib/google/sheets-api";

/**
 * Drive v3, the two corners of it the Sheets app needs that sheets-api.ts does
 * not cover: PERMISSIONS (share a file we created with the team) and CHANNELS
 * (ask Drive to call us when the file changes).
 *
 * It deliberately mirrors SheetsClient rather than extending it: same retry
 * ladder, same one-shot 401 refresh, same error type — so a caller that already
 * handles GoogleSheetsError handles this too, and a sync failure and a share
 * failure read the same way in the run log.
 *
 * There is a second Drive module at src/lib/google/drive.ts. That one exists to
 * stream video bytes for the review player and is owned by that feature; this
 * one is the Sheets app's, and neither has a call the other wants.
 *
 * Server-only: it spends the stored refresh token.
 */

const TIMEOUT_MS = 20_000;
const RETRIES = 2;

/** Test servers may stand in for Google, never in production. */
function driveBase(): string {
  const override = process.env.GOOGLE_DRIVE_BASE_URL;
  if (override && process.env.NODE_ENV !== "production") return override.replace(/\/$/, "");
  return "https://www.googleapis.com";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoff(attempt: number, retryAfter?: string | null): number {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(hinted, 10_000);
  return Math.min(500 * 2 ** attempt, 4000);
}

/** Drive's error body, reduced to the one sentence worth storing. */
async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason;
    const message = body.error?.message ?? "";
    return [reason, message].filter(Boolean).join(": ").slice(0, 300);
  } catch {
    return `HTTP ${res.status}`;
  }
}

export interface DrivePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
}

export interface WatchChannel {
  /** Ours — the id we generated and sent. */
  channelId: string;
  /** Google's handle for the watched resource; needed to stop the channel. */
  resourceId: string;
  /** When Drive will stop calling, as an ISO instant. */
  expiresAt: string;
}

export class DriveClient {
  private readonly admin: SupabaseClient;
  private readonly connectionId: string;
  private token: string | null = null;

  constructor(admin: SupabaseClient, connectionId: string) {
    this.admin = admin;
    this.connectionId = connectionId;
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const res = await getAccessToken(this.admin as unknown as SupabaseClient<Database>, this.connectionId);
    if (!res.ok) throw new GoogleSheetsError("auth", res.message, 401);
    this.token = res.token;
    return res.token;
  }

  /** Forget the cached token here AND in Postgres, so the next call refreshes. */
  private async dropToken(): Promise<void> {
    this.token = null;
    await this.admin
      .from("app_google_secrets")
      .update({ access_token: null, access_token_expires_at: null })
      .eq("connection_id", this.connectionId);
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${driveBase()}${path}`, {
          method: init.method ?? "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
          redirect: "manual",
        });
      } catch {
        clearTimeout(timer);
        if (attempt < RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new GoogleSheetsError("network", "Could not reach Google Drive. Try again.");
      }
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.dropToken();
        continue;
      }
      if (res.status === 401) {
        throw new GoogleSheetsError("auth", "Google refused the stored access. Reconnect Google to continue.", 401);
      }
      const detail = await readError(res);
      if (res.status === 403 && /quota|rate|userRateLimit/i.test(detail) && attempt < RETRIES) {
        await sleep(backoff(attempt));
        continue;
      }
      if (res.status === 403 || res.status === 404) {
        throw new GoogleSheetsError(
          "access_lost",
          "Cubes can no longer open this file in Google Drive — it may have been deleted, or access was removed.",
          res.status,
        );
      }
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        await sleep(backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      if (res.status === 429) throw new GoogleSheetsError("rate_limited", "Google Drive is rate limiting requests. It will be retried.", 429);
      if (res.status >= 500) throw new GoogleSheetsError("server", "Google Drive had a problem. It will be retried.", res.status);
      throw new GoogleSheetsError("bad_request", `Google Drive rejected the request: ${detail}`.slice(0, 500), res.status);
    }
  }

  /** Everyone Drive currently grants this file to. One page is plenty: a team
   *  big enough to exceed 100 grants is past what per-member sharing suits. */
  async listPermissions(fileId: string): Promise<DrivePermission[]> {
    const q = new URLSearchParams({
      fields: "permissions(id,type,role,emailAddress)",
      pageSize: "100",
      supportsAllDrives: "true",
    });
    const res = await this.request<{ permissions?: DrivePermission[] }>(
      `/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${q}`,
    );
    return res.permissions ?? [];
  }

  /**
   * Grants one person access.
   *
   * sendNotificationEmail=false on purpose: provisioning shares a file with a
   * whole team at once, often several sheets in a row, and Google's notification
   * would land as a separate mail per sheet per person. The sheet is reachable
   * from Cubes, which is where they were already looking.
   */
  async grant(fileId: string, email: string, role: "writer" | "reader"): Promise<DrivePermission> {
    const q = new URLSearchParams({
      sendNotificationEmail: "false",
      supportsAllDrives: "true",
      fields: "id,type,role,emailAddress",
    });
    return this.request<DrivePermission>(`/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${q}`, {
      method: "POST",
      body: { type: "user", role, emailAddress: email },
    });
  }

  /** Moves an existing grant between writer and reader. */
  async setRole(fileId: string, permissionId: string, role: "writer" | "reader"): Promise<void> {
    const q = new URLSearchParams({ supportsAllDrives: "true", fields: "id" });
    await this.request(`/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?${q}`, {
      method: "PATCH",
      body: { role },
    });
  }

  async revoke(fileId: string, permissionId: string): Promise<void> {
    const q = new URLSearchParams({ supportsAllDrives: "true" });
    await this.request(`/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?${q}`, {
      method: "DELETE",
    });
  }

  /**
   * Asks Drive to POST `address` whenever the file changes.
   *
   * `expiration` is a request, not a promise: Drive caps a file channel well
   * under a day and answers with the expiry it actually chose, which is the one
   * we store and renew against. `token` is echoed back in every notification —
   * we send the channel id in it so a notification is self-describing even if
   * Google ever changes which headers it sets.
   */
  async watchFile(
    fileId: string,
    channel: { id: string; address: string; token: string; ttlSeconds: number },
  ): Promise<WatchChannel> {
    const q = new URLSearchParams({ supportsAllDrives: "true" });
    const res = await this.request<{ id?: string; resourceId?: string; expiration?: string }>(
      `/drive/v3/files/${encodeURIComponent(fileId)}/watch?${q}`,
      {
        method: "POST",
        body: {
          id: channel.id,
          type: "web_hook",
          address: channel.address,
          token: channel.token,
          expiration: String(Date.now() + channel.ttlSeconds * 1000),
        },
      },
    );
    if (!res.resourceId) {
      throw new GoogleSheetsError("bad_request", "Google Drive accepted the watch but named no resource to renew.", 200);
    }
    const expiration = Number(res.expiration);
    return {
      channelId: res.id ?? channel.id,
      resourceId: res.resourceId,
      // Drive always sends an expiration for file channels; if one ever arrives
      // without, treat it as the shortest life we'd accept so it is renewed on
      // the next pass rather than trusted forever.
      expiresAt: new Date(Number.isFinite(expiration) && expiration > 0 ? expiration : Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  /** Cancels a channel. Best-effort by nature: an expired or already-stopped
   *  channel answers 404, which is the outcome we wanted anyway. */
  async stopChannel(channelId: string, resourceId: string): Promise<void> {
    await this.request(`/drive/v3/channels/stop`, {
      method: "POST",
      body: { id: channelId, resourceId },
    });
  }
}
