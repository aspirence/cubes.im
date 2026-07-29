"use client";

import { useMemo, useState } from "react";
import { Image, theme } from "antd";
import type { ChatAttachment } from "@/features/chat/use-chat";
import { LinkPreviews, LinkifiedText, URL_RE } from "@/features/links/link-preview";

// Chat and project docs share one link implementation.
export { LinkifiedText };

/**
 * Message body renderer: URLs become links (via LinkifiedText) and `@Name`
 * occurrences matching a team member's name render as accent-colored mentions.
 * URLs are opaque — mention matching never runs inside them (an address like
 * `https://x.com/@Alice` stays a plain link). The `@` must sit at the start of
 * a segment or after whitespace/punctuation (never inside a word), the longest
 * matching name at each `@` wins ("@Design Ops" beats "@Design"), and a word
 * boundary must follow so "@Ali" doesn't light up inside "@Alice".
 */
export function ChatMessageText({
  text,
  memberNames,
}: {
  text: string;
  memberNames: string[];
}) {
  const parts = useMemo(() => {
    const out: { key: string; text: string; mention: boolean }[] = [];
    const sorted = [...memberNames]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (sorted.length === 0) return [{ key: "t0", text, mention: false }];

    // Mention-match ONE non-URL segment; `keyBase` keeps keys unique per segment.
    const scanMentions = (seg: string, keyBase: string) => {
      let i = 0;
      let last = 0;
      while (i < seg.length) {
        if (
          seg[i] === "@" &&
          // Word boundary BEFORE the @: segment start, whitespace or punctuation.
          (i === 0 || !/[\p{L}\p{N}_]/u.test(seg[i - 1]))
        ) {
          const rest = seg.slice(i + 1);
          const hit = sorted.find((n) => {
            if (!rest.startsWith(n)) return false;
            const after = rest.charAt(n.length);
            return after === "" || !/[\p{L}\p{N}_]/u.test(after);
          });
          if (hit) {
            if (i > last)
              out.push({
                key: `${keyBase}t${last}`,
                text: seg.slice(last, i),
                mention: false,
              });
            out.push({ key: `${keyBase}m${i}`, text: `@${hit}`, mention: true });
            i += hit.length + 1;
            last = i;
            continue;
          }
        }
        i += 1;
      }
      if (last < seg.length)
        out.push({ key: `${keyBase}t${last}`, text: seg.slice(last), mention: false });
    };

    // Split by URL first; URL segments pass through untouched (LinkifiedText
    // turns them into anchors below).
    const re = new RegExp(URL_RE.source, "gi");
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > cursor) scanMentions(text.slice(cursor, m.index), `s${cursor}`);
      out.push({ key: `u${m.index}`, text: m[0], mention: false });
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) scanMentions(text.slice(cursor), `s${cursor}`);
    return out;
  }, [text, memberNames]);

  return (
    <>
      {parts.map((p) =>
        p.mention ? (
          <span key={p.key} style={{ color: "#4a4ad0", fontWeight: 650 }}>
            {p.text}
          </span>
        ) : (
          <LinkifiedText key={p.key} text={p.text} />
        ),
      )}
    </>
  );
}

const isImage = (a: ChatAttachment) =>
  a.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(a.url);

/** Unfurls the first links in a message. */
export function MessageLinkPreview({ text }: { text: string }) {
  return <LinkPreviews text={text} max={2} />;
}

function prettySize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Images render as a click-to-zoom grid; other files as download chips. */
export function MessageAttachments({ items }: { items: ChatAttachment[] }) {
  const { token } = theme.useToken();
  if (!items?.length) return null;
  const images = items.filter(isImage);
  const files = items.filter((a) => !isImage(a));

  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
      {images.length > 0 ? (
        <Image.PreviewGroup>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {images.map((a) => (
              <Image
                key={a.url}
                src={a.url}
                alt={a.name}
                style={{
                  maxWidth: 260,
                  maxHeight: 260,
                  borderRadius: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  objectFit: "cover",
                }}
              />
            ))}
          </div>
        </Image.PreviewGroup>
      ) : null}
      {files.map((a) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          download={a.name}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            maxWidth: 320,
            padding: "7px 10px",
            borderRadius: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary,
            textDecoration: "none",
          }}
        >
          <span
            className="material-symbols-rounded"
            aria-hidden
            style={{ fontSize: 18, color: token.colorTextTertiary }}
          >
            description
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 12.5,
                fontWeight: 600,
                color: token.colorText,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.name}
            </span>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {prettySize(a.size)}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

/** Thumbnails of not-yet-sent uploads, shown above the composer input. */
export function PendingAttachmentStrip({
  items,
  uploading,
  onRemove,
}: {
  items: ChatAttachment[];
  uploading: number;
  onRemove: (url: string) => void;
}) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState<string | null>(null);
  if (items.length === 0 && uploading === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "8px 8px 2px",
      }}
    >
      {items.map((a) =>
        isImage(a) ? (
          <span
            key={a.url}
            onMouseEnter={() => setHover(a.url)}
            onMouseLeave={() => setHover(null)}
            style={{ position: "relative", display: "inline-flex" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded blob URL */}
            <img
              src={a.url}
              alt={a.name}
              style={{
                width: 60,
                height: 60,
                objectFit: "cover",
                borderRadius: 8,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            />
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a.url)}
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "none",
                background: token.colorTextSecondary,
                color: "#fff",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: hover === a.url ? 1 : 0.85,
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 13 }}>
                close
              </span>
            </button>
          </span>
        ) : (
          <span
            key={a.url}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              fontSize: 12,
              color: token.colorText,
              maxWidth: 200,
            }}
          >
            <span
              className="material-symbols-rounded"
              style={{ fontSize: 15, color: token.colorTextTertiary }}
            >
              description
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.name}
            </span>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a.url)}
              style={{
                border: "none",
                background: "none",
                padding: 0,
                cursor: "pointer",
                display: "inline-flex",
                color: token.colorTextTertiary,
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                close
              </span>
            </button>
          </span>
        ),
      )}
      {Array.from({ length: uploading }, (_, i) => (
        <span
          key={`up${i}`}
          style={{
            width: 60,
            height: 60,
            borderRadius: 8,
            border: `1px dashed ${token.colorBorder}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: token.colorTextTertiary,
            fontSize: 11,
          }}
        >
          <span className="material-symbols-rounded wl-spin" style={{ fontSize: 18 }}>
            progress_activity
          </span>
        </span>
      ))}
    </div>
  );
}
