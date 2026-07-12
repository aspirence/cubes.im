"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  App,
  Avatar,
  Button,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DownloadOutlined,
  EditOutlined,
  SearchOutlined,
  UndoOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  VRThemeProvider,
  StatusChip,
  useVR,
} from "@/features/app-video-review/vr-theme";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useVideoReviewVideo,
  useVideoRevisions,
  useRevisionUrl,
  useVideoComments,
  useAddComment,
  useAddRevision,
  useToggleCommentResolved,
  useVideoReviewers,
  useSetVideoEditor,
  useSetReviewers,
  useSendForReview,
  useDecideReview,
  useVideoWorkflowTemplates,
  useCreateWorkflowTemplate,
  useApplyWorkflowTemplate,
  type VideoWithProject,
  type Drawing,
} from "@/features/app-video-review/use-video-review";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MemberSelect } from "@/features/team-members/member-select";
import { errMsg } from "@/lib/err";

dayjs.extend(relativeTime);

const { Text } = Typography;

type Stroke = Drawing["strokes"][number];
const PEN = { color: "#ff4d4f", width: 3 };

/**
 * A canvas overlaid on the video for freehand frame annotations. When
 * `editable`, it captures strokes (normalized 0..1) into `strokes`; otherwise it
 * renders `display` read-only. Redraws every render (cheap) so it stays in sync
 * with resizes and comment switches.
 */
function DrawingOverlay({
  editable,
  strokes,
  onStrokesChange,
  display,
}: {
  editable: boolean;
  strokes: Stroke[];
  onStrokesChange: (s: Stroke[]) => void;
  display: Drawing | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const renderStrokes = editable ? strokes : display?.strokes ?? [];

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of renderStrokes) {
      if (s.points.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = p[0] * c.width;
        const y = p[1] * c.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  });

  const norm = (e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={(e) => {
        if (!editable) return;
        e.preventDefault();
        drawing.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onStrokesChange([...strokes, { ...PEN, points: [norm(e)] }]);
      }}
      onPointerMove={(e) => {
        if (!editable || !drawing.current) return;
        const last = strokes[strokes.length - 1];
        if (!last) return;
        onStrokesChange([
          ...strokes.slice(0, -1),
          { ...last, points: [...last.points, norm(e)] },
        ]);
      }}
      onPointerUp={() => {
        drawing.current = false;
      }}
      onPointerLeave={() => {
        drawing.current = false;
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        cursor: editable ? "crosshair" : "default",
        pointerEvents: editable ? "auto" : "none",
        touchAction: "none",
      }}
    />
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/** Upload-a-new-version modal (file or URL). */
function NewVersionModal({
  open,
  onClose,
  videoId,
  teamId,
  nextRevision,
}: {
  open: boolean;
  onClose: () => void;
  videoId: string;
  teamId: string;
  nextRevision: number;
}) {
  const { message } = App.useApp();
  const addRevision = useAddRevision();
  const [source, setSource] = useState<"upload" | "url">("upload");
  const [url, setUrl] = useState("");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [summary, setSummary] = useState("");
  const [seeded, setSeeded] = useState(false);

  if (open && !seeded) {
    setSeeded(true);
    setSource("upload");
    setUrl("");
    setFileList([]);
    setSummary("");
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const file = fileList[0]?.originFileObj as File | undefined;

  const submit = async () => {
    if (source === "upload" && !file) return message.warning("Choose a file.");
    if (source === "url" && !url.trim()) return message.warning("Paste a URL.");
    try {
      await addRevision.mutateAsync({
        videoId,
        teamId,
        nextRevision,
        summary: summary.trim() || null,
        file: source === "upload" ? file : null,
        url: source === "url" ? url.trim() : null,
      });
      message.success(`Version v${nextRevision} uploaded.`);
      onClose();
    } catch (err) {
      message.error(errMsg(err, "Failed to upload version."));
    }
  };

  return (
    <Modal
      title={`Upload version v${nextRevision}`}
      open={open}
      onOk={submit}
      okText="Upload version"
      confirmLoading={addRevision.isPending}
      onCancel={onClose}
      destroyOnHidden
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <Segmented
          block
          value={source}
          onChange={(v) => setSource(v as "upload" | "url")}
          options={[
            { label: "Upload file", value: "upload" },
            { label: "Link (URL)", value: "url" },
          ]}
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
            <p className="ant-upload-text">Click or drag the new cut here</p>
          </Upload.Dragger>
        ) : (
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/v2.mp4" />
        )}
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What changed in this version? (optional)"
        />
      </div>
    </Modal>
  );
}

/** The review workflow: editor + reviewers, apply/save a template, and the
 *  stage actions (send for review → approve / request changes). */
function WorkflowPanel({ video }: { video: VideoWithProject }) {
  const VR = useVR();
  const { message } = App.useApp();
  const { data: members } = useTeamMembers();
  const { data: reviewers } = useVideoReviewers(video.id);
  const { data: templates } = useVideoWorkflowTemplates();
  const setEditor = useSetVideoEditor();
  const setReviewers = useSetReviewers();
  const sendForReview = useSendForReview();
  const decide = useDecideReview();
  const createTemplate = useCreateWorkflowTemplate();
  const applyTemplate = useApplyWorkflowTemplate();
  const [saveOpen, setSaveOpen] = useState(false);
  const [tplName, setTplName] = useState("");

  // Editor / reviewers reference USER ids (not team_member ids).
  const memberOptions = (members ?? [])
    .filter((m) => m.user)
    .map((m) => ({
      value: m.user!.id,
      label: m.user!.name,
      avatarUrl: m.user!.avatar_url,
      email: m.user!.email,
    }));
  const reviewerIds = (reviewers ?? []).map((r) => r.user_id);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      message.success(ok);
    } catch (err) {
      message.error(errMsg(err, "Something went wrong."));
    }
  };

  const stageStep =
    video.stage === "approved" ? 2 : video.stage === "in_review" ? 1 : 0;

  return (
    <div
      style={{
        border: `1px solid ${VR.hairline}`,
        borderRadius: 12,
        background: VR.panel,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Text strong style={{ flex: 1 }}>
          Review workflow
        </Text>
        <Select
          size="small"
          placeholder="Apply template"
          style={{ width: 160 }}
          value={undefined}
          onChange={(id) => {
            const tpl = (templates ?? []).find((t) => t.id === id);
            if (!tpl) return;
            void act(
              () =>
                applyTemplate.mutateAsync({
                  videoId: video.id,
                  templateId: tpl.id,
                  config: (tpl.config ?? {}) as never,
                  existingReviewers: reviewerIds,
                }),
              "Template applied.",
            );
          }}
          options={(templates ?? []).map((t) => ({ value: t.id, label: t.name }))}
        />
      </div>

      {/* Stage strip */}
      <div style={{ display: "flex", gap: 6 }}>
        {["Editing", "In review", "Approved"].map((label, i) => (
          <div
            key={label}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 11.5,
              fontWeight: 600,
              padding: "5px 4px",
              borderRadius: 6,
              color: i <= stageStep ? "#fff" : VR.textTertiary,
              background:
                i < stageStep ? "#3a9d6e" : i === stageStep ? "#4a4ad0" : VR.panelSoft,
            }}
          >
            {label}
          </div>
        ))}
      </div>

      <div>
        <Text style={{ fontSize: 12, color: VR.textSecondary }}>Editor</Text>
        <Select
          size="small"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Who is editing?"
          value={video.editor_id ?? undefined}
          onChange={(v) =>
            void act(
              () => setEditor.mutateAsync({ videoId: video.id, editorId: v ?? null }),
              "Editor updated.",
            )
          }
          options={memberOptions.map((o) => ({ value: o.value, label: o.label }))}
          style={{ width: "100%", marginTop: 4 }}
        />
      </div>

      <div>
        <Text style={{ fontSize: 12, color: VR.textSecondary }}>Reviewers (client / manager)</Text>
        <div style={{ marginTop: 4 }}>
          <MemberSelect
            value={reviewerIds}
            onChange={(ids) =>
              void act(
                () =>
                  setReviewers.mutateAsync({
                    videoId: video.id,
                    userIds: ids,
                    existing: reviewerIds,
                  }),
                "Reviewers updated.",
              )
            }
            options={memberOptions}
            placeholder="Add reviewers"
          />
        </div>
      </div>

      {/* Stage actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {video.stage === "approved" ? (
          <Tag color="success" style={{ marginInlineEnd: 0 }}>
            Approved
          </Tag>
        ) : video.stage === "in_review" ? (
          <>
            <Button
              type="primary"
              size="small"
              loading={decide.isPending}
              onClick={() =>
                void act(
                  () => decide.mutateAsync({ videoId: video.id, approved: true }),
                  "Approved.",
                )
              }
            >
              Approve
            </Button>
            <Button
              size="small"
              loading={decide.isPending}
              onClick={() =>
                void act(
                  () => decide.mutateAsync({ videoId: video.id, approved: false }),
                  "Changes requested — editor notified.",
                )
              }
            >
              Request changes
            </Button>
          </>
        ) : (
          <Tooltip
            title={reviewerIds.length === 0 ? "Add at least one reviewer first" : ""}
          >
            <Button
              type="primary"
              size="small"
              disabled={reviewerIds.length === 0}
              loading={sendForReview.isPending}
              onClick={() =>
                void act(
                  () => sendForReview.mutateAsync(video.id),
                  "Sent for review — reviewers notified.",
                )
              }
            >
              Send for review
            </Button>
          </Tooltip>
        )}
        <span style={{ flex: 1 }} />
        <Button size="small" type="text" onClick={() => setSaveOpen(true)}>
          Save as template
        </Button>
      </div>

      <Modal
        title="Save workflow template"
        open={saveOpen}
        okText="Save template"
        confirmLoading={createTemplate.isPending}
        onCancel={() => setSaveOpen(false)}
        onOk={() => {
          if (!tplName.trim()) return message.warning("Name the template.");
          void act(async () => {
            await createTemplate.mutateAsync({
              name: tplName.trim(),
              config: { editorId: video.editor_id, reviewerIds },
            });
            setSaveOpen(false);
            setTplName("");
          }, "Template saved.");
        }}
        destroyOnHidden
      >
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          Saves the current editor + reviewer set as a reusable workflow you can
          apply to future videos.
        </Text>
        <Input
          value={tplName}
          onChange={(e) => setTplName(e.target.value)}
          placeholder='e.g. "Client review — Acme"'
          style={{ marginTop: 10 }}
        />
      </Modal>
    </div>
  );
}

export default function VideoReviewScreen() {
  const VR = useVR();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { message } = App.useApp();

  const { data: video, isLoading } = useVideoReviewVideo(id);
  const { data: revisions } = useVideoRevisions(id);

  const [activeRev, setActiveRev] = useState<number | null>(null);
  const rev = activeRev ?? video?.latest_revision ?? 1;
  const currentRevision = (revisions ?? []).find((r) => r.revision === rev);
  const { data: playUrl } = useRevisionUrl(currentRevision);
  const { data: comments } = useVideoComments(id, rev);

  const addComment = useAddComment();
  const toggleResolved = useToggleCommentResolved();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [body, setBody] = useState("");
  const [versionOpen, setVersionOpen] = useState(false);
  // Frame drawing
  const [drawMode, setDrawMode] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [displayDrawing, setDisplayDrawing] = useState<Drawing | null>(null);
  // Right panel (PlayPause-style)
  const [panelTab, setPanelTab] = useState<"comments" | "workflow">("comments");
  const [commentFilter, setCommentFilter] = useState<"all" | "open" | "done">("all");
  const [sortBy, setSortBy] = useState<"time" | "new">("time");
  const [searchQ, setSearchQ] = useState("");

  const seek = (ms: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000;
      void videoRef.current.play().catch(() => {});
    }
  };

  const submitComment = async () => {
    if (!id || !body.trim()) return;
    try {
      await addComment.mutateAsync({
        videoId: id,
        revision: rev,
        body: body.trim(),
        timeMs: currentTime * 1000,
        drawing: drawMode && strokes.length > 0 ? { strokes } : null,
      });
      setBody("");
      setStrokes([]);
      setDrawMode(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to add comment."));
    }
  };

  if (isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!video) {
    return (
      <Empty description="Video not found or you don't have access.">
        <Link href="/apps/video-review">
          <Button type="primary">Back to Video Review</Button>
        </Link>
      </Empty>
    );
  }

  const nextRevision = Math.max(video.latest_revision, ...(revisions ?? []).map((r) => r.revision)) + 1;

  // ---- comment filtering / sorting (right panel) ---------------------------
  const q = searchQ.trim().toLowerCase();
  const filteredComments = (comments ?? [])
    .filter((c) =>
      commentFilter === "all" ? true : commentFilter === "open" ? !c.resolved : c.resolved,
    )
    .filter(
      (c) =>
        !q ||
        c.body.toLowerCase().includes(q) ||
        (c.author?.name ?? "").toLowerCase().includes(q),
    );
  const sortedComments =
    sortBy === "time"
      ? filteredComments // query order = by timestamp
      : [...filteredComments].sort(
          (a, b) => dayjs(b.created_at).valueOf() - dayjs(a.created_at).valueOf(),
        );
  const openCount = (comments ?? []).filter((c) => !c.resolved).length;
  const doneCount = (comments ?? []).filter((c) => c.resolved).length;

  return (
    <VRThemeProvider>
      <div
        style={{
          margin: "-22px -24px -48px",
          background: VR.bg,
          height: "calc(100vh - 58px)", overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top bar ------------------------------------------------------- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 18px",
            borderBottom: `1px solid ${VR.hairline}`,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/apps/video-review"
            aria-label="Back to Video Review"
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              background: VR.panelSoft,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: VR.textSecondary,
            }}
          >
            <ArrowLeftOutlined />
          </Link>
          <span
            style={{
              fontWeight: 700,
              color: VR.text,
              fontSize: 15.5,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {video.title}
          </span>
          {video.project ? (
            <Link href={`/projects/${video.project.id}`}>
              <Tag style={{ marginInlineEnd: 0 }}>{video.project.name}</Tag>
            </Link>
          ) : null}
          <StatusChip status={video.status} />
          <Select
            size="small"
            value={rev}
            onChange={setActiveRev}
            style={{ width: 118 }}
            options={(revisions ?? []).map((r) => ({
              value: r.revision,
              label: `Version v${r.revision}`,
            }))}
          />
          <Button size="small" icon={<UploadOutlined />} onClick={() => setVersionOpen(true)}>
            New version
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={!playUrl}
            href={playUrl ?? undefined}
            target="_blank"
            download
          >
            Download
          </Button>
        </div>

        {/* Body ----------------------------------------------------------- */}
        <div
          className="wl-vr-review-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 380px",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Player column */}
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, overflowY: "auto" }}>
            <div
              style={{
                background: "#000",
                borderRadius: 12,
                overflow: "hidden",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {playUrl ? (
                // Wrapper hugs the video's intrinsic box so the drawing canvas
                // aligns with the actual pixels (no letterbox offset).
                <div style={{ position: "relative", display: "inline-block" }}>
                  <video
                    ref={videoRef}
                    src={playUrl}
                    controls={!drawMode}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    style={{ maxWidth: "100%", maxHeight: "62vh", display: "block" }}
                  />
                  {drawMode || displayDrawing ? (
                    <DrawingOverlay
                      editable={drawMode}
                      strokes={strokes}
                      onStrokesChange={setStrokes}
                      display={drawMode ? null : displayDrawing}
                    />
                  ) : null}
                </div>
              ) : (
                <div
                  style={{
                    height: 320,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: VR.textTertiary,
                  }}
                >
                  No video source for this version.
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Tag
                style={{
                  marginInlineEnd: 0,
                  fontVariantNumeric: "tabular-nums",
                  background: VR.accentSoft,
                  color: VR.accent,
                  borderColor: "transparent",
                }}
              >
                @ {fmt(currentTime)}
              </Tag>
              <Button
                size="small"
                type={drawMode ? "primary" : "default"}
                icon={<EditOutlined />}
                onClick={() => {
                  const next = !drawMode;
                  setDrawMode(next);
                  if (next) {
                    videoRef.current?.pause();
                    setDisplayDrawing(null);
                  } else {
                    setStrokes([]);
                  }
                }}
              >
                Draw
              </Button>
              {drawMode && strokes.length > 0 ? (
                <Button size="small" type="text" onClick={() => setStrokes([])}>
                  Clear
                </Button>
              ) : null}
              {displayDrawing && !drawMode ? (
                <Button size="small" type="text" onClick={() => setDisplayDrawing(null)}>
                  Hide drawing
                </Button>
              ) : null}
              <span style={{ flex: 1 }} />
              {currentRevision?.summary ? (
                <Text style={{ color: VR.textTertiary, fontSize: 12.5 }}>
                  v{rev}: {currentRevision.summary}
                </Text>
              ) : null}
            </div>
          </div>

          {/* Right panel */}
          <div
            style={{
              borderLeft: `1px solid ${VR.hairline}`,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {/* Icon tabs */}
            <div style={{ display: "flex", gap: 6, padding: "10px 12px 0" }}>
              {(
                [
                  { key: "comments", icon: "chat_bubble", label: "Comments" },
                  { key: "workflow", icon: "account_tree", label: "Workflow" },
                ] as const
              ).map((t) => {
                const on = panelTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setPanelTab(t.key)}
                    aria-label={t.label}
                    title={t.label}
                    style={{
                      width: 40,
                      height: 34,
                      borderRadius: 9,
                      border: "none",
                      cursor: "pointer",
                      background: on ? VR.accentSoft : "transparent",
                      color: on ? VR.accent : VR.textTertiary,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 19 }}>
                      {t.icon}
                    </span>
                  </button>
                );
              })}
            </div>

            {panelTab === "workflow" ? (
              <div style={{ padding: 12, overflowY: "auto" }}>
                <WorkflowPanel video={video} />
              </div>
            ) : (
              <>
                {/* Filter pills */}
                <div style={{ padding: "10px 12px 0" }}>
                  <Segmented
                    size="small"
                    value={commentFilter}
                    onChange={(v) => setCommentFilter(v as "all" | "open" | "done")}
                    options={[
                      { label: `All`, value: "all" },
                      { label: `Open${openCount ? ` ${openCount}` : ""}`, value: "open" },
                      { label: `Done${doneCount ? ` ${doneCount}` : ""}`, value: "done" },
                    ]}
                  />
                </div>

                {/* Composer */}
                <div
                  style={{
                    margin: 12,
                    marginBottom: 6,
                    background: VR.panel,
                    border: `1px solid ${VR.hairline}`,
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Tag
                      style={{
                        marginInlineEnd: 0,
                        fontVariantNumeric: "tabular-nums",
                        background: VR.accentSoft,
                        color: VR.accent,
                        borderColor: "transparent",
                      }}
                    >
                      {fmt(currentTime)}
                    </Tag>
                    <Text style={{ color: VR.textTertiary, fontSize: 11.5 }}>
                      pins to the current frame
                    </Text>
                  </div>
                  <Input.TextArea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Add a comment…"
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    onPressEnter={(e) => {
                      if (!e.shiftKey) {
                        e.preventDefault();
                        void submitComment();
                      }
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                    <Button
                      type="primary"
                      size="small"
                      loading={addComment.isPending}
                      disabled={!body.trim()}
                      onClick={submitComment}
                    >
                      Comment
                    </Button>
                  </div>
                </div>

                {/* Sort + search */}
                <div style={{ display: "flex", gap: 8, padding: "0 12px 8px" }}>
                  <Select
                    size="small"
                    value={sortBy}
                    onChange={setSortBy}
                    style={{ width: 132 }}
                    options={[
                      { value: "time", label: "By timestamp" },
                      { value: "new", label: "Newest first" },
                    ]}
                  />
                  <Input
                    size="small"
                    allowClear
                    prefix={<SearchOutlined style={{ color: VR.textTertiary }} />}
                    placeholder="Search comments…"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                  />
                </div>

                {/* Comment list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
                  {sortedComments.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "44px 16px" }}>
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 16,
                          background: VR.panelSoft,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginBottom: 12,
                        }}
                      >
                        <span
                          className="material-symbols-rounded"
                          aria-hidden
                          style={{ fontSize: 26, color: VR.textTertiary }}
                        >
                          chat_bubble
                        </span>
                      </div>
                      <div style={{ color: VR.text, fontWeight: 600 }}>No comments yet</div>
                      <div style={{ color: VR.textTertiary, fontSize: 12.5 }}>
                        Be the first to comment.
                      </div>
                    </div>
                  ) : (
                    sortedComments.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          display: "flex",
                          gap: 8,
                          padding: 8,
                          borderRadius: 10,
                          opacity: c.resolved ? 0.55 : 1,
                        }}
                      >
                        <Avatar
                          size={26}
                          src={c.author?.avatar_url ?? undefined}
                          style={{ fontSize: 11, flex: "none" }}
                        >
                          {initials(c.author?.name ?? "?")}
                        </Avatar>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Text strong style={{ fontSize: 12.5, color: VR.text }}>
                              {c.author?.name ?? "Someone"}
                            </Text>
                            <button
                              type="button"
                              onClick={() => {
                                seek(c.time_ms);
                                setDrawMode(false);
                                setStrokes([]);
                                setDisplayDrawing(
                                  (c.drawing as unknown as Drawing | null) ?? null,
                                );
                              }}
                              style={{
                                border: "none",
                                background: VR.accentSoft,
                                color: VR.accent,
                                borderRadius: 5,
                                padding: "0 6px",
                                fontSize: 11,
                                cursor: "pointer",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {fmt(c.time_ms / 1000)}
                            </button>
                            {c.drawing ? (
                              <Tooltip title="Has a frame drawing">
                                <EditOutlined style={{ fontSize: 11, color: VR.accent }} />
                              </Tooltip>
                            ) : null}
                            <span style={{ flex: 1 }} />
                            <Tooltip title={c.resolved ? "Reopen" : "Resolve"}>
                              <Button
                                type="text"
                                size="small"
                                icon={c.resolved ? <UndoOutlined /> : <CheckOutlined />}
                                onClick={() =>
                                  toggleResolved.mutate({
                                    id: c.id,
                                    videoId: id as string,
                                    revision: rev,
                                    resolved: !c.resolved,
                                  })
                                }
                              />
                            </Tooltip>
                          </div>
                          <Text
                            style={{
                              fontSize: 13,
                              color: VR.text,
                              textDecoration: c.resolved ? "line-through" : "none",
                            }}
                          >
                            {c.body}
                          </Text>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <NewVersionModal
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        videoId={video.id}
        teamId={video.team_id}
        nextRevision={nextRevision}
      />

      <style>{`
        @media (max-width: 1020px) {
          .wl-vr-review-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </VRThemeProvider>
  );
}
