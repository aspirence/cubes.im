"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type ProjectView =
  Database["public"]["Tables"]["project_views"]["Row"];

const viewsKey = (projectId: string | undefined) =>
  ["project-views", projectId] as const;

/** Lists a project's task views, ordered. */
export function useProjectViews(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: viewsKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectView[]> => {
      const { data, error } = await supabase
        .from("project_views")
        .select("*")
        .eq("project_id", projectId as string)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Adds a view (by registry key) to a project. Admin-only via RLS. */
export function useAddProjectView() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      viewKey: string;
      position: number;
      name?: string | null;
    }): Promise<ProjectView> => {
      const { data, error } = await supabase
        .from("project_views")
        .insert({
          project_id: input.projectId,
          view_key: input.viewKey,
          position: input.position,
          name: input.name ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data, input) => {
      // Prime the cache with the inserted row so the new view_key is present on
      // the very next render — the project page navigates to ?tab=<key> right
      // after this resolves, and without the primed row the active-tab lookup
      // would briefly fall back to the first tab (a wrong-pane flash).
      queryClient.setQueryData<ProjectView[]>(viewsKey(input.projectId), (old) =>
        old
          ? old.some((v) => v.id === data.id)
            ? old
            : [...old, data]
          : [data],
      );
      queryClient.invalidateQueries({ queryKey: viewsKey(input.projectId) });
    },
  });
}

/** Renames a view (custom display name). Admin-only via RLS. */
export function useRenameProjectView() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
      name: string | null;
    }): Promise<void> => {
      // RLS filters non-admin updates to 0 rows without erroring — assert.
      const { data, error } = await supabase
        .from("project_views")
        .update({ name: input.name })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: viewsKey(input.projectId) });
    },
  });
}

/** Removes a view from a project. Admin-only via RLS. */
export function useRemoveProjectView() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      projectId: string;
    }): Promise<void> => {
      // RLS filters the row out (rather than erroring) for non-admins, so a
      // delete would silently affect 0 rows and resolve as "success". Force a
      // representation and assert a row was actually removed.
      const { data, error } = await supabase
        .from("project_views")
        .delete()
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: viewsKey(input.projectId) });
    },
  });
}

/**
 * Makes a project's task views match a template's Default views authoritatively:
 * the project ends up with exactly `viewKeys`, in that order. The projects
 * trigger pre-seeds list+board at positions 0/1 before this runs, so we can't
 * just insert-by-index (that collides on position and can never reorder or drop
 * the seeded pair). Instead we reconcile: insert missing keys, delete the ones
 * the template didn't ask for, then renumber every survivor to the template's
 * order. Runs on a freshly-created project by its creator (an admin).
 *
 * An empty `viewKeys` is a no-op — the trigger-seeded defaults are kept.
 */
export function useApplyTemplateViews() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      viewKeys: string[];
    }): Promise<void> => {
      // De-dupe while preserving the author's chosen order.
      const desired = input.viewKeys.filter((k, i, a) => a.indexOf(k) === i);
      if (desired.length === 0) return;
      const desiredSet = new Set(desired);

      const { data: existing, error: readErr } = await supabase
        .from("project_views")
        .select("id, view_key, position")
        .eq("project_id", input.projectId);
      if (readErr) throw readErr;
      const rows = existing ?? [];
      const present = new Set(rows.map((r) => r.view_key));

      // 1) Insert desired keys not present yet. Done before any delete so the
      //    project is never momentarily left without a view. Positions here are
      //    temporary — the renumber pass below fixes them.
      let tempPos = rows.length;
      for (const key of desired) {
        if (present.has(key)) continue;
        const { error } = await supabase.from("project_views").insert({
          project_id: input.projectId,
          view_key: key,
          position: tempPos++,
        });
        // 23505 = a concurrent insert already added it; the renumber pass keys
        // off view_key, so it will still be ordered correctly.
        if (error && error.code !== "23505") throw error;
      }

      // 2) Drop seeded/leftover views the template didn't ask for, so Default
      //    views are authoritative (e.g. a calendar-only template yields a
      //    calendar-only project — the seeded List/Board are removed).
      for (const r of rows) {
        if (desiredSet.has(r.view_key)) continue;
        const { data: del, error } = await supabase
          .from("project_views")
          .delete()
          .eq("id", r.id)
          .select("id");
        if (error) throw error;
        if (!del || del.length === 0) throw new Error("forbidden");
      }

      // 3) Renumber survivors to the template's exact order (unique positions).
      for (let i = 0; i < desired.length; i++) {
        const { data: upd, error } = await supabase
          .from("project_views")
          .update({ position: i })
          .eq("project_id", input.projectId)
          .eq("view_key", desired[i])
          .select("id");
        if (error) throw error;
        if (!upd || upd.length === 0) throw new Error("forbidden");
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: viewsKey(input.projectId) });
    },
  });
}

/** Renumbers a project's views to a new order (sequential positions). */
export function useReorderProjectViews() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      orderedIds: string[];
    }): Promise<void> => {
      for (let i = 0; i < input.orderedIds.length; i++) {
        // As with delete, a non-admin's UPDATE is RLS-filtered to 0 rows with
        // no error — assert a row changed so the caller sees a real failure.
        const { data, error } = await supabase
          .from("project_views")
          .update({ position: i })
          .eq("id", input.orderedIds[i])
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("forbidden");
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: viewsKey(input.projectId) });
    },
  });
}
