/**
 * What an admin may put on a team's HTTP allowlist, and the exact shape it is
 * stored in. Pure — no node: builtins — because the settings page imports it to
 * show the admin what will actually be saved before they save it.
 *
 * The precision matters twice over:
 *
 *  1. At run time the checker (src/lib/workflows/http-step.ts hostAllowed)
 *     compares `new URL(step.url).hostname` — already lowercased, already
 *     punycode, brackets stripped, and with its own trailing dot removed —
 *     against each stored entry lowercased and nothing else. An entry in any
 *     other shape ("München.de", "acme.com.", "acme.com:8443") is a row that
 *     looks added and can never match. That failure is silent and expensive, so
 *     normalising is the whole job here.
 *  2. The table's CHECK constraint (migration 20261132000000:214-219) rejects
 *     anything else at the database, which would reach the admin as a raw
 *     Postgres error instead of a sentence.
 */

/** One entry, as the route hands it to the settings page. */
export interface HttpHostRow {
  host: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  /** Resolved from public.users when the caller can see that row; else null. */
  created_by_name: string | null;
}

/** The note column's CHECK (migration 20261132000000:219). */
export const MAX_NOTE_LENGTH = 300;

/** The host column's CHECK, restated (migration 20261132000000:214-218). */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Already-absolute input: "https://api.acme.com/hook" rather than a bare host. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Dotted-decimal, which is the only v4 spelling the URL parser ever hands back. */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Names that only ever point inward or nowhere: the special-use domains of
 * RFC 6761 / RFC 8375, plus the suffixes cloud providers park their metadata
 * service and VPC-internal DNS on (metadata.google.internal being the famous
 * one). http-step.ts already refuses whatever these resolve to, so this is the
 * second lock rather than the first — but the first lock resolves the name at
 * request time and `fetch` resolves it again independently, so narrowing the
 * set of names a workflow may even attempt is worth having on its own.
 */
const RESERVED_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "corp",
  "home",
  "home.arpa",
  "lan",
  "private",
  "arpa",
  "onion",
  "alt",
  "test",
  "example",
  "invalid",
];

/**
 * Namespaces that many unrelated parties share, which must never be added on
 * their own.
 *
 * The run-time check is a suffix match — hostAllowed() in
 * src/lib/workflows/http-step.ts:129 accepts `host === allowed` OR
 * `host.endsWith("." + allowed)`. So an entry is really "this name and
 * everything under it". That is the right shape for `api.acme.com`, and a
 * catastrophe for `co.uk`: an admin who types their own registrar's suffix
 * thinking it scopes things down has instead allowed every site in the United
 * Kingdom. The same goes for the multi-tenant hosts below, where one label
 * separates our workspace from a stranger's bucket or app.
 *
 * This is deliberately NOT the Public Suffix List. The real PSL is ~10k
 * entries that change monthly, and shipping a stale copy would invent its own
 * bugs. What this catches is the mistake an admin actually makes — typing the
 * suffix instead of the host — and the message tells them what to type
 * instead. Anything past this list still has to survive the address checks at
 * request time.
 */
const SHARED_NAMESPACES = [
  // Registrable suffixes that look like ordinary two-label domains.
  "co.uk", "org.uk", "me.uk", "gov.uk", "ac.uk", "co.in", "net.in", "org.in",
  "com.au", "net.au", "org.au", "co.nz", "co.za", "com.br", "com.mx", "com.sg",
  "co.jp", "or.jp", "ne.jp", "com.cn", "com.hk", "com.tr", "co.kr", "com.pk",
  // Multi-tenant hosting: one label is all that separates tenants.
  "appspot.com", "firebaseapp.com", "web.app", "web.dev",
  "github.io", "gitlab.io", "herokuapp.com", "herokudns.com",
  "amazonaws.com", "s3.amazonaws.com", "cloudfront.net", "elb.amazonaws.com",
  "azurewebsites.net", "blob.core.windows.net", "core.windows.net",
  "cloudapp.azure.com", "trafficmanager.net",
  "vercel.app", "netlify.app", "netlify.com", "pages.dev", "workers.dev",
  "ngrok.io", "ngrok-free.app", "trycloudflare.com", "loca.lt",
  "onrender.com", "fly.dev", "railway.app", "glitch.me", "repl.co",
  "translate.goog", "googleusercontent.com", "blogspot.com",
  "wordpress.com", "myshopify.com", "zendesk.com", "atlassian.net",
];

export type HostCheck = { ok: true; host: string } | { ok: false; error: string };

/**
 * Turns whatever an admin typed into the one string the run-time checker will
 * compare against, or explains why it cannot. Accepts a pasted URL, a host with
 * a port, a leading "*." and a Unicode domain; all of them collapse to the
 * bare, lowercase, punycode hostname.
 */
export function normalizeHost(raw: string): HostCheck {
  const typed = raw.trim();
  if (!typed) return { ok: false, error: "Enter a hostname." };

  let parsed: URL;
  try {
    parsed = new URL(HAS_SCHEME.test(typed) ? typed : `https://${typed}`);
  } catch {
    return { ok: false, error: `"${typed}" is not a hostname we can read.` };
  }

  // Brackets are the URL syntax for an IPv6 literal; trailing dots are the root
  // label, which the checker strips from the URL side but not from the entry;
  // and "*." is the wildcard people know from other allowlists — an entry here
  // already covers its subdomains, so it is redundant rather than wrong, and
  // the preview shows what it became instead of quietly reinterpreting it.
  const host = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/^\*?\./, "")
    .replace(/\.+$/, "");
  if (!host) return { ok: false, error: `"${typed}" is not a hostname we can read.` };

  if (IPV4_LITERAL.test(host) || host.includes(":")) {
    return {
      ok: false,
      error:
        "Allow a hostname, not an IP address — an address has no subdomains to cover, and a private one would be refused at request time anyway.",
    };
  }

  const reserved = RESERVED_SUFFIXES.find((s) => host === s || host.endsWith(`.${s}`));
  if (reserved) {
    return {
      ok: false,
      error: `.${reserved} names are internal or reserved, so a workflow can never reach them.`,
    };
  }

  // Only an EXACT match is refused. "co.uk" is a shared namespace;
  // "acme.co.uk" is one company, and "api.acme.co.uk" is one service — both of
  // those are fine and must stay fine.
  if (SHARED_NAMESPACES.includes(host)) {
    return {
      ok: false,
      error: `"${host}" is shared by many unrelated sites, and an entry here also covers everything under it — so this would allow all of them. Add the specific host instead, like api.${host}.`,
    };
  }

  if (host.length > 253) {
    return { ok: false, error: "That hostname is longer than 253 characters." };
  }
  if (host.split(".").some((label) => label.length > 63)) {
    return { ok: false, error: "Each part of a hostname must be 63 characters or fewer." };
  }
  if (!HOST_PATTERN.test(host)) {
    return {
      ok: false,
      error: `"${host}" is not a valid hostname — use letters, digits and hyphens, with at least one dot.`,
    };
  }

  return { ok: true, host };
}

/** The optional reminder of why the host is on the list. */
export function normalizeNote(raw: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: false, error: "The note must be text." };
  const note = raw.trim();
  if (!note) return { ok: true, note: null };
  if (note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `The note must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }
  return { ok: true, note };
}
