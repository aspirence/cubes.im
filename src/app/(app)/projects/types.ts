import type { Database } from "@/types/database";
import type { ProjectWithRelations } from "@/features/projects/use-projects";

/**
 * The row shape the projects list/detail UI renders. It is exactly what
 * `useProjects()` / `useProject()` return per the shared contract: the base
 * `projects` columns plus the resolved relation embeds (status / health /
 * category / client / folder) and the per-user `is_favorite` / `is_archived`
 * flags. Re-exported here so the list components import a single local name.
 */
export type ProjectRow = ProjectWithRelations;

export type ProjectStatus =
  Database["public"]["Tables"]["sys_project_statuses"]["Row"];
export type ProjectHealth =
  Database["public"]["Tables"]["sys_project_healths"]["Row"];
export type ProjectFolder =
  Database["public"]["Tables"]["project_folders"]["Row"];
