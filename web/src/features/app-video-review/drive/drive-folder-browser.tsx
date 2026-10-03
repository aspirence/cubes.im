"use client";

/**
 * In-app browser for a Google Drive folder.
 *
 * The complaint this answers: a client sends the folder link, and the old modal
 * rejected it with "open it and copy the file's link instead" — handing the
 * user homework. A folder is a perfectly good answer to "where is the video";
 * it just is not a single video, so the job is to show what is inside it and
 * let them say which one.
 *
 * Contacts Google only through our route, and renders nothing it has not been
 * given: this component is pure presentation over a listing plus callbacks, so
 * the modal and the reviewer page can mount the same grid.
 */

import { useMemo, useState } from "react";
import { Alert, Breadcrumb, Button, Checkbox, Empty, Input, Skeleton, Tooltip, theme } from "antd";
import { MIcon } from "@/features/app-content-studio/ui";
import type { DriveFolderListing, DriveFolderRef, DriveVideo } from "./drive-api";
import { driveFolderUrl, filterByName, formatBytes, formatDuration } from "./drive-links";

/** A tile is at least this wide; the grid fits as many as the container allows. */
const TILE_MIN = 168;

function Meta({ video }: { video: DriveVideo }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        fontSize: 11.5,
        color: token.colorTextTertiary,
        whiteSpace: "nowrap",
      }}
    >
      <span>{formatDuration(video.durationMs)}</span>
      <span aria-hidden>·</span>
      <span>{formatBytes(video.sizeBytes)}</span>
    </div>
  );
}

function VideoTile({
  video,
  selected,
  selectable,
  onToggle,
  onChoose,
}: {
  video: DriveVideo;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onChoose: () => void;
}) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
        borderRadius: 10,
        overflow: "hidden",
        background: token.colorBgContainer,
        // The whole tile is the button; the checkbox is a second, smaller
        // target for the "add several" case so one click never means both.
        boxShadow: selected ? `0 0 0 1px ${token.colorPrimary}` : "none",
        transition: "border-color .12s ease, box-shadow .12s ease",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onChoose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChoose();
          }
        }}
        aria-label={`Use ${video.name}`}
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          background: token.colorFillTertiary,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
        }}
      >
        {video.thumbnailUrl ? (
          // Drive's thumbnail host is short-lived and per-file; next/image would
          // need it in remotePatterns and would cache a URL that expires within
          // the hour.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <MIcon name="movie" size={28} color={token.colorTextQuaternary} />
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: hover ? "rgba(0,0,0,.35)" : "transparent",
            opacity: hover ? 1 : 0,
            transition: "opacity .12s ease",
          }}
        >
          <span
            style={{
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(0,0,0,.55)",
            }}
          >
            Use this
          </span>
        </div>
        {selectable ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 6,
              insetInlineStart: 6,
              background: "rgba(0,0,0,.45)",
              borderRadius: 6,
              padding: "1px 4px",
            }}
          >
            <Checkbox checked={selected} onChange={onToggle} aria-label={`Select ${video.name}`} />
          </div>
        ) : null}
      </div>
      <div style={{ padding: "7px 9px 9px", display: "grid", gap: 3 }}>
        <Tooltip title={video.name} mouseEnterDelay={0.6}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: token.colorText,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {video.name}
          </div>
        </Tooltip>
        <Meta video={video} />
      </div>
    </div>
  );
}

function FolderTile({ folder, onOpen }: { folder: DriveFolderRef; onOpen: () => void }) {
  const { token } = theme.useToken();
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 11px",
        borderRadius: 10,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        color: token.colorText,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
        textAlign: "start",
        minWidth: 0,
      }}
    >
      <MIcon name="folder" size={18} color={token.colorWarning} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {folder.name}
      </span>
    </button>
  );
}

export function DriveFolderBrowser({
  trail,
  listing,
  loading,
  error,
  search,
  onSearch,
  onCrumb,
  onOpenFolder,
  onChoose,
  multiSelect,
  selectedIds,
  onToggleSelect,
  onAddSelected,
  addSelectedLabel = "Add all as separate reviews",
  onBack,
}: {
  trail: DriveFolderRef[];
  listing: DriveFolderListing | undefined;
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (value: string) => void;
  onCrumb: (index: number) => void;
  onOpenFolder: (folder: DriveFolderRef) => void;
  onChoose: (video: DriveVideo) => void;
  /** Off in the reviewer page: a version is one file, not a batch. */
  multiSelect?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (video: DriveVideo) => void;
  onAddSelected?: () => void;
  addSelectedLabel?: string;
  onBack: () => void;
}) {
  const { token } = theme.useToken();
  const here = trail[trail.length - 1] ?? null;
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);

  // Filtering is local, over the page we already hold, so typing is instant and
  // costs no Drive quota. A folder large enough to page is the one case this
  // misses, and there the answer is to open a subfolder rather than to send a
  // request per keystroke.
  const folders = useMemo(
    () => filterByName(listing?.folders ?? [], search),
    [listing?.folders, search],
  );
  const videos = useMemo(
    () => filterByName(listing?.videos ?? [], search),
    [listing?.videos, search],
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Button size="small" onClick={onBack} icon={<MIcon name="arrow_back" size={15} />}>
          Back
        </Button>
        <Breadcrumb
          style={{ fontSize: 12.5, minWidth: 0, flex: "1 1 160px" }}
          items={(trail.length ? trail : here ? [here] : []).map((f, i) => ({
            title:
              i === trail.length - 1 ? (
                <span style={{ fontWeight: 600 }}>{f.name}</span>
              ) : (
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    onCrumb(i);
                  }}
                >
                  {f.name}
                </a>
              ),
          }))}
        />
        {here ? (
          <a
            href={driveFolderUrl(here.id)}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: "nowrap" }}
          >
            Open in Drive
          </a>
        ) : null}
      </div>

      <Input
        allowClear
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search this folder"
        prefix={<MIcon name="search" size={15} color={token.colorTextTertiary} />}
      />

      {error ? <Alert type="error" showIcon message={error} /> : null}

      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : folders.length === 0 && videos.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            search.trim()
              ? "Nothing here matches that."
              : "No videos in this folder. Open a subfolder, or pick the file in Drive."
          }
        />
      ) : (
        <div style={{ display: "grid", gap: 10, maxHeight: 340, overflowY: "auto", paddingInlineEnd: 2 }}>
          {folders.length ? (
            <div
              style={{
                display: "grid",
                gap: 8,
                gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN}px, 1fr))`,
              }}
            >
              {folders.map((f) => (
                <FolderTile key={f.id} folder={f} onOpen={() => onOpenFolder(f)} />
              ))}
            </div>
          ) : null}
          {videos.length ? (
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN}px, 1fr))`,
              }}
            >
              {videos.map((v) => (
                <VideoTile
                  key={v.id}
                  video={v}
                  selected={selected.has(v.id)}
                  selectable={Boolean(multiSelect)}
                  onToggle={() => onToggleSelect?.(v)}
                  onChoose={() => onChoose(v)}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {multiSelect && selected.size > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
            {selected.size} selected
          </span>
          <Button type="primary" size="small" onClick={onAddSelected}>
            {addSelectedLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
