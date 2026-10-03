"use client";

import { useEffect, useRef, useState } from "react";
import type { Drawing } from "../use-video-review";

export type Stroke = Drawing["strokes"][number];

/** The annotation pen. Red reads on almost any frame and is not a brand colour. */
export const PEN = { color: "#ff4d4f", width: 3 };

/**
 * A canvas overlaid on the video for freehand frame annotations. When
 * `editable` it captures strokes (normalised 0..1) into `strokes`; otherwise it
 * renders `display` read-only.
 *
 * Coordinates are normalised so a drawing made on a 1440px stage still lands on
 * the same part of the frame on a phone. That only holds while the canvas
 * covers exactly the video's visible box, which is why the stage positions this
 * overlay on the measured letterbox rectangle rather than on the whole stage.
 * A ResizeObserver re-rasterises after a resize — the canvas backing store does
 * not follow CSS size on its own, and a stale one stretches the strokes.
 */
export function DrawingOverlay({
  editable,
  strokes,
  onStrokesChange,
  display,
}: {
  editable: boolean;
  strokes: Stroke[];
  onStrokesChange: (s: Stroke[]) => void;
  display: Drawing | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [, bumpAfterResize] = useState(0);
  const renderStrokes = editable ? strokes : (display?.strokes ?? []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => bumpAfterResize((n) => n + 1));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    // Match the backing store to the device pixels we actually occupy, so the
    // ink stays crisp on retina screens and after a resize.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of renderStrokes) {
      if (s.points.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * dpr;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = p[0] * c.width;
        const y = p[1] * c.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  });

  const norm = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => {
        if (!editable) return;
        e.preventDefault();
        drawing.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onStrokesChange([...strokes, { ...PEN, points: [norm(e)] }]);
      }}
      onPointerMove={(e) => {
        if (!editable || !drawing.current) return;
        const last = strokes[strokes.length - 1];
        if (!last) return;
        onStrokesChange([
          ...strokes.slice(0, -1),
          { ...last, points: [...last.points, norm(e)] },
        ]);
      }}
      onPointerUp={() => {
        drawing.current = false;
      }}
      onPointerLeave={() => {
        drawing.current = false;
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        cursor: editable ? "crosshair" : "default",
        pointerEvents: editable ? "auto" : "none",
        touchAction: "none",
      }}
    />
  );
}
