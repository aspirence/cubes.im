import { portalPalette } from "./portal-theme";
import { DEFAULT_PORTAL_BRAND } from "./types";

/**
 * The portal's dead ends, rendered on the server: a session that is not there,
 * a project that is not shared, a backend that has not shipped. Deliberately
 * plain (no hooks, no client bundle) so the unhappy path costs nothing, and
 * deliberately vague about causes — "this link is not valid" must read the same
 * whether the token expired, was used already, or never existed.
 */
export function PortalStatus({
  icon,
  title,
  message,
  action,
}: {
  icon: string;
  title: string;
  message: string;
  action?: { href: string; label: string };
}) {
  const palette = portalPalette(DEFAULT_PORTAL_BRAND.accent);
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.bg,
        color: palette.text,
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 15,
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: palette.panel,
            border: `1px solid ${palette.hair}`,
          }}
        >
          <span
            className="material-symbols-rounded"
            aria-hidden
            style={{ fontSize: 27, color: palette.textTertiary }}
          >
            {icon}
          </span>
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: "0 0 8px" }}>{title}</h1>
        <p
          style={{
            color: palette.textSecondary,
            fontSize: 14,
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {message}
        </p>
        {action ? (
          <a
            href={action.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 44,
              padding: "0 18px",
              marginTop: 18,
              borderRadius: 11,
              background: palette.accent,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14.5,
              textDecoration: "none",
            }}
          >
            {action.label}
          </a>
        ) : null}
      </div>
    </main>
  );
}
