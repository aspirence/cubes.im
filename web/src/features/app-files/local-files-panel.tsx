"use client";

import { useEffect, useState } from "react";
import { App, Button, Dropdown, Empty, Input, Modal, Select, Spin, Tooltip, theme } from "antd";
import type { MenuProps } from "antd";
import {
  useLocalFolder,
  copyFileTo,
  type LocalEntry,
} from "./use-local-folder";
import { humanSize, useSendFileToReview } from "./use-files";
import { useBackgroundUpload } from "@/features/uploads/use-background-upload";
import { useTasks } from "@/features/tasks/use-tasks";
import { useVideoFolders } from "@/features/app-video-review/use-video-review";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

type PreviewKind = "image" | "pdf" | "video" | "audio" | "text" | "none";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
  ico: "image/x-icon", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  xml: "application/xml", html: "text/html", css: "text/css", js: "text/javascript",
  ts: "text/plain", tsx: "text/plain", yml: "text/plain", yaml: "text/plain",
  log: "text/plain", py: "text/plain", sh: "text/plain",
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function guessMime(name: string, fallback: string): string {
  return fallback || MIME_BY_EXT[extOf(name)] || "";
}
function previewKind(mime: string, name: string): PreviewKind {
  const ext = extOf(name);
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (
    mime.startsWith("text/") ||
    ["application/json", "application/xml"].includes(mime) ||
    ["txt", "md", "csv", "json", "xml", "log", "js", "ts", "tsx", "css", "html", "yml", "yaml", "py", "sh"].includes(ext)
  )
    return "text";
  return "none";
}

interface PreviewState {
  entry: LocalEntry;
  kind: PreviewKind;
  url: string;
  text?: string;
}

function isImageName(name: string): boolean {
  return (MIME_BY_EXT[extOf(name)] ?? "").startsWith("image/");
}
function isVideoName(name: string): boolean {
  return (MIME_BY_EXT[extOf(name)] ?? "").startsWith("video/");
}
function fileGlyph(name: string): string {
  const ext = extOf(name);
  const mime = MIME_BY_EXT[ext] ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "movie";
  if (mime.startsWith("audio/")) return "music_note";
  if (ext === "pdf") return "picture_as_pdf";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "folder_zip";
  if (previewKind(mime, name) === "text") return "description";
  return "draft";
}

/** A lazily-loaded image thumbnail for an image file entry. */
function Thumb({ handle }: { handle: FileSystemFileHandle }) {
  const { token } = theme.useToken();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const f = await handle.getFile();
        if (cancelled) return;
        u = URL.createObjectURL(f);
        setUrl(u);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [handle]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  ) : (
    <MIcon name="image" size={34} color={token.colorTextTertiary} />
  );
}

/**
 * Browse a folder on the user's own machine (File System Access API) — no
 * upload. Preview / copy files locally, or push individual files (or the whole
 * folder) to the project's cloud Files so teammates can access them.
 */
export function LocalFilesPanel({ projectId }: { projectId: string }) {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const {
    supported,
    perm,
    rootName,
    path,
    entries,
    loading,
    configure,
    reconnect,
    openDir,
    goTo,
    refresh,
    disconnect,
    collectCurrent,
    deleteEntry,
  } = useLocalFolder(projectId);
  const bgUpload = useBackgroundUpload();
  const sendToReview = useSendFileToReview();
  const { data: tasks } = useTasks(projectId);
  const { data: reviewFolders } = useVideoFolders(projectId);
  const [pushingAll, setPushingAll] = useState(false);
  const [previewing, setPreviewing] = useState<PreviewState | null>(null);
  const [explain, setExplain] = useState<null | "configure" | "reconnect">(null);

  // "Add to Video Review" picker (choose a task / folder / title first).
  const [reviewFor, setReviewFor] = useState<LocalEntry | null>(null);
  const [reviewTaskId, setReviewTaskId] = useState<string | undefined>();
  const [reviewFolderId, setReviewFolderId] = useState<string | undefined>();
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewSeed, setReviewSeed] = useState<string | null>(null);
  if (reviewFor && reviewSeed !== reviewFor.name) {
    setReviewSeed(reviewFor.name);
    setReviewTitle(reviewFor.name.replace(/\.[a-z0-9]+$/i, ""));
    setReviewTaskId(undefined);
    setReviewFolderId(undefined);
  }
  if (!reviewFor && reviewSeed !== null) setReviewSeed(null);

  // Render the file INSIDE the app (modal) instead of opening a blob URL in a
  // new tab — the latter downloads for most types instead of viewing.
  const openPreview = async (entry: LocalEntry) => {
    if (!entry.fileHandle) return;
    const file = await entry.fileHandle.getFile();
    const mime = guessMime(entry.name, file.type);
    const kind = previewKind(mime, entry.name);
    if (kind === "text") {
      const text = await file.slice(0, 400_000).text();
      setPreviewing({ entry, kind, url: "", text });
      return;
    }
    if (kind === "none") {
      setPreviewing({ entry, kind, url: "" });
      return;
    }
    // Give the blob the correct type so the browser renders it inline.
    const typed = file.type ? file : new File([file], entry.name, { type: mime });
    setPreviewing({ entry, kind, url: URL.createObjectURL(typed) });
  };
  const closePreview = () => {
    setPreviewing((p) => {
      if (p?.url) URL.revokeObjectURL(p.url);
      return null;
    });
  };

  const copy = async (entry: LocalEntry) => {
    try {
      const ok = await copyFileTo(entry);
      if (ok) message.success(`Copied "${entry.name}".`);
    } catch {
      /* user cancelled the save dialog */
    }
  };

  // Fire-and-forget: the bytes upload in the background and the app-shell header
  // shows live progress + a cancel. We close any open preview right away so the
  // user isn't blocked watching a spinner.
  const pushOne = (entry: LocalEntry) => {
    if (!entry.fileHandle) return;
    const handle = entry.fileHandle;
    const rel = [...path, entry.name].join("/");
    const label = rootName ?? "Local folder";
    if (previewing?.entry.name === entry.name) closePreview();
    message.success(`Pushing "${entry.name}" in the background…`);
    void (async () => {
      try {
        const file = await handle.getFile();
        await bgUpload({
          file,
          projectId,
          folderId: null,
          allowDownload: true,
          watermark: false,
          sourceRelativePath: rel,
          sourceImportLabel: label,
        });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          message.error(`Couldn't push "${entry.name}".`);
      }
    })();
  };

  const pushAll = async () => {
    setPushingAll(true);
    let files: Awaited<ReturnType<typeof collectCurrent>>;
    try {
      files = await collectCurrent();
    } finally {
      setPushingAll(false);
    }
    if (files.length === 0) {
      message.info("No files to push here.");
      return;
    }
    const base = path.length ? path.join("/") + "/" : "";
    const label = rootName ?? "Local folder";
    message.success(
      `Pushing ${files.length} file${files.length === 1 ? "" : "s"} in the background…`,
    );
    // Sequential in the background so we don't open dozens of parallel XHRs; each
    // file appears as its own job in the header. Cancelling one stops the run.
    void (async () => {
      for (const { file, rel } of files) {
        try {
          await bgUpload({
            file,
            projectId,
            folderId: null,
            allowDownload: true,
            watermark: false,
            sourceRelativePath: base + rel,
            sourceImportLabel: label,
          });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") break;
        }
      }
    })();
  };

  // Upload the local file in the background, then create a Video Review item
  // linked to the chosen task / folder / title. The picker modal closes
  // immediately; the upload continues in the header.
  const doAddToReview = () => {
    const entry = reviewFor;
    if (!entry?.fileHandle) return;
    const handle = entry.fileHandle;
    const rel = [...path, entry.name].join("/");
    const label = rootName ?? "Local folder";
    const taskId = reviewTaskId ?? null;
    const folderId = reviewFolderId ?? null;
    const title = reviewTitle.trim() || null;
    setReviewFor(null);
    void (async () => {
      try {
        const file = await handle.getFile();
        const row = await bgUpload({
          file,
          projectId,
          folderId: null,
          allowDownload: true,
          watermark: false,
          sourceRelativePath: rel,
          sourceImportLabel: label,
        });
        await sendToReview.mutateAsync({ file: row, taskId, folderId, title });
        message.success(`"${entry.name}" added to Video Review.`);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          const reason = (e as Error)?.message;
          message.error(
            reason ? `Couldn't add to Video Review: ${reason}` : "Couldn't add to Video Review.",
          );
        }
      }
    })();
  };

  const deleteLocal = (entry: LocalEntry) => {
    modal.confirm({
      title: `Delete "${entry.name}" from your machine?`,
      content:
        "This removes the file from the local folder on disk — it can't be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const ok = await deleteEntry(entry.name);
          if (!ok) message.error("Delete needs write access — permission not granted.");
          else message.success(`Deleted "${entry.name}".`);
        } catch {
          message.error("Couldn't delete the file.");
        }
      },
    });
  };

  const fileMenu = (entry: LocalEntry): MenuProps => ({
    items: [
      { key: "preview", icon: <MIcon name="visibility" size={16} />, label: "Preview", onClick: () => void openPreview(entry) },
      { key: "copy", icon: <MIcon name="content_copy" size={15} />, label: "Copy to…", onClick: () => void copy(entry) },
      { key: "push", icon: <MIcon name="cloud_upload" size={16} />, label: "Push to remote", onClick: () => void pushOne(entry) },
      ...(isVideoName(entry.name)
        ? [
            {
              key: "review",
              icon: <MIcon name="movie" size={16} />,
              label: "Add to Video Review…",
              onClick: () => setReviewFor(entry),
            },
          ]
        : []),
      { type: "divider" as const },
      { key: "delete", icon: <MIcon name="delete" size={16} />, label: "Delete from disk", danger: true, onClick: () => deleteLocal(entry) },
    ],
  });

  /* ---- states without a connected, permitted folder ---- */
  if (!supported) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Local folder access needs a Chromium browser (Chrome/Edge/Arc)."
      />
    );
  }

  const intro = (
    <div style={{ maxWidth: 460, margin: "36px auto", textAlign: "center" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          margin: "0 auto 14px",
          background: token.colorFillTertiary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: token.colorPrimary,
        }}
      >
        <MIcon name="folder_open" size={28} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: token.colorText }}>
        Access a folder on your machine
      </div>
      <p style={{ fontSize: 13, color: token.colorTextSecondary, marginTop: 6 }}>
        Pick a folder on this computer to browse its files here — no upload. You
        can copy files anywhere, or push any of them to the project&apos;s cloud
        Files so teammates can access them.
      </p>
      {perm === "prompt" ? (
        <Button type="primary" onClick={() => setExplain("reconnect")} style={{ marginTop: 8 }}>
          Reconnect{rootName ? ` “${rootName}”` : ""}
        </Button>
      ) : (
        <Button type="primary" icon={<MIcon name="folder" size={16} />} onClick={() => setExplain("configure")} style={{ marginTop: 8 }}>
          Configure local folder
        </Button>
      )}
    </div>
  );

  // A branded explainer that frames the browser's native permission prompt
  // (which itself is a Chrome security dialog and can't be restyled).
  const explainer = (
    <Modal
      open={Boolean(explain)}
      onCancel={() => setExplain(null)}
      okText={explain === "reconnect" ? "Reconnect folder" : "Choose folder"}
      onOk={() => {
        const mode = explain;
        setExplain(null);
        if (mode === "reconnect") void reconnect();
        else void configure();
      }}
      title="Access a folder on your machine"
    >
      <p style={{ fontSize: 13.5, color: token.colorTextSecondary, marginTop: 0 }}>
        Next, your browser will ask you to <b>allow access</b> to the folder you
        pick — that&apos;s a normal, one-time security step from Chrome.
      </p>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          padding: "10px 12px",
          marginTop: 4,
        }}
      >
        <MIcon name="shield" size={18} color={token.colorPrimary} />
        <span style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
          Files stay on your machine — nothing is uploaded to Cubes unless you
          explicitly <b>push</b> a file to the cloud.
        </span>
      </div>
    </Modal>
  );

  if (perm !== "granted")
    return (
      <>
        {intro}
        {explainer}
      </>
    );

  /* ---- connected browser ---- */
  return (
    <div>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          <MIcon name="hard_drive" size={18} color={token.colorPrimary} />
          <button
            type="button"
            onClick={() => void goTo(0)}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: token.colorText, fontWeight: 700, fontSize: 14, padding: 0 }}
          >
            {rootName ?? "Local folder"}
          </button>
          {path.map((seg, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <MIcon name="chevron_right" size={16} color={token.colorTextTertiary} />
              <button
                type="button"
                onClick={() => void goTo(i + 1)}
                style={{ border: "none", background: "transparent", cursor: "pointer", color: token.colorTextSecondary, fontSize: 13.5, padding: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
        <Tooltip title="Refresh">
          <Button size="small" type="text" aria-label="Refresh" icon={<MIcon name="refresh" size={16} />} onClick={() => void refresh()} />
        </Tooltip>
        <Button size="small" icon={<MIcon name="folder" size={15} />} onClick={() => void configure()}>
          Change folder
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<MIcon name="cloud_upload" size={15} />}
          loading={pushingAll}
          onClick={() => void pushAll()}
        >
          Push all to remote
        </Button>
        <Tooltip title="Disconnect this folder">
          <Button size="small" type="text" aria-label="Disconnect" icon={<MIcon name="link_off" size={16} />} onClick={() => void disconnect()} />
        </Tooltip>
      </div>

      {/* Listing — a grid of folder + file cards */}
      {loading ? (
        <div style={{ padding: 44, textAlign: "center" }}>
          <Spin />
        </div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 44, textAlign: "center", color: token.colorTextTertiary, fontSize: 13 }}>
          This folder is empty.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          {entries.map((entry) => {
            const card: React.CSSProperties = {
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 12,
              overflow: "hidden",
              background: token.colorBgContainer,
              position: "relative",
            };
            const thumbArea: React.CSSProperties = {
              height: 108,
              display: "grid",
              placeItems: "center",
              background: token.colorFillQuaternary,
              overflow: "hidden",
            };
            const info: React.CSSProperties = {
              padding: "8px 10px",
              display: "flex",
              alignItems: "center",
              gap: 6,
            };
            if (entry.kind === "directory") {
              return (
                <button
                  key={entry.name}
                  type="button"
                  className="wl-local-card"
                  onClick={() => void openDir(entry.name)}
                  style={{ ...card, textAlign: "left", cursor: "pointer", padding: 0 }}
                >
                  <div style={thumbArea}>
                    <MIcon name="folder" size={44} color={token.colorPrimary} />
                  </div>
                  <div style={info}>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        fontWeight: 600,
                        color: token.colorText,
                      }}
                    >
                      {entry.name}
                    </span>
                    <MIcon name="chevron_right" size={16} color={token.colorTextTertiary} />
                  </div>
                </button>
              );
            }
            return (
              <div key={entry.name} className="wl-local-card" style={card}>
                <div
                  style={{ ...thumbArea, cursor: "pointer" }}
                  onClick={() => void openPreview(entry)}
                >
                  {isImageName(entry.name) && entry.fileHandle ? (
                    <Thumb handle={entry.fileHandle} />
                  ) : (
                    <MIcon name={fileGlyph(entry.name)} size={38} color={token.colorTextTertiary} />
                  )}
                  <span
                    className="wl-local-actions"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      background: token.colorBgElevated,
                      borderRadius: 8,
                      boxShadow: token.boxShadowTertiary,
                    }}
                  >
                    <Dropdown menu={fileMenu(entry)} trigger={["click"]} placement="bottomRight">
                      <Button
                        type="text"
                        size="small"
                        aria-label="File actions"
                        icon={<MIcon name="more_horiz" size={17} />}
                      />
                    </Dropdown>
                  </span>
                </div>
                <div style={info}>
                  <MIcon name={fileGlyph(entry.name)} size={15} color={token.colorTextTertiary} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 12.5,
                      color: token.colorText,
                    }}
                    title={entry.name}
                  >
                    {entry.name}
                  </span>
                  <span style={{ fontSize: 11, color: token.colorTextTertiary, flex: "none" }}>
                    {typeof entry.size === "number" ? humanSize(entry.size) : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* In-app preview */}
      <Modal
        open={Boolean(previewing)}
        onCancel={closePreview}
        title={previewing?.entry.name}
        width={previewing?.kind === "text" || previewing?.kind === "pdf" ? 900 : 720}
        destroyOnHidden
        styles={{ body: { maxHeight: "74vh", overflow: "auto" } }}
        footer={
          previewing ? (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button icon={<MIcon name="content_copy" size={15} />} onClick={() => void copy(previewing.entry)}>
                Copy to…
              </Button>
              <Button
                type="primary"
                icon={<MIcon name="cloud_upload" size={15} />}
                onClick={() => pushOne(previewing.entry)}
              >
                Push to remote
              </Button>
            </div>
          ) : null
        }
      >
        {previewing?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewing.url} alt={previewing.entry.name} style={{ maxWidth: "100%", display: "block", margin: "0 auto", borderRadius: 8 }} />
        ) : previewing?.kind === "pdf" ? (
          <iframe title={previewing.entry.name} src={previewing.url} style={{ width: "100%", height: "70vh", border: "none", borderRadius: 8 }} />
        ) : previewing?.kind === "video" ? (
          <video src={previewing.url} controls style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto" }} />
        ) : previewing?.kind === "audio" ? (
          <audio src={previewing.url} controls style={{ width: "100%" }} />
        ) : previewing?.kind === "text" ? (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: 13,
              fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              margin: 0,
              color: token.colorText,
            }}
          >
            {previewing.text}
          </pre>
        ) : previewing ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Can't preview this file type here — use Copy or Push below."
          />
        ) : null}
      </Modal>

      {/* Add to Video Review — pick a task / folder / title */}
      <Modal
        open={Boolean(reviewFor)}
        onCancel={() => setReviewFor(null)}
        title="Add to Video Review"
        okText="Add to review"
        onOk={doAddToReview}
        destroyOnHidden
      >
        <p style={{ fontSize: 13, color: token.colorTextSecondary, marginTop: 0 }}>
          <b>{reviewFor?.name}</b> will be uploaded to the cloud and opened as a
          review video.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 12.5, color: token.colorTextSecondary, marginBottom: 4 }}>Title</div>
            <Input value={reviewTitle} maxLength={200} onChange={(e) => setReviewTitle(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, color: token.colorTextSecondary, marginBottom: 4 }}>Link to a task (optional)</div>
            <Select
              showSearch
              allowClear
              value={reviewTaskId}
              onChange={setReviewTaskId}
              placeholder="No task"
              style={{ width: "100%" }}
              optionFilterProp="label"
              options={(tasks ?? []).map((t) => ({ value: t.id, label: t.name }))}
            />
          </div>
          {reviewFolders && reviewFolders.length > 0 ? (
            <div>
              <div style={{ fontSize: 12.5, color: token.colorTextSecondary, marginBottom: 4 }}>Review folder (optional)</div>
              <Select
                allowClear
                value={reviewFolderId}
                onChange={setReviewFolderId}
                placeholder="Unfiled"
                style={{ width: "100%" }}
                options={reviewFolders.map((f) => ({ value: f.id, label: f.name }))}
              />
            </div>
          ) : null}
        </div>
      </Modal>

      <style>{`
        .wl-local-card { transition: box-shadow .12s ease, border-color .12s ease; }
        .wl-local-card:hover { box-shadow: ${token.boxShadowTertiary}; border-color: ${token.colorBorder}; }
        .wl-local-actions { opacity: 0; transition: opacity .12s ease; }
        .wl-local-card:hover .wl-local-actions { opacity: 1; }
      `}</style>
    </div>
  );
}
