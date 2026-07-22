"use client";

import { useCallback, useRef, useState } from "react";
import { App, Button, Dropdown, Input, Modal, Tooltip, theme } from "antd";
import type { MenuProps } from "antd";
import { useBoards, useBoardsRealtime } from "@/features/whiteboard/use-boards";
import {
  WhiteboardCanvas,
  type ExcalidrawAPI,
  type SaveStatus,
} from "@/features/whiteboard/whiteboard-canvas";

/** Loosely-typed slice of Excalidraw's export helpers (dynamically imported so
 *  the heavy bundle stays out of SSR / the initial load). */
type ExcalidrawExports = {
  exportToBlob: (o: {
    elements: readonly unknown[];
    appState: unknown;
    files: unknown;
    mimeType?: string;
    quality?: number;
  }) => Promise<Blob>;
  exportToSvg: (o: {
    elements: readonly unknown[];
    appState: unknown;
    files: unknown;
  }) => Promise<SVGSVGElement>;
};

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" style={{ fontSize: size, color, lineHeight: 1 }}>
      {name}
    </span>
  );
}

/** Compact relative time for the board switcher ("just now", "5m ago", …). */
function editedAgo(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function WhiteboardPage() {
  const { token } = theme.useToken();
  const { modal, message } = App.useApp();
  const { boards, ready, hasTeam, create, rename, remove, duplicate, loadScene, saveScene } =
    useBoards();
  useBoardsRealtime();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const apiRef = useRef<ExcalidrawAPI | null>(null);

  // Derive the effective board during render (no effect): the current selection
  // if it still exists, otherwise the most-recently-updated board.
  const effectiveId =
    activeId && boards.some((b) => b.id === activeId) ? activeId : boards[0]?.id ?? null;
  const active = boards.find((b) => b.id === effectiveId) ?? null;

  const handleStatus = useCallback((s: SaveStatus) => setSaveStatus(s), []);
  const handleApiReady = useCallback((api: ExcalidrawAPI | null) => {
    apiRef.current = api;
  }, []);

  const handleNew = async () => {
    try {
      const board = await create(`Board ${boards.length + 1}`);
      if (board) setActiveId(board.id);
    } catch {
      message.error("Couldn't create the board.");
    }
  };

  const handleDuplicate = async () => {
    if (!active) return;
    try {
      const board = await duplicate(active.id);
      if (board) setActiveId(board.id);
    } catch {
      message.error("Couldn't duplicate the board.");
    }
  };

  const handleDelete = (id: string, name: string) =>
    modal.confirm({
      title: `Delete "${name}"?`,
      content: "This whiteboard and its drawing will be permanently removed for the whole team.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await remove(id);
        } catch {
          message.error("Couldn't delete the board.");
        }
      },
    });

  const commitRename = async () => {
    if (renaming && renaming.name.trim()) {
      try {
        await rename(renaming.id, renaming.name.trim());
      } catch {
        message.error("Couldn't rename the board.");
      }
    }
    setRenaming(null);
  };

  const exportImage = useCallback(
    async (format: "png" | "svg") => {
      const api = apiRef.current;
      if (!api) return;
      const elements = api.getSceneElements();
      if (!elements.length) {
        message.info("This board is empty — nothing to export yet.");
        return;
      }
      const appState = api.getAppState();
      const files = api.getFiles();
      const safe =
        (active?.name ?? "whiteboard").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") ||
        "whiteboard";
      try {
        const mod = (await import("@excalidraw/excalidraw")) as unknown as ExcalidrawExports;
        if (format === "png") {
          const blob = await mod.exportToBlob({
            elements,
            appState: { ...appState, exportBackground: true },
            files,
            mimeType: "image/png",
            quality: 1,
          });
          downloadBlob(blob, `${safe}.png`);
        } else {
          const svg = await mod.exportToSvg({
            elements,
            appState: { ...appState, exportBackground: true },
            files,
          });
          const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
            type: "image/svg+xml",
          });
          downloadBlob(blob, `${safe}.svg`);
        }
      } catch {
        message.error("Export failed.");
      }
    },
    [active?.name, message],
  );

  const switcherItems: MenuProps["items"] = [
    ...(boards.length
      ? boards.map((b) => ({
          key: b.id,
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 220 }}>
              <MIcon
                name={b.id === effectiveId ? "check" : "gesture"}
                size={16}
                color={b.id === effectiveId ? token.colorPrimary : token.colorTextTertiary}
              />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.name}
              </span>
              <span style={{ fontSize: 11, color: token.colorTextQuaternary, flex: "none" }}>
                {editedAgo(b.updatedAt)}
              </span>
            </span>
          ),
          onClick: () => setActiveId(b.id),
        }))
      : [{ key: "empty", label: "No boards yet", disabled: true }]),
    { type: "divider" as const },
    { key: "new", label: "New board", icon: <MIcon name="add" size={16} />, onClick: handleNew },
  ];

  const exportItems: MenuProps["items"] = [
    { key: "png", label: "Export as PNG", icon: <MIcon name="image" size={16} />, onClick: () => exportImage("png") },
    { key: "svg", label: "Export as SVG", icon: <MIcon name="shapes" size={16} />, onClick: () => exportImage("svg") },
  ];

  const barBtn: React.CSSProperties = {
    height: 34,
    borderRadius: 9,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontWeight: 600,
  };

  const iconBtn: React.CSSProperties = { ...barBtn, width: 34, justifyContent: "center", padding: 0 };

  return (
    <div
      style={{
        height: "calc(100dvh - 58px)",
        display: "flex",
        flexDirection: "column",
        background: token.colorBgLayout,
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          flex: "none",
          height: 52,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: token.colorText, fontWeight: 700, fontSize: 14.5, letterSpacing: "-0.01em" }}>
          <MIcon name="gesture" size={20} color={token.colorPrimary} />
          Whiteboard
        </span>

        <span style={{ width: 1, height: 20, background: token.colorBorderSecondary, margin: "0 4px" }} />

        <Dropdown menu={{ items: switcherItems }} trigger={["click"]}>
          <Button style={barBtn}>
            <MIcon name="gesture" size={16} color={token.colorTextTertiary} />
            <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {active?.name ?? "No board"}
            </span>
            <MIcon name="expand_more" size={18} color={token.colorTextTertiary} />
          </Button>
        </Dropdown>

        {active ? (
          <>
            <Tooltip title="Rename">
              <Button
                style={iconBtn}
                onClick={() => setRenaming({ id: active.id, name: active.name })}
                icon={<MIcon name="edit" size={16} />}
              />
            </Tooltip>
            <Tooltip title="Duplicate">
              <Button style={iconBtn} onClick={handleDuplicate} icon={<MIcon name="content_copy" size={16} />} />
            </Tooltip>
            <Dropdown menu={{ items: exportItems }} trigger={["click"]}>
              <Tooltip title="Export">
                <Button style={iconBtn} icon={<MIcon name="download" size={16} />} />
              </Tooltip>
            </Dropdown>
            <Tooltip title="Delete">
              <Button
                danger
                style={iconBtn}
                onClick={() => handleDelete(active.id, active.name)}
                icon={<MIcon name="delete" size={16} />}
              />
            </Tooltip>
          </>
        ) : null}

        <span style={{ flex: 1 }} />

        {active && saveStatus !== "idle" ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              marginRight: 4,
              color: saveStatus === "error" ? token.colorError : token.colorTextTertiary,
            }}
          >
            <MIcon
              name={saveStatus === "saving" ? "cloud_sync" : saveStatus === "saved" ? "cloud_done" : "cloud_off"}
              size={16}
              color={saveStatus === "error" ? token.colorError : token.colorTextTertiary}
            />
            {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Save failed"}
          </span>
        ) : null}

        <Button type="primary" style={barBtn} onClick={handleNew} icon={<MIcon name="add" size={17} />}>
          New board
        </Button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {!hasTeam ? (
          <CenterState icon="groups" title="No team selected" subtitle="Join or switch to a team to use whiteboards." />
        ) : !ready ? null : active ? (
          <WhiteboardCanvas
            key={active.id}
            boardId={active.id}
            loadScene={loadScene}
            saveScene={saveScene}
            onStatusChange={handleStatus}
            onApiReady={handleApiReady}
          />
        ) : (
          <CenterState
            icon="gesture"
            title="No whiteboards yet"
            action={
              <Button type="primary" onClick={handleNew} icon={<MIcon name="add" size={17} />} style={{ ...barBtn, height: 40, paddingInline: 18 }}>
                Create your first board
              </Button>
            }
          />
        )}
      </div>

      {/* Rename modal */}
      <Modal
        open={renaming !== null}
        title="Rename board"
        okText="Save"
        onCancel={() => setRenaming(null)}
        onOk={commitRename}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renaming?.name ?? ""}
          onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
          onPressEnter={commitRename}
          placeholder="Board name"
          maxLength={80}
        />
      </Modal>
    </div>
  );
}

function CenterState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        color: token.colorTextTertiary,
      }}
    >
      <MIcon name={icon} size={44} color={token.colorTextQuaternary} />
      <div style={{ fontSize: 15, color: token.colorTextSecondary }}>{title}</div>
      {subtitle ? <div style={{ fontSize: 13 }}>{subtitle}</div> : null}
      {action}
    </div>
  );
}
