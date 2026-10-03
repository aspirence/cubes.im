"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  App,
  Avatar,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { InputRef } from "antd";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DownloadOutlined,
  EditOutlined,
  SearchOutlined,
  ShareAltOutlined,
  UploadOutlined,
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
  useImportDriveCopy,
  useToggleCommentResolved,
  useVideoReviewers,
  useSetVideoEditor,
  useSetReviewers,
  useSendForReview,
  useDecideReview,
  useVideoWorkflowTemplates,
  useCreateWorkflowTemplate,
  useApplyWorkflowTemplate,
  useVideoShare,
  type VideoWithProject,
  type Drawing,
} from "@/features/app-video-review/use-video-review";
import { ShareReviewModal } from "@/features/app-video-review/share-modal";
import {
  VersionSourcePicker,
  emptyVersionSource,
  isVersionSourceReady,
  versionSourceToRevisionInput,
  versionWantsImport,
  type VersionSource,
} from "@/features/app-video-review/drive/version-source-picker";
import { PlayerStyles } from "@/features/app-video-review/player/player-styles";
import { VideoStage } from "@/features/app-video-review/player/video-stage";
import { TransportBar } from "@/features/app-video-review/player/transport-bar";
import { Scrubber, type CommentMarker } from "@/features/app-video-review/player/scrubber";
import {
  DrawingOverlay,
  type Stroke,
} from "@/features/app-video-review/player/drawing-overlay";
import { useVideoPlayer } from "@/features/app-video-review/player/use-video-player";
import { usePlayerHotkeys } from "@/features/app-video-review/player/use-player-hotkeys";
import { useStreamableSource } from "@/features/app-video-review/player/use-streamable-source";
import { formatClock, formatTimecode } from "@/features/app-video-review/player/timecode";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MemberSelect } from "@/features/team-members/member-select";
import { errMsg } from "@/lib/err";

dayjs.extend(relativeTime);

const { Text } = Typography;

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
  const importCopy = useImportDriveCopy();
  const [src, setSrc] = useState<VersionSource>(emptyVersionSource);
  const [summary, setSummary] = useState("");
  const [seeded, setSeeded] = useState(false);

  if (open && !seeded) {
    setSeeded(true);
    setSrc(emptyVersionSource);
    setSummary("");
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const submit = async () => {
    if (!isVersionSourceReady(src)) {
      return message.warning(
        src.kind === "upload"
          ? "Choose a file."
          : src.kind === "drive"
            ? "Pick a video from Drive."
            : "Paste a URL.",
      );
    }
    try {
      await addRevision.mutateAsync({
        videoId,
        teamId,
        nextRevision,
        summary: summary.trim() || null,
        ...versionSourceToRevisionInput(src),
      });
      message.success(`Version v${nextRevision} added.`);
      // The import copies the Drive file into our storage in the background;
      // the revision is already saved and playable from Drive either way, so a
      // failure here is a notice, not a failed upload.
      if (versionWantsImport(src)) {
        importCopy.mutate(
          { videoId },
          {
            onError: (err) =>
              message.warning(errMsg(err, "Couldn't start the Drive import.")),
          },
        );
      }
      onClose();
    } catch (err) {
      message.error(errMsg(err, "Failed to add version."));
    }
  };

  return (
    <Modal
      title={`Add version v${nextRevision}`}
      open={open}
      onOk={submit}
      okText="Add version"
      confirmLoading={addRevision.isPending}
      onCancel={onClose}
      destroyOnHidden
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <VersionSourcePicker teamId={teamId} value={src} onChange={setSrc} />
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
          style={{ width: 150 }}
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
  const router = useRouter();
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

  const [body, setBody] = useState("");
  const [versionOpen, setVersionOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { data: share } = useVideoShare(id);

  // Frame drawing
  const [drawMode, setDrawMode] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [displayDrawing, setDisplayDrawing] = useState<Drawing | null>(null);

  // Right panel
  const [panelTab, setPanelTab] = useState<"comments" | "details">("comments");
  const [commentFilter, setCommentFilter] = useState<"all" | "open" | "done">("all");
  const [sortBy, setSortBy] = useState<"time" | "new">("time");
  const [searchQ, setSearchQ] = useState("");
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [panelW, setPanelW] = useState(400);
  const composerRef = useRef<InputRef>(null);

  // A pasted provider link (YouTube/Drive/Vimeo…) normally plays via an embed;
  // uploads, direct files and Drive files we can stream ourselves play in
  // <video>. Track which URL failed so switching versions clears the
  // "couldn't preview" fallback without an effect.
  const [errorUrl, setErrorUrl] = useState<string | null>(null);
  const { source, streaming, degradedReason } = useStreamableSource(id, rev, playUrl);
  const failed = source?.kind === "file" && errorUrl === source.url;
  // The playhead is ours only for a real <video> that actually loaded — that is
  // the single condition behind timestamps, drawings, markers and shortcuts.
  const timed = source?.kind === "file" && !failed;

  const { attachVideo, attachStage, state: p, actions } = useVideoPlayer();

  const focusComposer = useCallback(() => {
    setPanelTab("comments");
    // Let the tab switch paint before stealing focus, or the textarea may not
    // exist yet when the shortcut fires from the Details tab.
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);
  usePlayerHotkeys({ enabled: timed, actions, onFocusComposer: focusComposer });

  // Back returns to wherever the review was opened from (the project's Video
  // Review tab, or the hub). router.back() restores that exact entry; when the
  // page was loaded directly (no history) we fall back to the project tab.
  const backFallback = video?.project
    ? `/projects/${video.project.id}?tab=video-review`
    : "/apps/video-review";
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(backFallback);
  };

  const openComment = useCallback(
    (c: { id: string; time_ms: number; drawing: unknown }) => {
      actions.seek(c.time_ms / 1000);
      setDrawMode(false);
      setStrokes([]);
      setDisplayDrawing((c.drawing as Drawing | null) ?? null);
      setActiveComment(c.id);
    },
    [actions],
  );

  const submitComment = async () => {
    if (!id || !body.trim()) return;
    try {
      await addComment.mutateAsync({
        videoId: id,
        revision: rev,
        body: body.trim(),
        timeMs: p.currentTime * 1000,
        drawing: drawMode && strokes.length > 0 ? { strokes } : null,
      });
      setBody("");
      setStrokes([]);
      setDrawMode(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to add comment."));
    }
  };

  // Dragging the divider writes straight to state; the grid track is a CSS
  // custom property, so no layout code has to know the panel's width.
  const startResize = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelW;
    const move = (ev: PointerEvent) =>
      setPanelW(Math.min(560, Math.max(320, startW + (startX - ev.clientX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
        (c.guest_name ?? c.author?.name ?? "").toLowerCase().includes(q),
    );
  const sortedComments =
    sortBy === "time"
      ? filteredComments // query order = by timestamp
      : [...filteredComments].sort(
          (a, b) => dayjs(b.created_at).valueOf() - dayjs(a.created_at).valueOf(),
        );
  const openCount = (comments ?? []).filter((c) => !c.resolved).length;
  const doneCount = (comments ?? []).filter((c) => c.resolved).length;

  const markers: CommentMarker[] = useMemo(
    () =>
      (comments ?? []).map((c) => ({
        id: c.id,
        timeMs: c.time_ms,
        label: `${formatClock(c.time_ms / 1000)} · ${c.body.split("\n")[0].slice(0, 90)}`,
        resolved: c.resolved,
      })),
    [comments],
  );

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

  const nextRevision =
    Math.max(video.latest_revision, ...(revisions ?? []).map((r) => r.revision)) + 1;
  const downloadUrl = playUrl ?? null;

  const secondaryActions = [
    {
      key: "new",
      label: "New version",
      onClick: () => setVersionOpen(true),
    },
    {
      key: "copy",
      label: "Copy video URL",
      disabled: !(currentRevision?.url ?? playUrl),
      onClick: async () => {
        const link = currentRevision?.url ?? playUrl;
        if (!link) return;
        try {
          await navigator.clipboard.writeText(link);
          message.success("Video link copied.");
        } catch {
          message.error("Couldn't copy the link.");
        }
      },
    },
    {
      key: "download",
      label: "Download",
      disabled: !downloadUrl,
      onClick: () => {
        if (downloadUrl) window.open(downloadUrl, "_blank", "noopener");
      },
    },
  ];

  return (
    <VRThemeProvider>
      <div
        className="wl-vr-root"
        style={{ "--vr-panel-w": `${panelW}px` } as React.CSSProperties}
      >
        <PlayerStyles />
        <div className="wl-vr-shell">
          {/* Header ------------------------------------------------------- */}
          <div className="wl-vr-head">
            <button type="button" onClick={goBack} aria-label="Back" title="Back" className="wl-vr-iconbtn">
              <ArrowLeftOutlined />
            </button>
            <span className="wl-vr-title">{video.title}</span>
            {video.project ? (
              <Link href={`/projects/${video.project.id}`} className="wl-vr-head-wide">
                <Tag style={{ marginInlineEnd: 0 }}>{video.project.name}</Tag>
              </Link>
            ) : null}
            <span className="wl-vr-head-status">
              <StatusChip status={video.status} />
            </span>
            <Select
              size="small"
              className="wl-vr-ver"
              value={rev}
              onChange={setActiveRev}
              style={{ width: 104 }}
              options={(revisions ?? []).map((r) => ({
                value: r.revision,
                label: `v${r.revision}`,
              }))}
            />
            <span className="wl-vr-head-wide">
              <Button size="small" icon={<UploadOutlined />} onClick={() => setVersionOpen(true)}>
                New version
              </Button>
              <Button
                size="small"
                style={{ marginInlineStart: 8 }}
                icon={
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                    link
                  </span>
                }
                disabled={!(currentRevision?.url ?? playUrl)}
                onClick={() => void secondaryActions[1].onClick?.()}
              >
                Copy URL
              </Button>
              <Button
                size="small"
                style={{ marginInlineStart: 8 }}
                icon={<DownloadOutlined />}
                disabled={!downloadUrl}
                href={downloadUrl ?? undefined}
                target="_blank"
                download
              >
                Download
              </Button>
            </span>
            <Button
              size="small"
              type="primary"
              icon={<ShareAltOutlined />}
              onClick={() => setShareOpen(true)}
            >
              <span className="wl-vr-share-label">Share</span>
              {share?.active ? (
                <span
                  aria-hidden
                  title="Live client link"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#5eead4",
                    display: "inline-block",
                    marginInlineStart: 6,
                    boxShadow: "0 0 0 3px rgba(94, 234, 212, 0.3)",
                  }}
                />
              ) : null}
            </Button>
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{
                items: secondaryActions.map((a) => ({
                  key: a.key,
                  label: a.label,
                  disabled: a.disabled,
                  onClick: () => void a.onClick?.(),
                })),
              }}
            >
              <button type="button" aria-label="More actions" className="wl-vr-iconbtn wl-vr-head-narrow">
                <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 18 }}>
                  more_horiz
                </span>
              </button>
            </Dropdown>
          </div>

          {/* Body --------------------------------------------------------- */}
          <div className="wl-vr-body">
            {/* Stage + transport */}
            <div
              className="wl-vr-main"
              ref={attachStage}
            >
              <VideoStage
                source={source}
                title={video.title}
                failed={Boolean(failed)}
                attachVideo={attachVideo}
                onError={() => {
                  if (source?.kind === "file") setErrorUrl(source.url);
                }}
                onSurfaceClick={drawMode ? undefined : actions.togglePlay}
                overlay={
                  drawMode || displayDrawing ? (
                    <DrawingOverlay
                      editable={drawMode}
                      strokes={strokes}
                      onStrokesChange={setStrokes}
                      display={drawMode ? null : displayDrawing}
                    />
                  ) : null
                }
                fallbackHint={
                  !timed && degradedReason ? (
                    <>
                      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 14, verticalAlign: "-2px", marginInlineEnd: 5 }}>
                        info
                      </span>
                      {degradedReason}
                    </>
                  ) : null
                }
              />
              <TransportBar
                state={p}
                actions={actions}
                disabled={!timed}
                extra={
                  timed ? (
                    <>
                      {drawMode && strokes.length > 0 ? (
                        <button
                          type="button"
                          className="wl-vr-tbtn is-text"
                          onClick={() => setStrokes([])}
                        >
                          Clear
                        </button>
                      ) : null}
                      {displayDrawing && !drawMode ? (
                        <button
                          type="button"
                          className="wl-vr-tbtn is-text"
                          onClick={() => setDisplayDrawing(null)}
                        >
                          Hide drawing
                        </button>
                      ) : null}
                      <Tooltip title={drawMode ? "Stop drawing" : "Draw on this frame"}>
                        <button
                          type="button"
                          aria-label="Draw on this frame"
                          aria-pressed={drawMode}
                          className={`wl-vr-tbtn${drawMode ? " is-on" : ""}`}
                          onClick={() => {
                            const next = !drawMode;
                            setDrawMode(next);
                            if (next) {
                              actions.pause();
                              setDisplayDrawing(null);
                            } else {
                              setStrokes([]);
                            }
                          }}
                        >
                          <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 19 }}>
                            draw
                          </span>
                        </button>
                      </Tooltip>
                    </>
                  ) : null
                }
              />
              <Scrubber
                duration={p.duration}
                currentTime={p.currentTime}
                buffered={p.buffered}
                markers={timed ? markers : []}
                disabled={!timed}
                onSeek={actions.seek}
                onMarkerClick={(m) => {
                  const c = (comments ?? []).find((x) => x.id === m.id);
                  if (c) {
                    openComment(c);
                    setPanelTab("comments");
                  }
                }}
              />
            </div>

            {/* Right panel */}
            <div className="wl-vr-panel">
              <button
                type="button"
                aria-label="Resize panel"
                className="wl-vr-resize"
                onPointerDown={startResize}
              />
              <div className="wl-vr-tabs">
                {(
                  [
                    { key: "comments", label: "Comments", count: comments?.length ?? 0 },
                    { key: "details", label: "Details", count: null },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`wl-vr-tab${panelTab === t.key ? " is-on" : ""}`}
                    onClick={() => setPanelTab(t.key)}
                  >
                    {t.label}
                    {t.count ? <span className="wl-vr-tab-count">{t.count}</span> : null}
                  </button>
                ))}
              </div>

              {panelTab === "details" ? (
                <div className="wl-vr-panel-scroll" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Versions */}
                  <div
                    style={{
                      border: `1px solid ${VR.hairline}`,
                      borderRadius: 12,
                      background: VR.panel,
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                      <Text strong style={{ flex: 1 }}>
                        Versions
                      </Text>
                      <Button size="small" type="text" onClick={() => setVersionOpen(true)}>
                        + New
                      </Button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {(revisions ?? []).map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setActiveRev(r.revision)}
                          style={{
                            textAlign: "left",
                            border: "none",
                            cursor: "pointer",
                            borderRadius: 8,
                            padding: "7px 9px",
                            background: r.revision === rev ? VR.accentSoft : "transparent",
                            color: VR.text,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Text strong style={{ fontSize: 12.5, color: r.revision === rev ? VR.accent : VR.text }}>
                              v{r.revision}
                            </Text>
                            <Text style={{ fontSize: 11.5, color: VR.textTertiary }}>
                              {dayjs(r.uploaded_at).fromNow()}
                            </Text>
                            {r.url ? (
                              <Tag style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: "16px", padding: "0 5px" }}>
                                link
                              </Tag>
                            ) : null}
                          </div>
                          {r.summary ? (
                            <div style={{ fontSize: 12, color: VR.textSecondary, marginTop: 2 }}>
                              {r.summary}
                            </div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  <WorkflowPanel video={video} />

                  {/* Deliverable + share */}
                  <div
                    style={{
                      border: `1px solid ${VR.hairline}`,
                      borderRadius: 12,
                      background: VR.panel,
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Text strong style={{ flex: 1 }}>
                        Linked
                      </Text>
                      <StatusChip status={video.status} />
                    </div>
                    {video.project ? (
                      <Link href={`/projects/${video.project.id}?tab=video-review`} style={{ fontSize: 13 }}>
                        Project · {video.project.name}
                      </Link>
                    ) : (
                      <Text style={{ fontSize: 12.5, color: VR.textTertiary }}>
                        Not attached to a project.
                      </Text>
                    )}
                    {video.task_id && video.project ? (
                      <Link
                        href={`/projects/${video.project.id}/tasks/${video.task_id}`}
                        style={{ fontSize: 13 }}
                      >
                        Deliverable task ↗
                      </Link>
                    ) : null}
                    <Button
                      size="small"
                      icon={<ShareAltOutlined />}
                      onClick={() => setShareOpen(true)}
                      style={{ alignSelf: "flex-start", marginTop: 2 }}
                    >
                      {share?.active ? "Client link is live" : "Share with a client"}
                    </Button>
                    {streaming ? (
                      <Text style={{ fontSize: 11.5, color: VR.textTertiary }}>
                        Streaming this Drive file through Cubes, so comments are frame-timed.
                      </Text>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  {/* Filters */}
                  <div style={{ display: "flex", gap: 8, padding: "10px 12px 8px", flexWrap: "wrap" }}>
                    <Segmented
                      size="small"
                      value={commentFilter}
                      onChange={(v) => setCommentFilter(v as "all" | "open" | "done")}
                      options={[
                        { label: "All", value: "all" },
                        { label: `Open${openCount ? ` ${openCount}` : ""}`, value: "open" },
                        { label: `Done${doneCount ? ` ${doneCount}` : ""}`, value: "done" },
                      ]}
                    />
                    <Select
                      size="small"
                      value={sortBy}
                      onChange={setSortBy}
                      style={{ width: 124 }}
                      options={[
                        { value: "time", label: "By timestamp" },
                        { value: "new", label: "Newest first" },
                      ]}
                    />
                    <Input
                      size="small"
                      allowClear
                      style={{ flex: 1, minWidth: 120 }}
                      prefix={<SearchOutlined style={{ color: VR.textTertiary }} />}
                      placeholder="Search…"
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                    />
                  </div>

                  {/* Thread */}
                  <div className="wl-vr-panel-scroll" style={{ padding: "0 6px 10px" }}>
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
                          className={`wl-vr-comment${c.resolved ? " is-done" : ""}`}
                          onClick={() => openComment(c)}
                          style={
                            activeComment === c.id
                              ? { background: VR.accentSoft }
                              : undefined
                          }
                        >
                          <Avatar
                            size={26}
                            src={c.guest_name ? undefined : (c.author?.avatar_url ?? undefined)}
                            style={{
                              fontSize: 11,
                              flex: "none",
                              background: c.guest_name ? "#0e9f6e" : undefined,
                            }}
                          >
                            {initials(c.guest_name ?? c.author?.name ?? "?")}
                          </Avatar>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <Text strong style={{ fontSize: 12.5, color: VR.text }}>
                                {c.guest_name ?? c.author?.name ?? "Someone"}
                              </Text>
                              {c.guest_name ? (
                                <Tag
                                  color="green"
                                  style={{
                                    marginInlineEnd: 0,
                                    fontSize: 10,
                                    lineHeight: "16px",
                                    padding: "0 5px",
                                  }}
                                >
                                  Client
                                </Tag>
                              ) : null}
                              <span style={{ flex: 1 }} />
                              <Tooltip title={c.resolved ? "Reopen" : "Resolve"}>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={c.resolved ? <span className="material-symbols-rounded" style={{ fontSize: 16 }}>undo</span> : <CheckOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleResolved.mutate({
                                      id: c.id,
                                      videoId: id as string,
                                      revision: rev,
                                      resolved: !c.resolved,
                                    });
                                  }}
                                />
                              </Tooltip>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "1px 0 3px" }}>
                              <button
                                type="button"
                                className="wl-vr-chip"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openComment(c);
                                }}
                              >
                                {formatClock(c.time_ms / 1000)}
                              </button>
                              {c.drawing ? (
                                <Tooltip title="Has a frame drawing">
                                  <EditOutlined style={{ fontSize: 11, color: VR.accent }} />
                                </Tooltip>
                              ) : null}
                              <Text style={{ fontSize: 11, color: VR.textTertiary }}>
                                {dayjs(c.created_at).fromNow()}
                              </Text>
                            </div>
                            <Text
                              style={{
                                fontSize: 13,
                                color: VR.text,
                                whiteSpace: "pre-wrap",
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

                  {/* Composer */}
                  <div className="wl-vr-composer">
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span className="wl-vr-chip" aria-label="Comment timestamp">
                        {timed ? formatTimecode(p.currentTime) : "no timecode"}
                      </span>
                      <Text style={{ color: VR.textTertiary, fontSize: 11.5, flex: 1, minWidth: 0 }}>
                        {timed ? "pins to the current frame" : "this source has no playhead"}
                      </Text>
                      {timed ? (
                        <Tooltip title={drawMode ? "Stop drawing" : "Draw on this frame"}>
                          <Button
                            size="small"
                            type={drawMode ? "primary" : "default"}
                            icon={<EditOutlined />}
                            onClick={() => {
                              const next = !drawMode;
                              setDrawMode(next);
                              if (next) {
                                actions.pause();
                                setDisplayDrawing(null);
                              } else {
                                setStrokes([]);
                              }
                            }}
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                      <Input.TextArea
                        ref={composerRef}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Add a comment…"
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        style={{ flex: 1 }}
                        onPressEnter={(e) => {
                          if (!e.shiftKey) {
                            e.preventDefault();
                            void submitComment();
                          }
                        }}
                      />
                      <Button
                        type="primary"
                        loading={addComment.isPending}
                        disabled={!body.trim()}
                        onClick={submitComment}
                        icon={
                          <span className="material-symbols-rounded" style={{ fontSize: 17 }}>
                            send
                          </span>
                        }
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
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

      <ShareReviewModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        videoId={video.id}
      />
    </VRThemeProvider>
  );
}
