"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { theme } from "antd";

/**
 * Shared link handling — used by chat messages and project docs so both linkify
 * and unfurl the same way.
 */

/** Matches bare and scheme-prefixed URLs inside plain text. */
export const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]/gi;

/** Adds the scheme a bare `www.` link needs to be openable. */
export function toHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

const isImageUrl = (u: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(u);

/** Every URL in the text, de-duplicated, in order. */
export function extractUrls(text: string, opts?: { skipImages?: boolean }): string[] {
  const found = text.match(new RegExp(URL_RE.source, "gi")) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    if (opts?.skipImages && isImageUrl(raw)) continue;
    const href = toHref(raw);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

/**
 * The URL sitting at a character offset, if any — lets a plain-text editor
 * resolve "what did the user just click on?" without putting markup in the text.
 */
export function urlAtOffset(text: string, offset: number): string | null {
  const re = new RegExp(URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) return toHref(m[0]);
  }
  return null;
}

/** Plain text with its URLs turned into anchors. */
export function LinkifiedText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { key: string; text: string; url: string | null }[] = [];
    let last = 0;
    const re = new RegExp(URL_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last)
        out.push({ key: `t${last}`, text: text.slice(last, m.index), url: null });
      out.push({ key: `u${m.index}`, text: m[0], url: toHref(m[0]) });
      last = m.index + m[0].length;
    }
    if (last < text.length)
      out.push({ key: `t${last}`, text: text.slice(last), url: null });
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

/** Unfurled card for a single URL. Renders nothing until it has something. */
export function LinkPreviewCard({ url, compact }: { url: string; compact?: boolean }) {
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

  if (!data || (!data.title && !data.image)) return null;

  const thumb = compact ? 44 : 56;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // Inside a contentEditable this must not become editable content itself.
      contentEditable={false}
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
        userSelect: "none",
      }}
    >
      {data.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote OG image, unknown host
        <img
          src={data.image}
          alt=""
          style={{
            width: thumb,
            height: thumb,
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
        {data.description && !compact ? (
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

/**
 * Unfurls the links found in a block of text. `max` keeps a paragraph full of
 * URLs from turning into a wall of cards.
 */
export function LinkPreviews({
  text,
  max = 3,
  compact,
}: {
  text: string;
  max?: number;
  compact?: boolean;
}) {
  const urls = useMemo(
    () => extractUrls(text, { skipImages: true }).slice(0, max),
    [text, max],
  );
  if (urls.length === 0) return null;
  return (
    <div contentEditable={false} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {urls.map((u) => (
        <LinkPreviewCard key={u} url={u} compact={compact} />
      ))}
    </div>
  );
}
