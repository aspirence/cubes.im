"use client";

import { useMemo, useState } from "react";
import { App, Button, Segmented, Select, Switch } from "antd";
import { PlusOutlined, FolderOutlined } from "@ant-design/icons";
import {
  useProjects,
  useProjectStatuses,
  useProjectHealths,
} from "@/features/projects/use-projects";
import { useProjectFolders } from "@/features/projects/use-project-folders";
import { useProjectCategories } from "@/features/settings/use-categories";
import { ProjectsTable } from "./projects-table";
import { ProjectsGrid } from "./projects-grid";
import { ProjectDrawer } from "./project-drawer";
import { FoldersModal } from "./folders-modal";
import { useProjectSkin } from "./project-skin";
import type { ProjectRow } from "./types";

type ViewMode = "table" | "grid";

/** Material Symbols label for the segmented control options. */
function SegLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
        {icon}
      </span>
      {text}
    </span>
  );
}

export default function ProjectsPage() {
  // Used so App context (message/modal) is mounted for child actions.
  App.useApp();
  const skin = useProjectSkin();

  const [view, setView] = useState<ViewMode>("grid");
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [archived, setArchived] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);

  const { data: projects, isLoading } = useProjects({
    folderId,
    favoritesOnly,
    archived,
  });

  // A favorites-only read drives the star state when the list itself doesn't
  // embed an `is_favorite` flag.
  const { data: favoriteProjects } = useProjects({ favoritesOnly: true });
  const favoriteIds = useMemo(
    () => new Set((favoriteProjects ?? []).map((p) => p.id)),
    [favoriteProjects],
  );

  const { data: folders } = useProjectFolders();
  const { data: categories } = useProjectCategories();
  const { data: statuses } = useProjectStatuses();
  const { data: healths } = useProjectHealths();

  // Category filter is applied client-side (useProjects has no category opt).
  const visibleProjects = useMemo(() => {
    const list = (projects ?? []) as ProjectRow[];
    if (!categoryId) return list;
    return list.filter((p) => p.category_id === categoryId);
  }, [projects, categoryId]);

  const folderOptions = useMemo(
    () => (folders ?? []).map((f) => ({ value: f.id, label: f.name })),
    [folders],
  );
  const categoryOptions = useMemo(
    () => (categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    [categories],
  );

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (project: ProjectRow) => {
    setEditing(project);
    setDrawerOpen(true);
  };

  const count = visibleProjects.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: 21,
                fontWeight: 600,
                letterSpacing: "-.4px",
                color: skin.text,
                lineHeight: 1.2,
              }}
            >
              Projects
            </h1>
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: skin.textSecondary,
                background: skin.chipBg,
                borderRadius: 999,
                padding: "2px 9px",
              }}
            >
              {count}
            </span>
          </div>
          <div
            style={{ fontSize: 13, color: skin.textSecondary, marginTop: 4 }}
          >
            All projects in the active team.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            icon={<FolderOutlined />}
            onClick={() => setFoldersOpen(true)}
            style={{ height: 36, borderRadius: 8 }}
          >
            Folders
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            style={{ height: 36, borderRadius: 8 }}
          >
            Create Project
          </Button>
        </div>
      </div>

      {/* Filter / toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <Select
            allowClear
            placeholder="All folders"
            value={folderId}
            onChange={(v) => setFolderId(v)}
            options={folderOptions}
            style={{ minWidth: 160, height: 36 }}
          />
          <Select
            allowClear
            placeholder="All categories"
            value={categoryId}
            onChange={(v) => setCategoryId(v)}
            options={categoryOptions}
            style={{ minWidth: 160, height: 36 }}
          />
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: skin.textSecondary,
              cursor: "pointer",
            }}
          >
            <Switch
              checked={favoritesOnly}
              onChange={setFavoritesOnly}
              size="small"
            />
            Favorites only
          </label>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: skin.textSecondary,
              cursor: "pointer",
            }}
          >
            <Switch checked={archived} onChange={setArchived} size="small" />
            Archived
          </label>
        </div>

        <Segmented<ViewMode>
          value={view}
          onChange={(v) => setView(v)}
          style={{ padding: 3 }}
          options={[
            {
              value: "grid",
              label: <SegLabel icon="grid_view" text="Grid" />,
            },
            {
              value: "table",
              label: <SegLabel icon="view_list" text="List" />,
            },
          ]}
          className="projects-view-segmented"
        />
      </div>

      {/* Active-pill styling to match the indigo token. */}
      <style>{`
        .projects-view-segmented .ant-segmented-item-selected {
          background: ${skin.accentSoft} !important;
          color: ${skin.accent} !important;
        }
        .projects-view-segmented .ant-segmented-thumb {
          background: ${skin.accentSoft} !important;
        }
        .projects-view-segmented .ant-segmented-item-selected .material-symbols-rounded {
          color: ${skin.accent};
        }
      `}</style>

      {!isLoading && count === 0 ? (
        <div
          style={{
            background: skin.card,
            border: `1px solid ${skin.hairline}`,
            borderRadius: 12,
            padding: 48,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 6,
          }}
        >
          <span
            className="material-symbols-rounded"
            style={{ fontSize: 32, color: skin.textFaint }}
          >
            folder_open
          </span>
          <div style={{ fontSize: 14, fontWeight: 600, color: skin.text }}>
            No projects yet
          </div>
          <div style={{ fontSize: 12.5, color: skin.textTertiary }}>
            Create your first project to start planning work.
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            style={{ marginTop: 10 }}
          >
            Create Project
          </Button>
        </div>
      ) : view === "grid" ? (
        <ProjectsGrid
          projects={visibleProjects}
          loading={isLoading}
          archived={archived}
          favoriteIds={favoriteIds}
          statuses={statuses}
          healths={healths}
          categories={categories}
          onEdit={openEdit}
        />
      ) : (
        <ProjectsTable
          projects={visibleProjects}
          loading={isLoading}
          archived={archived}
          favoriteIds={favoriteIds}
          statuses={statuses}
          healths={healths}
          categories={categories}
          onEdit={openEdit}
        />
      )}

      <ProjectDrawer
        open={drawerOpen}
        project={editing}
        onClose={() => setDrawerOpen(false)}
      />
      <FoldersModal open={foldersOpen} onClose={() => setFoldersOpen(false)} />
    </div>
  );
}
