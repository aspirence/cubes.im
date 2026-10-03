"use client";

/**
 * Sheets grid — what a cell looks like at rest and the editor that swaps in
 * when it is edited.
 *
 * Adapted from the CRM drawer's inline editors
 * (src/app/(app)/crm/_components/inline-edit.tsx) for a grid: the same
 * contract — text and numbers commit on Enter or blur, Escape cancels, selects
 * and dates commit on change, nothing is written when the value didn't change
 * — but the optimistic hold lives in the query cache (useUpdateCell) rather
 * than in each control, because a grid cell is unmounted the moment it
 * scrolls out of the virtual window and would lose a hold kept in local state.
 *
 * Editors report how they were committed ("down" after Enter, "right" after
 * Tab) so the grid can move the active cell the way a spreadsheet does.
 *
 * Person / people and long text edit in a popover: a 34px row has no room for
 * an avatar picker or a paragraph, and a popover is portalled out of the
 * virtual list so it is never clipped by it.
 */

import { useRef, useState } from "react";
import { App, Avatar, Button, DatePicker, Input, Popover, Select, theme } from "antd";
import dayjs from "dayjs";
import type { SelectOption, SheetColumn } from "@/lib/sheets/types";
import { MemberSelect, MemberSingleSelect, type MemberOption } from "@/features/team-members/member-select";
import { coerceCell, formatCell, isEmptyValue, type CellContext } from "./grid-values";

export type CommitMove = "down" | "right" | "left" | "none";

/* ------------------------------------------------------------------ *
 * Rest state
 * ------------------------------------------------------------------ */

const NUMERIC = new Set<SheetColumn["type"]>(["number", "currency", "percent"]);

export function isNumericColumn(column: SheetColumn): boolean {
  return NUMERIC.has(column.type);
}

function OptionPill({ option, fallback }: { option?: SelectOption; fallback: string }) {
  const { token } = theme.useToken();
  const color = option?.color ?? token.colorTextTertiary;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: "100%",
        padding: "0 8px",
        height: 20,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: "20px",
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color: option?.color ? `color-mix(in srgb, ${color} 80%, ${token.colorText})` : token.colorText,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flex: "none",
      }}
    >
      {option?.color ? <span style={{ width: 6, height: 6, borderRadius: 999, background: color, flex: "none" }} /> : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{option?.label ?? fallback}</span>
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => c && /[\p{L}\p{N}]/u.test(c))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function PersonChip({ member }: { member?: MemberOption }) {
  const { token } = theme.useToken();
  const label = member?.label ?? "Unknown member";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flex: "none", maxWidth: "100%" }} title={member?.email ?? undefined}>
      <Avatar size={18} src={member?.avatarUrl || undefined} style={{ fontSize: 9, background: token.colorPrimary, flex: "none" }}>
        {initials(label) || "?"}
      </Avatar>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: member ? undefined : token.colorTextTertiary }}>
        {label}
      </span>
    </span>
  );
}

/**
 * The resting cell. Checkboxes are real controls (one click flips them, like
 * the drawer's InlineBool); links, mail and phone are real anchors so they
 * still open — the grid only starts an edit on double-click or Enter.
 */
export function CellDisplay({
  value,
  column,
  ctx,
  members,
  locked,
  onToggle,
}: {
  value: unknown;
  column: SheetColumn;
  ctx: CellContext;
  members: Map<string, MemberOption>;
  locked: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const { token } = theme.useToken();
  switch (column.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={value === true}
          disabled={locked}
          aria-label={column.label}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => onToggle?.(e.target.checked)}
          style={{ width: 15, height: 15, cursor: locked ? "not-allowed" : "pointer", accentColor: token.colorPrimary, margin: 0 }}
        />
      );
    case "select": {
      if (isEmptyValue(value)) return null;
      const v = String(value);
      return <OptionPill option={ctx.options?.find((o) => o.value === v)} fallback={v} />;
    }
    case "multi_select": {
      const list = Array.isArray(value) ? value.map(String) : isEmptyValue(value) ? [] : [String(value)];
      return (
        <span style={{ display: "flex", gap: 4, overflow: "hidden", minWidth: 0 }}>
          {list.map((v) => (
            <OptionPill key={v} option={ctx.options?.find((o) => o.value === v)} fallback={v} />
          ))}
        </span>
      );
    }
    case "person":
      return isEmptyValue(value) ? null : <PersonChip member={members.get(String(value))} />;
    case "people": {
      const list = Array.isArray(value) ? value.map(String) : isEmptyValue(value) ? [] : [String(value)];
      if (list.length === 0) return null;
      if (list.length === 1) return <PersonChip member={members.get(list[0])} />;
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <Avatar.Group size={20} max={{ count: 4 }}>
            {list.map((id) => {
              const m = members.get(id);
              return (
                <Avatar key={id} size={20} src={m?.avatarUrl || undefined} style={{ fontSize: 9, background: token.colorPrimary }}>
                  {initials(m?.label ?? "?") || "?"}
                </Avatar>
              );
            })}
          </Avatar.Group>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: token.colorTextSecondary }}>
            {list.map((id) => members.get(id)?.label ?? "Unknown").join(", ")}
          </span>
        </span>
      );
    }
    case "url":
    case "email":
    case "phone": {
      if (isEmptyValue(value)) return null;
      const text = String(value);
      const href = column.type === "url" ? text : column.type === "email" ? `mailto:${text}` : `tel:${text.replace(/[^\d+]/g, "")}`;
      const safe = column.type !== "url" || /^(https?:|mailto:)/i.test(text);
      return safe ? (
        <a
          href={href}
          target={column.type === "url" ? "_blank" : undefined}
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {column.type === "url" ? text.replace(/^https?:\/\/(www\.)?/i, "") : text}
        </a>
      ) : (
        <span>{text}</span>
      );
    }
    default: {
      const text = formatCell(value, column, ctx);
      return (
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "block",
            width: "100%",
            textAlign: isNumericColumn(column) ? "right" : "left",
            fontVariantNumeric: isNumericColumn(column) ? "tabular-nums" : undefined,
          }}
        >
          {column.type === "long_text" ? text.replace(/\s*\n\s*/g, " ⏎ ") : text}
        </span>
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Editors
 * ------------------------------------------------------------------ */

export interface EditorProps {
  column: SheetColumn;
  value: unknown;
  ctx: CellContext;
  memberOptions: MemberOption[];
  /** Set when the edit was started by typing a character over the cell. */
  initialText?: string;
  onCommit: (value: unknown, move: CommitMove) => void;
  onCancel: () => void;
}

/** The text an existing value starts as in a free-text editor. */
function editText(value: unknown, column: SheetColumn): string {
  if (isEmptyValue(value)) return "";
  if (isNumericColumn(column)) return String(value);
  return String(value);
}

const EDITOR_STYLE: React.CSSProperties = { width: "100%", height: 30, borderRadius: 4 };

/**
 * Free text, numbers, links, email and phone. The typed text runs through the
 * same coercion as a paste, so "₹1,200" is accepted in a currency cell and an
 * invalid email keeps the editor open with the reason instead of writing junk.
 */
function TextEditor({ column, value, ctx, initialText, onCommit, onCancel }: EditorProps) {
  const { message } = App.useApp();
  const [text, setText] = useState(initialText ?? editText(value, column));
  const [error, setError] = useState<string | null>(null);
  // Enter, Tab and Escape hand focus back to the grid, which blurs this input
  // on its way out; without this latch that blur would commit a second time —
  // and turn an Escape into a save.
  const done = useRef(false);

  const commit = (move: CommitMove) => {
    if (done.current) return true;
    const res = coerceCell(text, column, ctx);
    if (!res.ok) {
      setError(res.error);
      message.warning({ content: res.error, key: "sheet-cell-invalid" });
      return false;
    }
    done.current = true;
    onCommit(res.value, move);
    return true;
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <Input
      autoFocus
      size="small"
      value={text}
      status={error ? "error" : undefined}
      onChange={(e) => {
        setText(e.target.value);
        setError(null);
      }}
      onFocus={(e) => {
        // Typing over a cell replaces it; Enter / double-click edits in place
        // with the caret at the end, the way spreadsheets behave.
        const el = e.currentTarget;
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }}
      onKeyDown={(e) => {
        // An IME (Hindi, Japanese…) uses Enter to pick a candidate, not to save.
        if (e.nativeEvent.isComposing) {
          e.stopPropagation();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commit(e.shiftKey ? "none" : "down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          commit(e.shiftKey ? "left" : "right");
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        } else {
          e.stopPropagation();
        }
      }}
      onBlur={() => {
        // A blur with an invalid value discards it rather than trapping focus.
        if (!commit("none")) cancel();
      }}
      style={{ ...EDITOR_STYLE, textAlign: isNumericColumn(column) ? "right" : "left" }}
      inputMode={isNumericColumn(column) ? "decimal" : column.type === "email" ? "email" : column.type === "phone" ? "tel" : undefined}
    />
  );
}

function LongTextEditor({ value, initialText, onCommit, onCancel, column }: EditorProps) {
  const [text, setText] = useState(initialText ?? editText(value, column));
  return (
    <Popover
      open
      trigger={[]}
      placement="bottomLeft"
      arrow={false}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      content={
        <div style={{ width: 360 }} onMouseDown={(e) => e.stopPropagation()}>
          <Input.TextArea
            autoFocus
            value={text}
            autoSize={{ minRows: 4, maxRows: 14 }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onCommit(text.replace(/^\s+|\s+$/g, "") || null, "down");
              }
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 8 }}>
            <span style={{ fontSize: 11.5, opacity: 0.6 }}>⌘/Ctrl + Enter to save</span>
            <span style={{ display: "flex", gap: 6 }}>
              <Button size="small" onClick={onCancel}>
                Cancel
              </Button>
              <Button size="small" type="primary" onClick={() => onCommit(text.replace(/^\s+|\s+$/g, "") || null, "none")}>
                Save
              </Button>
            </span>
          </div>
        </div>
      }
    >
      <div style={{ width: "100%", height: 30 }} />
    </Popover>
  );
}

function DateEditor({ column, value, onCommit, onCancel }: EditorProps) {
  const isDateTime = column.type === "datetime";
  const initial = isEmptyValue(value)
    ? null
    : isDateTime
      ? dayjs(String(value))
      : dayjs(String(value), "YYYY-MM-DD", true);
  return (
    <DatePicker
      autoFocus
      open
      size="small"
      showTime={isDateTime ? { format: "HH:mm", minuteStep: 5 } : false}
      format={isDateTime ? "D MMM YYYY, HH:mm" : "D MMM YYYY"}
      defaultValue={initial?.isValid() ? initial : null}
      needConfirm={isDateTime}
      onChange={(d) => {
        const next = d ? (isDateTime ? d.toISOString() : d.format("YYYY-MM-DD")) : null;
        onCommit(next, "none");
      }}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
      }}
      style={EDITOR_STYLE}
    />
  );
}

function SelectEditor({ column, value, ctx, onCommit, onCancel }: EditorProps) {
  const multiple = column.type === "multi_select";
  const [draft, setDraft] = useState<string[]>(() =>
    Array.isArray(value) ? value.map(String) : isEmptyValue(value) ? [] : [String(value)],
  );
  const options = (ctx.options ?? []).map((o) => ({
    value: o.value,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {o.color ? <span style={{ width: 8, height: 8, borderRadius: 999, background: o.color }} /> : null}
        {o.label}
      </span>
    ),
    title: o.label,
  }));
  return (
    // The wrapper is here for the capture handler: rc-select claims Tab while
    // its dropdown is open (it toggles the highlighted option and calls
    // preventDefault), so a multi-select cell had no keyboard way out at all —
    // Tab neither saved nor moved, and the picks were lost unless the user
    // happened to click somewhere else. Catching Tab on the way down makes it
    // behave the way a spreadsheet does: save and step sideways. Enter is left
    // to rc-select, so arrows + Enter still pick options.
    <div
      style={{ width: "100%" }}
      onKeyDownCapture={(e) => {
        if (!multiple || e.key !== "Tab") return;
        e.preventDefault();
        e.stopPropagation();
        onCommit(draft, e.shiftKey ? "left" : "right");
      }}
    >
      <Select
        autoFocus
        defaultOpen
        size="small"
        showSearch
        allowClear
        mode={multiple ? "multiple" : undefined}
        value={multiple ? draft : (draft[0] ?? undefined)}
        options={options}
        maxTagCount="responsive"
        optionFilterProp="title"
        notFoundContent={<span style={{ fontSize: 12 }}>No options — add them in the column settings.</span>}
        onChange={(v) => {
          if (multiple) {
            setDraft((v as string[]) ?? []);
          } else {
            onCommit((v as string | undefined) ?? null, "none");
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            if (multiple) onCommit(draft, "none");
            else onCancel();
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
        }}
        style={EDITOR_STYLE}
        popupMatchSelectWidth={false}
      />
    </div>
  );
}

function PersonEditor({ column, value, memberOptions, onCommit, onCancel }: EditorProps) {
  const multiple = column.type === "people";
  const [draft, setDraft] = useState<string[]>(() =>
    Array.isArray(value) ? value.map(String) : isEmptyValue(value) ? [] : [String(value)],
  );
  return (
    <Popover
      open
      trigger={[]}
      placement="bottomLeft"
      arrow={false}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      content={
        <div
          style={{ width: 300, display: "grid", gap: 8 }}
          onMouseDown={(e) => e.stopPropagation()}
          // Same as the multi-select above: the member picker's dropdown eats
          // Tab, so take it first and treat it as "save and move on".
          onKeyDownCapture={(e) => {
            if (!multiple || e.key !== "Tab") return;
            e.preventDefault();
            e.stopPropagation();
            onCommit(draft, e.shiftKey ? "left" : "right");
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onCancel();
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>{column.label}</div>
          {multiple ? (
            <MemberSelect value={draft} onChange={setDraft} options={memberOptions} popupInParent placeholder="Add people" />
          ) : (
            <MemberSingleSelect
              value={draft[0] ?? null}
              onChange={(v) => onCommit(v ?? null, "none")}
              options={memberOptions}
              placeholder="Choose a person"
            />
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <Button size="small" onClick={onCancel}>
              Cancel
            </Button>
            {multiple ? (
              <Button size="small" type="primary" onClick={() => onCommit(draft, "none")}>
                Save
              </Button>
            ) : (
              <Button size="small" onClick={() => onCommit(null, "none")} disabled={draft.length === 0}>
                Clear
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={{ width: "100%", height: 30 }} />
    </Popover>
  );
}

/**
 * Picks the editor for a column type. Checkboxes never get one (they toggle).
 * The grid's onCommit drops a value equal to the current one, so an editor
 * may always commit.
 */
export function CellEditor(props: EditorProps) {
  switch (props.column.type) {
    case "long_text":
      return <LongTextEditor {...props} />;
    case "date":
    case "datetime":
      return <DateEditor {...props} />;
    case "select":
    case "multi_select":
      return <SelectEditor {...props} />;
    case "person":
    case "people":
      return <PersonEditor {...props} />;
    case "checkbox":
      return null;
    default:
      return <TextEditor {...props} />;
  }
}
