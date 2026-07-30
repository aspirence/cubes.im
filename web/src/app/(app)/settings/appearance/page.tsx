"use client";

import { theme } from "antd";
import { useUIStore } from "@/store/ui-store";
import type { ThemeMode } from "@/lib/theme";

const THEMES: {
  value: ThemeMode;
  label: string;
  icon: string;
  hint: string;
  swatch: string;
  swatchBorder: string;
}[] = [
  {
    value: "light",
    label: "Light",
    icon: "light_mode",
    hint: "Bright, high-contrast surfaces.",
    swatch: "#f6f7f9",
    swatchBorder: "#ececf0",
  },
  {
    value: "dark",
    label: "Dark",
    icon: "dark_mode",
    hint: "Dimmed surfaces for low light.",
    swatch: "#1c1c22",
    swatchBorder: "#2a2a32",
  },
];

export default function AppearanceSettingsPage() {
  const { token } = theme.useToken();
  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);

  return (
    <div
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(16,24,40,.04)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "18px 18px 14px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: "-.4px",
            color: token.colorText,
            lineHeight: 1.2,
          }}
        >
          Appearance
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
          Customize how Cubes looks on this device.
        </p>
      </div>

      <div
        style={{
          padding: "16px 18px 18px",
          borderTop: `1px solid ${token.colorSplit}`,
        }}
      >
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: token.colorText,
            marginBottom: 10,
          }}
        >
          Theme
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {THEMES.map((t) => {
            const active = themeMode === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setThemeMode(t.value)}
                aria-pressed={active}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: 232,
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 11,
                  cursor: "pointer",
                  background: active
                    ? token.colorPrimaryBg
                    : token.colorBgContainer,
                  border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                  boxShadow: "0 1px 2px rgba(16,24,40,.04)",
                  transition:
                    "background .15s ease, border-color .15s ease, box-shadow .15s ease",
                  outline: "none",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 40,
                    flex: "0 0 auto",
                    borderRadius: 9,
                    // Swatches deliberately stay literal — each previews its theme.
                    background: t.swatch,
                    border: `1px solid ${t.swatchBorder}`,
                    color: t.value === "dark" ? "#e6e6ea" : "#4a4ad0",
                  }}
                >
                  <span
                    className="material-symbols-rounded"
                    style={{ fontSize: 20 }}
                  >
                    {t.icon}
                  </span>
                </span>

                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: token.colorText,
                    }}
                  >
                    {t.label}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      color: token.colorTextSecondary,
                      marginTop: 1,
                    }}
                  >
                    {t.hint}
                  </span>
                </span>

                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    flex: "0 0 auto",
                    borderRadius: "50%",
                    color: "#fff",
                    background: active ? token.colorPrimary : "transparent",
                    border: active ? "none" : `1px solid ${token.colorBorder}`,
                    transition: "background .15s ease, border-color .15s ease",
                  }}
                >
                  {active && (
                    <span
                      className="material-symbols-rounded"
                      style={{ fontSize: 14, fontWeight: 700 }}
                    >
                      check
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
