"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "@excalidraw/excalidraw/index.css";
import { useUIStore } from "@/store/ui-store";
import { loadViewport, saveViewport, type Scene } from "./use-boards";

/** The slice of Excalidraw's imperative API we use (export needs it). */
export interface ExcalidrawAPI {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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
  excalidrawAPI?: (api: ExcalidrawAPI) => void;
  onChange?: (elements: readonly unknown[], appState: unknown, files: unknown) => void;
}>;

/** A cheap signature over element versions — changes only on real edits, so we
 *  can ignore Excalidraw's noisy onChange (selection, pan, the mount echo). */
function sceneSig(elements: readonly unknown[]): string {
  let v = 0;
  for (const el of elements as { version?: number }[]) v += el.version ?? 0;
  return `${elements.length}:${v}`;
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
 * A single board's Excalidraw surface. Loads that board's scene from Supabase,
 * autosaves (debounced) on real edits, and restores this browser's saved
 * pan/zoom. Remounts when `boardId` changes (via `key` at the call site) so
 * switching boards is clean.
 */
export function WhiteboardCanvas({
  boardId,
  loadScene,
  saveScene,
  onStatusChange,
  onApiReady,
}: {
  boardId: string;
  loadScene: (id: string) => Promise<Scene | null>;
  saveScene: (id: string, scene: Scene) => Promise<void>;
  /** Bubbles the debounced save state so the top bar can show "Saving…/Saved". */
  onStatusChange?: (status: SaveStatus) => void;
  /** Hands the imperative API up (for export); called with null on unmount. */
  onApiReady?: (api: ExcalidrawAPI | null) => void;
}) {
  const dark = useUIStore((s) => s.themeMode === "dark");
  // undefined = still loading; { scene } once resolved (scene may be null).
  const [initial, setInitial] = useState<{ scene: Scene | null } | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSig = useRef<string>("");

  useEffect(() => {
    // Load this board's scene on mount / board switch. Reset to the loading
    // state first (defensive — the call site also remounts via `key`).
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitial(undefined);
    onStatusChange?.("idle");
    loadScene(boardId)
      .then((scene) => {
        if (cancelled) return;
        lastSig.current = sceneSig(scene?.elements ?? []);
        setInitial({ scene });
      })
      .catch(() => {
        if (cancelled) return;
        lastSig.current = "";
        setInitial({ scene: null });
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      onApiReady?.(null);
    };
  }, [boardId, loadScene, onStatusChange, onApiReady]);

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      // Viewport (pan/zoom) is per-user — persist it locally, immediately.
      const s = appState as { scrollX?: number; scrollY?: number; zoom?: { value?: number } };
      if (typeof s.scrollX === "number" && typeof s.scrollY === "number") {
        saveViewport(boardId, {
          scrollX: s.scrollX,
          scrollY: s.scrollY,
          zoom: s.zoom?.value ?? 1,
        });
      }

      // Skip no-op changes (selection, pan, the initial mount echo).
      const sig = sceneSig(elements);
      if (sig === lastSig.current) return;
      lastSig.current = sig;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      onStatusChange?.("saving");
      saveTimer.current = setTimeout(() => {
        saveScene(boardId, { elements, files: (files as Record<string, unknown>) ?? {} })
          .then(() => onStatusChange?.("saved"))
          .catch(() => onStatusChange?.("error"));
      }, 700);
    },
    [boardId, saveScene, onStatusChange],
  );

  if (initial === undefined) return <CanvasFallback label="Loading whiteboard…" />;

  const scene = initial.scene;
  const vp = loadViewport(boardId);
  const initialData = {
    elements: scene?.elements ?? [],
    files: scene?.files ?? {},
    appState: vp
      ? { scrollX: vp.scrollX, scrollY: vp.scrollY, zoom: { value: vp.zoom } }
      : undefined,
    // Only auto-center when this browser has no saved camera for the board.
    scrollToContent: !vp,
  };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Excalidraw
        theme={dark ? "dark" : "light"}
        initialData={initialData}
        excalidrawAPI={(api) => onApiReady?.(api)}
        onChange={handleChange}
      />
    </div>
  );
}
