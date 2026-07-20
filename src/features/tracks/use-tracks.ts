"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** project_tracks is newer than the generated database types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** A workstream inside a project ("Social Media", "Paid Ads"). */
export interface ProjectTrack {
  id: string;
  project_id: string;
  name: string;
  color_code: string;
  sort_order: number;
  created_at: string;
}

const tracksKey = (projectId: string | undefined) =>
  ["project-tracks", projectId] as const;

/** The project's tracks, in display order. */
export function useProjectTracks(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: tracksKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectTrack[]> => {
      const { data, error } = await loose(supabase)
        .from("project_tracks")
        .select("id, project_id, name, color_code, sort_order, created_at")
        .eq("project_id", projectId as string)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ProjectTrack[];
    },
  });
}

export function useCreateTrack(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      color: string;
      sortOrder: number;
    }): Promise<ProjectTrack> => {
      if (!projectId) throw new Error("No project");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await loose(supabase)
        .from("project_tracks")
        .insert({
          project_id: projectId,
          name: input.name.trim(),
          color_code: input.color,
          sort_order: input.sortOrder,
          created_by: user?.id ?? null,
        })
        .select("id, project_id, name, color_code, sort_order, created_at")
        .single();
      if (error) throw error;
      return data as ProjectTrack;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: tracksKey(projectId) }),
  });
}

export function useUpdateTrack(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      color?: string;
      sortOrder?: number;
    }): Promise<void> => {
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.color !== undefined) patch.color_code = input.color;
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
      const { error } = await loose(supabase)
        .from("project_tracks")
        .update(patch)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: tracksKey(projectId) }),
  });
}

/** Deletes a track. Its tasks are NOT deleted — they fall back to "No track". */
export function useDeleteTrack(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await loose(supabase)
        .from("project_tracks")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tracksKey(projectId) });
      // Tasks that pointed at it are now untracked.
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/** Moves a task into a track (or clears it with null). */
export function useSetTaskTrack(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      trackId: string | null;
    }): Promise<void> => {
      const { error } = await loose(supabase)
        .from("tasks")
        .update({ track_id: input.trackId })
        .eq("id", input.taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: tracksKey(projectId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Active track (view filter)                                                 */
/* -------------------------------------------------------------------------- */

interface ActiveTrackState {
  /** projectId -> selected track id (null = All tracks). */
  byProject: Record<string, string | null>;
  setTrack: (projectId: string, trackId: string | null) => void;
}

/**
 * Which track the user is currently focused on, per project. Kept in a store
 * (not the URL) so switching tabs inside a project keeps the focus, and every
 * view can read it without prop-drilling.
 */
export const useActiveTrackStore = create<ActiveTrackState>((set) => ({
  byProject: {},
  setTrack: (projectId, trackId) =>
    set((s) => ({ byProject: { ...s.byProject, [projectId]: trackId } })),
}));

/** The active track id for a project (null = All tracks). */
export function useActiveTrack(projectId: string | undefined): string | null {
  return useActiveTrackStore((s) =>
    projectId ? (s.byProject[projectId] ?? null) : null,
  );
}
