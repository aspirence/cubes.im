"use client";

import { useState } from "react";
import { Image, theme } from "antd";
import type { ChatAttachment } from "@/features/chat/use-chat";
import { LinkPreviews, LinkifiedText } from "@/features/links/link-preview";

// Chat and project docs share one link implementation.
export { LinkifiedText };

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
