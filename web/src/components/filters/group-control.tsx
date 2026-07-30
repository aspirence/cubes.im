"use client";

import { Button, Dropdown, theme } from "antd";

/** One group-by choice (e.g. Status, Priority, Due date). */
export interface GroupOption {
  value: string;
  label: string;
  /** Material Symbols glyph name. */
  icon?: string;
}

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * A compact "Group" control that mirrors the Filter button: instead of a wide
 * always-visible Segmented row, it's a single small button showing the current
 * grouping, opening a menu to switch. Config-driven via `options`, so the same
 * control works on any list across the platform.
 */
export function GroupControl({
  value,
  options,
  onChange,
  size = "middle",
}: {
  value: string;
  options: GroupOption[];
  onChange: (next: string) => void;
  size?: "small" | "middle";
}) {
  const { token } = theme.useToken();
  const current = options.find((o) => o.value === value);

  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectedKeys: [value],
        onClick: ({ key }) => onChange(key),
        items: options.map((o) => ({
          key: o.value,
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 96 }}>
              {o.icon ? <MIcon name={o.icon} size={16} color={token.colorTextTertiary} /> : null}
              {o.label}
            </span>
          ),
        })),
      }}
    >
      <Button size={size} icon={<MIcon name="splitscreen" size={16} color={token.colorTextTertiary} />}>
        <span style={{ color: token.colorTextTertiary, fontWeight: 500 }}>Group:</span>{" "}
        <span style={{ fontWeight: 600 }}>{current?.label ?? "None"}</span>
        <MIcon name="expand_more" size={16} color={token.colorTextTertiary} />
      </Button>
    </Dropdown>
  );
}

export default GroupControl;
