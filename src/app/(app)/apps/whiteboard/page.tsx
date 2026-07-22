"use client";

import { useState } from "react";
import { App, Button, Dropdown, Input, Modal, Tooltip, theme } from "antd";
import type { MenuProps } from "antd";
import { useBoards } from "@/features/whiteboard/use-boards";
import { WhiteboardCanvas } from "@/features/whiteboard/whiteboard-canvas";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" style={{ fontSize: size, color, lineHeight: 1 }}>
      {name}
    </span>
  );
}

export default function WhiteboardPage() {
  const { token } = theme.useToken();
  const { modal } = App.useApp();
  const { boards, ready, create, rename, remove, touch } = useBoards();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  // Derive the effective board during render (no effect): the current selection
  // if it still exists, otherwise the most-recently-updated board.
  const effectiveId =
    activeId && boards.some((b) => b.id === activeId) ? activeId : boards[0]?.id ?? null;
  const active = boards.find((b) => b.id === effectiveId) ?? null;

  const handleNew = () => {
    const board = create(`Board ${boards.length + 1}`);
    setActiveId(board.id);
  };

  const handleDelete = (id: string, name: string) =>
    modal.confirm({
      title: `Delete "${name}"?`,
      content: "This whiteboard and its drawing will be permanently removed.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () => remove(id),
    });

  const switcherItems: MenuProps["items"] = [
    ...(boards.length
      ? boards.map((b) => ({
          key: b.id,
          label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 160 }}>
              <MIcon name={b.id === effectiveId ? "check" : "gesture"} size={16} color={b.id === effectiveId ? token.colorPrimary : token.colorTextTertiary} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
            </span>
          ),
          onClick: () => setActiveId(b.id),
        }))
      : [{ key: "empty", label: "No boards yet", disabled: true }]),
    { type: "divider" as const },
    { key: "new", label: "New board", icon: <MIcon name="add" size={16} />, onClick: handleNew },
  ];

  const barBtn: React.CSSProperties = {
    height: 34,
    borderRadius: 9,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontWeight: 600,
  };

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
                style={{ ...barBtn, width: 34, justifyContent: "center", padding: 0 }}
                onClick={() => setRenaming({ id: active.id, name: active.name })}
                icon={<MIcon name="edit" size={16} />}
              />
            </Tooltip>
            <Tooltip title="Delete">
              <Button
                danger
                style={{ ...barBtn, width: 34, justifyContent: "center", padding: 0 }}
                onClick={() => handleDelete(active.id, active.name)}
                icon={<MIcon name="delete" size={16} />}
              />
            </Tooltip>
          </>
        ) : null}

        <span style={{ flex: 1 }} />

        <Button type="primary" style={barBtn} onClick={handleNew} icon={<MIcon name="add" size={17} />}>
          New board
        </Button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {!ready ? null : active ? (
          <WhiteboardCanvas key={active.id} boardId={active.id} onSaved={touch} />
        ) : (
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
            <MIcon name="gesture" size={44} color={token.colorTextQuaternary} />
            <div style={{ fontSize: 15, color: token.colorTextSecondary }}>No whiteboards yet</div>
            <Button type="primary" onClick={handleNew} icon={<MIcon name="add" size={17} />} style={{ ...barBtn, height: 40, paddingInline: 18 }}>
              Create your first board
            </Button>
          </div>
        )}
      </div>

      {/* Rename modal */}
      <Modal
        open={renaming !== null}
        title="Rename board"
        okText="Save"
        onCancel={() => setRenaming(null)}
        onOk={() => {
          if (renaming && renaming.name.trim()) rename(renaming.id, renaming.name.trim());
          setRenaming(null);
        }}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renaming?.name ?? ""}
          onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
          onPressEnter={() => {
            if (renaming && renaming.name.trim()) rename(renaming.id, renaming.name.trim());
            setRenaming(null);
          }}
          placeholder="Board name"
          maxLength={80}
        />
      </Modal>
    </div>
  );
}
