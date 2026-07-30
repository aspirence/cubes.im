"use client";

import { useMemo, useRef, useState } from "react";
import { Avatar, Button, Divider, Input, Popover, Select, theme } from "antd";
import type { InputRef } from "antd";
import {
  PlusOutlined,
  CloseOutlined,
  CheckOutlined,
  SearchOutlined,
} from "@ant-design/icons";

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
    // Letters/digits only — labels can carry suffixes like "Name · On leave",
    // whose "·" must not leak into the monogram.
    .filter((c) => c && /[\p{L}\p{N}]/u.test(c))
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

/** Muted section heading inside the picker popover ("Assignees" / "People"). */
function SectionLabel({ children }: { children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        color: token.colorTextTertiary,
        padding: "8px 8px 4px",
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}

/** One clickable person row: avatar (ringed when selected) + name + email.
 *  Selected rows get a hover-revealed × as the "click removes" cue. */
function PickRow({
  option,
  selected,
  onToggle,
}: {
  option: MemberOption;
  selected: boolean;
  onToggle: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <div
      role="button"
      tabIndex={0}
      className="wl-member-row"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 8px",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          flex: "none",
          borderRadius: "50%",
          // ClickUp-style selection cue: a brand ring around the avatar with a
          // hairline gap — no check marks anywhere in this picker.
          boxShadow: selected
            ? `0 0 0 1.5px ${token.colorBgElevated}, 0 0 0 3px ${token.colorPrimary}`
            : undefined,
        }}
      >
        <MemberAvatar option={option} size={26} />
      </span>
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
          {option.label}
        </span>
        {option.email ? (
          <span
            style={{
              fontSize: 11.5,
              color: token.colorTextTertiary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {option.email}
          </span>
        ) : null}
      </span>
      {selected ? (
        <CloseOutlined
          className="wl-row-x"
          style={{ fontSize: 10, color: token.colorTextTertiary, flex: "none" }}
        />
      ) : null}
    </div>
  );
}

/**
 * ClickUp-style people picker: the closed trigger is an avatar STACK (overlapping
 * avatars + "+N"), never a tag-filled input; the popover has the search box on
 * top and the list split into "Assignees" (selected — click to remove) and
 * "People" (click to add).
 */
function AvatarStackPicker({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  style,
  onInvite,
  popupInParent,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: MemberOption[];
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  onInvite?: (query: string) => void;
  popupInParent?: boolean;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<InputRef>(null);

  const byValue = useMemo(
    () => new Map(options.map((o) => [o.value, o])),
    [options],
  );
  const selectedSet = useMemo(() => new Set(value), [value]);
  // An id can outlive options (member removed mid-session): keep it visible
  // and removable instead of silently submitting an invisible assignee.
  const chosen = useMemo(
    () =>
      value.map((v) => byValue.get(v) ?? { value: v, label: "Unknown member" }),
    [value, byValue],
  );
  // Section membership is FROZEN per popover-open: if rows jumped between
  // "Assignees"/"People" on every click, the second click of a double-click
  // would land on whatever reflowed under the cursor. Selection state itself
  // stays live (ring + ×).
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(value));

  const q = search.trim().toLowerCase();
  const matches = (m: MemberOption) =>
    !q ||
    m.label.toLowerCase().includes(q) ||
    (m.email ?? "").toLowerCase().includes(q);
  const assigneeRows = Array.from(
    pinned,
    (v) => byValue.get(v) ?? { value: v, label: "Unknown member" },
  ).filter(matches);
  const peopleRows = options
    .filter((o) => !pinned.has(o.value))
    .filter(matches);

  function toggle(v: string) {
    onChange(selectedSet.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  function fireInvite() {
    setOpen(false);
    const query = search.trim();
    setSearch("");
    onInvite?.(query);
  }

  const content = (
    <div
      style={{ width: 268 }}
      onKeyDown={(e) => {
        // Esc closes only the picker — it must never bubble on to close the
        // Modal/Drawer behind it (discarding the user's draft).
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          setSearch("");
        }
      }}
    >
      <Input
        ref={searchRef}
        size="middle"
        variant="filled"
        prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
        placeholder="Search or enter email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onPressEnter={() => {
          // Enter = quick-pick the first unselected match. Invite only when
          // NOTHING matches at all — a query matching an already-selected
          // assignee must not steer toward inviting an existing teammate.
          const first = peopleRows.find((p) => !selectedSet.has(p.value));
          if (first) {
            toggle(first.value);
            setSearch("");
          } else if (onInvite && q && !assigneeRows.length && !peopleRows.length) {
            fireInvite();
          }
        }}
        style={{ borderRadius: 10 }}
        allowClear
      />
      <div style={{ maxHeight: 272, overflowY: "auto", marginTop: 6 }}>
        {assigneeRows.length ? (
          <>
            <SectionLabel>Assignees</SectionLabel>
            {assigneeRows.map((m) => (
              <PickRow
                key={m.value}
                option={m}
                selected={selectedSet.has(m.value)}
                onToggle={() => toggle(m.value)}
              />
            ))}
          </>
        ) : null}
        {peopleRows.length ? (
          <>
            <SectionLabel>People</SectionLabel>
            {peopleRows.map((m) => (
              <PickRow
                key={m.value}
                option={m}
                selected={selectedSet.has(m.value)}
                onToggle={() => toggle(m.value)}
              />
            ))}
          </>
        ) : null}
        {!assigneeRows.length && !peopleRows.length ? (
          <div
            style={{
              padding: "14px 8px",
              fontSize: 12.5,
              color: token.colorTextTertiary,
              textAlign: "center",
            }}
          >
            No members match
          </div>
        ) : null}
      </div>
      {onInvite ? (
        <>
          <Divider style={{ margin: "6px 0" }} />
          <Button
            type="text"
            icon={<PlusOutlined style={{ fontSize: 12 }} />}
            block
            size="small"
            style={{
              textAlign: "left",
              color: token.colorPrimary,
              fontSize: 13,
              fontWeight: 500,
              height: 32,
              padding: "0 8px",
            }}
            onClick={fireInvite}
          >
            {search.trim() ? `Invite “${search.trim()}”` : "Invite a new member…"}
          </Button>
        </>
      ) : null}
    </div>
  );

  return (
    <Popover
      open={disabled ? false : open}
      onOpenChange={(o) => {
        if (disabled) return;
        setOpen(o);
        // Re-freeze the section split from the CURRENT selection on each open.
        if (o) setPinned(new Set(value));
        if (!o) setSearch("");
      }}
      afterOpenChange={(o) => {
        // Popover keeps its content mounted after the first open, so autoFocus
        // would only ever fire once — focus explicitly on every open instead.
        if (o) searchRef.current?.focus();
      }}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      getPopupContainer={
        popupInParent ? (trigger) => trigger.parentElement ?? document.body : undefined
      }
      styles={{ body: { padding: 10 } }}
      content={content}
    >
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={placeholder ?? "Assignees"}
        aria-disabled={disabled || undefined}
        className="wl-assignee-trigger"
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          minHeight: 32,
          padding: "3px 10px",
          borderRadius: 8,
          // Opaque surface, and the SAME token the avatar-stack rings use —
          // a translucent fill here would leave the rings visibly mismatched
          // in dark theme.
          background: token.colorBgLayout,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          ...style,
        }}
      >
        {chosen.length ? (
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {chosen.slice(0, 4).map((m, i) => (
              <span
                key={m.value}
                title={m.label}
                style={{
                  display: "inline-flex",
                  marginLeft: i ? -7 : 0,
                  borderRadius: "50%",
                  // Ring in the pill's own bg so the overlap reads as a stack.
                  boxShadow: `0 0 0 2px ${token.colorBgLayout}`,
                }}
              >
                <MemberAvatar option={m} size={24} />
              </span>
            ))}
            {chosen.length > 4 ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  marginLeft: -7,
                  borderRadius: "50%",
                  background: token.colorFillSecondary,
                  boxShadow: `0 0 0 2px ${token.colorBgLayout}`,
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                }}
              >
                +{chosen.length - 4}
              </span>
            ) : null}
          </span>
        ) : (
          <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>
            {placeholder ?? "Assignee"}
          </span>
        )}
        {chosen.length && !disabled ? (
          <span
            role="button"
            aria-label="Clear assignees"
            className="wl-assignee-clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            style={{
              display: "inline-flex",
              marginLeft: "auto",
              color: token.colorTextTertiary,
            }}
          >
            <CloseOutlined style={{ fontSize: 10 }} />
          </span>
        ) : null}
      </div>
    </Popover>
  );
}

/**
 * A team-member multi-select that shows chosen members as avatar + name chips
 * (with a remove ×) and rich avatar + name + email rows in the dropdown. This is
 * the single people-picker used everywhere across the platform — sharing,
 * assignees, mentions, reviewers, etc.
 *
 * variant="avatar" renders a ClickUp-style avatar-stack trigger with a
 * search-on-top sectioned popover; the default "chip" is the fuller pill input.
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
  popupInParent,
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
  /** Render the dropdown inside the trigger's parent (for modals — keeps the
   *  popup attached to the field instead of spilling over the page behind). */
  popupInParent?: boolean;
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

  if (variant === "avatar") {
    return (
      <AvatarStackPicker
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        style={style}
        onInvite={onInvite}
        popupInParent={popupInParent}
      />
    );
  }

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
      // Tall avatar rows: cap the list so the popup scrolls instead of
      // towering past a small modal.
      listHeight={224}
      // optionRender already paints a check — rc-select's built-in selected
      // icon would double it up.
      menuItemSelectedIcon={null}
      getPopupContainer={
        popupInParent ? (trigger) => trigger.parentElement ?? document.body : undefined
      }
      options={options.map((o) => ({ value: o.value, label: o.label }))}
      popupRender={
        onInvite
          ? (menu) => (
              <>
                {menu}
                <Divider style={{ margin: "4px 0" }} />
                <Button
                  type="text"
                  icon={<PlusOutlined style={{ fontSize: 12 }} />}
                  block
                  size="small"
                  style={{
                    textAlign: "left",
                    color: token.colorPrimary,
                    fontSize: 13,
                    fontWeight: 500,
                    height: 32,
                    padding: "0 10px",
                    margin: "0 0 2px",
                  }}
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
      menuItemSelectedIcon={null}
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
