"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { MenuProps, UploadFile } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DownloadOutlined,
  EyeOutlined,
  FolderAddOutlined,
  InboxOutlined,
  MoreOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useAuth } from "@/features/auth/use-auth";
import { useProjects } from "@/features/projects/use-projects";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { useIsProjectAdmin } from "@/features/projects/use-project-members";
import {
  useTeamFiles,
  useFileFolders,
  useCreateFileFolder,
  useRenameFileFolder,
  useDeleteFileFolder,
  useUpdateFile,
  useDeleteTeamFile,
  useSendFileToReview,
  useFileUrl,
  humanSize,
  type FileWithMeta,
  type FileFolder,
} from "./use-files";
import { useBackgroundUpload } from "@/features/uploads/use-background-upload";
import { errMsg } from "@/lib/err";

dayjs.extend(relativeTime);

const { Text } = Typography;

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

function mimeIcon(mime: string | null, name: string): { icon: string; color: string } {
  const m = mime ?? "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (m.startsWith("video/")) return { icon: "movie", color: "#e0559b" };
  if (m.startsWith("image/")) return { icon: "image", color: "#3a9d6e" };
  if (m.startsWith("audio/")) return { icon: "music_note", color: "#8b6fd6" };
  if (m.includes("pdf") || ext === "pdf") return { icon: "picture_as_pdf", color: "#e0663f" };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { icon: "folder_zip", color: "#b8842a" };
  if (["doc", "docx", "txt", "md"].includes(ext)) return { icon: "description", color: "#3f8ff0" };
  if (["xls", "xlsx", "csv"].includes(ext)) return { icon: "table_chart", color: "#2bb3a3" };
  return { icon: "draft", color: "#8a8d98" };
}

/** Repeated diagonal watermark overlay for previews (viewer identity). */
function WatermarkOverlay({ text }: { text: string }) {
  const stamps = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        top: `${(i * 37 + 11) % 90}%`,
        left: `${(i * 53 + 7) % 80}%`,
        rotate: -18 - ((i * 7) % 14),
      })),
    [],
  );
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {stamps.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: s.top,
            left: s.left,
            transform: `rotate(${s.rotate}deg)`,
            color: "rgba(255,255,255,0.28)",
            mixBlendMode: "difference",
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: "nowrap",
            textShadow: "0 0 2px rgba(0,0,0,0.35)",
          }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

/** Preview drawer: image/video/audio inline (with watermark), else info card. */
function PreviewDrawer({
  file,
  onClose,
}: {
  file: FileWithMeta | null;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const { data: url } = useFileUrl(file);
  const mime = file?.mime ?? "";
  const stamp = `${profile?.name ?? "viewer"} · ${dayjs().format("DD MMM HH:mm")}`;

  return (
    <Drawer
      title={file?.name}
      placement="right"
      width={560}
      open={Boolean(file)}
      onClose={onClose}
    >
      {!file ? null : !url ? null : (
        <div style={{ position: "relative", background: "#000", borderRadius: 10, overflow: "hidden" }}>
          {mime.startsWith("image/") ? (
            // Signed, short-lived storage URL — next/image optimization doesn't
            // apply here, a plain img is correct.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} style={{ width: "100%", display: "block" }} />
          ) : mime.startsWith("video/") ? (
            <video
              src={url}
              controls
              controlsList={file.allow_download ? undefined : "nodownload"}
              style={{ width: "100%", display: "block", maxHeight: "70vh" }}
            />
          ) : mime.startsWith("audio/") ? (
            <div style={{ padding: 16 }}>
              <audio src={url} controls style={{ width: "100%" }} />
            </div>
          ) : (
            <div style={{ padding: 28, textAlign: "center", color: "#9a9da8", background: "#fff" }}>
              No inline preview for this type.
              {file.allow_download ? (
                <div style={{ marginTop: 12 }}>
                  <Button type="primary" icon={<DownloadOutlined />} href={url} target="_blank">
                    Download
                  </Button>
                </div>
              ) : (
                <div style={{ marginTop: 12, fontSize: 12.5 }}>Download is disabled for this file.</div>
              )}
            </div>
          )}
          {file.watermark && (mime.startsWith("image/") || mime.startsWith("video/")) ? (
            <WatermarkOverlay text={stamp} />
          ) : null}
        </div>
      )}
      {file ? (
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {file.allow_download && url ? (
            <Button icon={<DownloadOutlined />} href={url} target="_blank" download>
              Download
            </Button>
          ) : (
            <Tooltip title="The uploader disabled downloads for this file">
              <Button icon={<DownloadOutlined />} disabled>
                Download
              </Button>
            </Tooltip>
          )}
          <Text type="secondary" style={{ fontSize: 12, alignSelf: "center" }}>
            {humanSize(file.size_bytes)} · {file.mime ?? "unknown"} · uploaded{" "}
            {dayjs(file.created_at).fromNow()}
            {file.author ? ` by ${file.author.name}` : ""}
          </Text>
        </div>
      ) : null}
    </Drawer>
  );
}

/**
 * The Files app surface: folders bar + upload (with permissions) + file table +
 * preview. `projectId` semantics: a project id scopes to that project; `null`
 * scopes to team-wide files (no project); `undefined` = ALL files (folder bar
 * hidden — folders belong to a scope).
 */
export function FilesBrowser({ projectId }: { projectId?: string | null }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { data: files, isLoading } = useTeamFiles();
  const { data: projects } = useProjects();
  const activeTaskId = useTaskDrawer((s) => s.taskId);
  const teamAdmin = useIsTeamAdmin();
  const { data: projectAdmin } = useIsProjectAdmin(
    typeof projectId === "string" ? projectId : undefined,
  );

  const effectiveProject = projectId === undefined ? null : projectId;
  const showFolders = projectId !== undefined;
  const canManageFolders =
    effectiveProject === null ? teamAdmin : Boolean(projectAdmin || teamAdmin);

  const { data: folders } = useFileFolders(effectiveProject);
  const createFolder = useCreateFileFolder();
  const renameFolder = useRenameFileFolder();
  const deleteFolder = useDeleteFileFolder();
  const bgUpload = useBackgroundUpload();
  const updateFile = useUpdateFile();
  const deleteFile = useDeleteTeamFile();
  const sendToReview = useSendFileToReview();

  const [activeFolder, setActiveFolder] = useState<string | null>(null); // null=All, "__none"=Unfiled
  const [folderModal, setFolderModal] = useState<null | { id?: string; name: string }>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<FileWithMeta | null>(null);

  // Upload modal state
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [upAllowDownload, setUpAllowDownload] = useState(true);
  const [upWatermark, setUpWatermark] = useState(false);
  const [upFolder, setUpFolder] = useState<string | null>(null);
  const [upProject, setUpProject] = useState<string | null>(projectId ?? null);
  const [seeded, setSeeded] = useState(false);
  if (uploadOpen && !seeded) {
    setSeeded(true);
    setFileList([]);
    setUpAllowDownload(true);
    setUpWatermark(false);
    setUpFolder(activeFolder && activeFolder !== "__none" ? activeFolder : null);
    setUpProject(projectId ?? null);
  } else if (!uploadOpen && seeded) {
    setSeeded(false);
  }

  const folderList = useMemo(() => folders ?? [], [folders]);
  const visible = useMemo(() => {
    let list = files ?? [];
    if (projectId === null) list = list.filter((f) => !f.project_id);
    else if (typeof projectId === "string") list = list.filter((f) => f.project_id === projectId);
    if (showFolders) {
      if (activeFolder === "__none") list = list.filter((f) => !f.folder_id);
      else if (activeFolder) list = list.filter((f) => f.folder_id === activeFolder);
    }
    return list;
  }, [files, projectId, activeFolder, showFolders]);

  const doUpload = () => {
    const raw = fileList.map((f) => f.originFileObj).filter(Boolean) as File[];
    if (raw.length === 0) return message.warning("Choose at least one file.");
    const proj = upProject;
    const folder = upFolder;
    const allowDownload = upAllowDownload;
    const watermark = upWatermark;
    setUploadOpen(false);
    message.success(
      raw.length === 1
        ? "Sharing file in the background…"
        : `Sharing ${raw.length} files in the background…`,
    );
    // Bytes upload in the background; the app-shell header shows progress + cancel.
    void (async () => {
      for (const f of raw) {
        try {
          await bgUpload({
            file: f,
            projectId: proj,
            folderId: folder,
            allowDownload,
            watermark,
          });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") break;
        }
      }
    })();
  };

  const saveFolder = async () => {
    if (!folderModal) return;
    const name = folderModal.name.trim();
    if (!name) return message.warning("Folder ka naam do.");
    try {
      if (folderModal.id) {
        await renameFolder.mutateAsync({ id: folderModal.id, projectId: effectiveProject, name });
      } else {
        const f = await createFolder.mutateAsync({ name, projectId: effectiveProject });
        setActiveFolder(f.id);
      }
      setFolderModal(null);
    } catch (err) {
      message.error(errMsg(err, "Couldn't save the folder."));
    }
  };

  const fileMenu = (f: FileWithMeta): MenuProps => ({
    items: [
      {
        key: "preview",
        label: "Preview",
        icon: <EyeOutlined />,
        onClick: () => setPreview(f),
      },
      {
        key: "review",
        label: "Add to Video Review",
        icon: <MIcon name="movie" size={14} />,
        disabled: !(f.mime ?? "").startsWith("video/"),
        onClick: async () => {
          try {
            const id = await sendToReview.mutateAsync({
              file: f,
              taskId: activeTaskId,
            });
            message.success("Sent to Video Review.");
            router.push(`/apps/video-review/${id}`);
          } catch (err) {
            message.error(errMsg(err, "Couldn't send to review."));
          }
        },
      },
      {
        key: "publish",
        label: f.published ? "Unpublish from server" : "Push to server (publish)",
        icon: <MIcon name={f.published ? "cloud_off" : "cloud_upload"} size={14} />,
        onClick: () =>
          void updateFile
            .mutateAsync({ id: f.id, patch: { published: !f.published } })
            .then(() =>
              message.success(f.published ? "Unpublished." : "Published — ready to share."),
            )
            .catch((err) => message.error(errMsg(err, "Couldn't update."))),
      },
      {
        key: "download",
        label: f.allow_download ? "Disable download" : "Allow download",
        icon: <DownloadOutlined />,
        onClick: () =>
          void updateFile
            .mutateAsync({ id: f.id, patch: { allow_download: !f.allow_download } })
            .catch((err) => message.error(errMsg(err, "Couldn't update."))),
      },
      {
        key: "watermark",
        label: f.watermark ? "Remove watermark" : "Watermark previews",
        icon: <MIcon name="branding_watermark" size={14} />,
        onClick: () =>
          void updateFile
            .mutateAsync({ id: f.id, patch: { watermark: !f.watermark } })
            .catch((err) => message.error(errMsg(err, "Couldn't update."))),
      },
      ...(folderList.length > 0
        ? [
            {
              key: "move",
              type: "group" as const,
              label: "Move to folder",
              children: [
                ...folderList.map((fo: FileFolder) => ({
                  key: `mv-${fo.id}`,
                  label: fo.name,
                  disabled: f.folder_id === fo.id,
                  onClick: () =>
                    void updateFile
                      .mutateAsync({ id: f.id, patch: { folder_id: fo.id } })
                      .catch((err) => message.error(errMsg(err, "Couldn't move."))),
                })),
                {
                  key: "mv-none",
                  label: "No folder",
                  disabled: !f.folder_id,
                  onClick: () =>
                    void updateFile
                      .mutateAsync({ id: f.id, patch: { folder_id: null } })
                      .catch((err) => message.error(errMsg(err, "Couldn't move."))),
                },
              ],
            },
          ]
        : []),
      { type: "divider" as const },
      {
        key: "delete",
        label: "Delete file",
        danger: true,
        icon: <MIcon name="delete" size={14} />,
        onClick: () =>
          void deleteFile
            .mutateAsync(f)
            .then(() => message.success("File deleted."))
            .catch((err) => message.error(errMsg(err, "Couldn't delete."))),
      },
    ],
  });

  const columns: ColumnsType<FileWithMeta> = [
    {
      title: "Name",
      key: "name",
      render: (_, f) => {
        const ic = mimeIcon(f.mime, f.name);
        return (
          <button
            type="button"
            onClick={() => setPreview(f)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              padding: 0,
              maxWidth: 420,
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: `${ic.color}1f`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <MIcon name={ic.icon} size={17} color={ic.color} />
            </span>
            <span style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 13.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.name}
              </div>
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                {humanSize(f.size_bytes)}
                {f.project ? ` · ${f.project.name}` : ""}
              </Text>
            </span>
          </button>
        );
      },
    },
    {
      title: "Permissions",
      key: "perm",
      width: 210,
      render: (_, f) => (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {!f.allow_download ? <Tag color="orange">view-only</Tag> : <Tag>download</Tag>}
          {f.watermark ? <Tag color="purple">watermark</Tag> : null}
          {f.published ? <Tag color="green">published</Tag> : <Tag color="default">internal</Tag>}
        </span>
      ),
    },
    {
      title: "Uploaded",
      key: "by",
      width: 200,
      render: (_, f) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Avatar size={22} src={f.author?.avatar_url ?? undefined} style={{ fontSize: 10 }}>
            {(f.author?.name ?? "?")
              .split(/\s+/)
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </Avatar>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {dayjs(f.created_at).fromNow()}
          </Text>
        </span>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 48,
      render: (_, f) => (
        <Dropdown menu={fileMenu(f)} trigger={["click"]}>
          <Button type="text" size="small" icon={<MoreOutlined />} aria-label="File actions" />
        </Dropdown>
      ),
    },
  ];

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
          border: `1px solid ${on ? "#4a4ad0" : "#ececf0"}`,
          background: on ? "#eceefb" : "#fff",
          color: on ? "#4a4ad0" : "#6a6d78",
          fontSize: 12.5,
          fontWeight: on ? 600 : 500,
          cursor: "pointer",
        }}
      >
        {label}
        <span style={{ fontSize: 11, color: on ? "#4a4ad0" : "#9a9da8" }}>{count}</span>
      </button>
    );
    return menu ? (
      <Dropdown key={key ?? "all"} menu={menu} trigger={["contextMenu"]}>
        {inner}
      </Dropdown>
    ) : (
      inner
    );
  };

  const countFor = (fid: string | null) => {
    let list = files ?? [];
    if (projectId === null) list = list.filter((f) => !f.project_id);
    else if (typeof projectId === "string") list = list.filter((f) => f.project_id === projectId);
    if (fid === null) return list.length;
    if (fid === "__none") return list.filter((f) => !f.folder_id).length;
    return list.filter((f) => f.folder_id === fid).length;
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }} />
        <div style={{ display: "flex", gap: 8 }}>
          {showFolders ? (
            <Button
              icon={<FolderAddOutlined />}
              onClick={() => setFolderModal({ name: "" })}
              disabled={!canManageFolders}
            >
              New folder
            </Button>
          ) : null}
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
            Share files
          </Button>
        </div>
      </div>

      {/* Folder bar (folders belong to the selected project scope) */}
      {!showFolders ? null : (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {chip(null, "All", countFor(null))}
        {folderList.map((f) =>
          chip(
            f.id,
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <MIcon name="folder" size={14} color={activeFolder === f.id ? "#4a4ad0" : "#9a9da8"} />
              {f.name}
            </span>,
            countFor(f.id),
            {
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
                  onClick: () =>
                    void deleteFolder
                      .mutateAsync({ id: f.id, projectId: effectiveProject })
                      .then(() => {
                        if (activeFolder === f.id) setActiveFolder(null);
                        message.success("Folder deleted — files are now unfiled.");
                      })
                      .catch((err) => message.error(errMsg(err, "Couldn't delete."))),
                },
              ],
            },
          ),
        )}
        {folderList.length > 0 && (files ?? []).some((f) => !f.folder_id)
          ? chip("__none", "Unfiled", countFor("__none"))
          : null}
      </div>
      )}

      <Table<FileWithMeta>
        rowKey="id"
        size="middle"
        loading={isLoading}
        columns={columns}
        dataSource={visible}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No files here yet — share the first one."
            />
          ),
        }}
      />

      {/* Upload modal */}
      <Modal
        title="Share files with the team"
        open={uploadOpen}
        okText="Share"
        onOk={() => void doUpload()}
        onCancel={() => setUploadOpen(false)}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          <Upload.Dragger
            multiple
            beforeUpload={() => false}
            fileList={fileList}
            onChange={({ fileList: fl }) => setFileList(fl)}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag files here</p>
            <p className="ant-upload-hint" style={{ fontSize: 12 }}>
              Stored privately for your team — everyone on the workspace (and on
              your WiFi via the LAN URL) can access per the permissions below.
            </p>
          </Upload.Dragger>

          {projectId === undefined ? (
            <div>
              <Text style={{ fontSize: 12.5, color: "#6a6d78" }}>Project (optional)</Text>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Team-wide (no project)"
                value={upProject ?? undefined}
                onChange={(v) => setUpProject(v ?? null)}
                options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
          ) : null}

          {folderList.length > 0 ? (
            <div>
              <Text style={{ fontSize: 12.5, color: "#6a6d78" }}>Folder (optional)</Text>
              <Select
                allowClear
                placeholder="No folder"
                value={upFolder ?? undefined}
                onChange={(v) => setUpFolder(v ?? null)}
                options={folderList.map((f) => ({ value: f.id, label: f.name }))}
                style={{ width: "100%", marginTop: 4 }}
              />
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Allow download</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Off = view/stream only inside the app.
              </Text>
            </div>
            <Switch checked={upAllowDownload} onChange={setUpAllowDownload} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Watermark previews</div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Overlays the viewer&apos;s name on image/video previews.
              </Text>
            </div>
            <Switch checked={upWatermark} onChange={setUpWatermark} />
          </div>
        </div>
      </Modal>

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
          onChange={(e) => setFolderModal((m) => (m ? { ...m, name: e.target.value } : m))}
          placeholder='e.g. "Briefs", "Raw footage", "Deliverables"'
          maxLength={80}
          autoFocus
          onPressEnter={() => void saveFolder()}
        />
      </Modal>

      <PreviewDrawer file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
