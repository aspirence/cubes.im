import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorText } from "@/lib/apps/auth";
import type { AppActionResult } from "./app-action-types";

/**
 * The outbound HTTP step — the one that makes us interoperate with everything
 * we will never write a connector for. A workflow_steps row with step_type
 * 'http' carries
 *
 *   { url, method, headers: {..}, body, timeout_ms, retry: {max, backoff} }
 *
 * and the SQL engine parks the run on it exactly as it parks on an app step;
 * the Node runner calls runHttpStep and hands the response back through
 * wf_resume_app_step. The response — { status, headers, body } — lands in the
 * run context as steps.<key>, so later steps can map from it.
 *
 * Three guards, because this step is a request forger in the hands of anyone
 * who can edit a workflow:
 *
 *  1. https only, and every hostname is resolved before the request; a private,
 *     loopback, link-local or otherwise internal address is refused. That is
 *     the SSRF guard — without it a step could read the instance metadata
 *     service or reach anything inside the VPC.
 *  2. The host must be on that team's team_http_allowlist, which only a
 *     workspace admin can edit. An allowlist entry covers its subdomains
 *     ("acme.com" allows "api.acme.com") and nothing else ("notacme.com" is a
 *     different host, not a subdomain).
 *  3. Secrets are never written into a step. A header value, the URL or the
 *     body may contain {{connection.<id>.<field>}}, resolved here from
 *     app_connection_secrets, which only the service role can read. The token
 *     is what is stored in workflow_steps.config and shown in the run log; the
 *     value never enters the run context.
 *
 * Redirects are followed manually (up to three) so every hop goes through the
 * same two checks — an allowed host that answers 302 to 169.254.169.254 is the
 * classic way past a naive guard.
 */

/** Default and ceiling for the per-request timeout. */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
/** Response bytes kept. Anything past this is a step error, not a truncation. */
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_REDIRECTS = 3;

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

/** Header names a workflow may never set: they are the transport's business. */
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "cookie",
]);

const CONNECTION_TOKEN = /\{\{\s*connection\.([0-9a-fA-F-]{36})\.([A-Za-z0-9_]+)\s*\}\}/g;

export interface HttpStepConfig {
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
  timeout_ms?: unknown;
}

export interface HttpStepDeps {
  /** Injected by the tests so a mock server can stand in for the real internet. */
  fetchImpl?: typeof fetch;
  /** Injected by the tests to exercise the address guard without real DNS. */
  resolveHost?: (host: string) => Promise<string[]>;
}

/**
 * Is this address one a workflow must never reach? Covers loopback, private,
 * link-local (including the cloud metadata address), carrier-grade NAT,
 * multicast, reserved and benchmarking ranges, on both IPv4 and IPv6.
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedV4(address);
  if (kind === 6) return isBlockedV6(address);
  // Not an address at all: refuse rather than guess.
  return true;
}

function isBlockedV4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedV6(address: string): boolean {
  const lower = address.toLowerCase().split("%")[0];
  // ::ffff:1.2.3.4 and ::ffff:0102:0304 are IPv4 wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedV4(mapped[1]);
  if (lower === "::" || lower === "::1") return true;
  if (/^f[cd]/.test(lower)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  if (lower.startsWith("ff")) return true; // multicast
  if (lower.startsWith("::ffff:")) return true; // any other v4-mapped spelling
  if (lower.startsWith("64:ff9b:")) return true; // NAT64 to an address we cannot see
  if (lower.startsWith("2002:")) return true; // 6to4 wraps an arbitrary v4 address
  return false;
}

/** Does `host` sit on this allowlist — as itself or as a subdomain of an entry? */
export function hostAllowed(host: string, allowlist: string[]): boolean {
  const needle = host.toLowerCase().replace(/\.$/, "");
  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase();
    return needle === allowed || needle.endsWith(`.${allowed}`);
  });
}

async function realResolve(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  const found = await lookup(host, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
}

/**
 * Both policy checks for one absolute URL. Throws with a message that is safe
 * to store in the run log (it names the host, never the path or the query,
 * which is where tokens tend to hide).
 */
async function assertUrlAllowed(
  raw: string,
  allowlist: string[],
  resolveHost: (host: string) => Promise<string[]>,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The URL is not a valid absolute URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Only https URLs can be called from a workflow.");
  }
  if (url.username || url.password) {
    throw new Error("Credentials in the URL are not allowed — use a header instead.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostAllowed(host, allowlist)) {
    throw new Error(
      `${host} is not on this workspace's allowed hosts — an admin can add it in the workflow's HTTP settings.`,
    );
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    throw new Error(`${host} could not be resolved.`);
  }
  if (addresses.length === 0) {
    throw new Error(`${host} could not be resolved.`);
  }
  // Every address, not just the first: a host with one public and one private
  // A record would otherwise be a coin flip.
  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked) {
    throw new Error(`${host} resolves to an internal address, which a workflow may not call.`);
  }
  return url;
}

/** The hosts this team may call. */
async function loadAllowlist(admin: SupabaseClient, teamId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("team_http_allowlist")
    .select("host")
    .eq("team_id", teamId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { host: string }[]).map((row) => row.host);
}

/**
 * Replaces {{connection.<id>.<field>}} with the stored credential. The
 * connection must belong to the organization this team is in — service_role
 * bypasses RLS, so the ownership check has to be made here, by hand.
 */
async function resolveConnectionTokens(
  admin: SupabaseClient,
  teamId: string,
  value: string,
  cache: Map<string, Record<string, unknown>>,
): Promise<string> {
  const ids = new Set<string>();
  for (const match of value.matchAll(CONNECTION_TOKEN)) ids.add(match[1]);
  if (ids.size === 0) return value;

  const missing = [...ids].filter((id) => !cache.has(id));
  if (missing.length > 0) {
    const { data: team, error: teamErr } = await admin
      .from("teams")
      .select("organization_id")
      .eq("id", teamId)
      .maybeSingle();
    if (teamErr) throw new Error(teamErr.message);
    const orgId = (team as { organization_id: string } | null)?.organization_id ?? null;
    if (!orgId) throw new Error("This workspace has no organization, so it has no connections.");

    const { data: connections, error: connErr } = await admin
      .from("app_connections")
      .select("id, enabled")
      .eq("org_id", orgId)
      .in("id", missing);
    if (connErr) throw new Error(connErr.message);
    const usable = new Map(
      ((connections ?? []) as { id: string; enabled: boolean }[]).map((c) => [c.id, c.enabled]),
    );

    const { data: secrets, error: secretErr } = await admin
      .from("app_connection_secrets")
      .select("connection_id, credentials")
      .in("connection_id", [...usable.keys()]);
    if (secretErr) throw new Error(secretErr.message);
    const byId = new Map(
      ((secrets ?? []) as { connection_id: string; credentials: Record<string, unknown> }[]).map(
        (row) => [row.connection_id, row.credentials ?? {}],
      ),
    );

    for (const id of missing) {
      if (!usable.has(id)) {
        // Not in this org — indistinguishable from "does not exist", on purpose.
        throw new Error(`Connection ${id} is not available in this workspace.`);
      }
      if (!usable.get(id)) throw new Error(`Connection ${id} is switched off.`);
      cache.set(id, byId.get(id) ?? {});
    }
  }

  return value.replace(CONNECTION_TOKEN, (_match, id: string, field: string) => {
    const credentials = cache.get(id) ?? {};
    const secret = credentials[field];
    if (secret === undefined || secret === null) {
      throw new Error(`Connection ${id} has no "${field}".`);
    }
    return String(secret);
  });
}

/** Reads a response body, refusing anything over the cap instead of truncating. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error(`The response is larger than ${MAX_RESPONSE_BYTES} bytes.`);
  }
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`The response is larger than ${MAX_RESPONSE_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** Response headers, as a plain object, minus the ones that carry credentials. */
function headersOf(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Executes one http step. Never throws: like every app action, a failure is
 * `{ ok: false, error }` with text safe to write into the run log, because the
 * run log is readable by every member of the team.
 */
export async function runHttpStep(
  admin: SupabaseClient,
  teamId: string,
  config: HttpStepConfig,
  deps: HttpStepDeps = {},
): Promise<AppActionResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const resolveHost = deps.resolveHost ?? realResolve;
  const cache = new Map<string, Record<string, unknown>>();

  try {
    const method = String(config.method ?? "GET").toUpperCase();
    if (!METHODS.has(method)) {
      return { ok: false, output: {}, error: `"${method}" is not an HTTP method a step can use.` };
    }
    const rawUrl = typeof config.url === "string" ? config.url.trim() : "";
    if (!rawUrl) return { ok: false, output: {}, error: "The http step has no URL." };

    const timeoutMs = Math.min(
      Math.max(Number(config.timeout_ms) || DEFAULT_TIMEOUT_MS, 1_000),
      MAX_TIMEOUT_MS,
    );
    const allowlist = await loadAllowlist(admin, teamId);
    if (allowlist.length === 0) {
      return {
        ok: false,
        output: {},
        error:
          "This workspace has no allowed hosts yet — an admin must add the host before a workflow can call it.",
      };
    }

    const headers: Record<string, string> = {};
    if (config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)) {
      for (const [key, value] of Object.entries(config.headers as Record<string, unknown>)) {
        const name = key.trim().toLowerCase();
        if (!name || FORBIDDEN_HEADERS.has(name)) continue;
        headers[name] = await resolveConnectionTokens(admin, teamId, String(value ?? ""), cache);
      }
    }

    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD" && config.body !== undefined && config.body !== null) {
      const raw = typeof config.body === "string" ? config.body : JSON.stringify(config.body);
      body = await resolveConnectionTokens(admin, teamId, raw ?? "", cache);
      if (!headers["content-type"]) {
        headers["content-type"] = typeof config.body === "string" ? "text/plain" : "application/json";
      }
    }

    let target = await assertUrlAllowed(
      await resolveConnectionTokens(admin, teamId, rawUrl, cache),
      allowlist,
      resolveHost,
    );

    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await doFetch(target.toString(), {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status < 300 || response.status > 399) break;
      const location = response.headers.get("location");
      if (!location) break;
      if (hop === MAX_REDIRECTS) {
        return { ok: false, output: {}, error: "The request was redirected too many times." };
      }
      // A redirect is a fresh request to a fresh host: re-check both guards.
      target = await assertUrlAllowed(new URL(location, target).toString(), allowlist, resolveHost);
    }
    if (!response) {
      return { ok: false, output: {}, error: "The request produced no response." };
    }

    const text = await readCapped(response);
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    const output = {
      status: response.status,
      ok: response.ok,
      headers: headersOf(response),
      body: parsed,
    } as Record<string, unknown>;

    if (!response.ok) {
      // A 4xx/5xx is a step failure, so a {retry} config gets its second
      // attempt and a failed run shows up in the failures filter. The body's
      // first line is the only part worth reading in a run log.
      const detail = text.replace(/\s+/g, " ").trim().slice(0, 300);
      return {
        ok: false,
        output,
        error: safeErrorText(
          `The request to ${target.hostname} came back ${response.status}${detail ? `: ${detail}` : "."}`,
        ),
      };
    }

    return { ok: true, output };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, output: {}, error: "The request timed out." };
    }
    return { ok: false, output: {}, error: safeErrorText(err, "The http step failed.") };
  }
}
