"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { theme } from "antd";
import type { Block, BlockType } from "./use-docs";
import { LinkPreviews, urlAtOffset } from "@/features/links/link-preview";

/* ----------------------------------------------------------- block model */

const BLOCK_MENU: { type: BlockType; label: string; icon: string; hint: string }[] =
  [
    { type: "text", label: "Text", icon: "notes", hint: "Plain paragraph" },
    { type: "h1", label: "Heading 1", icon: "format_h1", hint: "Big section" },
    { type: "h2", label: "Heading 2", icon: "format_h2", hint: "Medium section" },
    { type: "h3", label: "Heading 3", icon: "format_h3", hint: "Small section" },
    { type: "bulleted", label: "Bulleted list", icon: "format_list_bulleted", hint: "• item" },
    { type: "numbered", label: "Numbered list", icon: "format_list_numbered", hint: "1. item" },
    { type: "todo", label: "To-do", icon: "check_box", hint: "Checklist item" },
    { type: "quote", label: "Quote", icon: "format_quote", hint: "Callout quote" },
    { type: "code", label: "Code", icon: "code", hint: "Monospace block" },
    { type: "divider", label: "Divider", icon: "horizontal_rule", hint: "Separator line" },
  ];

function newId(): string {
  // Globally unique so a block created after a reload can never collide with an
  // id already persisted in the page's content.
  return crypto.randomUUID();
}

export function emptyDoc(): Block[] {
  return [{ id: newId(), type: "text", text: "" }];
}

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

/* -------------------------------------------------------- caret helpers */

function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function placeCaret(el: HTMLElement, pos: "start" | "end" | number) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const textNode = el.firstChild;
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    const len = textNode.textContent?.length ?? 0;
    const offset =
      pos === "start"
        ? 0
        : pos === "end"
          ? len
          : Math.min(Math.max(pos, 0), len);
    range.setStart(textNode, offset);
  } else {
    range.selectNodeContents(el);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ------------------------------------------------------------- one block */

const TEXT_STYLE: Record<BlockType, React.CSSProperties> = {
  text: { fontSize: 15, lineHeight: 1.65 },
  h1: { fontSize: 28, fontWeight: 800, lineHeight: 1.3, marginTop: 8 },
  h2: { fontSize: 22, fontWeight: 700, lineHeight: 1.35, marginTop: 6 },
  h3: { fontSize: 18, fontWeight: 700, lineHeight: 1.4 },
  bulleted: { fontSize: 15, lineHeight: 1.65 },
  numbered: { fontSize: 15, lineHeight: 1.65 },
  todo: { fontSize: 15, lineHeight: 1.65 },
  quote: { fontSize: 15, lineHeight: 1.65, fontStyle: "italic" },
  code: { fontSize: 13.5, lineHeight: 1.6, fontFamily: "var(--font-geist-mono), ui-monospace, monospace" },
  divider: {},
};

function placeholderFor(type: BlockType): string {
  switch (type) {
    case "h1":
    case "h2":
    case "h3":
      return "Heading";
    case "bulleted":
    case "numbered":
      return "List item";
    case "todo":
      return "To-do";
    case "quote":
      return "Quote";
    case "code":
      return "Code";
    default:
      return "Type '/' for commands";
  }
}

interface BlockRowProps {
  block: Block;
  index: number;
  numberLabel?: number;
  editable: boolean;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onInput: (id: string, text: string) => void;
  onEnter: (id: string) => void;
  onBackspaceAtStart: (id: string) => void;
  onSlash: (id: string, el: HTMLDivElement) => void;
  onToggleTodo: (id: string) => void;
  slashOpen: boolean;
  onSlashNav: (dir: 1 | -1) => void;
  onSlashPick: () => void;
  onSlashClose: () => void;
}

function BlockRow({
  block,
  numberLabel,
  editable,
  registerRef,
  onInput,
  onEnter,
  onBackspaceAtStart,
  onSlash,
  onToggleTodo,
  slashOpen,
  onSlashNav,
  onSlashPick,
  onSlashClose,
}: BlockRowProps) {
  const { token } = theme.useToken();
  const ref = useRef<HTMLDivElement | null>(null);

  // Seed the DOM text ONCE (on mount). Never write it back on re-render, or the
  // caret would jump while typing — React owns structure, the DOM owns text.
  useLayoutEffect(() => {
    if (ref.current && ref.current.textContent !== block.text) {
      ref.current.textContent = block.text;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (block.type === "divider") {
    return (
      <div
        ref={(el) => {
          ref.current = el;
          registerRef(block.id, el);
        }}
        data-block-id={block.id}
        style={{ padding: "10px 0" }}
      >
        <div style={{ height: 1, background: token.colorBorderSecondary }} />
      </div>
    );
  }

  // Links are unfurled BELOW the block, outside contentEditable — putting
  // anchors in the text itself would fight the "DOM owns the text" model the
  // caret depends on.
  const hasLink = /(?:https?:\/\/|www\.)\S/i.test(block.text);
  const previews =
    hasLink && block.type !== "code" ? <LinkPreviews text={block.text} max={2} compact /> : null;

  const editableEl = (
    <div
      ref={(el) => {
        ref.current = el;
        registerRef(block.id, el);
      }}
      contentEditable={editable}
      suppressContentEditableWarning
      data-block-id={block.id}
      data-placeholder={placeholderFor(block.type)}
      onInput={(e) => onInput(block.id, e.currentTarget.textContent ?? "")}
      title={
        hasLink
          ? `${navigator?.platform?.includes("Mac") ? "⌘" : "Ctrl"}+click a link to open it`
          : undefined
      }
      onClick={(e) => {
        // Only on the modifier: a plain click has to keep placing the caret,
        // or a typo inside a URL could never be fixed.
        if (!e.metaKey && !e.ctrlKey) return;
        const text = e.currentTarget.textContent ?? "";
        const url = urlAtOffset(text, caretOffset(e.currentTarget));
        if (url) {
          e.preventDefault();
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }}
      onKeyDown={(e) => {
        // While the slash menu is open it owns Arrow/Enter/Escape so they
        // navigate/pick/dismiss instead of splitting the block.
        if (slashOpen) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onSlashNav(1);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onSlashNav(-1);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onSlashPick();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onSlashClose();
            return;
          }
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter(block.id);
        } else if (e.key === "Backspace") {
          const el = e.currentTarget;
          if (caretOffset(el) === 0 && window.getSelection()?.isCollapsed) {
            e.preventDefault();
            onBackspaceAtStart(block.id);
          }
        } else if (e.key === "/") {
          // Defer so the "/" is in the DOM when the menu reads the query.
          const el = e.currentTarget;
          window.setTimeout(() => onSlash(block.id, el), 0);
        }
      }}
      className="wl-doc-block"
      style={{
        outline: "none",
        minHeight: "1.6em",
        color: token.colorText,
        textDecoration:
          block.type === "todo" && block.checked ? "line-through" : "none",
        opacity: block.type === "todo" && block.checked ? 0.6 : 1,
        ...TEXT_STYLE[block.type],
      }}
    />
  );

  // Wrap with the per-type affordance (bullet / number / checkbox / quote bar).
  if (block.type === "bulleted") {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "1px 0" }}>
        <span style={{ lineHeight: "1.65", fontSize: 15, color: token.colorText, userSelect: "none" }}>•</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editableEl}
          {previews}
        </div>
      </div>
    );
  }
  if (block.type === "numbered") {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "1px 0" }}>
        <span style={{ lineHeight: "1.65", fontSize: 15, color: token.colorTextSecondary, userSelect: "none", minWidth: 18 }}>
          {numberLabel ?? 1}.
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editableEl}
          {previews}
        </div>
      </div>
    );
  }
  if (block.type === "todo") {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "2px 0" }}>
        <input
          type="checkbox"
          checked={Boolean(block.checked)}
          onChange={() => onToggleTodo(block.id)}
          style={{ marginTop: 5, cursor: "pointer", flex: "none" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editableEl}
          {previews}
        </div>
      </div>
    );
  }
  if (block.type === "quote") {
    return (
      <div
        style={{
          borderLeft: `3px solid ${token.colorPrimary}`,
          paddingLeft: 12,
          color: token.colorTextSecondary,
        }}
      >
        {editableEl}
        {previews}
      </div>
    );
  }
  if (block.type === "code") {
    return (
      <div
        style={{
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 8,
          padding: "10px 12px",
        }}
      >
        {editableEl}
      </div>
    );
  }
  return (
    <div style={{ padding: "1px 0" }}>
      {editableEl}
      {previews}
    </div>
  );
}

/* --------------------------------------------------------- slash popup */

/** The block menu filtered by the query typed after "/". Shared by the popup
 *  and the keyboard-pick handler so highlight and selection never disagree. */
function filterBlockMenu(query: string): typeof BLOCK_MENU {
  const q = query.trim().toLowerCase();
  return BLOCK_MENU.filter(
    (b) => !q || b.label.toLowerCase().includes(q) || b.type.includes(q),
  );
}

function SlashMenu({
  items,
  active,
  onPick,
  position,
}: {
  items: typeof BLOCK_MENU;
  active: number;
  onPick: (type: BlockType) => void;
  position: { top: number; left: number };
}) {
  const { token } = theme.useToken();
  if (items.length === 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        zIndex: 50,
        width: 260,
        maxHeight: 300,
        overflowY: "auto",
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        boxShadow: token.boxShadowSecondary,
        padding: 6,
      }}
    >
      {items.map((it, i) => {
        const on = i === active % items.length;
        return (
          <button
            key={it.type}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it.type);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "7px 8px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              background: on ? token.controlItemBgActive : "transparent",
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 7,
                background: token.colorFillTertiary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                color: token.colorTextSecondary,
              }}
            >
              <MIcon name={it.icon} size={18} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
                {it.label}
              </span>
              <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>{it.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- the editor */

export function BlockEditor({
  value,
  onChange,
  editable = true,
}: {
  value: Block[];
  onChange: (blocks: Block[]) => void;
  editable?: boolean;
}) {
  const { token } = theme.useToken();
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());
  // A queued caret target applied imperatively after the next render. A ref (not
  // state) so structural handlers don't schedule an extra state round-trip.
  // `pos` may be a numeric offset (e.g. the merge seam on Backspace).
  const pendingFocusRef = useRef<
    { id: string; pos: "start" | "end" | number } | null
  >(null);
  const setPendingFocus = (
    v: { id: string; pos: "start" | "end" | number } | null,
  ) => {
    pendingFocusRef.current = v;
  };
  // Stable empty fallback so an empty page doesn't churn a new block id (and
  // remount/steal focus) on every render before the first keystroke.
  const emptyFallback = useMemo(() => emptyDoc(), []);
  const [slash, setSlash] = useState<
    { blockId: string; query: string; active: number; top: number; left: number } | null
  >(null);

  const blocks = value.length > 0 ? value : emptyFallback;
  // Running numbers for consecutive numbered blocks (computed, not mutated in
  // the render body).
  const numberLabels = useMemo(() => {
    const map = new Map<string, number>();
    let run = 0;
    for (const b of blocks) {
      if (b.type === "numbered") {
        run += 1;
        map.set(b.id, run);
      } else {
        run = 0;
      }
    }
    return map;
  }, [blocks]);

  const registerRef = (id: string, el: HTMLDivElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };

  // Apply a queued focus after structural changes have rendered (runs after
  // every render; only acts when a focus was queued).
  useEffect(() => {
    const pf = pendingFocusRef.current;
    if (!pf) return;
    const el = refs.current.get(pf.id);
    if (el) placeCaret(el, pf.pos);
    pendingFocusRef.current = null;
  });

  const commit = (next: Block[]) => onChange(next);

  const setText = (id: string, text: string) => {
    // Keep state in sync for saving without re-seeding the DOM (caret-safe).
    const next = blocks.map((b) => (b.id === id ? { ...b, text } : b));
    // If a slash menu is open, update its query from the text after the last "/".
    if (slash && slash.blockId === id) {
      const idx = text.lastIndexOf("/");
      if (idx === -1) setSlash(null);
      else setSlash({ ...slash, query: text.slice(idx + 1), active: 0 });
    }
    commit(next);
  };

  const indexOf = (id: string) => blocks.findIndex((b) => b.id === id);

  const handleEnter = (id: string) => {
    const el = refs.current.get(id);
    const i = indexOf(id);
    if (i === -1) return;
    const full = el?.textContent ?? blocks[i].text;
    const offset = el ? caretOffset(el) : full.length;
    const before = full.slice(0, offset);
    const after = full.slice(offset);
    const cur = blocks[i];
    // Continue list/todo types on Enter; everything else starts a plain block.
    const contType: BlockType =
      cur.type === "bulleted" || cur.type === "numbered" || cur.type === "todo"
        ? cur.type
        : "text";
    // Enter on an empty list/todo item ends the list instead of nesting deeper.
    if (
      (cur.type === "bulleted" || cur.type === "numbered" || cur.type === "todo") &&
      full.trim() === ""
    ) {
      const next = blocks.map((b) => (b.id === id ? { ...b, type: "text" as BlockType, text: "" } : b));
      if (el) el.textContent = "";
      commit(next);
      setPendingFocus({ id, pos: "start" });
      return;
    }
    const newBlock: Block = { id: newId(), type: contType, text: after };
    const next = [...blocks];
    next[i] = { ...cur, text: before };
    next.splice(i + 1, 0, newBlock);
    if (el) el.textContent = before; // reflect the split on the current block
    commit(next);
    setPendingFocus({ id: newBlock.id, pos: "start" });
  };

  const handleBackspaceAtStart = (id: string) => {
    const i = indexOf(id);
    if (i <= 0) {
      // First block: just demote a styled empty block back to text.
      const cur = blocks[i];
      if (cur && cur.type !== "text" && (refs.current.get(id)?.textContent ?? "") === "") {
        const next = blocks.map((b) => (b.id === id ? { ...b, type: "text" as BlockType } : b));
        commit(next);
        setPendingFocus({ id, pos: "start" });
      }
      return;
    }
    const el = refs.current.get(id);
    const curText = el?.textContent ?? blocks[i].text;
    const prev = blocks[i - 1];
    if (prev.type === "divider") {
      // Remove the divider above rather than merging into it.
      const next = blocks.filter((b) => b.id !== prev.id);
      commit(next);
      setPendingFocus({ id, pos: "start" });
      return;
    }
    const prevEl = refs.current.get(prev.id);
    const prevText = prevEl?.textContent ?? prev.text;
    const merged = prevText + curText;
    const next = blocks
      .map((b) => (b.id === prev.id ? { ...b, text: merged } : b))
      .filter((b) => b.id !== id);
    if (prevEl) prevEl.textContent = merged;
    commit(next);
    // Caret at the join seam (end of the original prev text = numeric offset).
    setPendingFocus({ id: prev.id, pos: prevText.length });
  };

  const openSlash = (id: string, el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect();
    const host = el.closest("[data-doc-editor]") as HTMLElement | null;
    const hostRect = host?.getBoundingClientRect() ?? { top: 0, left: 0 };
    setSlash({
      blockId: id,
      query: "",
      active: 0,
      top: rect.bottom - hostRect.top + 4,
      left: rect.left - hostRect.left,
    });
  };

  const pickType = (type: BlockType) => {
    if (!slash) return;
    const id = slash.blockId;
    const el = refs.current.get(id);
    const text = el?.textContent ?? "";
    // Strip the "/query" the user typed to summon the menu.
    const idx = text.lastIndexOf("/");
    const cleaned = idx >= 0 ? text.slice(0, idx) : text;
    if (type === "divider") {
      const i = indexOf(id);
      const next = [...blocks];
      next[i] = { ...next[i], text: cleaned };
      const after: Block = { id: newId(), type: "text", text: "" };
      next.splice(i + 1, 0, { id: newId(), type: "divider", text: "" }, after);
      if (el) el.textContent = cleaned;
      commit(next);
      setSlash(null);
      setPendingFocus({ id: after.id, pos: "start" });
      return;
    }
    const next = blocks.map((b) =>
      b.id === id ? { ...b, type, text: cleaned } : b,
    );
    if (el) el.textContent = cleaned;
    commit(next);
    setSlash(null);
    setPendingFocus({ id, pos: "end" });
  };

  const toggleTodo = (id: string) => {
    commit(blocks.map((b) => (b.id === id ? { ...b, checked: !b.checked } : b)));
  };

  /* slash-menu keyboard control */
  const slashItems = slash ? filterBlockMenu(slash.query) : [];
  const navSlash = (dir: 1 | -1) => {
    setSlash((s) => {
      if (!s) return s;
      const len = filterBlockMenu(s.query).length;
      if (len === 0) return s;
      return { ...s, active: (s.active + dir + len) % len };
    });
  };
  const pickActive = () => {
    if (!slash) return;
    const items = filterBlockMenu(slash.query);
    const it = items[slash.active % (items.length || 1)];
    if (it) pickType(it.type);
    else setSlash(null);
  };
  const closeSlash = () => setSlash(null);

  return (
    <div data-doc-editor style={{ position: "relative" }}>
      {blocks.map((b, i) => {
        return (
          <BlockRow
            key={b.id}
            block={b}
            index={i}
            numberLabel={b.type === "numbered" ? numberLabels.get(b.id) : undefined}
            editable={editable}
            registerRef={registerRef}
            onInput={setText}
            onEnter={handleEnter}
            onBackspaceAtStart={handleBackspaceAtStart}
            onSlash={openSlash}
            onToggleTodo={toggleTodo}
            slashOpen={slash?.blockId === b.id}
            onSlashNav={navSlash}
            onSlashPick={pickActive}
            onSlashClose={closeSlash}
          />
        );
      })}

      {slash ? (
        <SlashMenu
          items={slashItems}
          active={slash.active}
          onPick={pickType}
          position={{ top: slash.top, left: slash.left }}
        />
      ) : null}

      <style>{`
        .wl-doc-block:empty:before {
          content: attr(data-placeholder);
          color: ${token.colorTextQuaternary};
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
