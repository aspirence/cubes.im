"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useProjects } from "@/features/projects/use-projects";
import type { Json } from "@/types/database";
import { useInstalledApp } from "./use-installed-apps";

/**
 * Per-app project ACTIVATION scope. An installed app is activated either for
 * every project in the team ("all", the default) or only for an admin-chosen
 * subset ("selected"). Stored in the existing `installed_apps.config` jsonb —
 * no dedicated table/migration — as `{ scope: "all" }` or
 * `{ scope: "selected", projectIds: [...] }`. Project-scoped apps (Social
 * Studio, Files, Video Review, Client Portal) read this to limit which projects
 * they surface; RLS still independently guarantees a caller only sees projects
 * they belong to, so this is a scoping preference, not a security boundary.
 */
export type AppScope =
  | { mode: "all" }
  | { mode: "selected"; projectIds: string[] };

export const DEFAULT_APP_SCOPE: AppScope = { mode: "all" };

/** Defensively parse a scope out of an `installed_apps.config` blob. */
export function parseAppScope(config: unknown): AppScope {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const c = config as Record<string, unknown>;
    if (c.scope === "selected") {
      const ids = Array.isArray(c.projectIds)
        ? c.projectIds.filter((x): x is string => typeof x === "string")
        : [];
      return { mode: "selected", projectIds: ids };
    }
  }
  return DEFAULT_APP_SCOPE;
}

/** Serialize a scope back into the `installed_apps.config` (jsonb) shape. */
export function scopeToConfig(scope: AppScope): Json {
  return scope.mode === "selected"
    ? { scope: "selected", projectIds: scope.projectIds }
    : { scope: "all" };
}

/** The current activation scope for an installed app in the active team. */
export function useAppScope(appKey: string): AppScope {
  const { record } = useInstalledApp(appKey);
  return useMemo(() => parseAppScope(record?.config), [record?.config]);
}

/**
 * The active team's projects that `appKey` is activated for — the full list
 * when scope is "all", or just the selected subset. `data` matches
 * `useProjects()` (still `undefined` while loading, so it drops in wherever an
 * app calls `useProjects()`), filtered to the activated set; the raw `scope`
 * and the common query flags come alongside. Returns explicit fields rather
 * than spreading the query result so react-query's render-tracking still
 * elides re-renders for consumers that only read `data`.
 */
export function useAppActivatedProjects(appKey: string) {
  const scope = useAppScope(appKey);
  const projectsQuery = useProjects();
  const data = useMemo(() => {
    const all = projectsQuery.data;
    if (all === undefined || scope.mode === "all") return all;
    const allowed = new Set(scope.projectIds);
    return all.filter((p) => allowed.has(p.id));
  }, [projectsQuery.data, scope]);
  return {
    data,
    scope,
    isLoading: projectsQuery.isLoading,
    isFetching: projectsQuery.isFetching,
    isError: projectsQuery.isError,
    error: projectsQuery.error,
    refetch: projectsQuery.refetch,
  };
}

/**
 * Maps a project VIEW key (from lib/projects/views.ts) to the first-party app
 * it embeds. Adding one of these views to a project auto-activates the app for
 * that project (see useActivateAppForProject).
 */
export const VIEW_KEY_TO_APP_KEY: Record<string, string> = {
  "video-review": "video_review",
  files: "files",
  "social-studio": "social_studio",
};

export function appKeyForViewKey(viewKey: string): string | undefined {
  return VIEW_KEY_TO_APP_KEY[viewKey];
}

/** App keys that render per-project views and support project-activation scoping.
 *  Workspace-level apps (e.g. mcp, data_manager) touch projects but are NOT
 *  scoped per project, so they never show the activation control. */
const PROJECT_SCOPED_APP_KEYS = new Set(Object.values(VIEW_KEY_TO_APP_KEY));

export function isProjectScopedApp(appKey: string): boolean {
  return PROJECT_SCOPED_APP_KEYS.has(appKey);
}

/**
 * Auto-activates an app for a project via the SECURITY DEFINER RPC
 * `app_activate_for_project`: when the app is scoped to "selected" projects, the
 * project is appended to its list; "all"/uninstalled is a no-op. The RPC
 * authorizes on project-admin, so this works even for a project admin who is not
 * a team admin (the config write is otherwise team-admin-only).
 */
export function useActivateAppForProject() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      appKey: string;
    }): Promise<void> => {
      const { error } = await supabase.rpc("app_activate_for_project", {
        p_project_id: input.projectId,
        p_app_key: input.appKey,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installed-apps", teamId] });
    },
  });
}

/** Writes an app's activation scope to `installed_apps.config` (admin via RLS). */
export function useSetAppScope() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      scope: AppScope;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("installed_apps")
        .update({ config: scopeToConfig(input.scope) })
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      // RLS on installed_apps limits writes to team admins; an empty result
      // means the row was filtered out (not an admin).
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installed-apps", teamId] });
    },
  });
}
