"use client";

import { useState } from "react";
import { App, Button, Input, Tooltip, theme } from "antd";
import { StarFilled, StarOutlined, EditOutlined } from "@ant-design/icons";
import {
  useUpdateProject,
  useToggleFavorite,
  type ProjectWithRelations,
} from "@/features/projects/use-projects";
import { AiTaskButton } from "./ai-task-button";
import { useCanCreateTasks } from "@/features/team-members/use-team-members";

/** A small material glyph. */
function MIcon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {name}
    </span>
  );
}

/** A subtle metadata chip for the header's second row. */
function MetaChip({
  icon,
  dot,
  children,
  mono,
  fg,
  bg,
  fgTertiary,
}: {
  icon?: string;
  dot?: string;
  children: React.ReactNode;
  mono?: boolean;
  fg: string;
  bg: string;
  fgTertiary: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 9px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        color: fg,
        background: bg,
        fontFamily: mono ? "var(--font-geist-mono), monospace" : undefined,
        letterSpacing: mono ? 0.3 : undefined,
      }}
    >
      {dot ? (
        <span
          aria-hidden
          style={{ width: 7, height: 7, borderRadius: "50%", background: dot }}
        />
      ) : null}
      {icon ? (
        <span style={{ color: fgTertiary }}>
          <MIcon name={icon} size={14} />
        </span>
      ) : null}
      {children}
    </span>
  );
}

/**
 * Workspace header: editable project name, colour dot, status + health Selects,
 * client / category tags, and a favourite star.
 *
 * Status/health/client/category and the `is_favorite` flag are read off the
 * `ProjectWithRelations` row returned by `useProject`. Mutations go through the
 * shared project hooks; failures surface as antd messages.
 */
export function ProjectWorkspaceHeader({
  project,
}: {
  project: ProjectWithRelations;
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const updateProject = useUpdateProject();
  const toggleFavorite = useToggleFavorite();
  const canCreateTasks = useCanCreateTasks(project.id);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);

  const isFavorite = project.is_favorite;

  const commitName = async () => {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === project.name) {
      setNameDraft(project.name);
      return;
    }
    try {
      await updateProject.mutateAsync({ id: project.id, name: trimmed });
      message.success("Project renamed.");
    } catch (err) {
      setNameDraft(project.name);
      message.error(
        err instanceof Error ? err.message : "Failed to rename project.",
      );
    }
  };

  const handleToggleFavorite = async () => {
    try {
      await toggleFavorite.mutateAsync({
        projectId: project.id,
        favorite: !isFavorite,
      });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update favourite.",
      );
    }
  };

  const chipColors = {
    fg: token.colorTextSecondary,
    bg: token.colorFillTertiary,
    fgTertiary: token.colorTextTertiary,
  };
  const hasMeta = Boolean(project.client || project.category || project.key);

  return (
    // Single compact row: identity + inline metadata (left), controls (right).
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        rowGap: 8,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: project.color_code,
          flex: "0 0 auto",
          boxShadow: `0 0 0 3px ${project.color_code}22`,
        }}
      />

      {editingName ? (
        <Input
          autoFocus
          value={nameDraft}
          maxLength={100}
          style={{ maxWidth: 420, fontSize: 20, fontWeight: 600 }}
          onChange={(e) => setNameDraft(e.target.value)}
          onPressEnter={commitName}
          onBlur={commitName}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setNameDraft(project.name);
            setEditingName(true);
          }}
          className="wl-proj-name"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "-0.4px",
            color: token.colorText,
          }}
        >
          {project.name}
          <EditOutlined
            className="wl-proj-edit"
            style={{ fontSize: 13, color: token.colorTextTertiary, opacity: 0 }}
            aria-label="Edit project name"
          />
        </button>
      )}

      <Tooltip title={isFavorite ? "Remove from favourites" : "Add to favourites"}>
        <Button
          type="text"
          shape="circle"
          size="small"
          aria-label="Toggle favourite"
          loading={toggleFavorite.isPending}
          icon={
            isFavorite ? (
              <StarFilled style={{ color: "#faad14" }} />
            ) : (
              <StarOutlined style={{ color: token.colorTextTertiary }} />
            )
          }
          onClick={handleToggleFavorite}
        />
      </Tooltip>

      {/* Metadata chips — now inline with the title (was a separate row). */}
      {hasMeta ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
            marginLeft: 2,
          }}
        >
          {project.client ? (
            <MetaChip icon="apartment" {...chipColors}>
              {project.client.name}
            </MetaChip>
          ) : null}
          {project.category ? (
            <MetaChip
              dot={project.category.color_code ?? token.colorTextTertiary}
              {...chipColors}
            >
              {project.category.name}
            </MetaChip>
          ) : null}
          <MetaChip icon="tag" mono {...chipColors}>
            {project.key}
          </MetaChip>
        </div>
      ) : null}

      {/* AI task, right-aligned — hidden when the caller can't author tasks. */}
      {canCreateTasks ? (
        <div style={{ marginLeft: "auto" }}>
          <AiTaskButton projectId={project.id} />
        </div>
      ) : null}

      <style>{`
        .wl-proj-name:hover .wl-proj-edit { opacity: 1; }
      `}</style>
    </div>
  );
}
