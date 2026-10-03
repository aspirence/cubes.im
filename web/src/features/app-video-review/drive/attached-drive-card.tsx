"use client";

/**
 * The "this is what you picked" card.
 *
 * Its real job is the one line that says timestamps are on. A Drive video used
 * to play in Drive's own iframe, which is another origin, so the page could not
 * read the playhead — every timestamped comment and every drawing silently did
 * nothing. Streaming the same file through Cubes into our own <video> fixes
 * that, and since the difference is invisible while the video is playing, the
 * card has to say it out loud.
 */

import { Alert, App, Button, Tag, Tooltip, theme } from "antd";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import { useImportDriveCopy, useRevisionImportStatus } from "../use-video-review";
import type { DriveAttachment } from "./drive-api";
import { driveFileUrl, formatBytes, formatDuration } from "./drive-links";

/** Mirrors the revision row's import_status, so no translation is needed. */
export type ImportState = "none" | "queued" | "running" | "done" | "error";

export function AttachedDriveCard({
  attachment,
  accountEmail,
  onDetach,
  importState = "none",
  importError,
  onImport,
  /** Create flow: the review does not exist yet, so importing is a promise to
   *  do it once it does — a checkbox, not a button. */
  importAsIntent,
  importIntent,
  onImportIntentChange,
}: {
  attachment: DriveAttachment;
  accountEmail?: string | null;
  onDetach: () => void;
  importState?: ImportState;
  importError?: string | null;
  onImport?: () => void;
  importAsIntent?: boolean;
  importIntent?: boolean;
  onImportIntentChange?: (next: boolean) => void;
}) {
  const { token } = theme.useToken();
  const { video } = attachment;
  const busy = importState === "queued" || importState === "running";

  return (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        background: token.colorFillQuaternary,
        padding: 10,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div
          style={{
            width: 104,
            flex: "0 0 104px",
            aspectRatio: "16 / 9",
            borderRadius: 8,
            overflow: "hidden",
            background: token.colorFillTertiary,
            display: "grid",
            placeItems: "center",
          }}
        >
          {video.thumbnailUrl ? (
            // See the folder browser: a Drive thumbnail URL is short-lived and
            // per-file, so it must not go through next/image's cache.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnailUrl}
              alt=""
              referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <MIcon name="movie" size={22} color={token.colorTextQuaternary} />
          )}
        </div>

        <div style={{ flex: "1 1 180px", minWidth: 0, display: "grid", gap: 3 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: token.colorText,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={video.name}
          >
            {video.name}
          </div>
          <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
            {formatDuration(video.durationMs)} · {formatBytes(video.sizeBytes)}
            {accountEmail ? ` · ${accountEmail}` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Tooltip title="Cubes streams the file from Drive into its own player, so the playhead is readable and comments can carry a timestamp.">
              <Tag color="success" style={{ marginInlineEnd: 0, borderRadius: 6, fontSize: 11 }}>
                Timestamps: on (streamed through Cubes)
              </Tag>
            </Tooltip>
            <a
              href={driveFileUrl(video.id)}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11.5, color: token.colorTextTertiary }}
            >
              Open in Drive
            </a>
          </div>
        </div>

        <Button size="small" onClick={onDetach} icon={<MIcon name="close" size={14} />}>
          Change
        </Button>
      </div>

      {importAsIntent ? (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={Boolean(importIntent)}
            onChange={(e) => onImportIntentChange?.(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
            Import a copy into Cubes for faster playback. Streaming from Drive works, but a
            copy keeps playing if the file is moved, renamed or un-shared later.
          </span>
        </label>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              size="small"
              loading={busy}
              disabled={importState === "done"}
              onClick={onImport}
              icon={<MIcon name="download" size={14} />}
            >
              {importState === "done"
                ? "Copy stored in Cubes"
                : busy
                  ? "Importing…"
                  : "Import a copy for faster playback"}
            </Button>
            <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
              Optional — scrubbing is smoother from our storage than from Drive.
            </span>
          </div>
          {importState === "error" ? (
            <Alert
              type="warning"
              showIcon
              message={importError || "The copy didn’t finish. The video still plays from Drive."}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The import control on its own, for the reviewer page — where the Drive
 * revision already exists and the question is only "keep streaming, or take a
 * copy?".
 *
 * It owns the round trip and the polling because the copy finishes long after
 * the request that started it: the route queues the work and answers, so the
 * only truthful progress report is the revision row, which this watches until
 * the status settles.
 *
 *   <DriveImportButton videoId={video.id} revisionId={rev.id}
 *                      revision={rev.revision} />
 */
export function DriveImportButton({
  videoId,
  revisionId,
  revision,
}: {
  videoId: string;
  revisionId: string;
  revision?: number;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const importCopy = useImportDriveCopy();
  const status = useRevisionImportStatus(videoId, revisionId);
  const state: ImportState = status.data?.status ?? "none";
  const busy = state === "queued" || state === "running" || importCopy.isPending;

  const start = async () => {
    try {
      await importCopy.mutateAsync({ videoId, revision: revision ?? null });
      void status.refetch();
    } catch (err) {
      message.error(errMsg(err, "The copy didn’t start."));
    }
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <Button
        size="small"
        loading={busy}
        disabled={state === "done"}
        onClick={start}
        icon={<MIcon name="download" size={14} />}
      >
        {state === "done"
          ? "Copy stored in Cubes"
          : busy
            ? "Importing…"
            : "Import a copy for faster playback"}
      </Button>
      {state === "error" ? (
        <Alert
          type="warning"
          showIcon
          message={
            status.data?.error || "The copy didn’t finish. The video still plays from Drive."
          }
        />
      ) : (
        <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
          Optional — the video already plays, and already supports timestamps.
        </span>
      )}
    </div>
  );
}
