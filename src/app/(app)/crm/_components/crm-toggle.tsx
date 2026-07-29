"use client";

import { Switch, theme } from "antd";

/**
 * The CRM toolbar's boolean pill — "Deleted", "My tasks", and friends.
 *
 * One implementation for all four call sites so the chrome (height 32, radius
 * 8, `colorBorderSecondary` hairline) can never drift. The whole pill is a
 * `<label>` wrapping the `Switch`, so the text is a real click target and
 * keyboard/screen-reader users get the switch's own semantics for free.
 */
export function CrmToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <Switch size="small" checked={checked} onChange={onChange} />
      <span
        style={{
          fontSize: 13,
          lineHeight: 1,
          color: checked ? token.colorText : token.colorTextSecondary,
        }}
      >
        {label}
      </span>
    </label>
  );
}
