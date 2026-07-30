"use client";

import { Tag } from "antd";
import type {
  ProjectRow,
  ProjectStatus,
  ProjectHealth,
} from "./types";
import type { ProjectCategory } from "@/features/settings/use-categories";

/** Returns a resolved { name, color } for a project's status. */
export function resolveStatus(
  project: ProjectRow,
  statuses: ProjectStatus[] | undefined,
): { name: string; color: string } | null {
  if (project.status) {
    return { name: project.status.name, color: project.status.color_code };
  }
  if (!project.status_id) return null;
  const found = statuses?.find((s) => s.id === project.status_id);
  return found ? { name: found.name, color: found.color_code } : null;
}

/** Returns a resolved { name, color } for a project's health. */
export function resolveHealth(
  project: ProjectRow,
  healths: ProjectHealth[] | undefined,
): { name: string; color: string } | null {
  if (project.health) {
    return { name: project.health.name, color: project.health.color_code };
  }
  if (!project.health_id) return null;
  const found = healths?.find((h) => h.id === project.health_id);
  return found ? { name: found.name, color: found.color_code } : null;
}

/** Returns a resolved category display for a project. */
export function resolveCategory(
  project: ProjectRow,
  categories: ProjectCategory[] | undefined,
): { name: string; color: string | null } | null {
  if (project.category) {
    return { name: project.category.name, color: project.category.color_code };
  }
  if (!project.category_id) return null;
  const found = categories?.find((c) => c.id === project.category_id);
  return found ? { name: found.name, color: found.color_code } : null;
}

/** Returns the project's client name when resolvable. */
export function resolveClientName(project: ProjectRow): string | null {
  return project.client?.name ?? null;
}

export function StatusTag({
  status,
}: {
  status: { name: string; color: string } | null;
}) {
  if (!status) return <span style={{ color: "rgba(0,0,0,0.35)" }}>—</span>;
  return <Tag color={status.color}>{status.name}</Tag>;
}

export function HealthTag({
  health,
}: {
  health: { name: string; color: string } | null;
}) {
  if (!health) return <span style={{ color: "rgba(0,0,0,0.35)" }}>—</span>;
  return <Tag color={health.color}>{health.name}</Tag>;
}

export function CategoryTag({
  category,
}: {
  category: { name: string; color: string | null } | null;
}) {
  if (!category) return <span style={{ color: "rgba(0,0,0,0.35)" }}>—</span>;
  return <Tag color={category.color ?? undefined}>{category.name}</Tag>;
}
