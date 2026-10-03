"use client";

import { useState } from "react";
import { Dropdown, Input, Popover, Slider, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { PlayerActions, PlayerState } from "./use-video-player";
import { DEFAULT_FPS, formatClock, formatTimecode, parseTimecode } from "./timecode";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

/** One square icon button — the transport's only button shape. */
function TButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  big,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  big?: boolean;
}) {
  return (
    <Tooltip title={label} mouseEnterDelay={0.4}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={`wl-vr-tbtn${active ? " is-on" : ""}${big ? " is-big" : ""}`}
      >
        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: big ? 24 : 19 }}>
          {icon}
        </span>
      </button>
    </Tooltip>
  );
}

/**
 * The transport bar that sits directly under the stage.
 *
 * Everything here is driven by `useVideoPlayer`, so the same bar works for an
 * uploaded file and for a Drive file streamed through our own endpoint. When
 * there is no readable playhead at all (a provider iframe) the caller passes
 * `disabled` and the bar stays visible but inert, which keeps the stage from
 * jumping as the viewer switches versions.
 */
export function TransportBar({
  state,
  actions,
  fps = DEFAULT_FPS,
  disabled,
  extra,
}: {
  state: PlayerState;
  actions: PlayerActions;
  fps?: number;
  disabled?: boolean;
  /** Right-aligned slot for app-level controls (e.g. the draw toggle). */
  extra?: React.ReactNode;
}) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const off = disabled || !state.hasMedia;

  const settings: MenuProps["items"] = [
    {
      key: "speed",
      label: "Playback speed",
      children: SPEEDS.map((s) => ({
        key: `speed-${s}`,
        label: `${s}×${s === 1 ? " (normal)" : ""}`,
        onClick: () => actions.setRate(s),
      })),
    },
    {
      key: "loop",
      label: state.loop ? "Loop: on" : "Loop: off",
      onClick: () => actions.toggleLoop(),
    },
    { type: "divider" },
    {
      key: "quality",
      disabled: true,
      // There is one rendition — we stream the original bytes rather than
      // transcoding — so "quality" is informational, not a choice.
      label: "Quality: source (original file)",
    },
    { key: "fps", disabled: true, label: `Timecode at ${fps} fps` },
  ];

  return (
    <div className="wl-vr-transport">
      <TButton
        icon={state.playing ? "pause" : "play_arrow"}
        label={state.playing ? "Pause (space)" : "Play (space)"}
        onClick={actions.togglePlay}
        disabled={off}
        big
      />
      <TButton
        icon="replay_5"
        label="Back 5s (←)"
        onClick={() => actions.seekBy(-5)}
        disabled={off}
      />
      <TButton
        icon="forward_5"
        label="Forward 5s (→)"
        onClick={() => actions.seekBy(5)}
        disabled={off}
      />
      <span className="wl-vr-t-wide">
        <TButton
          icon="repeat"
          label="Loop"
          onClick={actions.toggleLoop}
          active={state.loop}
          disabled={off}
        />
      </span>

      <span className="wl-vr-t-wide">
        <Dropdown
          disabled={off}
          menu={{
            items: SPEEDS.map((s) => ({
              key: String(s),
              label: `${s}×`,
              onClick: () => actions.setRate(s),
            })),
          }}
          trigger={["click"]}
        >
          <button type="button" className="wl-vr-tbtn is-text" disabled={off} aria-label="Playback speed">
            {state.rate}×
          </button>
        </Dropdown>
      </span>

      <span className="wl-vr-t-vol">
        <TButton
          icon={state.muted || state.volume === 0 ? "volume_off" : "volume_up"}
          label={state.muted ? "Unmute (m)" : "Mute (m)"}
          onClick={actions.toggleMute}
          disabled={off}
        />
        <Popover
          trigger="click"
          placement="top"
          content={
            <div style={{ height: 108, padding: "6px 2px" }}>
              <Slider
                vertical
                min={0}
                max={100}
                value={Math.round((state.muted ? 0 : state.volume) * 100)}
                onChange={(v) => actions.setVolume(v / 100)}
                style={{ height: "100%" }}
              />
            </div>
          }
        >
          <span className="wl-vr-vol-rail" role="presentation">
            <span
              className="wl-vr-vol-fill"
              style={{ width: `${Math.round((state.muted ? 0 : state.volume) * 100)}%` }}
            />
          </span>
        </Popover>
      </span>

      <Popover
        open={jumpOpen && !off}
        onOpenChange={(o) => {
          setJumpOpen(o);
          if (o) setJumpText(formatTimecode(state.currentTime, fps));
        }}
        trigger="click"
        placement="top"
        title="Jump to"
        content={
          <div style={{ width: 190 }}>
            <Input
              autoFocus
              size="small"
              value={jumpText}
              onChange={(e) => setJumpText(e.target.value)}
              placeholder="00:01:30:00"
              onPressEnter={() => {
                const secs = parseTimecode(jumpText, fps);
                if (secs !== null) actions.seek(secs);
                setJumpOpen(false);
              }}
            />
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
              HH:MM:SS:FF, or just 1:30. Enter to jump.
            </div>
          </div>
        }
      >
        <button
          type="button"
          className="wl-vr-timecode"
          disabled={off}
          aria-label="Current timecode — click to jump"
        >
          {formatTimecode(state.currentTime, fps)}
        </button>
      </Popover>
      <span className="wl-vr-duration">/ {formatClock(state.duration)}</span>

      <span style={{ flex: 1, minWidth: 4 }} />

      {extra}

      <Dropdown menu={{ items: settings }} trigger={["click"]} placement="topRight" disabled={off}>
        <button type="button" className="wl-vr-tbtn" aria-label="Settings" disabled={off}>
          <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 19 }}>
            settings
          </span>
        </button>
      </Dropdown>
      <TButton
        icon={state.fullscreen ? "fullscreen_exit" : "fullscreen"}
        label="Fullscreen (f)"
        onClick={actions.toggleFullscreen}
      />
    </div>
  );
}
