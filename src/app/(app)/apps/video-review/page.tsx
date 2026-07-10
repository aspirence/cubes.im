"use client";

import { useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Empty, Input, Modal, Typography } from "antd";
import type { MenuProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAppActivatedProjects } from "@/features/apps-platform/app-scope";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { useIsProjectAdmin } from "@/features/projects/use-project-members";
import {
  useVideoReviewVideos,
  useVideoFolders,
  useCreateVideoFolder,
  useRenameVideoFolder,
  useDeleteVideoFolder,
  useMoveVideoToFolder,
  useDeleteVideo,
  type VideoFolder,
  type VideoWithProject,
} from "@/features/app-video-review/use-video-review";
import { useImportLocalFolder } from "@/features/app-files/use-files";
import { NewReviewModal } from "@/features/app-video-review/new-review-modal";
import {
  VRThemeProvider,
  VideoGrid,
  VR,
} from "@/features/app-video-review/vr-theme";

const { Text } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

function StatCard({ icon, label, value, tone }: { icon: string; label: string; value: number; tone?: string }) {
  return (
    <div
      style={{
        background: VR.panel,
        border: `1px solid ${VR.hairline}`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          background: VR.panelSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MIcon name={icon} size={18} color={tone ?? VR.textSecondary} />
      </div>
      <div>
        <div style={{ fontSize: 11, letterSpacing: 1, color: VR.textTertiary, textTransform: "uppercase", fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color: tone ?? VR.text, lineHeight: 1.2 }}>{value}</div>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  desc,
  gradient,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  gradient: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="wl-vr-qa"
      style={{
        border: "none",
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        padding: 0,
        background: VR.panel,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 96,
          background: gradient,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: "rgba(255,255,255,0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <MIcon name={icon} size={24} color="#fff" />
        </div>
      </div>
      <div style={{ padding: "10px 14px 14px" }}>
        <div style={{ fontWeight: 600, color: VR.text, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: VR.textTertiary, marginTop: 2 }}>{desc}</div>
      </div>
    </button>
  );
}

export default function VideoReviewHubPage() {
  const { data: activeTeam } = useActiveTeam();
  const teamAdmin = useIsTeamAdmin();
  const { data: projects } = useAppActivatedProjects("video_review");
  const { data: videos, isLoading } = useVideoReviewVideos();
  const [modalOpen, setModalOpen] = useState(false);
  // null = All projects; "__none" = not linked; otherwise a project id.
  const [sel, setSel] = useState<string | null>(null);
  const scopedProjectId =
    sel === null || sel === "__none" ? null : sel;
  const { data: scopedFolders } = useVideoFolders(scopedProjectId);
  const createFolder = useCreateVideoFolder();
  const renameFolder = useRenameVideoFolder();
  const deleteFolder = useDeleteVideoFolder();
  const moveVideo = useMoveVideoToFolder();
  const deleteVideo = useDeleteVideo();
  const { message, modal } = App.useApp();
  const importFolder = useImportLocalFolder();
  const { data: projectAdmin } = useIsProjectAdmin(
    typeof scopedProjectId === "string" ? scopedProjectId : undefined,
  );
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [folderModal, setFolderModal] = useState<null | { id?: string; name: string }>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importLabel, setImportLabel] = useState("");
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [folderScopeKey, setFolderScopeKey] = useState<string | null>(sel);
  if (folderScopeKey !== sel) {
    setFolderScopeKey(sel);
    setActiveFolder(null);
  }

  const all = useMemo(() => videos ?? [], [videos]);
  const folderList = useMemo(() => scopedFolders ?? [], [scopedFolders]);
  const canManageCurrentScope =
    sel !== null && (teamAdmin || Boolean(projectAdmin));

  // Projects the user can access (RLS-scoped) + their video counts. Projects
  // with videos sort first; the empty rest hide behind "Show all".
  const projectRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of all) if (v.project_id) counts.set(v.project_id, (counts.get(v.project_id) ?? 0) + 1);
    return (projects ?? [])
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color_code ?? "#8a8d98",
        count: counts.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [projects, all]);
  const visibleProjectRows = useMemo(
    () =>
      showAllProjects
        ? projectRows
        : projectRows.filter((p) => p.count > 0 || p.id === sel),
    [projectRows, showAllProjects, sel],
  );
  const hiddenCount = projectRows.length - visibleProjectRows.length;
  const unlinkedCount = useMemo(() => all.filter((v) => !v.project_id).length, [all]);

  const visible = useMemo(() => {
    let list = all;
    if (sel === null) list = all;
    else if (sel === "__none") list = all.filter((v) => !v.project_id);
    else list = all.filter((v) => v.project_id === sel);
    if (sel !== null) {
      if (activeFolder === "__none") return list.filter((v) => !v.folder_id);
      if (activeFolder) return list.filter((v) => v.folder_id === activeFolder);
    }
    return list;
  }, [all, sel, activeFolder]);

  const stats = useMemo(
    () => ({
      total: all.length,
      inReview: all.filter((v) => v.status === "in_review").length,
      approved: all.filter((v) => v.status === "approved").length,
      changes: all.filter((v) => v.status === "changes_requested").length,
    }),
    [all],
  );

  const railRow = (
    key: string | null,
    label: string,
    icon: React.ReactNode,
    count?: number,
  ) => {
    const on = sel === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        onClick={() => setSel(key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "7px 10px",
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          background: on ? VR.accentSoft : "transparent",
          color: on ? VR.accent : VR.textSecondary,
          fontSize: 13.5,
          fontWeight: on ? 600 : 500,
        }}
      >
        {icon}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {typeof count === "number" ? (
          <span style={{ fontSize: 11.5, color: on ? VR.accent : VR.textTertiary }}>{count}</span>
        ) : null}
      </button>
    );
  };

  const folderChipMenu = (f: VideoFolder): MenuProps => ({
    items: [
      {
        key: "rename",
        label: "Rename folder…",
        onClick: () => setFolderModal({ id: f.id, name: f.name }),
      },
      {
        key: "delete",
        label: "Delete folder",
        danger: true,
        onClick: async () => {
          try {
            await deleteFolder.mutateAsync({ id: f.id, projectId: scopedProjectId });
            if (activeFolder === f.id) setActiveFolder(null);
          } catch {}
        },
      },
    ],
  });

  const cardMenu = (v: VideoWithProject): MenuProps => ({
    items: [
      ...(folderList.length > 0
        ? [
            {
              key: "move",
              type: "group" as const,
              label: "Move to folder",
              children: [
                ...folderList.map((folder) => ({
                  key: folder.id,
                  label: folder.name,
                  disabled: v.folder_id === folder.id,
                  onClick: () =>
                    void moveVideo
                      .mutateAsync({ videoId: v.id, folderId: folder.id })
                      .catch(() => undefined),
                })),
                {
                  key: "__none",
                  label: "No folder",
                  disabled: !v.folder_id,
                  onClick: () =>
                    void moveVideo
                      .mutateAsync({ videoId: v.id, folderId: null })
                      .catch(() => undefined),
                },
              ],
            },
            { type: "divider" as const },
          ]
        : []),
      {
        key: "delete",
        label: "Delete video",
        danger: true,
        onClick: () =>
          modal.confirm({
            title: `Delete "${v.title}"?`,
            content: "Its comments and revisions are removed. This can't be undone.",
            okText: "Delete",
            okButtonProps: { danger: true },
            onOk: () =>
              deleteVideo
                .mutateAsync(v.id)
                .then(() => message.success("Video deleted."))
                .catch(() => message.error("Couldn't delete the video.")),
          }),
      },
    ],
  });

  const saveFolder = async () => {
    if (!folderModal) return;
    const name = folderModal.name.trim();
    if (!name) return;
    try {
      if (folderModal.id) {
        await renameFolder.mutateAsync({
          id: folderModal.id,
          projectId: scopedProjectId,
          name,
        });
      } else {
        const folder = await createFolder.mutateAsync({
          name,
          projectId: scopedProjectId,
        });
        setActiveFolder(folder.id);
      }
      setFolderModal(null);
    } catch {}
  };

  const doImport = async () => {
    if (importFiles.length === 0) return;
    const label =
      importLabel.trim() ||
      (importFiles[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] ||
      "Imported folder";
    try {
      await importFolder.mutateAsync({
        files: importFiles,
        projectId: scopedProjectId,
        fileFolderId: null,
        reviewFolderId: activeFolder && activeFolder !== "__none" ? activeFolder : null,
        allowDownload: true,
        watermark: false,
        importLabel: label,
      });
      setImportOpen(false);
    } catch {}
  };

  return (
    <VRThemeProvider>
      <div
        style={{
          display: "flex",
          height: "calc(100vh - 58px)",
          margin: "-22px -24px -48px",
          background: VR.bg,
          overflow: "hidden",
        }}
      >
        {/* App rail — the tool's own project tree ("according to access"). */}
        <aside
          style={{
            width: 240,
            flex: "none",
            minHeight: 0,
            borderRight: `1px solid ${VR.hairline}`,
            padding: "16px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 12px" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "linear-gradient(135deg,#4a4ad0,#7a5af5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <MIcon name="movie" size={18} color="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: VR.text, fontSize: 14, lineHeight: 1.15 }}>Video Review</div>
              <div style={{ fontSize: 11, color: VR.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeTeam?.name ?? "Workspace"}
              </div>
            </div>
          </div>

          {railRow(null, "Home", <MIcon name="home" size={17} color={sel === null ? VR.accent : VR.textTertiary} />)}

          <div
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.8,
              color: VR.textTertiary,
              padding: "12px 10px 4px",
            }}
          >
            ALL PROJECTS ({projectRows.length})
          </div>
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
            {visibleProjectRows.map((p) =>
              railRow(
                p.id,
                p.name,
                <span
                  style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flex: "none" }}
                />,
                p.count,
              ),
            )}
            {unlinkedCount > 0
              ? railRow(
                  "__none",
                  "Not in a project",
                  <MIcon name="folder_off" size={16} color={VR.textTertiary} />,
                  unlinkedCount,
                )
              : null}
            {hiddenCount > 0 || showAllProjects ? (
              <button
                type="button"
                onClick={() => setShowAllProjects((v) => !v)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: VR.textTertiary,
                  fontSize: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "6px 10px",
                }}
              >
                {showAllProjects
                  ? "Show fewer projects"
                  : `Show all projects (${hiddenCount} empty)`}
              </button>
            ) : null}
          </div>

          <div style={{ borderTop: `1px solid ${VR.hairline}`, paddingTop: 10, padding: "10px 10px 2px" }}>
            <div style={{ fontSize: 11, color: VR.textTertiary, display: "flex", justifyContent: "space-between" }}>
              <span>Videos</span>
              <span>{stats.total}</span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "26px 28px 40px" }}>
          {sel === null ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                  marginBottom: 26,
                }}
              >
                <StatCard icon="movie" label="Videos" value={stats.total} />
                <StatCard icon="rate_review" label="In review" value={stats.inReview} tone="#4ba3f5" />
                <StatCard icon="check_circle" label="Approved" value={stats.approved} tone="#3fbf7f" />
                <StatCard icon="published_with_changes" label="Changes requested" value={stats.changes} tone="#e0a83e" />
              </div>

              <div style={{ fontWeight: 700, color: VR.text, fontSize: 16, marginBottom: 10 }}>Quick actions</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                  marginBottom: 28,
                }}
              >
                <QuickAction
                  icon="upload"
                  title="Upload a video"
                  desc="Drop a cut and start collecting feedback in seconds."
                  gradient="linear-gradient(135deg,#4a4ad0,#3b3bb8)"
                  onClick={() => setModalOpen(true)}
                />
                <QuickAction
                  icon="folder_open"
                  title="Browse projects"
                  desc="Open any project you have access to."
                  gradient="linear-gradient(135deg,#4c6fff,#3b4fd8)"
                  onClick={() => {
                    const first = projectRows.find((p) => p.count > 0) ?? projectRows[0];
                    if (first) setSel(first.id);
                  }}
                />
                <QuickAction
                  icon="grid_view"
                  title="App Center"
                  desc="Manage this app and other integrations."
                  gradient="linear-gradient(135deg,#7a5af5,#5a3fd8)"
                  onClick={() => (window.location.href = "/apps?view=cubes")}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: VR.text, fontSize: 16, flex: 1 }}>Recent videos</div>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
                  New review
                </Button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, color: VR.text, fontSize: 22, fontWeight: 700 }}>
                  {sel === "__none"
                    ? "Not in a project"
                    : projectRows.find((p) => p.id === sel)?.name ?? "Project"}
                </h2>
                <Text style={{ color: VR.textTertiary, fontSize: 12.5 }}>
                  {visible.length} video{visible.length === 1 ? "" : "s"}
                </Text>
              </div>
              {canManageCurrentScope ? (
                <Button onClick={() => setFolderModal({ name: "" })} style={{ marginRight: 8 }}>
                  New folder
                </Button>
              ) : null}
              {canManageCurrentScope ? (
                <Button onClick={() => setImportOpen(true)} style={{ marginRight: 8 }}>
                  Import local folder
                </Button>
              ) : null}
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
                New review
              </Button>
            </div>
          )}

          {sel !== null ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => setActiveFolder(null)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: `1px solid ${activeFolder === null ? VR.accent : VR.hairline}`,
                  background: activeFolder === null ? VR.accentSoft : VR.panel,
                  color: activeFolder === null ? VR.accent : VR.textSecondary,
                  fontSize: 12.5,
                  fontWeight: activeFolder === null ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                All
              </button>
              {folderList.map((folder) => (
                <Dropdown
                  key={folder.id}
                  menu={folderChipMenu(folder)}
                  trigger={canManageCurrentScope ? ["contextMenu"] : []}
                >
                  <button
                    type="button"
                    onClick={() => setActiveFolder(folder.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 8,
                      border: `1px solid ${activeFolder === folder.id ? VR.accent : VR.hairline}`,
                      background: activeFolder === folder.id ? VR.accentSoft : VR.panel,
                      color: activeFolder === folder.id ? VR.accent : VR.textSecondary,
                      fontSize: 12.5,
                      fontWeight: activeFolder === folder.id ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {folder.name}
                  </button>
                </Dropdown>
              ))}
            </div>
          ) : null}

          {isLoading ? null : visible.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<span style={{ color: VR.textTertiary }}>No videos here yet.</span>}
              style={{ margin: "48px 0" }}
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
                Upload a video
              </Button>
            </Empty>
          ) : (
            <VideoGrid videos={visible} cardMenu={cardMenu} />
          )}
        </main>
      </div>

      <NewReviewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultProjectId={sel && sel !== "__none" ? sel : undefined}
        defaultFolderId={activeFolder && activeFolder !== "__none" ? activeFolder : null}
      />
      <Modal
        title={folderModal?.id ? "Rename folder" : "New folder"}
        open={Boolean(folderModal)}
        okText={folderModal?.id ? "Save" : "Create folder"}
        confirmLoading={createFolder.isPending || renameFolder.isPending}
        onOk={() => void saveFolder()}
        onCancel={() => setFolderModal(null)}
        destroyOnHidden
      >
        <Input
          value={folderModal?.name ?? ""}
          onChange={(e) =>
            setFolderModal((curr) => (curr ? { ...curr, name: e.target.value } : curr))
          }
          placeholder='e.g. "Internal", "Round 1", "Client delivery"'
          maxLength={80}
        />
      </Modal>
      <Modal
        title="Import local folder"
        open={importOpen}
        okText="Import"
        confirmLoading={importFolder.isPending}
        onOk={() => void doImport()}
        onCancel={() => setImportOpen(false)}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          <input
            ref={(node) => {
              folderInputRef.current = node;
              if (node) {
                node.setAttribute("webkitdirectory", "");
                node.setAttribute("directory", "");
              }
            }}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setImportFiles(picked);
              if (!importLabel.trim() && picked[0]) {
                const rel = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
                if (rel) setImportLabel(rel.split("/")[0] ?? "");
              }
            }}
          />
          <Button onClick={() => folderInputRef.current?.click()}>
            Choose local folder
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {importFiles.length > 0
              ? `${importFiles.length} files selected`
              : "Imports all files into internal storage and turns videos into review items."}
          </Typography.Text>
          <Input
            value={importLabel}
            onChange={(e) => setImportLabel(e.target.value)}
            placeholder="Import label"
          />
        </div>
      </Modal>
      <style>{`
        .wl-vr-qa { transition: transform .12s ease, box-shadow .12s ease; }
        .wl-vr-qa:hover { transform: translateY(-2px); }
      `}</style>
    </VRThemeProvider>
  );
}
