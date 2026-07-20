"use client";

import { useState } from "react";
import { App as AntdApp, Dropdown, Tooltip, theme } from "antd";
import { useTaskIdFormatter } from "@/features/settings/use-task-id-format";

/**
 * Renders a task's configured display id (e.g. "PAY2-012" or "#12"). Reads the
 * team's format + the project's key via cached queries, so it can be dropped in
 * anywhere a task number is shown without threading props through.
 */
export function TaskIdLabel({
  projectId,
  taskNo,
}: {
  projectId: string | undefined;
  taskNo: number | null | undefined;
}) {
  const fmt = useTaskIdFormatter(projectId);
  return <>{fmt(taskNo)}</>;
}

/** Clipboard write with a legacy fallback (older Safari / non-secure origins). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea trick
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * The task's ID as an interactive chip: click copies the ID, and the right-click
 * menu also copies the task's URL or "ID + name" for pasting into chat/docs.
 * Use where the ID is a first-class handle (the task drawer header);
 * `TaskIdLabel` stays the plain-text form for dense rows and cards.
 */
export function TaskIdChip({
  projectId,
  taskNo,
  taskId,
  taskName,
}: {
  projectId: string | undefined;
  taskNo: number | null | undefined;
  /** Task uuid — used to build the shareable link. */
  taskId?: string;
  taskName?: string;
}) {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const fmt = useTaskIdFormatter(projectId);
  const [copied, setCopied] = useState(false);

  const display = fmt(taskNo);

  async function copy(value: string, label: string) {
    const ok = await copyText(value);
    if (!ok) {
      message.error("Couldn't copy — copy it manually.");
      return;
    }
    setCopied(true);
    message.success(`${label} copied`);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (taskNo == null || !display) {
    return (
      <span
        style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: 0.3,
          color: token.colorTextTertiary,
        }}
      >
        TASK
      </span>
    );
  }

  const taskUrl =
    taskId && projectId && typeof window !== "undefined"
      ? `${window.location.origin}/projects/${projectId}?task=${taskId}`
      : null;

  const items = [
    {
      key: "id",
      label: `Copy ID (${display})`,
      icon: (
        <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
          tag
        </span>
      ),
      onClick: () => void copy(display, "Task ID"),
    },
    ...(taskUrl
      ? [
          {
            key: "link",
            label: "Copy link",
            icon: (
              <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                link
              </span>
            ),
            onClick: () => void copy(taskUrl, "Link"),
          },
        ]
      : []),
    ...(taskName
      ? [
          {
            key: "both",
            label: "Copy ID + name",
            icon: (
              <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                content_copy
              </span>
            ),
            onClick: () => void copy(`${display} ${taskName}`, "ID + name"),
          },
        ]
      : []),
  ];

  return (
    <Dropdown menu={{ items }} trigger={["contextMenu"]}>
      <Tooltip title={copied ? "Copied!" : "Click to copy · right-click for more"}>
        <button
          type="button"
          onClick={() => void copy(display, "Task ID")}
          className="wl-task-id-chip"
          aria-label={`Task ${display} — click to copy`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "var(--font-geist-mono)",
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: 0.3,
            color: copied ? "#2f8f5f" : token.colorTextSecondary,
            background: copied ? "rgba(47,143,95,.1)" : token.colorFillQuaternary,
            border: `1px solid ${copied ? "rgba(47,143,95,.35)" : token.colorBorderSecondary}`,
            borderRadius: 999,
            padding: "2px 9px",
            cursor: "pointer",
            transition: "all .15s ease",
          }}
        >
          {display}
          <span
            className="material-symbols-rounded wl-task-id-copy"
            aria-hidden
            style={{ fontSize: 12, opacity: copied ? 1 : undefined }}
          >
            {copied ? "check" : "content_copy"}
          </span>
        </button>
      </Tooltip>
    </Dropdown>
  );
}
