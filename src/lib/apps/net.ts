import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF guard for outbound connector deliveries (test + future outbox). A
 * connection's target URL is caller-controlled, and connectors run server-side,
 * so an unvalidated fetch is an SSRF primitive. This resolves the host and
 * rejects any URL that points at a loopback / private / link-local / metadata
 * address, plus non-http(s) schemes.
 *
 * Residual: a determined attacker could DNS-rebind between this lookup and the
 * actual fetch (TOCTOU). Callers additionally use redirect:"manual" so a public
 * host cannot 3xx into the internal network; full IP-pinning is deferred.
 */

/** True when an IPv4 literal is loopback / private / link-local / reserved. */
function isBlockedV4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved
  return false;
}

/** True when an IPv6 literal is loopback / ULA / link-local (or maps to a blocked v4). */
function isBlockedV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fe80")) return true; // link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // fc00::/7 ULA
  const mapped = s.startsWith("::ffff:") ? s.slice(7) : null;
  if (mapped && net.isIPv4(mapped)) return isBlockedV4(mapped);
  return false;
}

export type UrlCheck = { ok: true } | { ok: false; reason: string };

export interface SafeUrlOptions {
  /** Reject non-https URLs. */
  requireHttps?: boolean;
  /** Pin the URL host (case-insensitive), e.g. "hooks.slack.com". */
  host?: string;
}

/**
 * Validates that `raw` is a public http(s) URL safe to fetch from the server.
 * All failure reasons are generic and NEVER echo the URL — they may be shown to
 * users and persisted to member-readable columns.
 */
export async function assertPublicHttpUrl(
  raw: string,
  opts: SafeUrlOptions = {},
): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "URL must use http or https." };
  }
  if (opts.requireHttps && url.protocol !== "https:") {
    return { ok: false, reason: "URL must use https." };
  }
  if (opts.host && url.hostname.toLowerCase() !== opts.host.toLowerCase()) {
    return { ok: false, reason: `URL host must be ${opts.host}.` };
  }

  let addresses: string[];
  const literal = net.isIP(url.hostname);
  if (literal) {
    addresses = [url.hostname];
  } else {
    try {
      const resolved = await lookup(url.hostname, { all: true });
      addresses = resolved.map((r) => r.address);
    } catch {
      return { ok: false, reason: "Host could not be resolved." };
    }
  }
  if (addresses.length === 0) {
    return { ok: false, reason: "Host could not be resolved." };
  }
  for (const ip of addresses) {
    const blocked = net.isIPv6(ip) ? isBlockedV6(ip) : isBlockedV4(ip);
    if (blocked) {
      return {
        ok: false,
        reason: "URL resolves to a private or disallowed address.",
      };
    }
  }
  return { ok: true };
}
