"use client";

import { useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Empty, Input, Modal, Typography } from "antd";
import type { MenuProps } from "antd";
import { FolderAddOutlined, PlusOutlined } from "@ant-design/icons";
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
import { VideoGrid, useVR } from "@/features/app-video-review/vr-theme";
import { errMsg } from "@/lib/err";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { useIsProjectAdmin } from "@/features/projects/use-project-members";

const { Text } = Typography;

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * The Video Review view embedded in a project — scoped to EXACTLY this project,
 * with folders to organize its cuts (create/rename/delete + move videos).
 */
export function VideoReviewTab({ projectId }: { projectId: string }) {
  const VR = useVR();
  const { message, modal } = App.useApp();
  const { data: videos, isLoading } = useVideoReviewVideos();
  const { data: folders } = useVideoFolders(projectId);
  const createFolder = useCreateVideoFolder();
  const renameFolder = useRenameVideoFolder();
  const deleteFolder = useDeleteVideoFolder();
  const moveVideo = useMoveVideoToFolder();
  const deleteVideo = useDeleteVideo();
  const importFolder = useImportLocalFolder();
  const teamAdmin = useIsTeamAdmin();
  const { data: projectAdmin } = useIsProjectAdmin(projectId);
  const canManage = teamAdmin || Boolean(projectAdmin);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalFolderId, setModalFolderId] = useState<string | null>(null);
  // null = All; "__none" = Unfiled; otherwise folder id.
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [folderModal, setFolderModal] = useState<null | { id?: string; name: string }>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importLabel, setImportLabel] = useState("");
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const mine = useMemo(
    () => (videos ?? []).filter((v) => v.project_id === projectId),
    [videos, projectId],
  );
  const folderList = useMemo(() => folders ?? [], [folders]);
  const countFor = (fid: string | null) =>
    mine.filter((v) => (fid === null ? true : (v.folder_id ?? null) === (fid === "__none" ? null : fid))).length;

  const visible = useMemo(() => {
    if (activeFolder === null) return mine;
    if (activeFolder === "__none") return mine.filter((v) => !v.folder_id);
    return mine.filter((v) => v.folder_id === activeFolder);
  }, [mine, activeFolder]);

  const saveFolder = async () => {
    if (!folderModal) return;
    const name = folderModal.name.trim();
    if (!name) return message.warning("Folder ka naam do.");
    try {
      if (folderModal.id) {
        await renameFolder.mutateAsync({ id: folderModal.id, projectId, name });
      } else {
        const f = await createFolder.mutateAsync({ name, projectId });
        setActiveFolder(f.id);
      }
      setFolderModal(null);
    } catch (err) {
      message.error(errMsg(err, "Couldn't save the folder."));
    }
  };

  const doImport = async () => {
    if (importFiles.length === 0) return message.warning("Choose a local folder first.");
    const label =
      importLabel.trim() ||
      (importFiles[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] ||
      "Imported folder";
    try {
      const targetFolderId =
        activeFolder && activeFolder !== "__none" ? activeFolder : null;
      const result = await importFolder.mutateAsync({
        files: importFiles,
        projectId,
        fileFolderId: null,
        reviewFolderId: targetFolderId,
        allowDownload: true,
        watermark: false,
        importLabel: label,
      });
      message.success(
        `Imported ${result.uploaded}/${result.total} files. ${result.reviewsCreated} review videos created.`,
      );
      setImportOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Couldn't import the folder."));
    }
  };

  const folderChipMenu = (f: VideoFolder): MenuProps => ({
    items: [
      {
        key: "rename",
        label: "Rename folder…",
        icon: <MIcon name="edit" size={14} />,
        onClick: () => setFolderModal({ id: f.id, name: f.name }),
      },
      {
        key: "delete",
        label: "Delete folder",
        icon: <MIcon name="delete" size={14} />,
        danger: true,
        onClick: async () => {
          try {
            await deleteFolder.mutateAsync({ id: f.id, projectId });
            if (activeFolder === f.id) setActiveFolder(null);
            message.success("Folder deleted — its videos are now unfiled.");
          } catch (err) {
            message.error(errMsg(err, "Couldn't delete the folder."));
          }
        },
      },
    ],
  });

  /** Per-card ⋯ menu: move between folders + delete. */
  const cardMenu = (v: VideoWithProject): MenuProps => ({
    items: [
      ...(folderList.length > 0
        ? [
            {
              key: "move",
              type: "group" as const,
              label: "Move to folder",
              children: [
                ...folderList.map((f) => ({
                  key: f.id,
                  label: f.name,
                  disabled: v.folder_id === f.id,
                  onClick: () =>
                    void moveVideo
                      .mutateAsync({ videoId: v.id, folderId: f.id })
                      .catch((err) => message.error(errMsg(err, "Couldn't move the video."))),
                })),
                {
                  key: "__none",
                  label: "No folder",
                  disabled: !v.folder_id,
                  onClick: () =>
                    void moveVideo
                      .mutateAsync({ videoId: v.id, folderId: null })
                      .catch((err) => message.error(errMsg(err, "Couldn't move the video."))),
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
        icon: <MIcon name="delete" size={14} />,
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
                .catch((err) => message.error(errMsg(err, "Couldn't delete the video."))),
          }),
      },
    ],
  });

  const chip = (key: string | null, label: React.ReactNode, count: number, menu?: MenuProps) => {
    const on = activeFolder === key;
    const inner = (
      <button
        key={key ?? "all"}
        type="button"
        onClick={() => setActiveFolder(key)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 8,
          border: `1px solid ${on ? VR.accent : VR.hairline}`,
          background: on ? VR.accentSoft : VR.panel,
          color: on ? VR.accent : VR.textSecondary,
          fontSize: 12.5,
          fontWeight: on ? 600 : 500,
          cursor: "pointer",
        }}
      >
        {label}
        <span style={{ fontSize: 11, color: on ? VR.accent : VR.textTertiary }}>{count}</span>
      </button>
    );
    // Right-click (or long-press) a folder chip for its tools.
    return menu ? (
      <Dropdown key={key ?? "all"} menu={menu} trigger={["contextMenu"]}>
        {inner}
      </Dropdown>
    ) : (
      inner
    );
  };

  return (
    <div
      style={{
        background: VR.bg,
        border: `1px solid ${VR.hairline}`,
        borderRadius: 12,
        padding: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          rowGap: 10,
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MIcon name="movie" size={20} color={VR.accent} />
            <span style={{ fontWeight: 700, color: VR.text, fontSize: 15.5 }}>Video Review</span>
          </div>
          <Text style={{ color: VR.textTertiary, fontSize: 12.5 }}>
            Cuts for this project — organize them into folders.
          </Text>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            icon={<FolderAddOutlined />}
            onClick={() => setFolderModal({ name: "" })}
            disabled={!canManage}
          >
            New folder
          </Button>
          <Button onClick={() => setImportOpen(true)} disabled={!canManage}>
            Import local folder
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setModalFolderId(
                activeFolder && activeFolder !== "__none" ? activeFolder : null,
              );
              setModalOpen(true);
            }}
          >
            New review
          </Button>
        </div>
      </div>

      {/* Folder bar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {chip(null, "All", mine.length)}
        {folderList.map((f) =>
          chip(
            f.id,
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <MIcon name="folder" size={14} color={activeFolder === f.id ? VR.accent : VR.textTertiary} />
              {f.name}
            </span>,
            countFor(f.id),
            folderChipMenu(f),
          ),
        )}
        {mine.some((v) => !v.folder_id) && folderList.length > 0
          ? chip("__none", "Unfiled", countFor("__none"))
          : null}
      </div>

      {isLoading ? null : visible.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: VR.textTertiary }}>
              {activeFolder ? "This folder is empty." : "No videos for this project yet."}
            </span>
          }
          style={{ margin: "28px 0" }}
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setModalFolderId(
                activeFolder && activeFolder !== "__none" ? activeFolder : null,
              );
              setModalOpen(true);
            }}
          >
            New review
          </Button>
        </Empty>
      ) : (
        <VideoGrid videos={visible} cardMenu={cardMenu} />
      )}

      <NewReviewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultProjectId={projectId}
        defaultFolderId={modalFolderId}
      />

      {/* Create / rename folder */}
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
            setFolderModal((m) => (m ? { ...m, name: e.target.value } : m))
          }
          placeholder='e.g. "Reels", "Client cuts", "Final"'
          maxLength={80}
          autoFocus
          onPressEnter={() => void saveFolder()}
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
              : "Videos become linked review items in this project. Other files stay in internal Files."}
          </Typography.Text>
          <Input
            value={importLabel}
            onChange={(e) => setImportLabel(e.target.value)}
            placeholder="Import label"
          />
        </div>
      </Modal>
    </div>
  );
}
