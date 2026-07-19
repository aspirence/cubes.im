"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { App, Avatar, Input, Spin, Tooltip, theme } from "antd";
import { useQuery } from "@tanstack/react-query";
import {
  EditorContent,
  Extension,
  ReactRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import type { Editor, Range } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import ImageExtension from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extensions";
import { Suggestion } from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { MentionMember } from "@/features/team-members/team-mention-input";
import { useUploadInlineImage } from "@/features/storage/use-storage";

const BRAND = "#4a4ad0";
/** Above AntD Modal (z-index ~1000) so popups work inside the create-task modal. */
const POPUP_Z = 1200;
const PLACEHOLDER_TEXT =
  "Describe the task — type / for commands, @ to mention, paste or drop images…";

function MIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {name}
    </span>
  );
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Stored descriptions are HTML. Legacy values (pre-WYSIWYG) were plain
 * text/markdown without tags — hydrate those as plain-text paragraphs.
 */
function toEditorContent(value: string): string {
  if (!value) return "";
  if (value.includes("<")) return value;
  return value
    .split("\n")
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p></p>"))
    .join("");
}

/* --------------------------------------------------- suggestion popups ---- */

type PopupHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

type PopupProps<I, S> = {
  items: I[];
  command: (item: S) => void;
  ref?: React.Ref<PopupHandle>;
};

/** ↑/↓/Enter/Tab keyboard navigation shared by the mention + slash popups. */
function usePopupNav<T>(
  ref: React.Ref<PopupHandle> | undefined,
  items: T[],
  pick: (item: T) => void,
) {
  const [active, setActive] = useState(0);
  // Clamp instead of resetting in an effect: when the filtered list shrinks
  // the highlight stays in bounds without a cascading render.
  const index = items.length > 0 ? Math.min(active, items.length - 1) : 0;
  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setActive((index + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setActive((index - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = items[index];
          if (item) pick(item);
          return true;
        }
        return false;
      },
    }),
    [items, index, pick],
  );
  return { index, setIndex: setActive };
}

function MentionPopup({ items, command, ref }: PopupProps<MentionMember, MentionNodeAttrs>) {
  const pick = useCallback(
    (m: MentionMember) => command({ id: m.id, label: m.name }),
    [command],
  );
  const { index, setIndex } = usePopupNav(ref, items, pick);
  if (items.length === 0) return null;
  return (
    <div className="rd-pop" role="listbox">
      {items.map((m, i) => (
        <button
          key={m.id}
          type="button"
          role="option"
          aria-selected={i === index}
          className={"rd-pop-item" + (i === index ? " is-active" : "")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(m)}
          onMouseEnter={() => setIndex(i)}
        >
          <Avatar size={22} src={m.avatarUrl ?? undefined} style={{ fontSize: 10, flex: "none" }}>
            {initials(m.name)}
          </Avatar>
          <span className="rd-pop-lines">
            <span className="rd-pop-name">{m.name}</span>
            {m.email ? <span className="rd-pop-meta">{m.email}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

type SlashItem = {
  title: string;
  icon: string;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
};

function SlashPopup({ items, command, ref }: PopupProps<SlashItem, SlashItem>) {
  const { index, setIndex } = usePopupNav(ref, items, command);
  if (items.length === 0) return null;
  return (
    <div className="rd-pop" role="listbox">
      {items.map((it, i) => (
        <button
          key={it.title}
          type="button"
          role="option"
          aria-selected={i === index}
          className={"rd-pop-item" + (i === index ? " is-active" : "")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command(it)}
          onMouseEnter={() => setIndex(i)}
        >
          <span className="rd-pop-ic">
            <MIcon name={it.icon} size={15} />
          </span>
          <span className="rd-pop-name">{it.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Fixed-position placement at the suggestion caret rect (no tippy). */
function positionPopup(
  el: HTMLElement,
  clientRect: (() => DOMRect | null) | null | undefined,
) {
  const rect = clientRect?.();
  if (!rect) return;
  el.style.position = "fixed";
  el.style.zIndex = String(POPUP_Z);
  const place = () => {
    const pad = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.left;
    if (left + w > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - pad - w);
    }
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - pad && rect.top - h - 6 > pad) {
      top = rect.top - h - 6; // flip above when there's no room below
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(place);
}

/**
 * Suggestion `render` lifecycle backed by a ReactRenderer appended to
 * document.body — manually positioned, keyboard-forwarded, Esc closes.
 */
function makeSuggestionRender<I, S>(
  Component: (props: PopupProps<I, S>) => React.ReactNode,
): NonNullable<SuggestionOptions<I, S>["render"]> {
  return () => {
    let renderer: ReactRenderer<PopupHandle> | null = null;

    const destroy = () => {
      renderer?.destroy();
      renderer = null;
    };

    return {
      onStart: (props: SuggestionProps<I, S>) => {
        renderer = new ReactRenderer(
          Component as unknown as React.ComponentType<Record<string, unknown>>,
          { props: { ...props }, editor: props.editor },
        ) as unknown as ReactRenderer<PopupHandle>;
        document.body.appendChild(renderer.element);
        positionPopup(renderer.element, props.clientRect);
      },
      onUpdate: (props: SuggestionProps<I, S>) => {
        if (!renderer) return;
        renderer.updateProps({ ...props });
        positionPopup(renderer.element, props.clientRect);
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") {
          destroy();
          return true;
        }
        return renderer?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: destroy,
    };
  };
}

/* ------------------------------------------------------- slash commands --- */

function createSlashExtension(openImagePicker: () => void) {
  const items: SlashItem[] = [
    {
      title: "Heading 1",
      icon: "format_h1",
      keywords: "h1 heading title big",
      run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run(),
    },
    {
      title: "Heading 2",
      icon: "format_h2",
      keywords: "h2 heading subtitle",
      run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
    },
    {
      title: "Heading 3",
      icon: "format_h3",
      keywords: "h3 heading small",
      run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
    },
    {
      title: "Bulleted list",
      icon: "format_list_bulleted",
      keywords: "ul bullet unordered list",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      icon: "format_list_numbered",
      keywords: "ol ordered number list",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
    },
    {
      title: "Checklist",
      icon: "checklist",
      keywords: "todo task check checkbox",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
    },
    {
      title: "Quote",
      icon: "format_quote",
      keywords: "blockquote citation",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
    },
    {
      title: "Code block",
      icon: "code_blocks",
      keywords: "code snippet pre",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
    },
    {
      title: "Table",
      icon: "table",
      keywords: "table grid columns rows",
      run: (e, r) =>
        e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      title: "Divider",
      icon: "horizontal_rule",
      keywords: "hr rule separator divider line",
      run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
    },
    {
      title: "Image",
      icon: "image",
      keywords: "image photo picture upload",
      run: (e, r) => {
        e.chain().focus().deleteRange(r).run();
        openImagePicker();
      },
    },
  ];

  return Extension.create({
    name: "rdSlashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: new PluginKey("rdSlash"),
          char: "/",
          startOfLine: true,
          items: ({ query }) => {
            const q = query.trim().toLowerCase();
            if (!q) return items;
            return items.filter(
              (it) => it.title.toLowerCase().includes(q) || it.keywords.includes(q),
            );
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: makeSuggestionRender<SlashItem, SlashItem>(SlashPopup),
        }),
      ];
    },
  });
}

/* -------------------------------------------------------------- editor ---- */

/**
 * A ClickUp-style WYSIWYG description editor built on TipTap: live rich-text
 * formatting, @-mentions, slash commands, task lists, tables, image uploads
 * (paste / drop / picker) and automatic link-preview cards. Emits HTML;
 * mentions serialize with a literal `@Name` so mention extraction on the
 * stored string keeps working.
 */
export function RichDescription({
  value,
  onChange,
  onCommit,
  minRows = 4,
  maxRows = 16,
  mentionMembers,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  minRows?: number;
  maxRows?: number;
  /** When provided, typing `@` opens the member picker. */
  mentionMembers?: MentionMember[];
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const uploadImage = useUploadInlineImage();
  const [uploading, setUploading] = useState(0);

  // Refs so the (created-once) extensions and editorProps never go stale.
  const membersRef = useRef<MentionMember[]>(mentionMembers ?? []);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const commitTimerRef = useRef<number | null>(null);

  /**
   * Debounced commit for changes made without editor focus (checkbox clicks,
   * image inserts) — those never see a blur.
   */
  const scheduleCommit = () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      onCommitRef.current();
    }, 250);
  };
  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    },
    [],
  );

  /** Uploads image files and inserts them (at `pos` when dropped there). */
  const uploadFiles = async (files: File[], pos: number | null) => {
    const ed = editorRef.current;
    if (!ed || files.length === 0) return;
    setUploading((c) => c + 1);
    try {
      if (pos != null) ed.chain().setTextSelection(pos).run();
      for (const file of files) {
        try {
          const url = await uploadImage.mutateAsync(file);
          ed.chain()
            .focus()
            .insertContent([
              { type: "image", attrs: { src: url, alt: file.name.replace(/\.[^.]+$/, "") } },
            ])
            .run();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Couldn't upload the image.");
        }
      }
      scheduleCommit();
    } finally {
      setUploading((c) => c - 1);
    }
  };
  const uploadFilesRef = useRef(uploadFiles);

  /* ---- link popover (⌘K / toolbar) ---- */
  const rdRef = useRef<HTMLDivElement | null>(null);
  const linkPopRef = useRef<HTMLDivElement | null>(null);
  const [linkPop, setLinkPop] = useState<{ left: number; top: number; url: string } | null>(null);
  const linkPopOpen = linkPop !== null;

  const openLinkPopover = () => {
    const ed = editorRef.current;
    const container = rdRef.current;
    if (!ed || !container) return;
    const crect = container.getBoundingClientRect();
    // Anchor at the caret/selection — there is no toolbar to hang off.
    let left = 8;
    let top = 40;
    try {
      const coords = ed.view.coordsAtPos(ed.state.selection.from);
      left = Math.max(8, Math.min(coords.left - crect.left, crect.width - 328));
      top = coords.bottom - crect.top + 6;
    } catch {
      // fall back to the top-left corner
    }
    const current = (ed.getAttributes("link").href as string | undefined) ?? "";
    setLinkPop({ left, top, url: current });
  };
  const openLinkPopoverRef = useRef(openLinkPopover);

  // Keep the "latest" refs fresh for the closures the editor captured at
  // creation time (extensions, editorProps, events).
  useEffect(() => {
    membersRef.current = mentionMembers ?? [];
    onChangeRef.current = onChange;
    onCommitRef.current = onCommit;
    uploadFilesRef.current = uploadFiles;
    openLinkPopoverRef.current = openLinkPopover;
  });

  useEffect(() => {
    if (!linkPopOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = linkPopRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setLinkPop(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [linkPopOpen]);

  // Created once (useState initializer): the editor only reads extensions at
  // creation. The closures below run on editor events, never during render —
  // they read the "latest" refs above, hence the react-hooks/refs opt-out.
  // eslint-disable-next-line react-hooks/refs -- extension callbacks fire on editor events, not during render
  const [extensions] = useState(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false, // ⌘/Ctrl+click handled in editorProps
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer" },
      },
    }),
    Placeholder.configure({ placeholder: PLACEHOLDER_TEXT }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    ImageExtension.configure({ inline: false, allowBase64: false }),
    Mention.configure({
      HTMLAttributes: { class: "rd-mention" },
      // Serialized output must contain the literal `@Name` text so
      // extractMentionUserIds on the stored string keeps working.
      renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id ?? ""}`,
      renderHTML: ({ options, node }) => [
        "span",
        options.HTMLAttributes,
        `@${node.attrs.label ?? node.attrs.id ?? ""}`,
      ],
      suggestion: {
        char: "@",
        items: ({ query }) => {
          const q = query.trim().toLowerCase();
          const members = membersRef.current;
          const filtered = q
            ? members.filter(
                (m) =>
                  m.name.toLowerCase().includes(q) ||
                  (m.email ?? "").toLowerCase().includes(q),
              )
            : members;
          return filtered.slice(0, 8);
        },
        render: makeSuggestionRender<MentionMember, MentionNodeAttrs>(MentionPopup),
      },
    }),
    createSlashExtension(() => fileInputRef.current?.click()),
  ]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      extensions,
      content: toEditorContent(value),
      editorProps: {
        handleKeyDown: (_view, event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === "k"
          ) {
            event.preventDefault();
            openLinkPopoverRef.current();
            return true;
          }
          return false;
        },
        handleClick: (_view, _pos, event) => {
          if (!(event.metaKey || event.ctrlKey)) return false;
          const target = event.target instanceof Element ? event.target : null;
          const anchor = target?.closest("a[href]");
          const href = anchor?.getAttribute("href");
          if (href) {
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const data = event.clipboardData;
          if (!data) return false;
          const files: File[] = [];
          for (const item of data.items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
              const f = item.getAsFile();
              if (f) files.push(f);
            }
          }
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadFilesRef.current(files, null);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = [...(event.dataTransfer?.files ?? [])].filter((f) =>
            f.type.startsWith("image/"),
          );
          if (files.length === 0) return false;
          event.preventDefault();
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          void uploadFilesRef.current(files, coords?.pos ?? null);
          return true;
        },
      },
      onUpdate: ({ editor: e }) => {
        const html = e.isEmpty ? "" : e.getHTML();
        lastEmittedRef.current = html;
        onChangeRef.current(html);
        if (!e.isFocused) scheduleCommit();
      },
      onBlur: () => {
        onCommitRef.current();
      },
    },
    [],
  );
  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  // Hydrate from `value` — only when it changed externally and the editor
  // isn't being typed in, to avoid update loops.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    if (editor.isFocused) return;
    editor.commands.setContent(toEditorContent(value), { emitUpdate: false });
    lastEmittedRef.current = value;
  }, [editor, value]);

  const uiState = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        h1: e.isActive("heading", { level: 1 }),
        h2: e.isActive("heading", { level: 2 }),
        h3: e.isActive("heading", { level: 3 }),
        bulletList: e.isActive("bulletList"),
        orderedList: e.isActive("orderedList"),
        taskList: e.isActive("taskList"),
        blockquote: e.isActive("blockquote"),
        code: e.isActive("code"),
        codeBlock: e.isActive("codeBlock"),
        link: e.isActive("link"),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        text: e.getText(),
      };
    },
  });

  const plainText = uiState?.text ?? "";

  const applyLink = () => {
    const ed = editorRef.current;
    if (!ed || !linkPop) return;
    const raw = linkPop.url.trim();
    if (!raw) {
      ed.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
      if (ed.state.selection.empty && !ed.isActive("link")) {
        ed.chain()
          .focus()
          .insertContent([{ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }])
          .unsetMark("link")
          .run();
      } else {
        ed.chain().focus().extendMarkRange("link").setLink({ href }).run();
      }
    }
    setLinkPop(null);
  };

  const removeLink = () => {
    editorRef.current?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkPop(null);
  };

  return (
    <div className="rd" ref={rdRef}>
      <style>{`
        .rd{position:relative;border:none;border-radius:0;background:transparent;overflow:visible;}
        
        .rd-toolbar{display:flex;align-items:center;gap:2px;padding:5px 6px;border-bottom:1px solid ${token.colorBorderSecondary};flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;}
        .rd-toolbar::-webkit-scrollbar{display:none;}
        .rd-tool{width:28px;height:28px;border:none;background:transparent;border-radius:7px;color:${token.colorTextSecondary};cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .12s;}
        .rd-tool:hover{background:${token.colorFillSecondary};color:${token.colorText};}
        .rd-tool.is-active{background:rgba(74,74,208,.12);color:${BRAND};}
        .rd-tool:disabled{opacity:.4;cursor:default;background:transparent;color:${token.colorTextSecondary};}
        .rd-sep{width:1px;height:18px;background:${token.colorBorderSecondary};margin:0 4px;align-self:center;}
        .rd-scroll{max-height:${maxRows * 24 + 20}px;overflow-y:auto;}
        .rd .ProseMirror{padding-left:0;padding-right:0;min-height:${minRows * 24 + 20}px;padding:10px 14px;font-size:14px;line-height:1.7;color:${token.colorText};outline:none;caret-color:${token.colorText};word-break:break-word;}
        .rd .ProseMirror p{margin:.35em 0;}
        .rd .ProseMirror > :first-child{margin-top:0;}
        .rd .ProseMirror h1,.rd .ProseMirror h2,.rd .ProseMirror h3{margin:.6em 0 .3em;line-height:1.3;font-weight:600;}
        .rd .ProseMirror h1{font-size:1.5em;} .rd .ProseMirror h2{font-size:1.28em;} .rd .ProseMirror h3{font-size:1.12em;}
        .rd .ProseMirror ul,.rd .ProseMirror ol{margin:.4em 0;padding-left:1.4em;}
        .rd .ProseMirror a{color:${token.colorPrimary};text-decoration:underline;text-underline-offset:2px;cursor:pointer;}
        .rd .ProseMirror code{background:${token.colorFillTertiary};padding:1px 5px;border-radius:5px;font-size:.9em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
        .rd .ProseMirror pre{background:${token.colorFillTertiary};padding:10px 12px;border-radius:8px;overflow-x:auto;margin:.5em 0;}
        .rd .ProseMirror pre code{background:transparent;padding:0;font-size:.9em;}
        .rd .ProseMirror blockquote{border-left:3px solid ${token.colorBorderSecondary};margin:.5em 0;padding-left:12px;color:${token.colorTextSecondary};}
        .rd .ProseMirror img{max-width:100%;border-radius:8px;margin:6px 0;display:block;}
        .rd .ProseMirror img.ProseMirror-selectednode{outline:2px solid ${BRAND};outline-offset:2px;}
        .rd .ProseMirror hr{border:none;border-top:2px solid ${token.colorBorderSecondary};margin:14px 0;}
        .rd .ProseMirror hr.ProseMirror-selectednode{border-top-color:${BRAND};}
        .rd .ProseMirror .tableWrapper{overflow-x:auto;}
        .rd .ProseMirror table{border-collapse:collapse;table-layout:fixed;width:100%;margin:.5em 0;}
        .rd .ProseMirror td,.rd .ProseMirror th{border:1px solid ${token.colorBorderSecondary};padding:5px 8px;vertical-align:top;position:relative;min-width:48px;}
        .rd .ProseMirror th{background:${token.colorFillQuaternary};font-weight:600;text-align:left;}
        .rd .ProseMirror td.selectedCell,.rd .ProseMirror th.selectedCell{background:rgba(74,74,208,.08);}
        .rd .ProseMirror ul[data-type="taskList"]{list-style:none;padding-left:2px;}
        .rd .ProseMirror ul[data-type="taskList"] li{display:flex;gap:8px;align-items:flex-start;}
        .rd .ProseMirror ul[data-type="taskList"] li > label{flex:none;margin-top:4px;user-select:none;}
        .rd .ProseMirror ul[data-type="taskList"] li > div{flex:1;min-width:0;}
        .rd .ProseMirror ul[data-type="taskList"] input[type="checkbox"]{cursor:pointer;accent-color:${BRAND};width:14px;height:14px;border-radius:4px;}
        .rd .ProseMirror li[data-checked="true"] > div{color:${token.colorTextTertiary};text-decoration:line-through;}
        .rd .ProseMirror .rd-mention{background:rgba(74,74,208,.10);color:${BRAND};border-radius:6px;padding:0 4px;font-weight:500;white-space:nowrap;box-decoration-break:clone;}
        .rd .ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:${token.colorTextQuaternary};float:left;height:0;pointer-events:none;}
        .rd-pop{min-width:230px;max-width:320px;max-height:280px;overflow-y:auto;background:${token.colorBgElevated};border:1px solid ${token.colorBorderSecondary};border-radius:10px;box-shadow:${token.boxShadowSecondary};padding:4px;}
        .rd-pop-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;background:transparent;border-radius:7px;cursor:pointer;text-align:left;color:${token.colorText};}
        .rd-pop-item.is-active{background:${token.colorFillSecondary};}
        .rd-pop-ic{width:24px;height:24px;border-radius:7px;flex:none;display:inline-flex;align-items:center;justify-content:center;background:${token.colorPrimaryBg};color:${BRAND};}
        .rd-pop-lines{display:flex;flex-direction:column;line-height:1.25;min-width:0;}
        .rd-pop-name{font-size:13px;color:${token.colorText};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .rd-pop-meta{font-size:11px;color:${token.colorTextTertiary};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .rd-linkpop{position:absolute;display:flex;gap:6px;align-items:center;padding:8px;background:${token.colorBgElevated};border:1px solid ${token.colorBorderSecondary};border-radius:10px;box-shadow:${token.boxShadowSecondary};z-index:60;width:320px;}
      `}</style>

      {/* Hidden file input — the slash-menu "Image" command and uploads use it. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        // Inline display:none — the `hidden` attribute alone can be undone by
        // author CSS; an inline style cannot.
        style={{ display: "none" }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) void uploadFiles(files, null);
          e.target.value = "";
        }}
      />
      {uploading > 0 ? (
        <div style={{ position: "absolute", top: 8, right: 10, zIndex: 5 }}>
          <Spin size="small" />
        </div>
      ) : null}
      {linkPop ? (
        <div
          className="rd-linkpop"
          ref={linkPopRef}
          style={{ left: linkPop.left, top: linkPop.top }}
        >
          <Input
            size="small"
            placeholder="Paste or type a link…"
            value={linkPop.url}
            autoFocus
            onChange={(e) =>
              setLinkPop((p) => (p ? { ...p, url: e.target.value } : p))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setLinkPop(null);
                editor?.chain().focus().run();
              }
            }}
          />
          <Tooltip title="Apply">
            <button
              type="button"
              className="rd-tool"
              aria-label="Apply link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyLink}
            >
              <MIcon name="check" />
            </button>
          </Tooltip>
          <Tooltip title="Remove link">
            <button
              type="button"
              className="rd-tool"
              aria-label="Remove link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={removeLink}
            >
              <MIcon name="link_off" />
            </button>
          </Tooltip>
        </div>
      ) : null}

      <div className="rd-scroll">
        <EditorContent editor={editor} />
      </div>



      <LinkPreviews text={plainText} />
    </div>
  );
}

/* ----------------------------------------------------------- link previews - */

const URL_RE = /https?:\/\/[^\s)<>"']+/g;

function LinkPreviews({ text }: { text: string }) {
  const { token } = theme.useToken();
  const urls = useMemo(() => {
    const found = text.match(URL_RE) ?? [];
    return [...new Set(found)]
      .filter((u) => !/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(u))
      .slice(0, 4);
  }, [text]);

  if (urls.length === 0) return null;
  return (
    <div
      style={{
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {urls.map((u) => (
        <LinkPreviewCard key={u} url={u} />
      ))}
    </div>
  );
}

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

function LinkPreviewCard({ url }: { url: string }) {
  const { token } = theme.useToken();
  const { data, isLoading } = useQuery<Preview>({
    queryKey: ["link-preview", url],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      return res.json();
    },
  });

  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "flex",
        gap: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        overflow: "hidden",
        textDecoration: "none",
        background: token.colorBgContainer,
      }}
    >
      {data?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image}
          alt=""
          style={{ width: 92, height: 72, objectFit: "cover", flex: "none" }}
        />
      ) : (
        <div
          style={{
            width: 46,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: token.colorTextTertiary,
            background: token.colorFillQuaternary,
          }}
        >
          <MIcon name="link" size={20} />
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1, padding: "8px 10px 8px 0" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: token.colorText,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {isLoading ? "Loading preview…" : data?.title || host}
        </div>
        {data?.description ? (
          <div
            style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              marginTop: 2,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {data.description}
          </div>
        ) : null}
        <div style={{ fontSize: 11.5, color: token.colorTextTertiary, marginTop: 3 }}>
          {data?.siteName || host}
        </div>
      </div>
    </a>
  );
}
