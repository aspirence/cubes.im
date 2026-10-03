"use client";

/**
 * The three-way source chooser — Upload / Google Drive / Link — packaged for
 * the reviewer page's "new version" dialog.
 *
 * The reviewer page belongs to the player work, so this is the seam between us:
 * that dialog drops its Segmented + Dragger + URL input and mounts this
 * instead, keeping only its own summary field and its own OK button. The value
 * is a plain tagged union it can hold in one useState, and
 * `versionSourceToRevisionInput` turns it into the arguments `useAddRevision`
 * already takes — so nothing about how a version is saved has to move.
 *
 *   const [src, setSrc] = useState<VersionSource>(emptyVersionSource);
 *   <VersionSourcePicker teamId={teamId} value={src} onChange={setSrc} />
 *   await addRevision.mutateAsync({ videoId, teamId, nextRevision, summary,
 *                                   ...versionSourceToRevisionInput(src) });
 *   if (versionWantsImport(src)) importCopy.mutate({ videoId });
 */

import { useMemo, useState } from "react";
import { Alert, App, Button, Input, Segmented, Spin, Upload } from "antd";
import type { UploadFile } from "antd";
import { VideoCameraOutlined } from "@ant-design/icons";
import { errMsg } from "@/lib/err";
import type { DriveRevisionSource } from "../use-video-review";
import { DriveSourcePicker } from "./drive-source-picker";
import { fetchDriveFile, type DriveAttachment, type DriveFolderRef } from "./drive-api";
import { parseDriveLink } from "./drive-links";
import { pickDriveConnection, useDriveConnections, connectDriveHref } from "./use-drive-connections";

export type VersionSource =
  | { kind: "upload"; file: File | null }
  /** `importCopy` is a promise kept AFTER the version is saved: there is no
   *  revision row to import until then, so the button would have nothing to
   *  act on and a checkbox is the honest control. */
  | { kind: "drive"; attachment: DriveAttachment | null; importCopy?: boolean }
  | { kind: "url"; url: string };

export const emptyVersionSource: VersionSource = { kind: "upload", file: null };

/** True once the chosen source is complete enough to save. */
export function isVersionSourceReady(value: VersionSource): boolean {
  if (value.kind === "upload") return Boolean(value.file);
  if (value.kind === "drive") return Boolean(value.attachment);
  return value.url.trim().length > 0;
}

/**
 * True when the caller should kick off an import once the version is saved:
 *
 *   await addRevision.mutateAsync({ ... });
 *   if (versionWantsImport(src)) await importCopy.mutateAsync({ videoId });
 *
 * With no `rev`, the import route takes the latest revision — the one just
 * added.
 */
export function versionWantsImport(value: VersionSource): boolean {
  return value.kind === "drive" && Boolean(value.attachment) && Boolean(value.importCopy);
}

/** Turns the chosen source into the three fields `useAddRevision` accepts. */
export function versionSourceToRevisionInput(value: VersionSource): {
  file: File | null;
  url: string | null;
  drive: DriveRevisionSource | null;
} {
  if (value.kind === "upload") return { file: value.file, url: null, drive: null };
  if (value.kind === "url") return { file: null, url: value.url.trim() || null, drive: null };
  const a = value.attachment;
  return {
    file: null,
    url: null,
    drive: a
      ? {
          connectionId: a.connectionId,
          fileId: a.video.id,
          name: a.video.name,
          mimeType: a.video.mimeType,
          sizeBytes: a.video.sizeBytes,
          durationMs: a.video.durationMs,
          thumbnailUrl: a.video.thumbnailUrl,
        }
      : null,
  };
}

export function VersionSourcePicker({
  teamId,
  value,
  onChange,
  uploadHint = "Click or drag the new cut here",
}: {
  teamId: string | undefined;
  value: VersionSource;
  onChange: (next: VersionSource) => void;
  uploadHint?: string;
}) {
  const { message } = App.useApp();
  const { data: connections } = useDriveConnections();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [folder, setFolder] = useState<DriveFolderRef | null>(null);
  const [resolving, setResolving] = useState(false);

  const connection = pickDriveConnection(connections, connectionId);
  const url = value.kind === "url" ? value.url : "";
  const driveLink = useMemo(() => parseDriveLink(url), [url]);

  const resolvePastedLink = async () => {
    if (!driveLink || !teamId || !connection) return;
    setResolving(true);
    try {
      const resolved = await fetchDriveFile({
        connectionId: connection.id,
        fileId: driveLink.id,
      });
      if (resolved.kind === "folder") {
        setFolder(resolved.folder);
        onChange({ kind: "drive", attachment: null });
      } else {
        onChange({
          kind: "drive",
          attachment: { connectionId: connection.id, video: resolved.video },
        });
      }
    } catch (err) {
      message.error(errMsg(err, "Couldn’t open that Drive link."));
    } finally {
      setResolving(false);
    }
  };

  const returnTo =
    typeof window === "undefined" ? "/apps/video-review" : window.location.pathname;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Segmented
        block
        value={value.kind}
        onChange={(v) => {
          const kind = v as VersionSource["kind"];
          if (kind === "upload") onChange({ kind, file: fileList[0]?.originFileObj as File | null });
          else if (kind === "drive") onChange({ kind, attachment: null });
          else onChange({ kind, url: "" });
        }}
        options={[
          { label: "Upload", value: "upload" },
          { label: "Google Drive", value: "drive" },
          { label: "Link", value: "url" },
        ]}
      />

      {value.kind === "upload" ? (
        <Upload.Dragger
          maxCount={1}
          accept="video/*"
          beforeUpload={() => false}
          fileList={fileList}
          onChange={({ fileList: fl }) => {
            const next = fl.slice(-1);
            setFileList(next);
            onChange({ kind: "upload", file: (next[0]?.originFileObj as File) ?? null });
          }}
        >
          <p className="ant-upload-drag-icon">
            <VideoCameraOutlined />
          </p>
          <p className="ant-upload-text">{uploadHint}</p>
        </Upload.Dragger>
      ) : value.kind === "drive" ? (
        <DriveSourcePicker
          teamId={teamId}
          returnTo={returnTo}
          value={value.attachment}
          onChange={(attachment) =>
            onChange({ kind: "drive", attachment, importCopy: value.importCopy })
          }
          connectionId={connectionId}
          onConnectionChange={setConnectionId}
          openFolder={folder}
          importAsIntent
          importIntent={Boolean(value.importCopy)}
          onImportIntentChange={(next) =>
            onChange({ kind: "drive", attachment: value.attachment, importCopy: next })
          }
        />
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <Input
            value={url}
            onChange={(e) => onChange({ kind: "url", url: e.target.value })}
            placeholder="https://…/v2.mp4, YouTube, Vimeo, Loom, Drive…"
          />
          {driveLink && connection ? (
            <Alert
              type="info"
              showIcon
              message={
                driveLink.kind === "folder"
                  ? "That’s a Google Drive folder"
                  : "That’s a Google Drive video"
              }
              description={
                <Button type="primary" size="small" loading={resolving} onClick={resolvePastedLink}>
                  {driveLink.kind === "folder"
                    ? "Open this folder"
                    : "Use it through Google Drive (keeps timestamps)"}
                </Button>
              }
            />
          ) : driveLink && !connection ? (
            <Alert
              type="warning"
              showIcon
              message="Timestamps won’t work on this link"
              description={
                <div style={{ display: "grid", gap: 8 }}>
                  <span style={{ fontSize: 12.5 }}>
                    A Drive link plays inside Drive’s player, which Cubes can’t read the
                    playhead from. Connect Google so Cubes can stream the file itself, or
                    upload this cut instead.
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button
                      type="primary"
                      size="small"
                      disabled={!teamId}
                      onClick={() =>
                        teamId && window.location.assign(connectDriveHref(teamId, returnTo))
                      }
                    >
                      Connect Google
                    </Button>
                    <Button size="small" onClick={() => onChange(emptyVersionSource)}>
                      Upload instead
                    </Button>
                  </div>
                </div>
              }
            />
          ) : null}
          {resolving ? <Spin size="small" /> : null}
        </div>
      )}
    </div>
  );
}
