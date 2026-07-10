"use client";

import Link from "next/link";
import { Typography } from "antd";

const { Text } = Typography;

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#ffffff" }}>
      {/* Brand panel (left, hidden on small screens) */}
      <div
        className="auth-hero"
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "26px 30px 40px",
          margin: 12,
          borderRadius: 22,
          background:
            "radial-gradient(ellipse 72% 52% at 52% 78%, rgba(106,90,240,.5), transparent 72%)," +
            "radial-gradient(ellipse 50% 42% at 22% 96%, rgba(224,85,155,.34), transparent 70%)," +
            "radial-gradient(ellipse 46% 40% at 86% 92%, rgba(79,91,213,.38), transparent 72%)," +
            "linear-gradient(180deg,#ffffff 0%,#f5f4fd 44%,#eceafb 100%)",
          border: "1px solid #eceef6",
        }}
      >
        {/* Brand — top left */}
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            color: "inherit",
            width: "fit-content",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/cubes.im_logo_big.png"
            alt=""
            style={{ width: 52, height: 52, objectFit: "contain" }}
          />
          <span
            style={{
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.5px",
              color: "#16203a",
            }}
          >
            Cubes
          </span>
        </Link>

        {/* Statement — bottom left */}
        <div style={{ maxWidth: 460 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "#5b5f74",
              marginBottom: 10,
            }}
          >
            One login. Zero glue work.
          </div>
          <div
            style={{
              fontSize: "clamp(24px, 2.4vw, 32px)",
              fontWeight: 700,
              letterSpacing: "-.02em",
              lineHeight: 1.25,
              color: "#17171c",
            }}
          >
            Get access to your team&apos;s hub for clarity and productivity.
          </div>
        </div>
      </div>

      {/* Form column (right) */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          padding: "24px 28px",
        }}
      >
        {/* Top bar: mobile brand (left) + back to site (right) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Link
            className="auth-mobile-brand"
            href="/"
            style={{
              display: "none",
              alignItems: "center",
              gap: 8,
              color: "inherit",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/cubes.im_logo_big.png"
              alt=""
              style={{ width: 32, height: 32, objectFit: "contain" }}
            />
            <span
              style={{
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "-0.4px",
                color: "#16203a",
              }}
            >
              Cubes
            </span>
          </Link>
          <span />
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 13,
              fontWeight: 500,
              color: "#8b90a0",
            }}
          >
            <span
              className="material-symbols-rounded"
              aria-hidden
              style={{ fontSize: 17, lineHeight: 1 }}
            >
              arrow_back
            </span>
            Back to site
          </Link>
        </div>

        {/* Centered form */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 0",
          }}
        >
          <div style={{ width: "100%", maxWidth: 380 }}>{children}</div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            © Cubes · Open source, built in the open
          </Text>
          <span style={{ display: "inline-flex", gap: 12, fontSize: 12 }}>
            <Link href="/terms" style={{ color: "#8b90a0" }}>
              Terms
            </Link>
            <Link href="/privacy" style={{ color: "#8b90a0" }}>
              Privacy
            </Link>
          </span>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .auth-hero { display: none !important; }
          .auth-mobile-brand { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
