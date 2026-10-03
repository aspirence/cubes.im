"use client";

import { useCallback, useRef, useState } from "react";
import { Tooltip } from "antd";
import type { BufferedRange } from "./use-video-player";
import { formatClock } from "./timecode";

export interface CommentMarker {
  id: string;
  timeMs: number;
  /** First line of the comment — what the hover tooltip shows. */
  label: string;
  resolved: boolean;
}

/**
 * The full-width timeline under the transport: buffered ranges behind the
 * played portion, plus one marker per comment timestamp.
 *
 * Dragging updates a local `scrub` position and seeks live, so the playhead
 * tracks the pointer even while the element is still seeking. We deliberately
 * keep markers as absolutely positioned buttons rather than painting them into
 * a canvas — they need hover tooltips and keyboard focus.
 */
export function Scrubber({
  duration,
  currentTime,
  buffered,
  markers,
  disabled,
  onSeek,
  onMarkerClick,
}: {
  duration: number;
  currentTime: number;
  buffered: BufferedRange[];
  markers: CommentMarker[];
  disabled?: boolean;
  onSeek: (seconds: number) => void;
  onMarkerClick?: (marker: CommentMarker) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const total = duration > 0 ? duration : 0;
  const shown = scrub ?? currentTime;
  const pct = total > 0 ? Math.min(100, Math.max(0, (shown / total) * 100)) : 0;

  const timeAt = useCallback(
    (clientX: number): number => {
      const rail = railRef.current;
      if (!rail || total <= 0) return 0;
      const r = rail.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return ratio * total;
    },
    [total],
  );

  return (
    <div className="wl-vr-scrub-wrap">
      <div
        ref={railRef}
        className={`wl-vr-scrub${disabled || total <= 0 ? " is-disabled" : ""}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={formatClock(shown)}
        onPointerDown={(e) => {
          if (disabled || total <= 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const t = timeAt(e.clientX);
          setScrub(t);
          onSeek(t);
        }}
        onPointerMove={(e) => {
          if (disabled || total <= 0) return;
          setHover(timeAt(e.clientX));
          if (scrub === null) return;
          const t = timeAt(e.clientX);
          setScrub(t);
          onSeek(t);
        }}
        onPointerUp={() => setScrub(null)}
        onPointerCancel={() => setScrub(null)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (disabled || total <= 0) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onSeek(Math.max(0, currentTime - 5));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onSeek(Math.min(total, currentTime + 5));
          }
        }}
      >
        <div className="wl-vr-scrub-rail">
          {buffered.map((b, i) => (
            <div
              key={i}
              className="wl-vr-scrub-buffered"
              style={{
                left: `${(b.start / total) * 100}%`,
                width: `${((b.end - b.start) / total) * 100}%`,
              }}
            />
          ))}
          <div className="wl-vr-scrub-played" style={{ width: `${pct}%` }} />
          {hover !== null && total > 0 ? (
            <div className="wl-vr-scrub-hover" style={{ left: `${(hover / total) * 100}%` }}>
              {formatClock(hover)}
            </div>
          ) : null}
        </div>
        <div className="wl-vr-scrub-knob" style={{ left: `${pct}%` }} />
        {total > 0
          ? markers.map((m) => {
              const left = Math.min(100, Math.max(0, (m.timeMs / 1000 / total) * 100));
              return (
                <Tooltip key={m.id} title={m.label} placement="top">
                  <button
                    type="button"
                    aria-label={`Comment at ${formatClock(m.timeMs / 1000)}`}
                    className={`wl-vr-scrub-marker${m.resolved ? " is-done" : ""}`}
                    style={{ left: `${left}%` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(m.timeMs / 1000);
                      onMarkerClick?.(m);
                    }}
                  />
                </Tooltip>
              );
            })
          : null}
      </div>
    </div>
  );
}
