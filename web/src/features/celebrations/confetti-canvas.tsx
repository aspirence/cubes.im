"use client";

import { useEffect, useRef } from "react";

/** Brand-led confetti palette (indigo family + celebratory accents). */
const COLORS = ["#4a4ad0", "#7b5cf0", "#f5b301", "#2bb36e", "#e5484d", "#5a5ad6"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  ttl: number;
}

/**
 * Hand-rolled full-screen confetti — deliberately no dependency (~150
 * particles, one rAF loop, ~3s). Renders nothing under prefers-reduced-motion:
 * vestibular-safe celebrations fall back to the card's opacity entrance alone.
 */
export function ConfettiCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const particles: Particle[] = [];
    const spawn = (x: number, y: number, angle: number, spread: number, count: number, speed: number) => {
      for (let i = 0; i < count; i++) {
        const a = angle + rand(-spread / 2, spread / 2);
        const v = rand(speed * 0.5, speed);
        particles.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          w: rand(5, 9),
          h: rand(8, 14),
          rot: rand(0, Math.PI * 2),
          vr: rand(-0.25, 0.25),
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          ttl: rand(120, 200),
        });
      }
    };

    // Centre burst + two bottom-corner cones aimed inward/upward.
    spawn(W / 2, H * 0.38, -Math.PI / 2, Math.PI * 1.6, 70, 9);
    spawn(0, H, -Math.PI / 3, Math.PI / 4, 40, 13);
    spawn(W, H, (-2 * Math.PI) / 3, Math.PI / 4, 40, 13);

    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      ctx.clearRect(0, 0, W, H);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += 0.12; // gravity
        p.vx *= 0.99; // drag
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.ttl -= 1;
        if (p.ttl <= 0 || p.y > H + 24) {
          particles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, p.ttl / 40);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (particles.length > 0 && now - started < 3500) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ position: "fixed", inset: 0, pointerEvents: "none" }}
    />
  );
}
