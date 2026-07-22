"use client";

/**
 * Local (per-browser) whiteboard board list. v1 keeps boards + scenes in
 * localStorage — zero backend/schema change. A future v2 can swap this hook for
 * a Supabase-backed, team-scoped, realtime store without touching the UI.
 */

import { useCallback, useEffect, useState } from "react";

export interface Board {
  id: string;
  name: string;
  updatedAt: number;
}

const LIST_KEY = "cubes-whiteboards";
/** Scene payload for a board is stored under this per-board key. */
export const sceneKey = (id: string) => `cubes-wb-scene-${id}`;

function readList(): Board[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const list = raw ? (JSON.parse(raw) as Board[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeList(list: Board[]) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

function uid(): string {
  // App code (not a workflow script) — Math.random is fine here.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function useBoards() {
  const [{ boards, ready }, setData] = useState<{ boards: Board[]; ready: boolean }>({
    boards: [],
    ready: false,
  });

  useEffect(() => {
    // One-time, hydration-safe load of persisted boards from localStorage after
    // mount (reading storage during render would break SSR/hydration).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData({
      boards: readList().sort((a, b) => b.updatedAt - a.updatedAt),
      ready: true,
    });
  }, []);

  const commit = useCallback((updater: (prev: Board[]) => Board[]) => {
    setData((prev) => {
      const next = updater(prev.boards).sort((a, b) => b.updatedAt - a.updatedAt);
      writeList(next);
      return { boards: next, ready: true };
    });
  }, []);

  const create = useCallback(
    (name = "Untitled board"): Board => {
      const board: Board = { id: uid(), name, updatedAt: Date.now() };
      commit((prev) => [board, ...prev]);
      return board;
    },
    [commit],
  );

  const rename = useCallback(
    (id: string, name: string) =>
      commit((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b))),
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit((prev) => prev.filter((b) => b.id !== id));
      try {
        localStorage.removeItem(sceneKey(id));
      } catch {
        /* ignore */
      }
    },
    [commit],
  );

  const touch = useCallback(
    (id: string) =>
      commit((prev) =>
        prev.map((b) => (b.id === id ? { ...b, updatedAt: Date.now() } : b)),
      ),
    [commit],
  );

  return { boards, ready, create, rename, remove, touch };
}
