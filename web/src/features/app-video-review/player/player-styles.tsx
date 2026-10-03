"use client";

import { theme } from "antd";
import { useVR } from "../vr-theme";

/**
 * Every rule the review screen needs, in one place.
 *
 * The layout is written as CSS rather than inline styles on purpose: the
 * desktop / tablet / phone arrangements differ by more than a couple of
 * properties, and media queries re-flow on a resize with no React state and no
 * SSR/client mismatch, which a `window.innerWidth` check cannot promise.
 *
 * Colours come in as custom properties resolved from the active AntD theme, so
 * the screen still follows light/dark mode. The stage and its transport are the
 * one deliberately fixed-dark region — a reference frame has to be judged
 * against black in either mode.
 */
export function PlayerStyles() {
  const VR = useVR();
  const { token } = theme.useToken();

  return (
    <style>{`
.wl-vr-root {
  --vr-bg: ${VR.bg};
  --vr-panel: ${VR.panel};
  --vr-fill: ${VR.panelSoft};
  --vr-hairline: ${VR.hairline};
  --vr-text: ${VR.text};
  --vr-t2: ${VR.textSecondary};
  --vr-t3: ${VR.textTertiary};
  --vr-accent: ${VR.accent};
  --vr-accent-soft: ${VR.accentSoft};
  /* The same accent hue lifted for the near-black transport, where the
     app accent itself would fall below a readable contrast. */
  --vr-accent-on-dark: #8f8fff;
  --vr-marker: ${token.colorWarning};
  --vr-marker-done: rgba(255,255,255,.42);
  --vr-stage: #08090c;
  --vr-bar: #101216;
  --vr-panel-w: 400px;
}

/* ---------------------------------------------------------------- shell */
.wl-vr-shell {
  margin: -22px -24px -48px;
  background: var(--vr-bg);
  height: calc(100vh - 58px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wl-vr-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  min-height: 54px;
  border-bottom: 1px solid var(--vr-hairline);
  background: var(--vr-panel);
}
.wl-vr-title {
  flex: 1;
  min-width: 0;
  font-weight: 700;
  font-size: 15.5px;
  color: var(--vr-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-vr-iconbtn {
  width: 32px; height: 32px; flex: none;
  border: none; border-radius: 9px; cursor: pointer;
  background: var(--vr-fill); color: var(--vr-t2);
  display: inline-flex; align-items: center; justify-content: center;
}
.wl-vr-iconbtn:hover { color: var(--vr-text); }
.wl-vr-head-wide { display: contents; }
.wl-vr-head-narrow { display: none; }

/* ----------------------------------------------------------------- body */
.wl-vr-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--vr-panel-w);
}
.wl-vr-main {
  min-width: 0; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--vr-stage);
}

/* ---------------------------------------------------------------- stage */
.wl-vr-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--vr-stage);
  overflow: hidden;
}
.wl-vr-stage-empty {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 8px; padding: 24px; text-align: center;
  color: rgba(255,255,255,.72);
}
.wl-vr-stage-link {
  margin-top: 6px; color: #fff; font-size: 12.5px; font-weight: 600;
  border: 1px solid rgba(255,255,255,.3); border-radius: 8px; padding: 5px 12px;
}
.wl-vr-stage-hint {
  flex: none;
  padding: 7px 12px;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255,255,255,.62);
  background: var(--vr-bar);
  border-top: 1px solid rgba(255,255,255,.06);
}

/* ------------------------------------------------------------ transport */
.wl-vr-transport {
  flex: none;
  display: flex; align-items: center; gap: 2px;
  padding: 5px 8px;
  background: var(--vr-bar);
  border-top: 1px solid rgba(255,255,255,.07);
}
.wl-vr-tbtn {
  width: 32px; height: 32px; flex: none;
  border: none; border-radius: 8px; padding: 0;
  background: transparent; color: rgba(255,255,255,.84);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.wl-vr-tbtn.is-big { width: 38px; height: 38px; }
.wl-vr-tbtn.is-text {
  width: auto; min-width: 38px; padding: 0 8px;
  font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.wl-vr-tbtn:hover:not(:disabled) { background: rgba(255,255,255,.11); }
.wl-vr-tbtn.is-on { color: var(--vr-accent-on-dark); background: rgba(143,143,255,.16); }
.wl-vr-tbtn:disabled { opacity: .32; cursor: default; }
.wl-vr-t-vol { display: inline-flex; align-items: center; gap: 4px; }
.wl-vr-vol-rail {
  width: 62px; height: 4px; border-radius: 2px;
  background: rgba(255,255,255,.22);
  position: relative; cursor: pointer; display: inline-block;
  margin-right: 4px;
}
.wl-vr-vol-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  border-radius: 2px; background: rgba(255,255,255,.85);
}
.wl-vr-timecode {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12.5px; letter-spacing: .01em;
  color: #fff; background: rgba(255,255,255,.09);
  border: none; border-radius: 7px; padding: 5px 9px;
  cursor: pointer; margin-left: 4px; white-space: nowrap;
}
.wl-vr-timecode:hover:not(:disabled) { background: rgba(255,255,255,.17); }
.wl-vr-timecode:disabled { opacity: .35; cursor: default; }
.wl-vr-duration {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11.5px; color: rgba(255,255,255,.48); margin-left: 5px; white-space: nowrap;
}

/* ------------------------------------------------------------- scrubber */
.wl-vr-scrub-wrap { flex: none; padding: 0 10px 9px; background: var(--vr-bar); }
.wl-vr-scrub {
  position: relative; height: 16px;
  display: flex; align-items: center;
  cursor: pointer; touch-action: none; outline: none;
}
.wl-vr-scrub.is-disabled { cursor: default; opacity: .4; }
.wl-vr-scrub:focus-visible .wl-vr-scrub-rail { box-shadow: 0 0 0 2px var(--vr-accent-on-dark); }
.wl-vr-scrub-rail {
  position: relative; width: 100%; height: 5px;
  border-radius: 3px; background: rgba(255,255,255,.15);
}
.wl-vr-scrub-buffered {
  position: absolute; top: 0; bottom: 0;
  background: rgba(255,255,255,.28); border-radius: 3px;
}
.wl-vr-scrub-played {
  position: absolute; left: 0; top: 0; bottom: 0;
  border-radius: 3px; background: var(--vr-accent-on-dark);
}
.wl-vr-scrub-knob {
  position: absolute; top: 50%; width: 12px; height: 12px;
  border-radius: 50%; background: #fff;
  transform: translate(-50%, -50%); pointer-events: none;
  box-shadow: 0 1px 4px rgba(0,0,0,.55);
}
.wl-vr-scrub-marker {
  position: absolute; top: 50%;
  width: 10px; height: 10px; padding: 0;
  transform: translate(-50%, -50%);
  border-radius: 3px; border: 1.5px solid var(--vr-bar);
  background: var(--vr-marker); cursor: pointer;
}
.wl-vr-scrub-marker.is-done { background: var(--vr-marker-done); }
.wl-vr-scrub-marker:hover { transform: translate(-50%, -50%) scale(1.25); }
.wl-vr-scrub-hover {
  position: absolute; bottom: 12px; transform: translateX(-50%);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; color: #fff; background: rgba(0,0,0,.78);
  border-radius: 5px; padding: 1px 5px; pointer-events: none; white-space: nowrap;
}

/* ---------------------------------------------------------------- panel */
.wl-vr-panel {
  position: relative;
  display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
  background: var(--vr-panel);
  border-left: 1px solid var(--vr-hairline);
}
.wl-vr-resize {
  position: absolute; left: -3px; top: 0; bottom: 0; width: 6px;
  cursor: col-resize; z-index: 4; background: transparent;
  border: none; padding: 0;
}
.wl-vr-resize:hover { background: var(--vr-accent-soft); }
.wl-vr-tabs {
  flex: none; display: flex; gap: 2px;
  padding: 0 10px; border-bottom: 1px solid var(--vr-hairline);
}
.wl-vr-tab {
  appearance: none; border: none; background: transparent;
  padding: 11px 10px 9px; font-size: 13px; font-weight: 600;
  color: var(--vr-t3); cursor: pointer;
  border-bottom: 2px solid transparent;
  display: inline-flex; align-items: center; gap: 6px;
}
.wl-vr-tab.is-on { color: var(--vr-accent); border-bottom-color: var(--vr-accent); }
.wl-vr-tab-count {
  font-size: 11px; font-weight: 700; line-height: 16px;
  min-width: 16px; padding: 0 4px; border-radius: 8px;
  background: var(--vr-fill); color: var(--vr-t2);
}
.wl-vr-panel-scroll {
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
}
.wl-vr-composer {
  flex: none;
  padding: 9px 12px 11px;
  border-top: 1px solid var(--vr-hairline);
  background: var(--vr-panel);
}
.wl-vr-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-weight: 600;
  background: var(--vr-accent-soft); color: var(--vr-accent);
  border: none; border-radius: 6px; padding: 2px 6px; cursor: pointer;
}
.wl-vr-comment {
  display: flex; gap: 9px; padding: 9px 10px;
  border-radius: 10px; cursor: pointer;
}
.wl-vr-comment:hover { background: var(--vr-fill); }
.wl-vr-comment.is-done { opacity: .55; }

/* ================================================ tablet & small laptop */
@media (max-width: 1099px) {
  .wl-vr-shell { height: auto; min-height: calc(100vh - 58px); overflow: visible; }
  .wl-vr-body { display: block; }
  .wl-vr-main {
    position: sticky; top: 58px; z-index: 5;
    box-shadow: 0 10px 24px -18px rgba(0,0,0,.6);
  }
  .wl-vr-stage { flex: none; height: 45vh; }
  .wl-vr-panel { border-left: none; }
  .wl-vr-resize { display: none; }
  .wl-vr-t-wide { display: none; }
  .wl-vr-panel-scroll { overflow-y: visible; }
  .wl-vr-composer { position: sticky; bottom: 0; z-index: 4; }
  /* Below the two-column breakpoint the header's secondary actions move into
     the ⋯ menu — at 1024px they would otherwise wrap onto a second row. */
  .wl-vr-head-wide { display: none; }
  .wl-vr-head-narrow { display: inline-flex; }
  /* The tabs become the segmented control that splits the page below the
     video, so they take the panel's full width. */
  .wl-vr-tab { flex: 1; justify-content: center; }
}

/* ================================================================ phone */
@media (max-width: 899px) {
  .wl-vr-shell { margin: -16px -14px -40px; }
  .wl-vr-head { padding: 8px 12px; gap: 6px; }
}
@media (max-width: 699px) {
  .wl-vr-stage { height: 40vh; }
  /* On a phone the title is the only way to know which cut you are looking at,
     so it keeps its room and the status chip moves to the Details tab. */
  .wl-vr-title { font-size: 14px; min-width: 96px; }
  .wl-vr-head-status { display: none; }
  .wl-vr-share-label { display: none; }
  .wl-vr-ver { width: 72px !important; }
  .wl-vr-transport { gap: 0; padding: 4px 4px; }
  .wl-vr-tbtn { width: 30px; height: 30px; }
  .wl-vr-tbtn.is-big { width: 34px; height: 34px; }
  .wl-vr-vol-rail { display: none; }
  .wl-vr-duration { display: none; }
  .wl-vr-timecode { font-size: 11.5px; padding: 4px 6px; margin-left: 2px; }
  .wl-vr-tabs { padding: 0 8px; }
  .wl-vr-tab { padding: 12px 4px 10px; }
  .wl-vr-composer { padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); }
}
    `}</style>
  );
}
