"use client";

import Link from "next/link";
import { Dropdown, Tag, Typography } from "antd";
import type { MenuProps } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { VIDEO_STATUS_META, type VideoWithProject } from "./use-video-review";

dayjs.extend(relativeTime);

const { Text } = Typography;

/** Video Review palette — the platform's own light/indigo design language. */
export const VR = {
  bg: "#f6f7f9",
  panel: "#ffffff",
  panelSoft: "#f2f3f5",
  hairline: "#ececf0",
  text: "#17171c",
  textSecondary: "#6a6d78",
  textTertiary: "#9a9da8",
  accent: "#4a4ad0",
  accentSoft: "#eceefb",
} as const;

/**
 * Historically forced a dark subtree; the app now follows the platform theme,
 * so this is a passthrough kept for call-site stability.
 */
export function VRThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function StatusChip({ status }: { status: string }) {
  const meta = VIDEO_STATUS_META[status] ?? { label: status, color: "default" };
  return (
    <Tag color={meta.color} style={{ marginInlineEnd: 0, borderRadius: 6 }}>
      {meta.label}
    </Tag>
  );
}

/** Video card grid shared by the hub and the project-embedded view. Pass
 *  `cardMenu` to add a per-card ⋯ menu (e.g. Move to folder). */
export function VideoGrid({
  videos,
  cardMenu,
}: {
  videos: VideoWithProject[];
  cardMenu?: (v: VideoWithProject) => MenuProps;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 14,
      }}
    >
      {videos.map((v) => (
        <Link
          key={v.id}
          href={`/apps/video-review/${v.id}`}
          className="wl-vr-card"
          style={{
            background: VR.panel,
            border: `1px solid ${VR.hairline}`,
            borderRadius: 12,
            overflow: "hidden",
            textDecoration: "none",
            color: "inherit",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {cardMenu ? (
            <span
              onClick={(e) => {
                // Keep the menu trigger from following the card link.
                e.preventDefault();
                e.stopPropagation();
              }}
              style={{ position: "absolute", top: 6, right: 6, zIndex: 2 }}
            >
              <Dropdown menu={cardMenu(v)} trigger={["click"]} placement="bottomRight">
                <button
                  type="button"
                  aria-label="Video options"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    border: "none",
                    background: "rgba(0,0,0,0.35)",
                    color: "#fff",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16 }}>
                    more_horiz
                  </span>
                </button>
              </Dropdown>
            </span>
          ) : null}
          <div
            style={{
              height: 118,
              background: "linear-gradient(140deg, #2b2b31 0%, #34346a 60%, #4a4ad0 130%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              className="material-symbols-rounded"
              aria-hidden
              style={{ fontSize: 34, color: "rgba(255,255,255,0.8)" }}
            >
              play_circle
            </span>
          </div>
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Text
                strong
                style={{
                  color: VR.text,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 13.5,
                }}
              >
                {v.title}
              </Text>
              <StatusChip status={v.status} />
            </div>
            <Text style={{ color: VR.textTertiary, fontSize: 12 }}>
              v{v.latest_revision} · {dayjs(v.updated_at).fromNow()}
              {v.project ? ` · ${v.project.name}` : ""}
            </Text>
          </div>
        </Link>
      ))}
      <style>{`
        .wl-vr-card { transition: border-color .12s ease, box-shadow .12s ease, transform .12s ease; }
        .wl-vr-card:hover { border-color: rgba(74,74,208,.45); box-shadow: 0 6px 18px -8px rgba(16,24,40,.14); transform: translateY(-1px); }
      `}</style>
    </div>
  );
}
