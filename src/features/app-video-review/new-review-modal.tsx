"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Input, Modal, Segmented, Select, Typography, Upload, theme } from "antd";
import type { UploadFile } from "antd";
import { VideoCameraOutlined } from "@ant-design/icons";
import { useProjects } from "@/features/projects/use-projects";
import { useCreateVideoReview, useVideoFolders } from "./use-video-review";
import { errMsg } from "@/lib/err";
import { createClient } from "@/lib/supabase/client";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { useTasks } from "@/features/tasks/use-tasks";

const { Text } = Typography;

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

/**
 * Add-a-video dialog, shared by the App Center browser and a project's Video
 * Review view. When `defaultProjectId` is set the project is fixed (the picker
 * is hidden) so the video is created inside that project.
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
  const create = useCreateVideoReview();
  const activeDrawerTaskId = useTaskDrawer((s) => s.taskId);
  const seededTaskId = defaultTaskId ?? activeDrawerTaskId ?? undefined;
  const { data: seedTask } = useReviewTask(seededTaskId);

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [source, setSource] = useState<"upload" | "url">("upload");
  const [url, setUrl] = useState("");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [seeded, setSeeded] = useState(false);
  const selectedProjectId = defaultProjectId ?? projectId ?? seedTask?.project_id ?? undefined;
  const { data: folders } = useVideoFolders(selectedProjectId ?? null);
  const { data: projectTasks } = useTasks(selectedProjectId);

  if (open && !seeded) {
    setSeeded(true);
    setTitle("");
    setProjectId(defaultProjectId ?? seedTask?.project_id);
    setTaskId(defaultTaskId ?? seedTask?.id ?? null);
    setFolderId(defaultFolderId ?? null);
    setSource("upload");
    setUrl("");
    setFileList([]);
  } else if (!open && seeded) {
    setSeeded(false);
  }
  if (
    open &&
    seeded &&
    seedTask &&
    !defaultProjectId &&
    !projectId &&
    !taskId
  ) {
    setProjectId(seedTask.project_id);
    setTaskId(seedTask.id);
  }

  const file = fileList[0]?.originFileObj as File | undefined;

  const submit = async () => {
    if (!title.trim()) return message.warning("Give the video a title.");
    if (source === "upload" && !file) return message.warning("Choose a video file.");
    if (source === "url" && !url.trim()) return message.warning("Paste a video URL.");
    try {
      const id = await create.mutateAsync({
        title: title.trim(),
        projectId: selectedProjectId ?? null,
        taskId: taskId ?? null,
        folderId,
        file: source === "upload" ? file : null,
        url: source === "url" ? url.trim() : null,
      });
      message.success("Video added for review.");
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
      okText="Add for review"
      confirmLoading={create.isPending}
      onCancel={onClose}
      destroyOnHidden
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
            onChange={(v) => setSource(v as "upload" | "url")}
            options={[
              { label: "Upload file", value: "upload" },
              { label: "Link (URL)", value: "url" },
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
          ) : (
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/video.mp4" />
          )}
        </div>
      </div>
    </Modal>
  );
}
