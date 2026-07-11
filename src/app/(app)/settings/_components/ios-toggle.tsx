"use client";

import { theme } from "antd";

/**
 * iOS-style toggle: a 38x22 pill track (#4a4ad0 on / theme off-track) with an 18px
 * white knob that slides (left 2px off / 18px on). Purely presentational — it
 * mirrors the same `checked` / `onChange` contract as an AntD Switch so it can
 * be dropped in over existing boolean-preference wiring.
 */
export function IosToggle({
  checked,
  onChange,
  disabled,
  loading,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  "aria-label"?: string;
}) {
  const { token } = theme.useToken();
  const isBusy = Boolean(disabled || loading);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={isBusy}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 38,
        height: 22,
        flex: "0 0 auto",
        padding: 0,
        border: "none",
        borderRadius: 999,
        cursor: isBusy ? "not-allowed" : "pointer",
        background: checked ? "#4a4ad0" : token.colorTextQuaternary,
        opacity: isBusy ? 0.6 : 1,
        transition: "background .18s ease",
        outline: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 18 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#ffffff",
          boxShadow: "0 1px 2px rgba(16,24,40,.24)",
          transition: "left .18s ease",
        }}
      />
    </button>
  );
}
