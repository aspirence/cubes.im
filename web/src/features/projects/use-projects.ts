"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];
export type ProjectStatus =
  Database["public"]["Tables"]["sys_project_statuses"]["Row"];
export type ProjectHealth =
  Database["public"]["Tables"]["sys_project_healths"]["Row"];

/** Named lookup embeds returned alongside a project row. */
export interface ProjectRelations {
  status: Pick<ProjectStatus, "id" | "name" | "color_code" | "icon"> | null;
  health: Pick<ProjectHealth, "id" | "name" | "color_code"> | null;
  category: { id: string; name: string; color_code: string | null } | null;
  client: { id: string; name: string } | null;
  folder: { id: string; name: string; color_code: string } | null;
}

/** A project row annotated with relation names + per-user favorite/archive flags. */
export type ProjectWithRelations = Project &
  ProjectRelations & {
    is_favorite: boolean;
    is_archived: boolean;
  };

export interface UseProjectsOptions {
  folderId?: string | null;
  favoritesOnly?: boolean;
  archived?: boolean;
}

const PROJECTS_ROOT = "projects" as const;

const projectsKey = (
  teamId: string | undefined,
  opts: UseProjectsOptions | undefined,
) =>
  [
    PROJECTS_ROOT,
    "list",
    teamId,
    {
      folderId: opts?.folderId ?? null,
      favoritesOnly: Boolean(opts?.favoritesOnly),
      archived: Boolean(opts?.archived),
    },
  ] as const;

const projectKey = (id: string | undefined) =>
  [PROJECTS_ROOT, "detail", id] as const;

const statusesKey = ["sys-project-statuses"] as const;
const healthsKey = ["sys-project-healths"] as const;

/**
 * The FK-embed select string. PostgREST resolves the embeds via the named
 * foreign keys; the resulting relational types are awkward to express against
 * the generated `Database` type, so callers cast the raw rows through `unknown`
 * into `ProjectWithRelations`.
 */
const PROJECT_SELECT = `
  *,
  status:sys_project_statuses!projects_status_id_fk ( id, name, color_code, icon ),
  health:sys_project_healths!projects_health_id_fk ( id, name, color_code ),
  category:project_categories!projects_category_id_fk ( id, name, color_code ),
  client:clients!projects_client_id_fk ( id, name ),
  folder:project_folders!projects_folder_id_fk ( id, name, color_code )
`;

/**
 * Lists the active team's projects (RLS-scoped) annotated with the related
 * status/health/category/client/folder names and per-user favorite/archive
 * flags. Supports filtering by folder, favorites-only, and archived.
 */
export function useProjects(opts?: UseProjectsOptions) {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: projectsKey(teamId, opts),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<ProjectWithRelations[]> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      // Per-user favorite / archived project ids for the current user.
      const [favRes, archRes] = await Promise.all([
        supabase.from("favorite_projects").select("project_id"),
        supabase.from("archived_projects").select("project_id"),
      ]);
      if (favRes.error) throw favRes.error;
      if (archRes.error) throw archRes.error;

      const favoriteIds = new Set(
        (favRes.data ?? []).map((r) => r.project_id),
      );
      const archivedIds = new Set(
        (archRes.data ?? []).map((r) => r.project_id),
      );

      let query = supabase
        .from("projects")
        .select(PROJECT_SELECT)
        .eq("team_id", teamId as string)
        .order("name", { ascending: true });

      if (opts?.folderId !== undefined) {
        query =
          opts.folderId === null
            ? query.is("folder_id", null)
            : query.eq("folder_id", opts.folderId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []) as unknown as Array<
        Project & ProjectRelations
      >;

      let result: ProjectWithRelations[] = rows.map((row) => ({
        ...row,
        is_favorite: favoriteIds.has(row.id),
        is_archived: archivedIds.has(row.id),
      }));

      if (opts?.favoritesOnly) {
        result = result.filter((p) => p.is_favorite);
      }

      // By default hide archived projects; when `archived` is true show ONLY
      // the user's archived projects.
      if (opts?.archived) {
        result = result.filter((p) => p.is_archived);
      } else {
        result = result.filter((p) => !p.is_archived);
      }

      return result;
    },
  });
}

/** Loads a single project with its related lookup names. */
export function useProject(id: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: projectKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<ProjectWithRelations> => {
      const [{ data, error }, favRes, archRes] = await Promise.all([
        supabase
          .from("projects")
          .select(PROJECT_SELECT)
          .eq("id", id as string)
          .single(),
        supabase
          .from("favorite_projects")
          .select("project_id")
          .eq("project_id", id as string)
          .maybeSingle(),
        supabase
          .from("archived_projects")
          .select("project_id")
          .eq("project_id", id as string)
          .maybeSingle(),
      ]);
      if (error) throw error;
      if (favRes.error) throw favRes.error;
      if (archRes.error) throw archRes.error;

      const row = data as unknown as Project & ProjectRelations;
      return {
        ...row,
        is_favorite: Boolean(favRes.data),
        is_archived: Boolean(archRes.data),
      };
    },
  });
}

export interface CreateProjectInput {
  name: string;
  clientId?: string | null;
  colorCode?: string | null;
  categoryId?: string | null;
}

/**
 * Creates a project via the `create_project` RPC (sets owner + adds the creator
 * as a project_member). Returns the new project id.
 */
export function useCreateProject() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (input: CreateProjectInput): Promise<string> => {
      if (!teamId) throw new Error("No active team");

      const { data, error } = await supabase.rpc("create_project", {
        p_name: input.name,
        p_team_id: teamId,
        ...(input.clientId ? { p_client_id: input.clientId } : {}),
        ...(input.colorCode ? { p_color_code: input.colorCode } : {}),
        ...(input.categoryId ? { p_category_id: input.categoryId } : {}),
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_ROOT] });
    },
  });
}

export interface UpdateProjectInput extends ProjectUpdate {
  id: string;
}

/** Updates a project row (name/color/status/health/category/client/folder/dates/notes). */
export function useUpdateProject() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateProjectInput): Promise<Project> => {
      const { id, ...rest } = input;
      const { data, error } = await supabase
        .from("projects")
        .update(rest)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_ROOT] });
      queryClient.invalidateQueries({ queryKey: projectKey(project.id) });
    },
  });
}

/** Deletes a project. */
export function useDeleteProject() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_ROOT] });
    },
  });
}

export interface ToggleFavoriteInput {
  projectId: string;
  /** Desired state: true = favorite, false = unfavorite. */
  favorite: boolean;
}

/**
 * Toggles the current user's favorite_projects row for a project. Inserts when
 * `favorite` is true, deletes when false.
 */
export function useToggleFavorite() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ToggleFavoriteInput): Promise<void> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      if (input.favorite) {
        const { error } = await supabase
          .from("favorite_projects")
          .upsert(
            { user_id: user.id, project_id: input.projectId },
            { onConflict: "user_id,project_id" },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("favorite_projects")
          .delete()
          .eq("user_id", user.id)
          .eq("project_id", input.projectId);
        if (error) throw error;
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_ROOT] });
      queryClient.invalidateQueries({ queryKey: projectKey(input.projectId) });
    },
  });
}

export interface ToggleArchiveInput {
  projectId: string;
  /** Desired state: true = archived, false = unarchived. */
  archived: boolean;
}

/**
 * Toggles the current user's archived_projects row for a project. Inserts when
 * `archived` is true, deletes when false.
 */
export function useToggleArchive() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ToggleArchiveInput): Promise<void> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      if (input.archived) {
        const { error } = await supabase
          .from("archived_projects")
          .upsert(
            { user_id: user.id, project_id: input.projectId },
            { onConflict: "project_id,user_id" },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("archived_projects")
          .delete()
          .eq("user_id", user.id)
          .eq("project_id", input.projectId);
        if (error) throw error;
      }
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: [PROJECTS_ROOT] });
      queryClient.invalidateQueries({ queryKey: projectKey(input.projectId) });
    },
  });
}

/** Lists the global project status lookups ordered by sort_order. */
export function useProjectStatuses() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: statusesKey,
    queryFn: async (): Promise<ProjectStatus[]> => {
      const { data, error } = await supabase
        .from("sys_project_statuses")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 60,
  });
}

/** Lists the global project health lookups ordered by sort_order. */
export function useProjectHealths() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: healthsKey,
    queryFn: async (): Promise<ProjectHealth[]> => {
      const { data, error } = await supabase
        .from("sys_project_healths")
        .select("*")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 60,
  });
}
