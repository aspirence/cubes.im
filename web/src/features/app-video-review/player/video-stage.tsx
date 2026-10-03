"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaSource } from "../media-source";

export interface StageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The dark, full-bleed stage: it fills whatever height the layout gives it and
 * letterboxes the video inside, never cropping and never overflowing.
 *
 * The video is absolutely positioned on a rectangle we compute ourselves rather
 * than left to `object-fit: contain`. Both look identical, but only the
 * computed rectangle can be handed to the drawing overlay, which has to cover
 * exactly the visible pixels — with `object-fit` the letterbox bars are inside
 * the element's box and every annotation would sit off the frame.
 */
export function VideoStage({
  source,
  title,
  failed,
  attachVideo: attachVideoNode,
  onError,
  onSurfaceClick,
  overlay,
  fallbackHint,
  className,
  onStageEl,
}: {
  source: MediaSource | null;
  title: string;
  /** A direct file that refused to play — show the "open original" fallback. */
  failed: boolean;
  attachVideo: (el: HTMLVideoElement | null) => void;
  onError: () => void;
  onSurfaceClick?: () => void;
  /** Rendered on the measured video rectangle, pixel-aligned with the frame. */
  overlay?: React.ReactNode;
  /** One line explaining a degraded mode (e.g. why an iframe has no timecode). */
  fallbackHint?: React.ReactNode;
  className?: string;
  onStageEl?: (el: HTMLDivElement | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [box, setBox] = useState<StageBox>({ left: 0, top: 0, width: 0, height: 0 });

  const measure = useCallback(
    (ratio: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w <= 0 || h <= 0) return;
      // Fit the frame inside the stage: whichever axis runs out first decides.
      const fitW = Math.min(w, h * ratio);
      const fitH = fitW / ratio;
      setBox({
        left: Math.round((w - fitW) / 2),
        top: Math.round((h - fitH) / 2),
        width: Math.round(fitW),
        height: Math.round(fitH),
      });
    },
    [],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    measure(aspect);
    const ro = new ResizeObserver(() => measure(aspect));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [aspect, measure]);

  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      attachVideoNode(el);
      if (!el) return;
      const read = () => {
        if (el.videoWidth > 0 && el.videoHeight > 0) {
          setAspect(el.videoWidth / el.videoHeight);
        }
      };
      read();
      el.addEventListener("loadedmetadata", read, { once: false });
    },
    [attachVideoNode],
  );

  const isEmbed = source?.kind === "embed";
  const showFallback = !source || failed || source.kind === "unsupported";

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div
        ref={(el) => {
          wrapRef.current = el;
          onStageEl?.(el);
        }}
        className="wl-vr-stage"
        onClick={showFallback || isEmbed ? undefined : onSurfaceClick}
      >
        {showFallback ? (
          <StageFallback source={source} />
        ) : isEmbed ? (
          // A provider page (YouTube/Vimeo/Drive/Loom…) is not a media file, so
          // it plays in the provider's own iframe. Letterbox it on the same
          // measured rectangle so switching sources doesn't jump the layout.
          <iframe
            key={source.url}
            src={source.url}
            title={title}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            style={{
              position: "absolute",
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              border: 0,
              background: "#000",
            }}
          />
        ) : (
          <>
            <video
              ref={attachVideo}
              key={source.url}
              src={source.url}
              playsInline
              preload="metadata"
              onError={onError}
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                display: "block",
                background: "#000",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                pointerEvents: "none",
              }}
            >
              {/* The overlay itself re-enables pointer events when it's armed. */}
              <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>
                {overlay}
              </div>
            </div>
          </>
        )}
      </div>
      {fallbackHint ? <div className="wl-vr-stage-hint">{fallbackHint}</div> : null}
    </div>
  );
}

/** The "we can't play this here" panel, with the provider's own fix. */
function StageFallback({ source }: { source: MediaSource | null }) {
  if (!source) {
    return (
      <div className="wl-vr-stage-empty">
        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 30 }}>
          movie
        </span>
        <div>No video source for this version.</div>
      </div>
    );
  }
  const unsupported = source.kind === "unsupported";
  return (
    <div className="wl-vr-stage-empty">
      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 34 }}>
        videocam_off
      </span>
      <div style={{ fontWeight: 600, color: "#fff" }}>
        {unsupported ? "This link can’t be played here" : "Couldn’t preview this link"}
      </div>
      <div style={{ fontSize: 12.5, maxWidth: 440, lineHeight: 1.5 }}>
        {unsupported
          ? source.hint
          : "It isn’t a directly playable video file. Open it in a new tab, or upload the file / paste a YouTube, Vimeo or Google Drive link."}
      </div>
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="wl-vr-stage-link"
      >
        Open original ↗
      </a>
    </div>
  );
}
