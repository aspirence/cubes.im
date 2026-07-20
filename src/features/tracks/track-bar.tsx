"use client";

import { useMemo, useState } from "react";
import {
  App as AntdApp,
  Button,
  ColorPicker,
  Dropdown,
  Input,
  Modal,
  Tooltip,
  theme,
} from "antd";
import {
  useProjectTracks,
  useCreateTrack,
  useUpdateTrack,
  useDeleteTrack,
  useActiveTrackStore,
  useActiveTrack,
  type ProjectTrack,
} from "@/features/tracks/use-tracks";
import { useTasks } from "@/features/tasks/use-tasks";

const PALETTE = [
  "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#ec4899", "#6366f1", "#14b8a6", "#f97316", "#64748b",
];

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * The track strip under the project header: "All" plus one chip per track,
 * each showing how many tasks sit in it. Picking a chip narrows every view in
 * the project to that track; "All" restores the full project.
 */
export function TrackBar({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const { token } = theme.useToken();
  const { data: tracks } = useProjectTracks(projectId);
  const activeTrack = useActiveTrack(projectId);
  const setTrack = useActiveTrackStore((s) => s.setTrack);
  const [managerOpen, setManagerOpen] = useState(false);

  // Counts come from the UNFILTERED project list, so each chip always shows the
  // real size of its track (not the size of the current selection).
  const { data: allTasks } = useTasks(projectId, { includeSubtasks: true });
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    let untracked = 0;
    for (const t of allTasks ?? []) {
      if (t.track_id) m.set(t.track_id, (m.get(t.track_id) ?? 0) + 1);
      else untracked += 1;
    }
    return { m, untracked, total: (allTasks ?? []).length };
  }, [allTasks]);

  // Nothing to show until a track exists — keep the header clean for projects
  // that don't use them.
  if ((tracks ?? []).length === 0 && !canManage) return null;

  const chip = (
    key: string | null,
    label: string,
    count: number,
    color?: string,
  ) => {
    const active = activeTrack === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        onClick={() => setTrack(projectId, key)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 28,
          padding: "0 11px",
          borderRadius: 999,
          border: `1px solid ${active ? (color ?? token.colorPrimary) : token.colorBorderSecondary}`,
          background: active
            ? `${color ?? token.colorPrimary}14`
            : token.colorBgContainer,
          color: active ? (color ?? token.colorPrimary) : token.colorTextSecondary,
          fontSize: 12.5,
          fontWeight: active ? 700 : 500,
          cursor: "pointer",
          transition: "all .14s ease",
        }}
      >
        {color ? (
          <span
            aria-hidden
            style={{ width: 8, height: 8, borderRadius: "50%", background: color, flex: "none" }}
          />
        ) : null}
        {label}
        <span
          className="tabular"
          style={{ fontSize: 11, opacity: 0.75, fontWeight: 600 }}
        >
          {count}
        </span>
      </button>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "2px 0 10px",
      }}
    >
      <Tooltip title="Tracks group this project's work by area — the project still shows everything.">
        <span style={{ display: "inline-flex", color: token.colorTextTertiary }}>
          <MIcon name="lan" size={16} />
        </span>
      </Tooltip>

      {chip(null, "All", counts.total)}
      {(tracks ?? []).map((t) =>
        chip(t.id, t.name, counts.m.get(t.id) ?? 0, t.color_code),
      )}

      {canManage ? (
        <Button
          type="text"
          size="small"
          onClick={() => setManagerOpen(true)}
          style={{ height: 28, borderRadius: 999, color: token.colorTextTertiary, fontSize: 12.5 }}
          icon={<MIcon name={(tracks ?? []).length ? "tune" : "add"} size={15} />}
        >
          {(tracks ?? []).length ? "Manage" : "Add track"}
        </Button>
      ) : null}

      <TrackManagerModal
        projectId={projectId}
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        untracked={counts.untracked}
        counts={counts.m}
      />
    </div>
  );
}

/** Create / rename / recolor / delete a project's tracks. */
function TrackManagerModal({
  projectId,
  open,
  onClose,
  untracked,
  counts,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  untracked: number;
  counts: Map<string, number>;
}) {
  const { token } = theme.useToken();
  const { message, modal } = AntdApp.useApp();
  const { data: tracks } = useProjectTracks(open ? projectId : undefined);
  const createTrack = useCreateTrack(projectId);
  const updateTrack = useUpdateTrack(projectId);
  const deleteTrack = useDeleteTrack(projectId);
  const setTrack = useActiveTrackStore((s) => s.setTrack);

  const [draft, setDraft] = useState("");
  const [color, setColor] = useState(PALETTE[0]);

  async function add() {
    const name = draft.trim();
    if (!name || createTrack.isPending) return;
    try {
      await createTrack.mutateAsync({
        name,
        color,
        sortOrder: (tracks ?? []).length,
      });
      setDraft("");
      setColor(PALETTE[((tracks ?? []).length + 1) % PALETTE.length]);
    } catch (e) {
      message.error(
        e instanceof Error && /duplicate|unique/i.test(e.message)
          ? "A track with that name already exists in this project."
          : "Couldn't add that track.",
      );
    }
  }

  function remove(t: ProjectTrack) {
    const n = counts.get(t.id) ?? 0;
    modal.confirm({
      title: `Delete track "${t.name}"?`,
      content:
        n > 0
          ? `${n} task${n === 1 ? "" : "s"} will move to "No track" — none of the work is deleted.`
          : "This track has no tasks.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteTrack.mutateAsync(t.id);
          // Don't leave the project filtered by a track that no longer exists.
          setTrack(projectId, null);
        } catch {
          message.error("Couldn't delete that track.");
        }
      },
    });
  }

  return (
    <Modal title="Tracks" open={open} onCancel={onClose} footer={null} width={520}>
      <p style={{ marginTop: 0, fontSize: 13, color: token.colorTextTertiary, lineHeight: 1.6 }}>
        Group this project&apos;s work by area — Social Media, Paid Ads, Website.
        The project keeps showing every task; picking a track narrows the views
        to just that one.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {(tracks ?? []).map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            count={counts.get(t.id) ?? 0}
            onRename={(name) =>
              updateTrack
                .mutateAsync({ id: t.id, name })
                .catch(() => message.error("Couldn't rename the track."))
            }
            onColor={(c) =>
              updateTrack
                .mutateAsync({ id: t.id, color: c })
                .catch(() => message.error("Couldn't update the colour."))
            }
            onDelete={() => remove(t)}
          />
        ))}

        {untracked > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px dashed ${token.colorBorder}`,
              fontSize: 13,
              color: token.colorTextTertiary,
            }}
          >
            <MIcon name="inbox" size={16} />
            No track
            <span className="tabular" style={{ marginLeft: "auto", fontWeight: 600 }}>
              {untracked}
            </span>
          </div>
        ) : null}
      </div>

      {/* Add */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <ColorPicker
          value={color}
          onChange={(c) => setColor(c.toHexString())}
          presets={[{ label: "Tracks", colors: PALETTE }]}
          disabledAlpha
        />
        <Input
          placeholder="New track name…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={add}
          maxLength={60}
        />
        <Button
          type="primary"
          onClick={add}
          loading={createTrack.isPending}
          disabled={!draft.trim()}
        >
          Add
        </Button>
      </div>
    </Modal>
  );
}

function TrackRow({
  track,
  count,
  onRename,
  onColor,
  onDelete,
}: {
  track: ProjectTrack;
  count: number;
  onRename: (name: string) => void;
  onColor: (color: string) => void;
  onDelete: () => void;
}) {
  const { token } = theme.useToken();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);

  function commit() {
    const next = name.trim();
    setEditing(false);
    if (next && next !== track.name) onRename(next);
    else setName(track.name);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <ColorPicker
        value={track.color_code}
        size="small"
        onChangeComplete={(c) => onColor(c.toHexString())}
        presets={[{ label: "Tracks", colors: PALETTE }]}
        disabledAlpha
      />
      {editing ? (
        <Input
          size="small"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={commit}
          onBlur={commit}
          style={{ flex: 1 }}
          maxLength={60}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13.5,
            fontWeight: 600,
            color: token.colorText,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {track.name}
        </span>
      )}
      <span className="tabular" style={{ fontSize: 12, color: token.colorTextTertiary }}>
        {count}
      </span>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            {
              key: "rename",
              label: "Rename",
              icon: <MIcon name="edit" size={14} />,
              onClick: () => {
                setName(track.name);
                setEditing(true);
              },
            },
            {
              key: "delete",
              label: "Delete",
              danger: true,
              icon: <MIcon name="delete" size={14} />,
              onClick: onDelete,
            },
          ],
        }}
      >
        <Button
          type="text"
          size="small"
          aria-label={`${track.name} options`}
          icon={<MIcon name="more_horiz" size={16} color={token.colorTextTertiary} />}
        />
      </Dropdown>
    </div>
  );
}
