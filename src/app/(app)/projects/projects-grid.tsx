"use client";

import { useState } from "react";
import { Empty, Spin } from "antd";
import { useRouter } from "next/navigation";
import { ProjectActions, FavoriteStar } from "./project-actions";
import { resolveClientName } from "./project-display";
import {
  useProjectSkin,
  MONO,
  SemanticPill,
  CategoryChip,
  ProgressBar,
  AvatarStack,
  projectAvatars,
  resolveDisplay,
} from "./project-skin";
import type { ProjectRow, ProjectStatus, ProjectHealth } from "./types";
import type { ProjectCategory } from "@/features/settings/use-categories";

export interface ProjectsGridProps {
  projects: ProjectRow[];
  loading: boolean;
  archived: boolean;
  favoriteIds: Set<string>;
  statuses: ProjectStatus[] | undefined;
  healths: ProjectHealth[] | undefined;
  categories: ProjectCategory[] | undefined;
  onEdit: (project: ProjectRow) => void;
}

function ProjectCard({
  project,
  archived,
  favoriteIds,
  statuses,
  healths,
  categories,
  onEdit,
}: {
  project: ProjectRow;
  archived: boolean;
  favoriteIds: Set<string>;
  statuses: ProjectStatus[] | undefined;
  healths: ProjectHealth[] | undefined;
  categories: ProjectCategory[] | undefined;
  onEdit: (project: ProjectRow) => void;
}) {
  const router = useRouter();
  const skin = useProjectSkin();
  const [hover, setHover] = useState(false);

  const isFavorite = project.is_favorite ?? favoriteIds.has(project.id);
  const clientName = resolveClientName(project);
  const { status, health, category, progress } = resolveDisplay(
    project,
    statuses,
    healths,
    categories,
  );
  const barColor = project.color_code || skin.bar;
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
        display: "flex",
        flexDirection: "column",
        gap: 12,
        background: skin.card,
        border: `1px solid ${hover ? skin.cardHoverBorder : skin.hairline}`,
        borderRadius: 12,
        padding: 15,
        cursor: "pointer",
        boxShadow: hover ? skin.cardHoverShadow : skin.cardShadow,
        transform: hover ? "translateY(-2px)" : "none",
        transition: "box-shadow .15s ease, transform .15s ease, border-color .15s ease",
      }}
    >
      {/* Header: dot + name/client + star + actions */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          aria-hidden
          style={{
            marginTop: 4,
            flex: "none",
            width: 10,
            height: 10,
            borderRadius: 3,
            background: project.color_code || skin.bar,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: skin.text,
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={project.name}
          >
            {project.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: skin.textSecondary,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {clientName ?? "No client"}
          </div>
        </div>
        <div
          style={{ display: "flex", alignItems: "center", flex: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          <FavoriteStar project={project} isFavorite={isFavorite} />
          <ProjectActions
            project={project}
            archived={archived}
            onEdit={onEdit}
          />
        </div>
      </div>

      {/* Pills */}
      {(status || category || health) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {status ? (
            <SemanticPill label={status.name} color={status.color} dot />
          ) : null}
          {category ? (
            <CategoryChip label={category.name} color={category.color} />
          ) : null}
          {health ? (
            <SemanticPill
              label={health.name}
              color={health.color}
              name={`health ${health.name}`}
            />
          ) : null}
        </div>
      )}

      {/* Task count + progress % */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: skin.textSecondary,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 15, color: skin.textTertiary }}
          >
            checklist
          </span>
          <span className="font-mono" style={{ color: skin.text, fontWeight: 600 }}>
            {project.tasks_counter ?? 0}
          </span>
          <span>tasks</span>
        </span>
        {progress !== null ? (
          <span className="font-mono" style={{ color: skin.text, fontWeight: 600 }}>
            {progress}%
          </span>
        ) : null}
      </div>

      {/* Progress bar */}
      {progress !== null ? (
        <ProgressBar value={progress} color={barColor} />
      ) : null}

      {/* Footer: avatars + key */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 4,
          borderTop: `1px solid ${skin.divider}`,
          marginTop: "auto",
        }}
      >
        <AvatarStack avatars={avatars} />
        {project.key ? (
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: skin.textTertiary,
              letterSpacing: ".3px",
              fontFamily: MONO,
            }}
          >
            {project.key}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectsGrid({
  projects,
  loading,
  archived,
  favoriteIds,
  statuses,
  healths,
  categories,
  onEdit,
}: ProjectsGridProps) {
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
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
        gap: 14,
      }}
    >
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          archived={archived}
          favoriteIds={favoriteIds}
          statuses={statuses}
          healths={healths}
          categories={categories}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
