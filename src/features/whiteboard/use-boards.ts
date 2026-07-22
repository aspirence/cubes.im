"use client";

/**
 * Team-scoped whiteboard store (v2). Boards + scenes live in Supabase:
 *   - `whiteboards`        — one row per board (metadata), team-shared, realtime.
 *   - `whiteboard_scenes`  — the heavy Excalidraw payload (elements + files),
 *                            1:1 with a board, last-write-wins, NOT broadcast.
 *
 * The board list stays live across tabs and teammates via `useBoardsRealtime`;
 * a scene is loaded on demand when a board opens and saved (debounced) by the
 * canvas. Per-user viewport (pan/zoom) is intentionally kept local to each
 * browser (see the viewport helpers), never in the shared scene.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";

/** whiteboards / whiteboard_scenes are newer than the generated DB types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export interface Board {
  id: string;
  name: string;
  /** ms epoch, from `updated_at`. */
  updatedAt: number;
  createdBy: string | null;
}

/** The Excalidraw scene we persist. Viewport is stored separately (local). */
export interface Scene {
  elements: readonly unknown[];
  files: Record<string, unknown>;
}

interface BoardRow {
  id: string;
  name: string;
  updated_at: string;
  created_by: string | null;
}

const BOARDS_ROOT = "whiteboard-boards" as const;
const boardsKey = (teamId: string | undefined) => [BOARDS_ROOT, teamId] as const;

const toBoard = (r: BoardRow): Board => ({
  id: r.id,
  name: r.name,
  updatedAt: new Date(r.updated_at).getTime(),
  createdBy: r.created_by,
});

const BOARD_COLS = "id, name, updated_at, created_by";

export function useBoards() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;

  const query = useQuery({
    queryKey: boardsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<Board[]> => {
      const { data, error } = await loose(supabase)
        .from("whiteboards")
        .select(BOARD_COLS)
        .eq("team_id", teamId as string)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as BoardRow[]).map(toBoard);
    },
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: boardsKey(teamId) }),
    [queryClient, teamId],
  );

  const create = useCallback(
    async (name = "Untitled board"): Promise<Board | null> => {
      if (!teamId) return null;
      const { data, error } = await loose(supabase)
        .from("whiteboards")
        .insert({ team_id: teamId, name, created_by: user?.id ?? null })
        .select(BOARD_COLS)
        .single();
      if (error) throw error;
      await invalidate();
      return toBoard(data as BoardRow);
    },
    [supabase, teamId, user?.id, invalidate],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const { error } = await loose(supabase)
        .from("whiteboards")
        .update({ name })
        .eq("id", id);
      if (error) throw error;
      await invalidate();
    },
    [supabase, invalidate],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await loose(supabase)
        .from("whiteboards")
        .delete()
        .eq("id", id);
      if (error) throw error;
      clearViewport(id); // the scene row cascades; drop the local viewport too
      await invalidate();
    },
    [supabase, invalidate],
  );

  const duplicate = useCallback(
    async (id: string): Promise<Board | null> => {
      if (!teamId) return null;
      const [{ data: src }, { data: sceneRow }] = await Promise.all([
        loose(supabase).from("whiteboards").select("name").eq("id", id).single(),
        loose(supabase)
          .from("whiteboard_scenes")
          .select("scene")
          .eq("whiteboard_id", id)
          .maybeSingle(),
      ]);
      const name = `${(src as { name?: string } | null)?.name ?? "Board"} copy`;
      const { data: created, error } = await loose(supabase)
        .from("whiteboards")
        .insert({ team_id: teamId, name, created_by: user?.id ?? null })
        .select(BOARD_COLS)
        .single();
      if (error) throw error;
      const board = toBoard(created as BoardRow);
      const scene = (sceneRow as { scene?: unknown } | null)?.scene;
      if (scene) {
        await loose(supabase)
          .from("whiteboard_scenes")
          .insert({ whiteboard_id: board.id, scene });
      }
      await invalidate();
      return board;
    },
    [supabase, teamId, user?.id, invalidate],
  );

  const loadScene = useCallback(
    async (boardId: string): Promise<Scene | null> => {
      const { data, error } = await loose(supabase)
        .from("whiteboard_scenes")
        .select("scene")
        .eq("whiteboard_id", boardId)
        .maybeSingle();
      if (error) throw error;
      const scene = (data as { scene?: Partial<Scene> } | null)?.scene;
      if (!scene) return null;
      return {
        elements: Array.isArray(scene.elements) ? scene.elements : [],
        files: (scene.files as Record<string, unknown>) ?? {},
      };
    },
    [supabase],
  );

  const saveScene = useCallback(
    async (boardId: string, scene: Scene): Promise<void> => {
      const { error } = await loose(supabase)
        .from("whiteboard_scenes")
        .upsert(
          { whiteboard_id: boardId, scene, updated_at: new Date().toISOString() },
          { onConflict: "whiteboard_id" },
        );
      if (error) throw error;
      // The DB trigger bumps whiteboards.updated_at → realtime refreshes the
      // list for teammates; refresh locally too so our own "edited" is instant.
      void invalidate();
    },
    [supabase, invalidate],
  );

  return {
    boards: query.data ?? [],
    ready: query.isFetched,
    isLoading: query.isLoading,
    hasTeam: Boolean(teamId),
    create,
    rename,
    remove,
    duplicate,
    loadScene,
    saveScene,
  };
}

/**
 * Live board list: a metadata INSERT/UPDATE/DELETE from any teammate (or another
 * tab) refreshes the list. Unique topic per instance — same rationale as
 * useChatRealtime / useNotificationsRealtime.
 */
export function useBoardsRealtime() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  const topicRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (!teamId) return;
    const channel = supabase
      .channel(`whiteboards:${teamId}:${topicRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whiteboards",
          filter: `team_id=eq.${teamId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: boardsKey(teamId) });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, teamId]);
}

/* -------------------------------------------------------------------------- */
/* Per-user viewport (pan/zoom) — local to each browser, never shared.        */
/* -------------------------------------------------------------------------- */

export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

const viewportKey = (id: string) => `cubes-wb-view-${id}`;

export function loadViewport(id: string): Viewport | null {
  try {
    const raw = localStorage.getItem(viewportKey(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Viewport>;
    if (
      typeof v.scrollX !== "number" ||
      typeof v.scrollY !== "number" ||
      typeof v.zoom !== "number"
    ) {
      return null;
    }
    return { scrollX: v.scrollX, scrollY: v.scrollY, zoom: v.zoom };
  } catch {
    return null;
  }
}

export function saveViewport(id: string, v: Viewport) {
  try {
    localStorage.setItem(viewportKey(id), JSON.stringify(v));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

export function clearViewport(id: string) {
  try {
    localStorage.removeItem(viewportKey(id));
  } catch {
    /* ignore */
  }
}
