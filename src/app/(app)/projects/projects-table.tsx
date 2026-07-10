"use client";

import { useState } from "react";
import { Empty, Spin } from "antd";
import { useRouter } from "next/navigation";
import { ProjectActions, FavoriteStar } from "./project-actions";
import { resolveClientName } from "./project-display";
import {
  TOKENS,
  MONO,
  SemanticPill,
  ProgressBar,
  AvatarStack,
  projectAvatars,
  resolveDisplay,
} from "./project-skin";
import type { ProjectRow, ProjectStatus, ProjectHealth } from "./types";
import type { ProjectCategory } from "@/features/settings/use-categories";

export interface ProjectsTableProps {
  projects: ProjectRow[];
  loading: boolean;
  archived: boolean;
  favoriteIds: Set<string>;
  statuses: ProjectStatus[] | undefined;
  healths: ProjectHealth[] | undefined;
  categories: ProjectCategory[] | undefined;
  onEdit: (project: ProjectRow) => void;
}

/** Shared column template: name/key · client · status · progress · avatars · actions. */
const GRID_TEMPLATE =
  "minmax(220px, 2.2fr) minmax(120px, 1.2fr) 130px minmax(160px, 1.6fr) 90px 84px";

function ListRow({
  project,
  archived,
  favoriteIds,
  statuses,
  healths,
  categories,
  onEdit,
  isLast,
}: {
  project: ProjectRow;
  archived: boolean;
  favoriteIds: Set<string>;
  statuses: ProjectStatus[] | undefined;
  healths: ProjectHealth[] | undefined;
  categories: ProjectCategory[] | undefined;
  onEdit: (project: ProjectRow) => void;
  isLast: boolean;
}) {
  const router = useRouter();
  const [hover, setHover] = useState(false);

  const isFavorite = project.is_favorite ?? favoriteIds.has(project.id);
  const clientName = resolveClientName(project);
  const { status, progress } = resolveDisplay(
    project,
    statuses,
    healths,
    categories,
  );
  const barColor = project.color_code || TOKENS.bar;
  const avatars = projectAvatars(project);

  const go = () => router.push(`/projects/${project.id}?tab=tasks`);

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter") go();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: GRID_TEMPLATE,
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        minWidth: 720,
        cursor: "pointer",
        background: hover ? TOKENS.rowHover : TOKENS.card,
        borderBottom: isLast ? "none" : `1px solid ${TOKENS.divider}`,
        transition: "background .12s ease",
      }}
    >
      {/* Name + key + favorite */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span onClick={(e) => e.stopPropagation()} style={{ flex: "none" }}>
          <FavoriteStar project={project} isFavorite={isFavorite} />
        </span>
        <span
          aria-hidden
          style={{
            flex: "none",
            width: 9,
            height: 9,
            borderRadius: 3,
            background: project.color_code || TOKENS.bar,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: TOKENS.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={project.name}
          >
            {project.name}
          </div>
          {project.key ? (
            <div
              className="font-mono"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: TOKENS.textTertiary,
                letterSpacing: ".3px",
                fontFamily: MONO,
              }}
            >
              {project.key}
            </div>
          ) : null}
        </div>
      </div>

      {/* Client */}
      <div
        style={{
          fontSize: 13,
          color: clientName ? TOKENS.textSecondary : TOKENS.textFaint,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {clientName ?? "No client"}
      </div>

      {/* Status */}
      <div style={{ minWidth: 0 }}>
        {status ? (
          <SemanticPill label={status.name} color={status.color} dot />
        ) : (
          <span style={{ color: TOKENS.textFaint }}>—</span>
        )}
      </div>

      {/* Progress bar + % */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {progress !== null ? (
          <>
            <ProgressBar value={progress} color={barColor} />
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: TOKENS.text,
                width: 34,
                textAlign: "right",
                flex: "none",
              }}
            >
              {progress}%
            </span>
          </>
        ) : (
          <span
            className="font-mono"
            style={{ fontSize: 12, color: TOKENS.textFaint }}
          >
            {project.tasks_counter ?? 0} tasks
          </span>
        )}
      </div>

      {/* Avatars */}
      <div>
        <AvatarStack avatars={avatars} size={22} />
      </div>

      {/* Actions */}
      <div
        style={{ display: "flex", justifyContent: "flex-end" }}
        onClick={(e) => e.stopPropagation()}
      >
        <ProjectActions
          project={project}
          archived={archived}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
}

export function ProjectsTable({
  projects,
  loading,
  archived,
  favoriteIds,
  statuses,
  healths,
  categories,
  onEdit,
}: ProjectsTableProps) {
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div style={{ padding: 48 }}>
        <Empty description="No projects" />
      </div>
    );
  }

  return (
    <div
      className="wl-hscroll"
      style={{
        border: `1px solid ${TOKENS.hairline}`,
        borderRadius: 12,
        background: TOKENS.card,
        boxShadow: TOKENS.cardShadow,
        overflowX: "auto",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_TEMPLATE,
          gap: 12,
          padding: "9px 16px",
          minWidth: 720,
          borderBottom: `1px solid ${TOKENS.hairline}`,
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: ".3px",
          textTransform: "uppercase",
          color: TOKENS.textTertiary,
          background: TOKENS.canvas,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
        }}
      >
        <span>Project</span>
        <span>Client</span>
        <span>Status</span>
        <span>Progress</span>
        <span>Team</span>
        <span />
      </div>

      {projects.map((project, i) => (
        <ListRow
          key={project.id}
          project={project}
          archived={archived}
          favoriteIds={favoriteIds}
          statuses={statuses}
          healths={healths}
          categories={categories}
          onEdit={onEdit}
          isLast={i === projects.length - 1}
        />
      ))}
    </div>
  );
}
