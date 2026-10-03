import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAccessToken } from "./tokens";

/**
 * Google Drive v3 over raw fetch — the same shape and failure vocabulary as
 * sheets-api.ts, no googleapis dependency. Server-only: it spends the stored
 * tokens, and none of them may ever reach a response body.
 *
 * WHY THIS EXISTS AT ALL
 * A Drive video used to play through Drive's `/preview` iframe. That iframe is
 * cross-origin, so the reviewer page cannot read `currentTime` from it and
 * timestamped comments are impossible — on exactly the videos most clients send.
 * `streamRange` is the way out: we fetch the bytes with the workspace's token
 * and pipe them into our own `<video>` element, where the timeline is ours.
 *
 * Failure handling, and why:
 *   401  the cached access token died early (revoked session, clock skew). The
 *        cache is dropped and the token refreshed ONCE; a second 401 is real.
 *   403 / 404  under `drive.file` these mean the same thing in practice: the
 *        file was deleted, moved out of reach, or was never granted to THIS
 *        connection. No retry can fix it — the person has to pick the file
 *        again — so it is its own error kind with that exact instruction.
 *   429 / 5xx  Drive's per-minute quotas and blips: one backoff retry. Only one,
 *        because a stream request is in a user's playback path and a long retry
 *        ladder reads as a hang, not as resilience.
 */

/** Requests for metadata; a media request's body is deliberately untimed. */
const TIMEOUT_MS = 20_000;
/** One retry after a backoff. See the note on 429/5xx above. */
const BACKOFF_MS = 700;

export type DriveErrorKind =
  | "auth"
  | "access_lost"
  | "rate_limited"
  | "server"
  | "bad_request"
  | "network";

export class DriveError extends Error {
  readonly kind: DriveErrorKind;
  readonly status: number;
  constructor(kind: DriveErrorKind, message: string, status = 0) {
    super(message);
    this.name = "DriveError";
    this.kind = kind;
    this.status = status;
  }
}

/** The one sentence a person can act on. Used verbatim by every route. */
export const PICK_AGAIN =
  "Cubes can no longer open this Google Drive file — it may have been deleted, " +
  "moved, or access was removed. Pick it again to keep reviewing.";

/** Test servers may stand in for Google, never in production. */
function driveBase(): string {
  const override = process.env.GOOGLE_DRIVE_BASE_URL;
  if (override && process.env.NODE_ENV !== "production") return override.replace(/\/$/, "");
  return "https://www.googleapis.com";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A token plus the ability to mint a fresh one.
 *
 * Callers may pass a bare string when they already hold a token (tests, and the
 * Picker path where the browser was handed one). A connection-bound credential
 * additionally knows how to refresh, which is what turns a 401 into a retry
 * instead of an error.
 */
export interface DriveAuth {
  token(): Promise<string>;
  /** Returns a new token, or null when the grant itself is gone. */
  refresh(): Promise<string | null>;
}

export type DriveCredential = string | DriveAuth;

function asAuth(credential: DriveCredential): DriveAuth {
  if (typeof credential !== "string") return credential;
  return {
    token: async () => credential,
    // A caller who handed us a literal string has nothing to refresh with.
    refresh: async () => null,
  };
}

/**
 * Binds a credential to a stored Google connection. The refresh path clears the
 * cached access token in Postgres first, so `getAccessToken` is forced to mint a
 * new one rather than hand back the dead value it just read.
 */
export function driveAuthForConnection(
  admin: SupabaseClient<Database>,
  connectionId: string,
): DriveAuth {
  let cached: string | null = null;
  return {
    async token(): Promise<string> {
      if (cached) return cached;
      const res = await getAccessToken(admin, connectionId);
      if (!res.ok) throw new DriveError("auth", res.message, 401);
      cached = res.token;
      return res.token;
    },
    async refresh(): Promise<string | null> {
      cached = null;
      await admin
        .from("app_google_secrets")
        .update({ access_token: null, access_token_expires_at: null })
        .eq("connection_id", connectionId);
      const res = await getAccessToken(admin, connectionId);
      if (!res.ok) return null;
      cached = res.token;
      return res.token;
    },
  };
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Drive reports size as a string; null for Google-native docs and folders. */
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  isFolder: boolean;
  /** False when the account can see the file but not download its bytes. */
  canDownload: boolean;
  modifiedAt: string | null;
  webViewUrl: string | null;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

/** The field mask every call shares, so a file looks identical everywhere. */
const FILE_FIELDS =
  "id,name,mimeType,size,thumbnailLink,modifiedTime,webViewLink," +
  "videoMediaMetadata(durationMillis,width,height),capabilities(canDownload)";

interface RawFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
  webViewLink?: string;
  videoMediaMetadata?: { durationMillis?: string | number; width?: number; height?: number };
  capabilities?: { canDownload?: boolean };
}

function toFile(raw: RawFile): DriveFile {
  const mime = raw.mimeType ?? "application/octet-stream";
  const ms = raw.videoMediaMetadata?.durationMillis;
  const durationMs = ms === undefined ? NaN : Number(ms);
  return {
    id: raw.id,
    name: raw.name ?? "Untitled",
    mimeType: mime,
    sizeBytes: raw.size === undefined ? null : Number(raw.size),
    thumbnailUrl: raw.thumbnailLink ?? null,
    durationSeconds: Number.isFinite(durationMs) ? durationMs / 1000 : null,
    width: raw.videoMediaMetadata?.width ?? null,
    height: raw.videoMediaMetadata?.height ?? null,
    isFolder: mime === FOLDER_MIME,
    // Absent capabilities means we did not ask for them, not "denied".
    canDownload: raw.capabilities?.canDownload !== false,
    modifiedAt: raw.modifiedTime ?? null,
    webViewUrl: raw.webViewLink ?? null,
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    return body.error?.message || body.error?.status || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * One Drive request, with the refresh/backoff policy described at the top.
 *
 * The response body is never read here, so a media request can hand `res.body`
 * onward untouched. The request timeout deliberately covers only the wait for
 * HEADERS — a two-hour 4K file must not be aborted twenty seconds into its
 * body — which is why the timer is cleared the moment a response arrives.
 */
async function driveFetch(
  credential: DriveCredential,
  url: string,
  opts: {
    headers?: Record<string, string>;
    /** Defaults to GET; the watch/stop calls are POSTs with a JSON body. */
    method?: string;
    body?: string;
    /** Overrides PICK_AGAIN on 403/404. The reviewer's "pick it again" is the
     *  wrong instruction for a background channel registration, which the
     *  person never asked for and cannot answer. */
    accessLostMessage?: string;
    /**
     * Turns Google's OWN refusal into a sentence we wrote. Consulted for every
     * status we do not retry, so the actual cause survives instead of being
     * flattened into one canned line — an operator chasing a file-permissions
     * problem that is really an unverified webhook domain is an hour lost.
     *
     * It is handed the parsed `error.message` and must answer with authored
     * prose or null, never the provider's text: these messages end up in
     * member-readable columns, and Drive quotes the address (and therefore
     * could quote a token) back at us inside them.
     */
    refusal?: (detail: string, status: number) => string | null;
  } = {},
): Promise<Response> {
  const auth = asAuth(credential);
  let refreshed = false;
  let backedOff = false;

  for (;;) {
    const token = await auth.token();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        body: opts.body,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(opts.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      if (!backedOff) {
        backedOff = true;
        await sleep(BACKOFF_MS);
        continue;
      }
      throw new DriveError("network", "Could not reach Google Drive. Try again.");
    }
    // Headers are in. The body may still be arriving and must outlive this
    // timer; clearing it here is what lets it.
    clearTimeout(timer);

    if (res.ok || res.status === 206) return res;

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      // Drain before retrying: an unread body holds the connection open.
      await res.body?.cancel().catch(() => {});
      const fresh = await auth.refresh();
      if (fresh) continue;
      throw new DriveError(
        "auth",
        // The body was cancelled above to free the socket, so there is no detail
        // to classify — the status is the whole story.
        opts.refusal?.("", 401) ??
          "Google refused the stored access. Reconnect Google to keep playing Drive videos.",
        401,
      );
    }

    const detail = await readError(res);
    const authored = (status: number) => opts.refusal?.(detail, status) ?? null;

    if (res.status === 401) {
      throw new DriveError(
        "auth",
        authored(401) ?? "Google refused the stored access. Reconnect Google to keep playing Drive videos.",
        401,
      );
    }
    if (res.status === 403 || res.status === 404) {
      // A 403 that mentions quota is rate limiting wearing a 403's clothes; the
      // file is still ours and a retry is the right answer.
      if (res.status === 403 && /quota|rate limit|userRateLimitExceeded/i.test(detail) && !backedOff) {
        backedOff = true;
        await sleep(BACKOFF_MS);
        continue;
      }
      throw new DriveError(
        "access_lost",
        authored(res.status) ?? opts.accessLostMessage ?? PICK_AGAIN,
        res.status,
      );
    }
    if ((res.status === 429 || res.status >= 500) && !backedOff) {
      backedOff = true;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS);
      continue;
    }
    if (res.status === 429) {
      throw new DriveError(
        "rate_limited",
        authored(429) ?? "Google Drive is rate limiting us. Try again in a moment.",
        429,
      );
    }
    if (res.status >= 500) {
      throw new DriveError(
        "server",
        authored(res.status) ?? "Google Drive had a problem. Try again in a moment.",
        res.status,
      );
    }
    // Last resort only: `detail` is Google's own text. Every caller that stores
    // its message where a member can read it passes `refusal` and never gets
    // here.
    throw new DriveError(
      "bad_request",
      authored(res.status) ?? `Google Drive rejected the request: ${detail}`.slice(0, 500),
      res.status,
    );
  }
}

/** Everything we know about one Drive file. */
export async function fileMeta(credential: DriveCredential, fileId: string): Promise<DriveFile> {
  const url =
    `${driveBase()}/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`;
  const res = await driveFetch(credential, url);
  return toFile((await res.json()) as RawFile);
}

export interface FolderPage {
  files: DriveFile[];
  nextPageToken: string | null;
}

/**
 * One page of a folder's contents, ordered folders-then-name so the listing
 * reads like Drive's own. `videoOnly` keeps sub-folders (you have to be able to
 * walk down into them) but drops the PDFs and thumbnails that share the folder.
 */
export async function listFolder(
  credential: DriveCredential,
  folderId: string,
  opts: { pageToken?: string | null; videoOnly?: boolean; pageSize?: number } = {},
): Promise<FolderPage> {
  // The id is interpolated into Drive's query language, so a quote or backslash
  // in it would change what we are asking for. Escape both.
  const safeId = folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const clauses = [`'${safeId}' in parents`, "trashed = false"];
  if (opts.videoOnly) {
    clauses.push(`(mimeType contains 'video/' or mimeType = '${FOLDER_MIME}')`);
  }
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    orderBy: "folder,name",
    pageSize: String(Math.min(Math.max(opts.pageSize ?? 100, 1), 1000)),
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    fields: `nextPageToken,files(${FILE_FIELDS})`,
  });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const res = await driveFetch(credential, `${driveBase()}/drive/v3/files?${params}`);
  const body = (await res.json()) as { files?: RawFile[]; nextPageToken?: string };
  return {
    files: (body.files ?? []).map(toFile),
    nextPageToken: body.nextPageToken ?? null,
  };
}

/**
 * The raw bytes, with the browser's Range forwarded untouched. The upstream
 * Response is returned as-is so the route can pipe `res.body` straight through
 * without ever holding a video in memory.
 */
export async function streamRange(
  credential: DriveCredential,
  fileId: string,
  rangeHeader: string | null,
): Promise<Response> {
  const url =
    `${driveBase()}/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;
  return driveFetch(credential, url, {
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });
}

/* ------------------------------------------------------------------ ranges */

export type ByteRange =
  /** No Range header, or one we are allowed to ignore: send the whole file. */
  | { kind: "full" }
  | { kind: "range"; start: number; end: number }
  /** Syntactically fine but outside the file: the answer is 416, not clamping. */
  | { kind: "unsatisfiable" };

/**
 * Parses one byte range against a known total.
 *
 * Only a single range is honoured. Multi-range requests are legal HTTP and
 * would need a multipart/byteranges body; no browser video element asks for one,
 * so they are treated as "send the whole file" rather than implemented.
 *
 * `end` is INCLUSIVE, as in the header itself — the off-by-one that Content-Range
 * and Content-Length disagree about is settled here, once.
 */
export function parseByteRange(header: string | null | undefined, total: number): ByteRange {
  if (!header) return { kind: "full" };
  const match = /^bytes=(.*)$/i.exec(header.trim());
  if (!match) return { kind: "full" };
  const spec = match[1].trim();
  if (spec.includes(",")) return { kind: "full" };

  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return { kind: "full" };
  const [, rawStart, rawEnd] = parts;

  // A zero-length file can satisfy nothing, and `bytes=0-` against it is the
  // one range browsers still send, so answer it as the full (empty) body.
  if (total <= 0) return { kind: "full" };

  // Suffix form: "bytes=-500" means the LAST 500 bytes, not "up to 500".
  if (rawStart === "") {
    if (rawEnd === "") return { kind: "full" };
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix)) return { kind: "full" };
    if (suffix === 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, total - suffix);
    return { kind: "range", start, end: total - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start)) return { kind: "full" };
  // Past the last byte — the 416 case the spec is explicit about.
  if (start >= total) return { kind: "unsatisfiable" };

  // Open-ended "bytes=500-" is what a <video> sends to start playing; it means
  // "everything from here", and the end is clamped to the last byte.
  const end = rawEnd === "" ? total - 1 : Math.min(Number(rawEnd), total - 1);
  if (!Number.isFinite(end) || end < start) return { kind: "unsatisfiable" };
  return { kind: "range", start, end };
}

/** `Content-Range: bytes <start>-<end>/<total>` for a satisfied range. */
export function contentRange(start: number, end: number, total: number): string {
  return `bytes ${start}-${end}/${total}`;
}

/** `Content-Range: bytes * /<total>` — the 416 form, which names only the size. */
export function unsatisfiedContentRange(total: number): string {
  return `bytes */${total}`;
}

/** Byte count of an inclusive range, which is the Content-Length to send. */
export function rangeLength(start: number, end: number): number {
  return end - start + 1;
}

/** Normalised header to forward upstream, so Drive and we agree on the window. */
export function rangeHeaderFor(start: number, end: number): string {
  return `bytes=${start}-${end}`;
}

// -----------------------------------------------------------------------------
// Push notification channels (files.watch / channels.stop)
// -----------------------------------------------------------------------------

/**
 * A registered notification channel, as Google hands it back.
 *
 * `resourceId` is the half that matters later: channels.stop needs BOTH the
 * channel id we minted and this opaque id, and Google never repeats it, so a
 * channel whose resourceId we lose can only be waited out.
 */
export interface DriveChannel {
  id: string;
  resourceId: string;
  resourceUri: string | null;
  /** Milliseconds since the epoch; absent on a channel Google left open-ended. */
  expirationMs: number | null;
}

/** The message shown when Drive refuses a watch on a file we can no longer see. */
export const WATCH_ACCESS_LOST =
  "Cubes can no longer open this Google Sheet, so it cannot watch it for changes.";

/**
 * Why Drive refused a files.watch, said in our own words.
 *
 * WHY THIS EXISTS. A registration is refused for reasons that live in completely
 * different places — one is in the Cloud console, one is in the person's Drive,
 * one is in our own request — and Drive distinguishes them ONLY in the prose of
 * `error.message`. Reporting all of them as "Cubes can no longer open this
 * Google Sheet" sends an operator to check file permissions when the actual
 * cause is a domain nobody verified, which is the single most likely failure on
 * a first deployment and the one the checklist warns about.
 *
 * WHY IT IS A MAPPING AND NOT A PASS-THROUGH. The answer is stored in
 * app_sheet_drive_channels.last_error, which any member of the workspace can
 * read. Google's own text quotes the callback address back at us, and a future
 * message could quote more of the request than that — the channel token is in
 * the same body. So this matches on Google's text and answers with sentences we
 * wrote, exactly as rejectionReason() does for Resend in src/lib/email/resend.ts.
 *
 * Returning null means "no better answer than the default", which keeps the
 * caller's canned message for the cases where it is already right.
 */
export function watchRefusalMessage(detail: string, status: number): string | null {
  const d = (detail ?? "").toLowerCase();

  // THE ONE THE DEPLOYMENT CHECKLIST IS ABOUT. Drive will not POST to a domain
  // nobody has proved they own, and says so as "Unauthorized WebHook callback
  // channel: <url>" with reason push.webhookUrlUnauthorized. Nothing about the
  // sheet, the account or the permissions is wrong.
  if (d.includes("webhookurlunauthorized") || (d.includes("webhook") && d.includes("unauthorized"))) {
    return (
      "Google will not deliver change notifications to this address: the domain is not verified as ours. " +
      "Verify it in Google Search Console and add it under Domain verification in the Cloud project that " +
      "owns the OAuth client, then try again. Until then this sheet syncs on its timer instead."
    );
  }
  if (d.includes("webhookurlnothttps") || d.includes("must be https") || d.includes("must use https")) {
    return "Google only delivers change notifications over HTTPS, and this deployment's address is not. Until it is, this sheet syncs on its timer instead.";
  }
  if (d.includes("webhookurlnohostoraddress") || d.includes("invalid webhook") || d.includes("callback url")) {
    return "Google rejected our notification address as unusable. Check NEXT_PUBLIC_APP_URL (or GOOGLE_DRIVE_WEBHOOK_URL) — it must be an HTTPS URL on a public domain.";
  }
  // Push is not offered for every resource; on Drive this means the file kind
  // (a shortcut, some shared-drive items) cannot be watched at all.
  if (d.includes("pushnotsupported") || d.includes("push notifications are not supported")) {
    return "Google does not offer change notifications for this kind of file, so this sheet syncs on its timer instead.";
  }
  if (d.includes("not unique") || d.includes("channelidnotunique")) {
    return "Google says that notification channel id is already in use. The next maintenance pass mints a new one.";
  }
  // The grant is missing drive scope entirely — reconnecting is what fixes it,
  // not touching the file.
  if (d.includes("insufficient authentication scopes") || d.includes("insufficient permission") || status === 401) {
    return "The stored Google access does not cover watching files. Reconnect this Google account in Settings → Apps to turn live sync on.";
  }
  if (d.includes("does not have sufficient permissions") || d.includes("has not granted") || d.includes("not found")) {
    // Genuinely a file problem: the canned sentence is the right one.
    return WATCH_ACCESS_LOST;
  }
  if (status === 429 || d.includes("rate limit") || d.includes("quota")) {
    return "Google is rate limiting us, so live sync could not be switched on yet. It retries by itself.";
  }
  if (status >= 500) {
    return "Google had a problem registering the change notification. It retries by itself.";
  }
  // Nothing recognised. Say what we do know — the status — and nothing Google
  // wrote, because this string is member-readable.
  return `Google refused the change notification for this sheet (HTTP ${status}). It syncs on its timer meanwhile.`;
}

/**
 * Asks Drive to POST to `address` whenever `fileId` changes.
 *
 * `token` is echoed back on every notification as X-Goog-Channel-Token and is
 * the only thing that distinguishes a real callback from anyone on the internet
 * who guesses the channel id — so it is a secret, not a label.
 *
 * `expirationMs` is a REQUEST, not a promise: Drive caps a files channel at 24h
 * and silently clamps anything longer, which is why the caller must store the
 * value that comes back rather than the one it sent.
 */
export async function watchFile(
  credential: DriveCredential,
  input: { fileId: string; channelId: string; address: string; token: string; expirationMs?: number },
): Promise<DriveChannel> {
  const url =
    `${driveBase()}/drive/v3/files/${encodeURIComponent(input.fileId)}/watch` +
    `?supportsAllDrives=true`;
  const res = await driveFetch(credential, url, {
    method: "POST",
    accessLostMessage: WATCH_ACCESS_LOST,
    // Carries Google's actual reason into the error this throws, and from there
    // into app_sheet_drive_channels.last_error — see watchRefusalMessage.
    refusal: watchRefusalMessage,
    body: JSON.stringify({
      id: input.channelId,
      type: "web_hook",
      address: input.address,
      token: input.token,
      ...(input.expirationMs ? { expiration: String(input.expirationMs) } : {}),
    }),
  });
  const raw = (await res.json()) as {
    id?: string;
    resourceId?: string;
    resourceUri?: string;
    expiration?: string | number;
  };
  if (!raw.resourceId) {
    // Without a resourceId we could never stop this channel again, and Drive
    // would keep calling us for up to a day. Treat it as a failed registration.
    throw new DriveError("bad_request", "Google registered a channel without a resource id.", res.status);
  }
  const expiration = raw.expiration === undefined ? NaN : Number(raw.expiration);
  return {
    id: raw.id ?? input.channelId,
    resourceId: raw.resourceId,
    resourceUri: raw.resourceUri ?? null,
    expirationMs: Number.isFinite(expiration) && expiration > 0 ? expiration : null,
  };
}

/**
 * Cancels a channel. Returns false when Google says it is already gone (404),
 * which is a success for the caller's purposes — nothing will POST at us again.
 */
export async function stopChannel(
  credential: DriveCredential,
  input: { channelId: string; resourceId: string },
): Promise<boolean> {
  const url = `${driveBase()}/drive/v3/channels/stop`;
  try {
    await driveFetch(credential, url, {
      method: "POST",
      accessLostMessage: "That Google notification channel no longer exists.",
      body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
    });
    return true;
  } catch (err) {
    if (err instanceof DriveError && err.kind === "access_lost") return false;
    throw err;
  }
}
