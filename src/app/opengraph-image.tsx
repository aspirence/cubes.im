import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo";

export const alt = "Cubes — One workspace for everything you run";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Branded social card, generated at build time. */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #0b0d12 0%, #14171f 55%, #1b2030 100%)",
          color: "#e6e9ef",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 14,
              background: "#4a4ad0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Font-free mark: a rotated white square that reads as a cube face. */}
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                background: "#fff",
                transform: "rotate(45deg)",
              }}
            />
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>
            {SITE_NAME}
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 940,
            }}
          >
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 30, color: "#9aa4b6", maxWidth: 900 }}>
            The open-source, all-in-one workspace — projects, docs, review,
            clients and people ops behind a single login.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 24,
            color: "#8a8d98",
          }}
        >
          <div style={{ display: "flex" }}>cubes.im</div>
          <div style={{ display: "flex" }}>Open source · Free to start</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
