"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { App, Input, Segmented, Spin, Tooltip, theme } from "antd";
import type { InputRef } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { useUploadInlineImage } from "@/features/storage/use-storage";

/** antd exposes the DOM <textarea> at ref.resizableTextArea.textArea. */
type TextAreaHandle = {
  resizableTextArea?: { textArea?: HTMLTextAreaElement };
} | null;

/** Static toolbar descriptors (no component state / refs). */
type ToolCmd =
  | "bold"
  | "italic"
  | "heading"
  | "ul"
  | "ol"
  | "check"
  | "quote"
  | "code"
  | "link";
const TOOLBAR: { icon: string; title: string; cmd: ToolCmd }[] = [
  { icon: "format_bold", title: "Bold", cmd: "bold" },
  { icon: "format_italic", title: "Italic", cmd: "italic" },
  { icon: "format_h1", title: "Heading", cmd: "heading" },
  { icon: "format_list_bulleted", title: "Bulleted list", cmd: "ul" },
  { icon: "format_list_numbered", title: "Numbered list", cmd: "ol" },
  { icon: "checklist", title: "Checklist", cmd: "check" },
  { icon: "format_quote", title: "Quote", cmd: "quote" },
  { icon: "code", title: "Inline code", cmd: "code" },
  { icon: "link", title: "Link", cmd: "link" },
];

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

/**
 * A doc-like description editor: a markdown toolbar, Write / Preview modes
 * (Preview renders GitHub-flavored markdown), image paste-and-drop that uploads
 * to storage and embeds the image, and automatic link-preview cards for any
 * URLs in the text.
 */
export function RichDescription({
  value,
  onChange,
  onCommit,
  minRows = 4,
  maxRows = 16,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  minRows?: number;
  maxRows?: number;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [mode, setMode] = useState<"write" | "preview">("write");
  const uploadImage = useUploadInlineImage();
  const areaRef = useRef<InputRef | null>(null);

  const focusRange = useCallback((from: number, to: number) => {
    requestAnimationFrame(() => {
      const node =
        (areaRef.current as unknown as TextAreaHandle)?.resizableTextArea?.textArea ?? null;
      if (!node) return;
      node.focus();
      node.setSelectionRange(from, to);
    });
  }, []);

  /** Wrap the current selection (or a placeholder) with markdown syntax. */
  const wrap = useCallback(
    (before: string, after = before, placeholder = "text") => {
      const node =
        (areaRef.current as unknown as TextAreaHandle)?.resizableTextArea?.textArea ?? null;
      const start = node ? node.selectionStart : value.length;
      const end = node ? node.selectionEnd : value.length;
      const sel = value.slice(start, end) || placeholder;
      const next = value.slice(0, start) + before + sel + after + value.slice(end);
      onChange(next);
      focusRange(start + before.length, start + before.length + sel.length);
    },
    [value, onChange, focusRange],
  );

  /** Prefix the current line (heading / list / quote). */
  const linePrefix = useCallback(
    (prefix: string) => {
      const node =
        (areaRef.current as unknown as TextAreaHandle)?.resizableTextArea?.textArea ?? null;
      const start = node ? node.selectionStart : value.length;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      onChange(next);
      focusRange(start + prefix.length, start + prefix.length);
    },
    [value, onChange, focusRange],
  );

  const insertAtCursor = useCallback(
    (text: string) => {
      const node =
        (areaRef.current as unknown as TextAreaHandle)?.resizableTextArea?.textArea ?? null;
      const start = node ? node.selectionStart : value.length;
      const end = node ? node.selectionEnd : value.length;
      const next = value.slice(0, start) + text + value.slice(end);
      onChange(next);
      focusRange(start + text.length, start + text.length);
    },
    [value, onChange, focusRange],
  );

  const uploadAndInsert = async (file: File) => {
    try {
      const url = await uploadImage.mutateAsync(file);
      insertAtCursor(`\n![${file.name.replace(/\.[^.]+$/, "")}](${url})\n`);
      onCommit();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't upload the image.");
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          void uploadAndInsert(file);
          return;
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) {
      e.preventDefault();
      void uploadAndInsert(file);
    }
  };

  const runCmd = (cmd: ToolCmd) => {
    switch (cmd) {
      case "bold":
        return wrap("**");
      case "italic":
        return wrap("_");
      case "heading":
        return linePrefix("## ");
      case "ul":
        return linePrefix("- ");
      case "ol":
        return linePrefix("1. ");
      case "check":
        return linePrefix("- [ ] ");
      case "quote":
        return linePrefix("> ");
      case "code":
        return wrap("`", "`", "code");
      case "link":
        return wrap("[", "](https://)", "text");
    }
  };

  return (
    <div className="rd">
      <style>{`
        .rd{border:1px solid ${token.colorBorderSecondary};border-radius:12px;background:${token.colorBgContainer};overflow:hidden;transition:border-color .14s,box-shadow .14s;}
        .rd:focus-within{border-color:${token.colorTextTertiary};}
        .rd-toolbar{display:flex;align-items:center;gap:2px;padding:5px 6px;border-bottom:1px solid ${token.colorBorderSecondary};flex-wrap:wrap;}
        .rd-tool{width:28px;height:28px;border:none;background:transparent;border-radius:7px;color:${token.colorTextSecondary};cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .12s;}
        .rd-tool:hover{background:${token.colorFillSecondary};color:${token.colorText};}
        .rd-sep{width:1px;height:18px;background:${token.colorBorderSecondary};margin:0 4px;}
        .rd .ant-input{background:transparent !important;font-size:14px;line-height:1.7;color:${token.colorText};}
        .rd-preview{padding:12px 14px;font-size:14px;line-height:1.7;color:${token.colorText};}
        .rd-preview h1,.rd-preview h2,.rd-preview h3{margin:.6em 0 .3em;line-height:1.3;}
        .rd-preview h1{font-size:1.5em;} .rd-preview h2{font-size:1.28em;} .rd-preview h3{font-size:1.12em;}
        .rd-preview p{margin:.4em 0;} .rd-preview ul,.rd-preview ol{margin:.4em 0;padding-left:1.4em;}
        .rd-preview a{color:${token.colorPrimary};} .rd-preview code{background:${token.colorFillTertiary};padding:1px 5px;border-radius:5px;font-size:.9em;}
        .rd-preview pre{background:${token.colorFillTertiary};padding:10px 12px;border-radius:8px;overflow-x:auto;}
        .rd-preview img{max-width:100%;border-radius:8px;margin:6px 0;}
        .rd-preview blockquote{border-left:3px solid ${token.colorBorderSecondary};margin:.5em 0;padding-left:12px;color:${token.colorTextSecondary};}
        .rd-preview table{border-collapse:collapse;} .rd-preview td,.rd-preview th{border:1px solid ${token.colorBorderSecondary};padding:4px 8px;}
      `}</style>

      <div className="rd-toolbar">
        {TOOLBAR.map((t, i) => (
          <span key={t.cmd} style={{ display: "inline-flex" }}>
            {i === 7 ? <span className="rd-sep" /> : null}
            <Tooltip title={t.title}>
              <button
                type="button"
                className="rd-tool"
                aria-label={t.title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCmd(t.cmd)}
                disabled={mode === "preview"}
              >
                <MIcon name={t.icon} />
              </button>
            </Tooltip>
          </span>
        ))}
        <Tooltip title="Upload image">
          <label className="rd-tool" style={{ margin: 0 }} aria-label="Upload image">
            {uploadImage.isPending ? <Spin size="small" /> : <MIcon name="image" />}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAndInsert(f);
                e.target.value = "";
              }}
            />
          </label>
        </Tooltip>
        <div style={{ marginLeft: "auto" }}>
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => setMode(v as "write" | "preview")}
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>
      </div>

      {mode === "write" ? (
        <Input.TextArea
          ref={areaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onPaste={handlePaste}
          onDrop={handleDrop}
          placeholder="Describe the task — paste an image, drop a link, use the toolbar… Markdown supported."
          autoSize={{ minRows, maxRows }}
          variant="borderless"
          style={{ padding: "10px 14px" }}
        />
      ) : (
        <div className="rd-preview">
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <span style={{ color: token.colorTextTertiary }}>Nothing to preview yet.</span>
          )}
        </div>
      )}

      <LinkPreviews text={value} />
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
