"use client";

import { useState } from "react";
import { App as AntdApp, Popover, Tooltip, theme } from "antd";
import type { ChatReaction } from "@/features/chat/use-chat";

/** Reactions worth one tap — the rest live behind the picker. */
export const QUICK_EMOJI = ["👍", "🎉", "✅", "👀", "🙌", "❤️"];

const EMOJI_PICKER = [
  "👍", "👎", "❤️", "🎉", "✅", "❌", "👀", "🙌", "🔥", "💯",
  "😄", "😂", "🙏", "👏", "🤝", "💡", "⚡", "🚀", "⏳", "🐛",
  "📌", "📎", "🎯", "✨", "🤔", "😅", "😍", "🥳", "😴", "🫡",
];

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * The toolbar that appears over a message on hover: quick reactions, the full
 * emoji picker, and (for your own messages) edit / delete.
 */
export function MessageHoverActions({
  mine,
  onReact,
  onEdit,
  onDelete,
  onCopy,
}: {
  mine: boolean;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const { token } = theme.useToken();
  const [pickerOpen, setPickerOpen] = useState(false);

  const btn = (
    label: string,
    icon: string,
    onClick: () => void,
    danger = false,
  ) => (
    <Tooltip title={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        style={{
          width: 26,
          height: 26,
          border: "none",
          background: "transparent",
          borderRadius: 6,
          cursor: "pointer",
          color: danger ? token.colorError : token.colorTextSecondary,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MIcon name={icon} size={16} />
      </button>
    </Tooltip>
  );

  return (
    <div
      className="wl-msg-actions"
      style={{
        position: "absolute",
        top: -14,
        right: 8,
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 2,
        borderRadius: 9,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
        boxShadow: "0 4px 14px -6px rgba(16,24,40,.22)",
      }}
    >
      {QUICK_EMOJI.slice(0, 3).map((e) => (
        <Tooltip key={e} title={`React ${e}`}>
          <button
            type="button"
            aria-label={`React ${e}`}
            onClick={() => onReact(e)}
            style={{
              width: 26,
              height: 26,
              border: "none",
              background: "transparent",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            {e}
          </button>
        </Tooltip>
      ))}

      <Popover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        trigger="click"
        placement="topRight"
        arrow={false}
        content={
          <div style={{ width: 236, display: "flex", flexWrap: "wrap", gap: 2 }}>
            {EMOJI_PICKER.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`React ${e}`}
                onClick={() => {
                  onReact(e);
                  setPickerOpen(false);
                }}
                style={{
                  width: 30,
                  height: 30,
                  border: "none",
                  background: "transparent",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 17,
                  lineHeight: 1,
                }}
              >
                {e}
              </button>
            ))}
          </div>
        }
      >
        {btn("More reactions", "add_reaction", () => setPickerOpen(true))}
      </Popover>

      {btn("Copy text", "content_copy", onCopy)}
      {mine ? btn("Edit", "edit", onEdit) : null}
      {mine ? btn("Delete", "delete", onDelete, true) : null}
    </div>
  );
}

/** The reaction pills under a message. Click one to add/remove your own. */
export function MessageReactions({
  reactions,
  myUserId,
  onToggle,
}: {
  reactions: ChatReaction[];
  myUserId: string | undefined;
  onToggle: (emoji: string, existingId?: string) => void;
}) {
  const { token } = theme.useToken();
  if (!reactions?.length) return null;

  // Group by emoji, preserving first-seen order so pills don't jump around.
  const groups = new Map<string, ChatReaction[]>();
  for (const r of reactions) {
    const arr = groups.get(r.emoji) ?? [];
    arr.push(r);
    groups.set(r.emoji, arr);
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
      {[...groups.entries()].map(([emoji, list]) => {
        const mine = list.find((r) => r.user_id === myUserId);
        const names = list.map((r) => r.user?.name ?? "Someone");
        return (
          <Tooltip
            key={emoji}
            title={`${names.slice(0, 6).join(", ")}${names.length > 6 ? ` +${names.length - 6}` : ""} reacted ${emoji}`}
          >
            <button
              type="button"
              onClick={() => onToggle(emoji, mine?.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                height: 24,
                padding: "0 8px",
                borderRadius: 999,
                cursor: "pointer",
                fontSize: 12.5,
                lineHeight: 1,
                border: `1px solid ${mine ? token.colorPrimary : token.colorBorderSecondary}`,
                background: mine ? token.colorPrimaryBg : token.colorFillQuaternary,
                color: mine ? token.colorPrimary : token.colorTextSecondary,
                fontWeight: mine ? 700 : 500,
              }}
            >
              <span style={{ fontSize: 13 }}>{emoji}</span>
              {list.length}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Emoji picker for the composer — inserts at the end of the draft. */
export function ComposerEmojiButton({ onPick }: { onPick: (emoji: string) => void }) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const { message } = AntdApp.useApp();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topRight"
      arrow={false}
      content={
        <div style={{ width: 236, display: "flex", flexWrap: "wrap", gap: 2 }}>
          {EMOJI_PICKER.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={e}
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              style={{
                width: 30,
                height: 30,
                border: "none",
                background: "transparent",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 17,
                lineHeight: 1,
              }}
            >
              {e}
            </button>
          ))}
        </div>
      }
    >
      <Tooltip title="Emoji">
        <button
          type="button"
          aria-label="Insert emoji"
          onClick={() => {
            if (!open) message.destroy("emoji-hint");
          }}
          style={{
            width: 32,
            height: 30,
            marginBottom: 3,
            flex: "none",
            border: "none",
            background: "transparent",
            borderRadius: 8,
            cursor: "pointer",
            color: token.colorTextTertiary,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MIcon name="mood" size={17} />
        </button>
      </Tooltip>
    </Popover>
  );
}
