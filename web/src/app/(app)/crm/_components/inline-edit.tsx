"use client";

/**
 * Inline field editors — the controls the record drawer's Overview is built
 * from.
 *
 * The rule they all share: a field reads as *text* until you touch it. Opening
 * a lead to fix a phone number or move a stage shouldn't mean leaving the
 * drawer for a list page, but an Overview rendered as twenty input boxes stops
 * being a summary. So at rest each control is the value in the drawer's normal
 * 13px ink (a muted em dash when empty) with a hover tint and a pencil beside
 * it; click the value — or the pencil — and a real editor swaps in.
 *
 * The pencil is a genuine `<button>`, not the whole row dressed up as one:
 * several of these fields hold a `tel:` link, a copy button or a URL, and a
 * `role="button"` wrapper would swallow their clicks, eat Enter/Space and hide
 * them from the accessibility tree. Keeping the wrapper inert means the link
 * still dials, the copy button still copies, and there is exactly one tab stop
 * per field: the pencil.
 *
 * Behaviour is identical across every control:
 *  - text/number commit on blur and on Enter; Escape cancels and restores,
 *  - selects and dates commit on change and close; booleans flip on one click,
 *  - nothing is written when the value didn't actually change,
 *  - the written value stays on screen (with a small Spin) until the write has
 *    landed AND the record's query has caught up; a failed write restores the
 *    old value and toasts.
 *
 * `onSave` returns a Promise: the control owns pending/error state, the caller
 * owns the mutation. It must not resolve until the write is proven — the
 * update hooks in `@/features/app-crm` select the row back and await their own
 * invalidation, which is what lets the optimistic hold be released safely.
 *
 * Clicks and keystrokes are swallowed the way `LeadStatusPicker` swallows
 * them, so a row underneath (which usually opens a drawer) stays put — and so
 * that Escape cancels the edit instead of closing the Drawer around it.
 */

import { createContext, useContext, useRef, useState } from "react";
import { App, DatePicker, Input, InputNumber, Select, Spin, theme } from "antd";
import dayjs from "dayjs";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { crmDate } from "../_lib/ui";

const DEFAULT_ERROR = "Couldn't save that change.";

/* ------------------------------------------------------------------ *
 * Read-only scope
 * ------------------------------------------------------------------ */

const InlineEditReadOnlyContext = createContext(false);

/**
 * Marks a whole block of inline controls read-only — a soft-deleted record
 * shows its values, it does not offer to edit them. Wraps the Overview once
 * instead of threading a flag through every field.
 */
export function InlineEditScope({
  readOnly = false,
  children,
}: {
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <InlineEditReadOnlyContext.Provider value={readOnly}>
      {children}
    </InlineEditReadOnlyContext.Provider>
  );
}

function useInlineReadOnly(override?: boolean): boolean {
  const scoped = useContext(InlineEditReadOnlyContext);
  return override ?? scoped;
}

/** The muted em dash an empty field renders. Exported for `renderValue`. */
export function InlineEmpty() {
  const { token } = theme.useToken();
  return <span style={{ color: token.colorTextQuaternary }}>—</span>;
}

/* ------------------------------------------------------------------ *
 * Shared props + save state
 * ------------------------------------------------------------------ */

type InlineCommon<T> = {
  /** Accessible name for the resting value ("Stage", "Mobile number"). */
  label?: string;
  /**
   * Rest-state rendering when the plain value isn't rich enough — a stage's
   * coloured chip, a phone's call link, a URL. Called with the value currently
   * on screen (the optimistic one while a write is in flight).
   */
  renderValue?: (value: T) => React.ReactNode;
  /** Fallback text for the failure toast. */
  errorText?: string;
  /** Force read-only; otherwise inherited from `InlineEditScope`. */
  readOnly?: boolean;
};

/**
 * Optimistic value + pending/error state for one field.
 *
 * The written value is held on screen so the field never flashes back to the
 * old one in the gap between the write resolving and the query refetching. The
 * hold is released when the *last* in-flight write for this field settles —
 * `onSave` only resolves once the record's query has been refetched, so by then
 * the incoming prop already carries the stored value. Releasing on settle
 * rather than "when the prop happens to change" is what stops a write that
 * silently changed nothing from stranding a phantom value on screen forever.
 */
function useInlineSave<T>(
  value: T,
  onSave: (next: T) => Promise<void>,
  errorText: string,
) {
  const { message } = App.useApp();
  const [optimistic, setOptimistic] = useState<{ value: T } | null>(null);
  const [seen, setSeen] = useState(value);
  const [saving, setSaving] = useState(false);
  /** Overlapping commits: only the last one out clears the spinner + hold. */
  const inFlight = useRef(0);

  // The incoming prop moved — the refetch landed, or someone else edited the
  // record — so it wins and the value we were holding is dropped. Adjusting
  // state during render is React's own answer here: an effect would paint the
  // stale value once before correcting it.
  if (!Object.is(seen, value)) {
    setSeen(value);
    setOptimistic(null);
  }

  const shown = optimistic ? optimistic.value : value;

  const commit = async (next: T) => {
    // Nothing commits when the value is unchanged.
    if (Object.is(next, shown)) return;
    setOptimistic({ value: next });
    inFlight.current += 1;
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      message.error(errMsg(err, errorText));
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        setSaving(false);
        setOptimistic(null);
      }
    }
  };

  return { shown, saving, commit };
}

/* ------------------------------------------------------------------ *
 * Resting shell
 * ------------------------------------------------------------------ */

/** antd's `size="small"` control height — the shell matches it, so opening an
 *  editor doesn't grow the row. */
const SHELL_HEIGHT = 24;

/**
 * The rest state every control shares: the value, a hover tint, and a real
 * pencil button (space always reserved, revealed on hover/focus) that opens
 * the editor. The Spin replaces the pencil while a write is in flight.
 *
 * The wrapper is deliberately inert — no `role`, no `tabIndex`, no key
 * handling. Fields whose value is a link or a copy button need those events to
 * reach the link, and a `role="button"` around interactive content hides it
 * from screen readers entirely.
 */
function InlineShell({
  children,
  saving,
  readOnly,
  label,
  valueText,
  action = "edit",
  pressed,
  onActivate,
}: {
  children: React.ReactNode;
  saving: boolean;
  readOnly: boolean;
  label?: string;
  /** The value as words, so the button announces what it acts on. */
  valueText?: string;
  /** "edit" opens an editor; "toggle" flips a boolean in one click. */
  action?: "edit" | "toggle";
  /** Current state of a `toggle` field, announced as `aria-pressed`. */
  pressed?: boolean;
  onActivate: () => void;
}) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [buttonFocused, setButtonFocused] = useState(false);
  const lit = hover || focused;

  if (readOnly) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          maxWidth: "100%",
          minWidth: 0,
          minHeight: SHELL_HEIGHT,
        }}
      >
        {children}
      </span>
    );
  }

  const name = label ?? "value";
  const spoken = valueText || "empty";

  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={(e) => {
        // A nested link or button (the `tel:` link, the copy button, the
        // pencil itself) owns its own click — only bare value text activates
        // the field.
        if ((e.target as HTMLElement).closest?.("a,button")) return;
        e.stopPropagation();
        onActivate();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
        minWidth: 0,
        minHeight: SHELL_HEIGHT,
        padding: "0 6px",
        margin: "0 -6px",
        borderRadius: 6,
        cursor: "pointer",
        background: lit ? token.colorFillTertiary : "transparent",
        transition: "background-color .12s ease",
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {children}
      </span>
      {saving ? (
        <span
          style={{
            flex: "none",
            width: 18,
            display: "inline-flex",
            justifyContent: "center",
          }}
        >
          <Spin size="small" />
        </span>
      ) : (
        <button
          type="button"
          aria-label={
            action === "toggle"
              ? `${name}, currently ${spoken}. Toggle.`
              : `Edit ${name}, currently ${spoken}`
          }
          aria-pressed={action === "toggle" ? Boolean(pressed) : undefined}
          onFocus={() => setButtonFocused(true)}
          onBlur={() => setButtonFocused(false)}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onActivate();
          }}
          style={{
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            padding: 0,
            border: "none",
            borderRadius: 5,
            background: buttonFocused ? token.colorFillSecondary : "transparent",
            color: token.colorTextTertiary,
            cursor: "pointer",
            // Reserved space always; ink only on hover or focus, so the
            // Overview still reads as text rather than as a form.
            opacity: lit ? 1 : 0,
            // globals.css suppresses outlines project-wide, so the ring is
            // painted here — from tokens, so it works in both themes.
            boxShadow: buttonFocused
              ? `0 0 0 2px ${token.colorPrimaryBorder}`
              : undefined,
            transition: "opacity .12s ease",
          }}
        >
          <MIcon
            name={
              action === "toggle"
                ? pressed
                  ? "toggle_on"
                  : "toggle_off"
                : "edit"
            }
            size={14}
          />
        </button>
      )}
    </span>
  );
}

/**
 * Wraps a live editor so clicks and keystrokes never reach the row or the
 * Drawer, and so Escape cancels the edit. Every control routes its Escape
 * through here — rc-drawer's own ESC handler is a React `onKeyDown` on the
 * panel above us, so stopping propagation at this one place is what keeps
 * Escape from closing the whole Drawer.
 */
function EditorShell({
  onCancel,
  children,
}: {
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{ display: "block", minWidth: 0 }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
      }}
    >
      {children}
    </span>
  );
}

const EDITOR_FONT: React.CSSProperties = { fontSize: 13, width: "100%" };

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

export function InlineText({
  value,
  placeholder,
  onSave,
  inputMode,
  maxLength,
  required = false,
  validate,
  label,
  renderValue,
  errorText = DEFAULT_ERROR,
  readOnly,
}: InlineCommon<string> & {
  value: string | null | undefined;
  placeholder?: string;
  /** Receives the trimmed string — the caller maps "" to null if it needs to. */
  onSave: (next: string) => Promise<void>;
  inputMode?: "text" | "tel" | "email" | "url" | "numeric";
  maxLength?: number;
  /** Blanking the field cancels instead of writing (a record's own name). */
  required?: boolean;
  /**
   * Shape check on the trimmed draft — return a message to reject the write.
   * The modal forms validate email and URL fields; editing in place must not
   * be the loophole that lets a malformed one through.
   */
  validate?: (next: string) => string | null;
}) {
  const { message } = App.useApp();
  const ro = useInlineReadOnly(readOnly);
  const { shown, saving, commit } = useInlineSave<string>(
    value ?? "",
    onSave,
    errorText,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  /** Set by Escape so the blur that follows doesn't write the draft anyway. */
  const cancelled = useRef(false);

  const open = () => {
    setDraft(shown);
    cancelled.current = false;
    setEditing(true);
  };

  const cancel = () => {
    cancelled.current = true;
    setEditing(false);
  };

  const finish = () => {
    setEditing(false);
    if (cancelled.current) return;
    const next = draft.trim();
    // A required field left blank restores — and says so, rather than quietly
    // undoing what the user just typed.
    if (required && !next) {
      message.error(`${label ?? "This field"} can't be empty.`);
      return;
    }
    // Trimmed against trimmed: a stored value carrying stray whitespace must
    // not re-write (and log a timeline row) on every open-and-blur.
    if (next === shown.trim()) return;
    const problem = validate?.(next) ?? null;
    if (problem) {
      message.error(problem);
      return;
    }
    void commit(next);
  };

  if (editing && !ro) {
    return (
      <EditorShell onCancel={cancel}>
        <Input
          autoFocus
          size="small"
          value={draft}
          maxLength={maxLength}
          inputMode={inputMode}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish();
            }
          }}
          style={EDITOR_FONT}
        />
      </EditorShell>
    );
  }

  return (
    <InlineShell
      saving={saving}
      readOnly={ro}
      label={label}
      valueText={shown}
      onActivate={open}
    >
      {renderValue ? (
        renderValue(shown)
      ) : shown ? (
        <span>{shown}</span>
      ) : (
        <InlineEmpty />
      )}
    </InlineShell>
  );
}

/* ------------------------------------------------------------------ *
 * Select
 * ------------------------------------------------------------------ */

export type InlineOption = { value: string; label: string };

export function InlineSelect({
  value,
  options,
  onSave,
  placeholder,
  allowClear = false,
  showSearch = true,
  label,
  renderValue,
  errorText = DEFAULT_ERROR,
  readOnly,
}: InlineCommon<string | null> & {
  value: string | null | undefined;
  options: InlineOption[];
  onSave: (next: string | null) => Promise<void>;
  placeholder?: string;
  allowClear?: boolean;
  showSearch?: boolean;
}) {
  const ro = useInlineReadOnly(readOnly);
  const { shown, saving, commit } = useInlineSave<string | null>(
    value ?? null,
    onSave,
    errorText,
  );
  const [editing, setEditing] = useState(false);

  if (editing && !ro) {
    return (
      <EditorShell onCancel={() => setEditing(false)}>
        <Select
          autoFocus
          defaultOpen
          size="small"
          value={shown}
          options={options}
          placeholder={placeholder}
          allowClear={allowClear}
          showSearch={showSearch}
          optionFilterProp="label"
          style={{ ...EDITOR_FONT, minWidth: 140 }}
          // antd hands back `undefined` (not null) when the value is cleared.
          onChange={(next: string | null | undefined) => {
            setEditing(false);
            void commit(next ?? null);
          }}
          onBlur={() => setEditing(false)}
        />
      </EditorShell>
    );
  }

  const current = shown
    ? options.find((o) => o.value === shown)?.label ?? null
    : null;

  return (
    <InlineShell
      saving={saving}
      readOnly={ro}
      label={label}
      valueText={current ?? ""}
      onActivate={() => setEditing(true)}
    >
      {renderValue ? (
        renderValue(shown)
      ) : current ? (
        <span>{current}</span>
      ) : (
        <InlineEmpty />
      )}
    </InlineShell>
  );
}

/* ------------------------------------------------------------------ *
 * Date
 * ------------------------------------------------------------------ */

/** Sanity bounds for a hand-typed date — a close date in 1823 is a typo, not
 *  a plan. Wide enough that no real CRM date is refused. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/** Value and `onSave` are plain `YYYY-MM-DD` — the shape the DB columns hold. */
export function InlineDate({
  value,
  onSave,
  placeholder,
  label,
  renderValue,
  errorText = DEFAULT_ERROR,
  readOnly,
}: InlineCommon<string | null> & {
  value: string | null | undefined;
  onSave: (next: string | null) => Promise<void>;
  placeholder?: string;
}) {
  const ro = useInlineReadOnly(readOnly);
  const { shown, saving, commit } = useInlineSave<string | null>(
    value ?? null,
    onSave,
    errorText,
  );
  const [editing, setEditing] = useState(false);

  // A stored value that doesn't parse is treated as absent rather than shown
  // as "Invalid Date" in the picker or as an undimmed em dash at rest.
  const parsed = shown ? dayjs(shown) : null;
  const valid = parsed && parsed.isValid() ? parsed : null;

  if (editing && !ro) {
    return (
      <EditorShell onCancel={() => setEditing(false)}>
        <DatePicker
          autoFocus
          open
          allowClear
          size="small"
          value={valid}
          format="DD MMM YYYY"
          placeholder={placeholder}
          style={EDITOR_FONT}
          disabledDate={(d) => d.year() < MIN_YEAR || d.year() > MAX_YEAR}
          onChange={(next) => {
            setEditing(false);
            void commit(next ? next.format("YYYY-MM-DD") : null);
          }}
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
        />
      </EditorShell>
    );
  }

  return (
    <InlineShell
      saving={saving}
      readOnly={ro}
      label={label}
      valueText={valid ? crmDate(shown) : ""}
      onActivate={() => setEditing(true)}
    >
      {renderValue ? (
        renderValue(shown)
      ) : valid ? (
        <span>{crmDate(shown)}</span>
      ) : (
        <InlineEmpty />
      )}
    </InlineShell>
  );
}

/* ------------------------------------------------------------------ *
 * Number
 * ------------------------------------------------------------------ */

export function InlineNumber({
  value,
  onSave,
  min,
  precision,
  placeholder,
  label,
  renderValue,
  errorText = DEFAULT_ERROR,
  readOnly,
}: InlineCommon<number | null> & {
  value: number | null | undefined;
  onSave: (next: number | null) => Promise<void>;
  min?: number;
  /** Decimals allowed. Pass 0 for a column typed `integer`. */
  precision?: number;
  placeholder?: string;
}) {
  const ro = useInlineReadOnly(readOnly);
  const { shown, saving, commit } = useInlineSave<number | null>(
    value ?? null,
    onSave,
    errorText,
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(null);
  const cancelled = useRef(false);

  const open = () => {
    setDraft(shown);
    cancelled.current = false;
    setEditing(true);
  };

  /**
   * `min` and `precision` are enforced here, not left to the input.
   * rc-input-number clamps on its wrapper's blur, which fires *after* the
   * `onBlur` we hand to the inner `<input>` — so without this, tabbing out of
   * "-5" writes -5 while the box snaps to 0, and "12.5" reaches an `integer`
   * column as a Postgres cast error.
   */
  const normalize = (next: number | null): number | null => {
    if (next === null || !Number.isFinite(next)) return null;
    const rounded =
      precision === undefined ? next : Number(next.toFixed(precision));
    return min === undefined ? rounded : Math.max(min, rounded);
  };

  const cancel = () => {
    cancelled.current = true;
    setEditing(false);
  };

  const finish = () => {
    setEditing(false);
    if (cancelled.current) return;
    void commit(normalize(draft));
  };

  if (editing && !ro) {
    return (
      <EditorShell onCancel={cancel}>
        <InputNumber
          autoFocus
          size="small"
          value={draft}
          min={min}
          precision={precision}
          step={precision === 0 ? 1 : undefined}
          placeholder={placeholder}
          style={EDITOR_FONT}
          onChange={(next) => setDraft(next)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish();
            }
          }}
        />
      </EditorShell>
    );
  }

  return (
    <InlineShell
      saving={saving}
      readOnly={ro}
      label={label}
      valueText={shown === null ? "" : shown.toLocaleString()}
      onActivate={open}
    >
      {renderValue ? (
        renderValue(shown)
      ) : shown === null ? (
        <InlineEmpty />
      ) : (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {shown.toLocaleString()}
        </span>
      )}
    </InlineShell>
  );
}

/* ------------------------------------------------------------------ *
 * Boolean
 * ------------------------------------------------------------------ */

/**
 * A flag flips on one click — the `LeadStatusPicker` rule that the chip *is*
 * the control. There is no editor to open: two clicks (open a Switch, throw
 * the Switch) to set a boolean is a form pretending to be a field.
 */
export function InlineBool({
  value,
  onSave,
  label,
  renderValue,
  errorText = DEFAULT_ERROR,
  readOnly,
}: InlineCommon<boolean> & {
  value: boolean | null | undefined;
  onSave: (next: boolean) => Promise<void>;
  /** Word shown when the flag is on ("Ideal customer"). */
  label?: string;
}) {
  const ro = useInlineReadOnly(readOnly);
  const { shown, saving, commit } = useInlineSave<boolean>(
    Boolean(value),
    onSave,
    errorText,
  );

  return (
    <InlineShell
      saving={saving}
      readOnly={ro}
      label={label}
      valueText={shown ? "yes" : "no"}
      action="toggle"
      pressed={shown}
      onActivate={() => void commit(!shown)}
    >
      {renderValue ? (
        renderValue(shown)
      ) : shown ? (
        <span>{label ?? "Yes"}</span>
      ) : (
        <InlineEmpty />
      )}
    </InlineShell>
  );
}
