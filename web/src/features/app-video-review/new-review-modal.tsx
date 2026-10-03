"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Input, Modal, Segmented, Select, Spin, Typography, Upload, theme } from "antd";
import type { UploadFile } from "antd";
import { VideoCameraOutlined } from "@ant-design/icons";
import { useProjects } from "@/features/projects/use-projects";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useCreateVideoReview, useImportDriveCopy, useVideoFolders } from "./use-video-review";
import type { DriveRevisionSource } from "./use-video-review";
import { errMsg } from "@/lib/err";
import { createClient } from "@/lib/supabase/client";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { useTasks } from "@/features/tasks/use-tasks";
import { DriveSourcePicker } from "./drive/drive-source-picker";
import type { DriveAttachment, DriveFolderRef, DriveVideo } from "./drive/drive-api";
import { fetchDriveFile } from "./drive/drive-api";
import { parseDriveLink } from "./drive/drive-links";
import {
  connectDriveHref,
  pickDriveConnection,
  useDriveConnections,
} from "./drive/use-drive-connections";

const { Text } = Typography;

/**
 * Connecting Google is a full-page redirect through Google's consent screen, so
 * a half-filled dialog would be lost. The draft is parked here and picked up
 * the next time the dialog opens — which is the first thing the user does when
 * they land back on the page.
 */
const DRAFT_KEY = "cubes.video-review.new-review-draft";

interface Draft {
  title: string;
  projectId?: string | null;
  taskId?: string | null;
  folderId?: string | null;
  url?: string;
}

function saveDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private browsing and blocked storage are fine; the draft is a courtesy.
  }
}

function takeDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

/** Drops a file extension so "Launch promo v3.mp4" titles a review sensibly. */
function titleFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || name;
}

interface ReviewTaskOption {
  id: string;
  name: string;
  project_id: string;
}

function useReviewTask(taskId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["review-task", taskId],
    enabled: Boolean(taskId),
    queryFn: async (): Promise<ReviewTaskOption | null> => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,name,project_id")
        .eq("id", taskId as string)
        .maybeSingle();
      if (error) throw error;
      return data as ReviewTaskOption | null;
    },
  });
}

type SourceKind = "upload" | "drive" | "url";

/**
 * Add-a-video dialog, shared by the App Center browser and a project's Video
 * Review view. When `defaultProjectId` is set the project is fixed (the picker
 * is hidden) so the video is created inside that project.
 *
 * Three ways in, because they are genuinely different problems: a file on this
 * machine, a file in the team's Drive, and a link to anywhere else. Drive earns
 * its own tab rather than being a special case of "link" because a Drive video
 * only supports timestamped comments when Cubes can stream it — and that needs
 * a connection and a picked file, not a URL.
 */
export function NewReviewModal({
  open,
  onClose,
  defaultProjectId,
  defaultFolderId,
  defaultTaskId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
  defaultFolderId?: string | null;
  defaultTaskId?: string | null;
  onCreated?: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: projects } = useProjects();
  const { data: activeTeam } = useActiveTeam();
  const create = useCreateVideoReview();
  const importCopy = useImportDriveCopy();
  const activeDrawerTaskId = useTaskDrawer((s) => s.taskId);
  const seededTaskId = defaultTaskId ?? activeDrawerTaskId ?? undefined;
  const { data: seedTask } = useReviewTask(seededTaskId);
  const { data: connections } = useDriveConnections();
  const teamId = activeTeam?.id;

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [source, setSource] = useState<SourceKind>("upload");
  const [url, setUrl] = useState("");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [drive, setDrive] = useState<DriveAttachment | null>(null);
  const [driveFolder, setDriveFolder] = useState<DriveFolderRef | null>(null);
  const [driveConnectionId, setDriveConnectionId] = useState<string | null>(null);
  const [importAfterCreate, setImportAfterCreate] = useState(false);
  const [resolvingLink, setResolvingLink] = useState(false);
  const [bulk, setBulk] = useState<{ videos: DriveVideo[]; connectionId: string } | null>(null);

  const selectedProjectId = defaultProjectId ?? projectId ?? seedTask?.project_id ?? undefined;
  const { data: folders } = useVideoFolders(selectedProjectId ?? null);
  const { data: projectTasks } = useTasks(selectedProjectId);
  const connection = pickDriveConnection(connections, driveConnectionId);
  const googleConnected = Boolean(connection);

  if (open && !seeded) {
    setSeeded(true);
    const draft = takeDraft();
    setTitle(draft?.title ?? "");
    setProjectId(defaultProjectId ?? draft?.projectId ?? seedTask?.project_id ?? undefined);
    setTaskId(defaultTaskId ?? draft?.taskId ?? seedTask?.id ?? null);
    setFolderId(defaultFolderId ?? draft?.folderId ?? null);
    // Coming back from Google's consent screen, the Drive tab is what they
    // were reaching for; a saved draft is the only evidence we have of that.
    setSource(draft ? "drive" : "upload");
    setUrl(draft?.url ?? "");
    setFileList([]);
    setDrive(null);
    setDriveFolder(null);
    setImportAfterCreate(false);
    setBulk(null);
  } else if (!open && seeded) {
    setSeeded(false);
  }
  if (open && seeded && seedTask && !defaultProjectId && !projectId && !taskId) {
    setProjectId(seedTask.project_id);
    setTaskId(seedTask.id);
  }

  /**
   * A Drive pick names itself, so an empty title fills in rather than blocking
   * the submit on a field the user has no opinion about. Done on the pick, not
   * in an effect: an effect would also fire on unrelated re-renders, and a
   * title the user has since cleared on purpose would keep coming back.
   */
  const attachDrive = (next: DriveAttachment | null) => {
    setDrive(next);
    if (next && !title.trim()) setTitle(titleFromFileName(next.video.name));
    if (!next) setImportAfterCreate(false);
    setBulk(null);
  };

  const file = fileList[0]?.originFileObj as File | undefined;
  const driveLink = useMemo(() => parseDriveLink(url), [url]);

  const stashDraft = () =>
    saveDraft({ title, projectId: selectedProjectId ?? null, taskId, folderId, url });

  const connectHref = teamId
    ? connectDriveHref(
        teamId,
        typeof window === "undefined" ? "/apps/video-review" : window.location.pathname,
      )
    : null;

  /** Pull a pasted Drive link through our backend so it becomes timestampable. */
  const resolvePastedLink = async () => {
    if (!driveLink || !teamId || !connection) return;
    setResolvingLink(true);
    try {
      const resolved = await fetchDriveFile({
        connectionId: connection.id,
        fileId: driveLink.id,
      });
      if (resolved.kind === "folder") {
        setDriveFolder(resolved.folder);
        setSource("drive");
      } else {
        attachDrive({ connectionId: connection.id, video: resolved.video });
        setSource("drive");
      }
    } catch (err) {
      message.error(errMsg(err, "Couldn’t open that Drive link."));
    } finally {
      setResolvingLink(false);
    }
  };

  const driveSource = (attachment: DriveAttachment): DriveRevisionSource => ({
    connectionId: attachment.connectionId,
    fileId: attachment.video.id,
    name: attachment.video.name,
    mimeType: attachment.video.mimeType,
    sizeBytes: attachment.video.sizeBytes,
    durationMs: attachment.video.durationMs,
    thumbnailUrl: attachment.video.thumbnailUrl,
  });

  /** "Add all as separate reviews" — one review per picked file. */
  const submitBulk = async (videos: DriveVideo[], connectionId: string) => {
    const created: string[] = [];
    const failed: string[] = [];
    for (const video of videos) {
      try {
        const id = await create.mutateAsync({
          title: titleFromFileName(video.name),
          projectId: selectedProjectId ?? null,
          taskId: taskId ?? null,
          folderId,
          drive: driveSource({ connectionId, video }),
        });
        created.push(id);
      } catch {
        // One bad file must not throw away the ones that worked, so failures
        // are collected and reported together at the end.
        failed.push(video.name);
      }
    }
    if (created.length) {
      message.success(
        created.length === 1 ? "Video added for review." : `${created.length} videos added for review.`,
      );
    }
    if (failed.length) {
      message.warning(`Couldn’t add: ${failed.join(", ")}`);
    }
    if (created.length) {
      if (created.length === 1) onCreated?.(created[0]);
      onClose();
    }
  };

  const submit = async () => {
    if (bulk) return submitBulk(bulk.videos, bulk.connectionId);
    if (!title.trim()) return message.warning("Give the video a title.");
    if (source === "upload" && !file) return message.warning("Choose a video file.");
    if (source === "drive" && !drive) return message.warning("Choose a video from Drive.");
    if (source === "url" && !url.trim()) return message.warning("Paste a video URL.");
    try {
      const id = await create.mutateAsync({
        title: title.trim(),
        projectId: selectedProjectId ?? null,
        taskId: taskId ?? null,
        folderId,
        file: source === "upload" ? file : null,
        url: source === "url" ? url.trim() : null,
        drive: source === "drive" && drive ? driveSource(drive) : null,
      });
      message.success("Video added for review.");
      if (source === "drive" && drive && importAfterCreate) {
        // Fire-and-forget: the review already exists and plays; the copy is an
        // optimisation, so a failure here is a warning, not a failed create.
        importCopy
          .mutateAsync({ videoId: id, revision: 1 })
          .catch((err) => message.warning(errMsg(err, "The copy didn’t start.")));
      }
      onCreated?.(id);
      onClose();
    } catch (err) {
      message.error(errMsg(err, "Failed to add video."));
    }
  };

  return (
    <Modal
      title="New video review"
      open={open}
      onOk={submit}
      okText={bulk ? `Add ${bulk.videos.length} reviews` : "Add for review"}
      confirmLoading={create.isPending}
      onCancel={onClose}
      destroyOnHidden
      width={560}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
        <div>
          <Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>Title</Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Launch promo — cut 1"
            autoFocus
            style={{ marginTop: 4 }}
          />
        </div>
        {selectedProjectId && (folders ?? []).length > 0 ? (
          <div>
            <Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>Folder (optional)</Text>
            <Select
              allowClear
              placeholder="No folder"
              value={folderId ?? undefined}
              onChange={(v) => setFolderId(v ?? null)}
              options={(folders ?? []).map((f) => ({ value: f.id, label: f.name }))}
              style={{ width: "100%", marginTop: 4 }}
            />
          </div>
        ) : null}
        {defaultProjectId ? null : (
          <div>
            <Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>Project (optional)</Text>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Not linked to a project"
              value={selectedProjectId}
              onChange={(value) => {
                setProjectId(value);
                setTaskId(null);
                setFolderId(null);
              }}
              options={(projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
              style={{ width: "100%", marginTop: 4 }}
            />
          </div>
        )}
        {selectedProjectId ? (
          <div>
            <Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>Task (optional)</Text>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Not linked to a task"
              value={taskId ?? undefined}
              onChange={(value) => setTaskId(value ?? null)}
              options={(projectTasks ?? []).map((task) => ({
                value: task.id,
                label: task.name,
              }))}
              style={{ width: "100%", marginTop: 4 }}
            />
          </div>
        ) : null}
        <div>
          <Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>Source</Text>
          <Segmented
            block
            value={source}
            onChange={(v) => {
              setSource(v as SourceKind);
              setBulk(null);
            }}
            options={[
              { label: "Upload", value: "upload" },
              { label: "Google Drive", value: "drive" },
              { label: "Link", value: "url" },
            ]}
            style={{ marginTop: 4, marginBottom: 8 }}
          />
          {source === "upload" ? (
            <Upload.Dragger
              maxCount={1}
              accept="video/*"
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
            >
              <p className="ant-upload-drag-icon">
                <VideoCameraOutlined />
              </p>
              <p className="ant-upload-text">Click or drag a video file here</p>
              <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                MP4/WebM/MOV. Stored privately for your team.
              </p>
            </Upload.Dragger>
          ) : source === "drive" ? (
            <DriveSourcePicker
              teamId={teamId}
              returnTo={typeof window === "undefined" ? "/apps/video-review" : window.location.pathname}
              value={drive}
              onChange={attachDrive}
              connectionId={driveConnectionId}
              onConnectionChange={setDriveConnectionId}
              openFolder={driveFolder}
              onAddMany={(videos, connectionId) => {
                // Staged rather than created immediately: the project, task and
                // folder above apply to all of them, and the user may still be
                // choosing those.
                setBulk({ videos, connectionId });
                setDrive(null);
              }}
              addManyLabel="Add all as separate reviews"
              importAsIntent
              importIntent={importAfterCreate}
              onImportIntentChange={setImportAfterCreate}
              onBeforeConnect={stashDraft}
            />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/video.mp4, YouTube, Vimeo, Loom, Drive…"
              />
              {driveLink && googleConnected ? (
                <Alert
                  type="info"
                  showIcon
                  message={
                    driveLink.kind === "folder"
                      ? "That’s a Google Drive folder"
                      : "That’s a Google Drive video"
                  }
                  description={
                    <div style={{ display: "grid", gap: 8 }}>
                      <span style={{ fontSize: 12.5 }}>
                        {driveLink.kind === "folder"
                          ? "Open it here and pick which video to review — Cubes will play it in its own player, so comments can carry a timestamp."
                          : "Bring it in through Google so Cubes can play it itself. Pasted as a plain link it plays inside Drive’s player, where timestamps and drawings don’t work."}
                      </span>
                      <Button
                        type="primary"
                        size="small"
                        loading={resolvingLink}
                        onClick={resolvePastedLink}
                        style={{ justifySelf: "start" }}
                      >
                        {driveLink.kind === "folder" ? "Open this folder" : "Use it through Google Drive"}
                      </Button>
                    </div>
                  }
                />
              ) : driveLink && !googleConnected ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Timestamps won’t work on this link"
                  description={
                    <div style={{ display: "grid", gap: 8 }}>
                      <span style={{ fontSize: 12.5 }}>
                        A Drive link plays inside Drive’s own player, which Cubes can’t read
                        the playhead from — so comments and drawings can’t be pinned to a
                        moment. Connect Google and Cubes streams the same file itself, or
                        upload the video instead.
                      </span>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button
                          type="primary"
                          size="small"
                          disabled={!connectHref}
                          onClick={() => {
                            stashDraft();
                            if (connectHref) window.location.assign(connectHref);
                          }}
                        >
                          Connect Google
                        </Button>
                        <Button size="small" onClick={() => setSource("upload")}>
                          Upload instead
                        </Button>
                      </div>
                      <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                        You can still add it as a plain link — it will play, just without
                        timestamped comments.
                      </span>
                    </div>
                  }
                />
              ) : null}
              {resolvingLink ? <Spin size="small" /> : null}
            </div>
          )}
        </div>

        {bulk ? (
          <Alert
            type="success"
            showIcon
            message={`${bulk.videos.length} videos ready`}
            description={
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12.5 }}>
                  Each one becomes its own review, named after the file. The project, task
                  and folder above apply to all of them.
                </span>
                <Button size="small" onClick={() => setBulk(null)} style={{ justifySelf: "start" }}>
                  Clear
                </Button>
              </div>
            }
          />
        ) : null}
      </div>
    </Modal>
  );
}
