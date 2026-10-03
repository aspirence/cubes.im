"use client";

import { useEffect } from "react";
import type { PlayerActions } from "./use-video-player";

/** True when the key belongs to whatever the viewer is typing into. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/**
 * The editor-room shortcuts: space play/pause, ←/→ five seconds, shift+←/→ one
 * frame, f fullscreen, m mute, c to jump into the comment box.
 *
 * Bound on the document so they work wherever focus happens to be, except when
 * the viewer is typing — a comment about "the space between the logos" must not
 * start and stop the video. `enabled` is false for provider iframes, which have
 * no playhead we can move.
 */
export function usePlayerHotkeys({
  enabled,
  actions,
  onFocusComposer,
}: {
  enabled: boolean;
  actions: PlayerActions;
  onFocusComposer: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          actions.togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) actions.stepFrames(-1);
          else actions.seekBy(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) actions.stepFrames(1);
          else actions.seekBy(5);
          break;
        case "f":
          e.preventDefault();
          actions.toggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          actions.toggleMute();
          break;
        case "c":
          e.preventDefault();
          onFocusComposer();
          break;
        default:
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, actions, onFocusComposer]);
}
