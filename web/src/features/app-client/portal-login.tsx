"use client";

import { useState } from "react";
import {
  PButton,
  PCard,
  PField,
  PNotice,
  inputStyle,
  usePortalPalette,
  BrandMark,
} from "./portal-shell";
import { isValidEmail, normalizeEmail, type PortalBrand } from "./types";

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  /** The neutral answer: we say this whether or not the contact exists. */
  | { kind: "sent"; email: string }
  /** Mail cannot go out at all — a workspace fact, so it leaks no account. */
  | { kind: "no_email"; reason: string }
  | { kind: "error"; reason: string };

/**
 * Why a visitor landed here, worded so that none of these answers reveals
 * whether a given address belongs to a contact.
 */
const REASONS: Record<string, string> = {
  expired: "That sign-in link has expired or was already used. Here is a fresh one.",
  signed_out: "You are signed out.",
  invalid: "That link is not valid any more. Ask for a new one below.",
  // /api/client/auth/[token] redirects here with ?error=link for an unknown,
  // used or expired token and ?error=config when the server has no service
  // key. Without these two the most common way to arrive on this page — a
  // second click on the emailed link — showed a bare form and no explanation.
  link: "That sign-in link has expired or was already used. Ask for a fresh one below.",
  config: "Sign-in is not switched on for this workspace yet. Ask your agency to check their setup.",
};

/**
 * Client sign-in: one field, one button, a one-time link by email.
 *
 * Two rules shape this screen. It answers "check your email" whether or not
 * the address belongs to a contact, so the page cannot be used to discover who
 * an agency works with. And when the workspace has no mail sender configured,
 * it says so plainly instead of claiming an email is on its way — the invite
 * modal elsewhere in this product makes that claim today, and a client waiting
 * for an email that was never sent is the worst possible first impression.
 */
export function PortalLogin({
  brand,
  reason,
}: {
  brand: PortalBrand;
  /** Why the visitor was sent here, when they did not come on their own. */
  reason?: string | null;
}) {
  const palette = usePortalPalette(brand.accent);
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const reasonText = REASONS[reason ?? ""] ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) {
      setPhase({ kind: "error", reason: "That does not look like an email address." });
      return;
    }
    setPhase({ kind: "sending" });
    let response: Response;
    try {
      response = await fetch("/api/client/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
    } catch {
      setPhase({ kind: "error", reason: "We could not reach the sign-in service." });
      return;
    }
    // The route answers `{error}` on every failure and `{ok, message,
    // emailConfigured}` on success; `reason` is read too because the decide and
    // session routes use that key and one of them may end up behind this form.
    let body: { emailConfigured?: boolean; error?: string; reason?: string } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      body = {};
    }
    const said = body.error ?? body.reason;

    if (response.status === 404) {
      // The route exists; a 404 here means something in front of it is not
      // routing to this deployment. Saying "your agency has not switched this
      // on" would be a guess, and the wrong one — it sends a client who only
      // needs a fresh link off to ask for a manual re-invite.
      setPhase({
        kind: "no_email",
        reason:
          "We could not find the sign-in service at this address. Check the link you were given, or ask your agency for a fresh one.",
      });
      return;
    }
    if (response.status >= 500) {
      // Nothing left the server, so this is not "that did not work, try again
      // in a second" — it is "no email is coming".
      setPhase({
        kind: "no_email",
        reason: said ?? "We could not send the link just now. Please try again in a minute.",
      });
      return;
    }
    if (!response.ok) {
      setPhase({
        kind: "error",
        reason: said ?? "We could not send the link just now.",
      });
      return;
    }
    if (body.emailConfigured === false) {
      setPhase({
        kind: "no_email",
        reason:
          said ??
          "This workspace has no email sender configured, so the link could not be sent. Ask your contact there for it.",
      });
      return;
    }
    setPhase({ kind: "sent", email: address });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: palette.bg,
        color: palette.text,
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark brand={brand} palette={palette} size={40} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{brand.name}</div>
            <div style={{ fontSize: 12.5, color: palette.textSecondary }}>Client sign-in</div>
          </div>
        </div>

        {phase.kind === "sent" ? (
          <PCard palette={palette} padding={18}>
            <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
              <span
                className="material-symbols-rounded"
                aria-hidden
                style={{ fontSize: 30, color: palette.accent }}
              >
                mark_email_read
              </span>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Check your email</div>
              <div style={{ fontSize: 13.5, color: palette.textSecondary, lineHeight: 1.55 }}>
                If <strong>{phase.email}</strong> has been given access, a sign-in link is on
                its way. It works once and expires in 15 minutes.
              </div>
              {/* The server stops at five live links per contact per quarter of
                  an hour, so someone who keeps pressing the button waits for a
                  sixth mail that is never sent. Saying so costs nothing — it is
                  a rule of the service, not a fact about this address. */}
              <div style={{ fontSize: 12, color: palette.textTertiary, lineHeight: 1.5 }}>
                Asked a few times already? Only five links go out every 15 minutes — open the
                most recent email you received.
              </div>
              <PButton
                palette={palette}
                variant="ghost"
                onClick={() => setPhase({ kind: "idle" })}
              >
                Use a different address
              </PButton>
            </div>
          </PCard>
        ) : (
          <PCard palette={palette} padding={18}>
            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              {reasonText ? (
                <PNotice palette={palette} tone={palette.accent} icon="info" title={reasonText} />
              ) : null}
              <div style={{ fontSize: 13.5, color: palette.textSecondary, lineHeight: 1.55 }}>
                Enter the email your agency shared the project with. We will send you a
                one-time link — no password to remember.
              </div>
              <PField palette={palette} label="Email">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  style={inputStyle(palette)}
                />
              </PField>
              <PButton
                palette={palette}
                type="submit"
                full
                disabled={phase.kind === "sending"}
              >
                {phase.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
              </PButton>
              {phase.kind === "no_email" ? (
                <PNotice palette={palette} tone={palette.gold} icon="unsubscribe" title="No email was sent">
                  {phase.reason}
                </PNotice>
              ) : null}
              {phase.kind === "error" ? (
                <PNotice palette={palette} tone={palette.red} icon="error" title="That did not work">
                  {phase.reason}
                </PNotice>
              ) : null}
            </form>
          </PCard>
        )}

        <div style={{ fontSize: 11.5, color: palette.textTertiary, textAlign: "center" }}>
          You are signing in to a private client area. Nobody here will ever ask you for a
          password to your ad accounts.
        </div>
      </div>
    </div>
  );
}
