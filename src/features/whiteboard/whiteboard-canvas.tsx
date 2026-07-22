"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "@excalidraw/excalidraw/index.css";
import { useUIStore } from "@/store/ui-store";
import { sceneKey } from "./use-boards";

/** Excalidraw is browser-only — load it client-side, no SSR. Typed loosely to
 *  the props we actually use so we don't fight the library's deep types. */
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  {
    ssr: false,
    loading: () => <CanvasFallback label="Loading whiteboard…" />,
  },
) as unknown as React.ComponentType<{
  theme?: "light" | "dark";
  initialData?: unknown;
  onChange?: (elements: readonly unknown[], appState: unknown, files: unknown) => void;
}>;

interface Scene {
  elements: readonly unknown[];
  files: Record<string, unknown>;
}

function loadScene(id: string): Scene | null {
  try {
    const raw = localStorage.getItem(sceneKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Scene>;
    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      files: parsed.files ?? {},
    };
  } catch {
    return null;
  }
}

function CanvasFallback({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#8a8d98",
        fontSize: 13,
      }}
    >
      {label}
    </div>
  );
}

/**
 * A single board's Excalidraw surface. Loads that board's scene from
 * localStorage, and autosaves (debounced) on every change. Remounts when
 * `boardId` changes (via `key` at the call site) so switching boards is clean.
 */
export function WhiteboardCanvas({
  boardId,
  onSaved,
}: {
  boardId: string;
  /** Fired after a debounced save so the board list can bump "updated". */
  onSaved?: (boardId: string) => void;
}) {
  const dark = useUIStore((s) => s.themeMode === "dark");
  // undefined = still reading; null = fresh board; Scene = restored.
  const [initial, setInitial] = useState<Scene | null | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Load this board's scene from localStorage on mount / board switch
    // (client-only external store; safe to set after mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitial(loadScene(boardId));
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [boardId]);

  const handleChange = useCallback(
    (elements: readonly unknown[], _appState: unknown, files: unknown) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(
            sceneKey(boardId),
            JSON.stringify({ elements, files: files ?? {} }),
          );
          onSaved?.(boardId);
        } catch {
          /* localStorage quota (large images) — silently skip this save */
        }
      }, 700);
    },
    [boardId, onSaved],
  );

  if (initial === undefined) return <CanvasFallback label="Loading whiteboard…" />;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Excalidraw
        theme={dark ? "dark" : "light"}
        initialData={
          initial
            ? { elements: initial.elements, files: initial.files, scrollToContent: true }
            : undefined
        }
        onChange={handleChange}
      />
    </div>
  );
}
