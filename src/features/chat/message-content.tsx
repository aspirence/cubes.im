"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image, theme } from "antd";
import type { ChatAttachment } from "@/features/chat/use-chat";

/** Matches bare and scheme-prefixed URLs inside plain text. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]/gi;

const isImage = (a: ChatAttachment) =>
  a.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(a.url);

function href(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Message text with URLs turned into links (the rest stays plain text). */
export function LinkifiedText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { key: string; text: string; url: string | null }[] = [];
    let last = 0;
    // matchAll needs a fresh lastIndex each render — the regex is global.
    const re = new RegExp(URL_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last)
        out.push({ key: `t${last}`, text: text.slice(last, m.index), url: null });
      out.push({ key: `u${m.index}`, text: m[0], url: href(m[0]) });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ key: `t${last}`, text: text.slice(last), url: null });
    return out;
  }, [text]);

  return (
    <>
      {parts.map((p) =>
        p.url ? (
          <a
            key={p.key}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#4a4ad0", wordBreak: "break-word" }}
            onClick={(e) => e.stopPropagation()}
          >
            {p.text}
          </a>
        ) : (
          <span key={p.key}>{p.text}</span>
        ),
      )}
    </>
  );
}

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** Unfurled card for the first non-image link in a message (Slack-style). */
function LinkPreviewCard({ url }: { url: string }) {
  const { token } = theme.useToken();
  const { data } = useQuery({
    queryKey: ["link-preview", url] as const,
    staleTime: 1000 * 60 * 60,
    retry: false,
    queryFn: async (): Promise<Preview | null> => {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) return null;
      return (await res.json()) as Preview;
    },
  });

  // Nothing worth showing until the fetch produced a title or an image.
  if (!data || (!data.title && !data.image)) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        gap: 10,
        marginTop: 6,
        maxWidth: 460,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderLeft: `3px solid ${token.colorPrimary}`,
        borderRadius: 8,
        padding: 10,
        background: token.colorFillQuaternary,
        textDecoration: "none",
      }}
    >
      {data.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote OG image, unknown host
        <img
          src={data.image}
          alt=""
          style={{
            width: 56,
            height: 56,
            flex: "none",
            objectFit: "cover",
            borderRadius: 6,
            background: token.colorFillSecondary,
          }}
        />
      ) : null}
      <span style={{ minWidth: 0 }}>
        {data.siteName ? (
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: token.colorTextTertiary,
              marginBottom: 1,
            }}
          >
            {data.siteName}
          </span>
        ) : null}
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: token.colorText,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.title ?? url}
        </span>
        {data.description ? (
          <span
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              fontSize: 12,
              color: token.colorTextSecondary,
              lineHeight: 1.45,
              marginTop: 2,
            }}
          >
            {data.description}
          </span>
        ) : null}
      </span>
    </a>
  );
}

/** The first non-image URL in the text, unfurled. */
export function MessageLinkPreview({ text }: { text: string }) {
  const url = useMemo(() => {
    const found = text.match(new RegExp(URL_RE.source, "gi")) ?? [];
    const first = found.find((u) => !/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(u));
    return first ? href(first) : null;
  }, [text]);
  if (!url) return null;
  return <LinkPreviewCard url={url} />;
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
