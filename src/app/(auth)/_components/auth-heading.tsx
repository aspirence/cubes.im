"use client";

/**
 * Shared heading for the auth forms: a bold title and a muted one-liner —
 * the editorial look shared by login and signup.
 */
export function AuthHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h1
        style={{
          margin: 0,
          fontSize: 26,
          fontWeight: 750,
          letterSpacing: "-.5px",
          color: "#17171c",
        }}
      >
        {title}
      </h1>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 13.5,
          lineHeight: 1.6,
          color: "#8b90a0",
          maxWidth: 340,
        }}
      >
        {subtitle}
      </p>
    </div>
  );
}

/** The dark full-width submit button style shared by the auth forms. */
export const AUTH_DARK_BUTTON: React.CSSProperties = {
  height: 44,
  borderRadius: 9,
  fontWeight: 600,
  background: "#17171c",
  borderColor: "#17171c",
};
