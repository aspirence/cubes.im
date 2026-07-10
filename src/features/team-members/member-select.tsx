"use client";

import { useMemo, useState } from "react";
import { Avatar, Button, Divider, Select, Tooltip, theme } from "antd";
import { PlusOutlined, CloseOutlined, CheckOutlined } from "@ant-design/icons";

export interface MemberOption {
  /** The value stored (a team_members.id in most task/project contexts). */
  value: string;
  /** Display name. */
  label: string;
  avatarUrl?: string | null;
  /** When provided, searching also matches the member's email; shown as a subtitle. */
  email?: string | null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Deterministic, pleasant avatar tint from the name/id so people are visually
// distinguishable even without a photo (stable across renders).
const AVATAR_TINTS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6",
];
function tintFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function MemberAvatar({
  option,
  size,
}: {
  option: MemberOption | undefined;
  size: number;
}) {
  const hasPhoto = Boolean(option?.avatarUrl);
  return (
    <Avatar
      size={size}
      src={option?.avatarUrl ?? undefined}
      style={{
        fontSize: size < 24 ? 10 : 11,
        flex: "none",
        background: hasPhoto ? undefined : tintFor(option?.value ?? option?.label ?? "?"),
        color: hasPhoto ? undefined : "#fff",
      }}
    >
      {initials(option?.label ?? "?")}
    </Avatar>
  );
}

/**
 * A team-member multi-select that shows chosen members as avatar + name chips
 * (with a remove ×) and rich avatar + name + email rows in the dropdown. This is
 * the single people-picker used everywhere across the platform — sharing,
 * assignees, mentions, reviewers, etc.
 *
 * variant="avatar" renders selected members as bare avatars (name on hover) for
 * dense/compact fields; the default "chip" is the fuller, more legible pill.
 */
export function MemberSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  style,
  onInvite,
  variant = "chip",
  size,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: MemberOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  /**
   * When provided, the dropdown shows an "Invite a new member" footer that calls
   * this with the current search text — for adding someone not yet on the team.
   */
  onInvite?: (query: string) => void;
  /** "chip" (avatar + name pill, default) or "avatar" (bare avatars, compact). */
  variant?: "chip" | "avatar";
  size?: "small" | "middle" | "large";
}) {
  const { token } = theme.useToken();
  const byValue = useMemo(
    () => new Map(options.map((o) => [o.value, o])),
    [options],
  );
  const selected = useMemo(() => new Set(value), [value]);
  // Mirror the dropdown's search text (uncontrolled) so the invite footer can
  // label with, and forward, whatever the user typed.
  const [search, setSearch] = useState("");

  return (
    <Select
      mode="multiple"
      value={value}
      onChange={(v) => {
        onChange(v);
        // rc-select auto-clears its internal search on select WITHOUT calling
        // onSearch, so clear our mirror too or the invite footer goes stale.
        setSearch("");
      }}
      disabled={disabled}
      placeholder={placeholder}
      size={size}
      showSearch
      onSearch={setSearch}
      onOpenChange={(open) => {
        // Same deal on blur/close: rc-select clears the input silently.
        if (!open) setSearch("");
      }}
      // Match by name OR email (rc-select's label-only filter would miss a
      // member when the user types their email, nudging a needless invite).
      filterOption={(input, option) => {
        const q = input.trim().toLowerCase();
        if (!q) return true;
        const m = byValue.get(option?.value as string);
        return (
          (m?.label ?? "").toLowerCase().includes(q) ||
          (m?.email ?? "").toLowerCase().includes(q)
        );
      }}
      style={{ width: "100%", ...style }}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      popupRender={
        onInvite
          ? (menu) => (
              <>
                {menu}
                <Divider style={{ margin: "4px 0" }} />
                <Button
                  type="text"
                  icon={<PlusOutlined />}
                  block
                  style={{ textAlign: "left" }}
                  // Prevent the Select from stealing focus / committing a
                  // selection on mousedown so the click opens the invite dialog.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onInvite(search.trim())}
                >
                  {search.trim()
                    ? `Invite “${search.trim()}”`
                    : "Invite a new member…"}
                </Button>
              </>
            )
          : undefined
      }
      optionRender={(option) => {
        const m = byValue.get(option.value as string);
        const isSel = selected.has(option.value as string);
        return (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingBlock: 2,
            }}
          >
            <MemberAvatar option={m} size={28} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
              <span
                style={{
                  fontSize: 13,
                  color: token.colorText,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m?.label ?? String(option.label)}
              </span>
              {m?.email ? (
                <span
                  style={{
                    fontSize: 11.5,
                    color: token.colorTextTertiary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.email}
                </span>
              ) : null}
            </span>
            {isSel ? (
              <CheckOutlined style={{ color: token.colorPrimary, fontSize: 13, flex: "none" }} />
            ) : null}
          </span>
        );
      }}
      tagRender={({ value: v, onClose }) => {
        const m = byValue.get(v as string);
        if (variant === "avatar") {
          return (
            <span
              style={{ display: "inline-flex", marginInlineEnd: 4 }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Tooltip title={`${m?.label ?? ""} — click to remove`}>
                <span style={{ cursor: "pointer" }} onClick={() => onClose()}>
                  <MemberAvatar option={m} size={24} />
                </span>
              </Tooltip>
            </span>
          );
        }
        return (
          <span
            onMouseDown={(e) => e.preventDefault()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              maxWidth: "100%",
              marginInlineEnd: 4,
              marginBlock: 2,
              paddingInline: "3px 7px",
              paddingBlock: 2,
              borderRadius: 999,
              background: token.colorFillSecondary,
              border: `1px solid ${token.colorBorderSecondary}`,
              lineHeight: 1,
            }}
          >
            <MemberAvatar option={m} size={20} />
            <span
              style={{
                fontSize: 12.5,
                color: token.colorText,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {m?.label ?? String(v)}
            </span>
            <span
              role="button"
              aria-label="Remove"
              onClick={() => onClose()}
              style={{
                display: "inline-flex",
                cursor: "pointer",
                color: token.colorTextTertiary,
                flex: "none",
              }}
            >
              <CloseOutlined style={{ fontSize: 10 }} />
            </span>
          </span>
        );
      }}
    />
  );
}

/**
 * Single-member picker: the same rich avatar + name + email dropdown rows as
 * MemberSelect, and the chosen member shows as an avatar + name in the closed
 * box (instead of a bare name). Use anywhere ONE person is chosen — assignee
 * filters, schedule allocation, automation member fields, etc.
 */
export function MemberSingleSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  style,
  allowClear = true,
  size,
  notFoundContent,
}: {
  // value/onChange are optional so this can drop straight into an antd
  // <Form.Item>, which injects them via cloneElement.
  value?: string | null;
  onChange?: (value: string | undefined) => void;
  options: MemberOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  allowClear?: boolean;
  size?: "small" | "middle" | "large";
  notFoundContent?: React.ReactNode;
}) {
  const { token } = theme.useToken();
  const byValue = useMemo(
    () => new Map(options.map((o) => [o.value, o])),
    [options],
  );

  return (
    <Select
      showSearch
      value={value ?? undefined}
      onChange={(v) => onChange?.((v as string | undefined) ?? undefined)}
      allowClear={allowClear}
      disabled={disabled}
      placeholder={placeholder}
      size={size}
      notFoundContent={notFoundContent}
      filterOption={(input, option) => {
        const q = input.trim().toLowerCase();
        if (!q) return true;
        const m = byValue.get(option?.value as string);
        return (
          (m?.label ?? "").toLowerCase().includes(q) ||
          (m?.email ?? "").toLowerCase().includes(q)
        );
      }}
      style={{ width: "100%", ...style }}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      labelRender={(props) => {
        const m = byValue.get(props.value as string);
        if (!m) return props.label as React.ReactNode;
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <MemberAvatar option={m} size={18} />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </span>
          </span>
        );
      }}
      optionRender={(option) => {
        const m = byValue.get(option.value as string);
        const isSel = value === option.value;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 10, paddingBlock: 2 }}>
            <MemberAvatar option={m} size={28} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
              <span
                style={{
                  fontSize: 13,
                  color: token.colorText,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m?.label ?? String(option.label)}
              </span>
              {m?.email ? (
                <span
                  style={{
                    fontSize: 11.5,
                    color: token.colorTextTertiary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.email}
                </span>
              ) : null}
            </span>
            {isSel ? (
              <CheckOutlined style={{ color: token.colorPrimary, fontSize: 13, flex: "none" }} />
            ) : null}
          </span>
        );
      }}
    />
  );
}
