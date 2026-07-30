"use client";

import { useState } from "react";
import { App as AntdApp, Button, Dropdown, Input, Modal, Tooltip, theme } from "antd";
import {
  useTaskStatuses,
  useTaskStatusCategories,
  useCreateTaskStatus,
  useUpdateTaskStatus,
  useDeleteTaskStatus,
  type TaskStatusWithCategory,
  type TaskStatusCategory,
} from "@/features/tasks/use-task-statuses";

/** What each fixed stage means — surfaced in the group heading's ⓘ tooltip. */
const STAGE_HINTS: Record<string, string> = {
  "Not started": "Work that hasn't begun — backlog and queued items.",
  Active: "Work in progress. Tasks here can run a timer.",
  Done: "Finished work awaiting review or acceptance.",
  Closed: "Complete. Statuses here count toward completed tasks.",
};

function StatusDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: `2.5px solid ${color}`,
        flex: "none",
      }}
    />
  );
}

/** One status row: pill with dot + UPPERCASE name, ⋯ menu (rename/delete). */
function StatusRow({
  status,
  onRename,
  onDelete,
}: {
  status: TaskStatusWithCategory;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { token } = theme.useToken();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(status.name);
  const color = status.category?.color_code ?? "#a9a9a9";

  function commit() {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== status.name) onRename(name);
    else setDraft(status.name);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 10,
        border: `1px solid ${token.colorBorder}`,
        background: token.colorBgContainer,
      }}
    >
      <span
        aria-hidden
        className="material-symbols-rounded"
        style={{ fontSize: 15, color: token.colorTextQuaternary, cursor: "grab" }}
      >
        drag_indicator
      </span>
      <StatusDot color={color} />
      {editing ? (
        <Input
          size="small"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={commit}
          onBlur={commit}
          style={{ flex: 1, fontWeight: 600 }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: token.colorText,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {status.name}
        </span>
      )}
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            {
              key: "rename",
              label: "Rename",
              icon: (
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                  edit
                </span>
              ),
              onClick: () => {
                setDraft(status.name);
                setEditing(true);
              },
            },
            {
              key: "delete",
              label: "Delete",
              danger: true,
              icon: (
                <span className="material-symbols-rounded" style={{ fontSize: 14 }}>
                  delete
                </span>
              ),
              onClick: onDelete,
            },
          ],
        }}
      >
        <Button
          type="text"
          size="small"
          aria-label={`${status.name} options`}
          icon={
            <span
              className="material-symbols-rounded"
              style={{ fontSize: 16, color: token.colorTextTertiary }}
            >
              more_horiz
            </span>
          }
        />
      </Dropdown>
    </div>
  );
}

/** Dashed "+ Add status" row that flips into an inline input. */
function AddStatusRow({ onAdd }: { onAdd: (name: string) => void }) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const name = draft.trim();
    if (name) onAdd(name);
    setDraft("");
    setOpen(false);
  }

  if (open) {
    return (
      <Input
        size="middle"
        autoFocus
        placeholder="Status name…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={commit}
        onBlur={commit}
        style={{ borderRadius: 10 }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "9px 12px",
        borderRadius: 10,
        border: `1.5px dashed ${token.colorBorder}`,
        background: "transparent",
        color: token.colorTextTertiary,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
        add
      </span>
      Add status
    </button>
  );
}

/**
 * ClickUp-style status editor: the project's statuses grouped under the four
 * fixed stages (Not started / Active / Done / Closed), with add / rename /
 * delete per stage. Custom statuses always live under one of the stages.
 */
export function StatusManagerModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { message, modal } = AntdApp.useApp();
  const { data: statuses } = useTaskStatuses(open ? projectId : undefined);
  const { data: categories } = useTaskStatusCategories();
  const createStatus = useCreateTaskStatus();
  const updateStatus = useUpdateTaskStatus();
  const deleteStatus = useDeleteTaskStatus();

  const byCategory = new Map<string, TaskStatusWithCategory[]>();
  for (const s of statuses ?? []) {
    const arr = byCategory.get(s.category_id) ?? [];
    arr.push(s);
    byCategory.set(s.category_id, arr);
  }
  async function onAdd(cat: TaskStatusCategory, name: string) {
    if (!projectId || createStatus.isPending) return;
    const all = statuses ?? [];
    // Board columns order by a FLAT sort_order, so a new status must slot in
    // at the end of ITS stage: right after the last status in this or any
    // earlier stage, shifting everything later up by one.
    const catOrder = new Map((categories ?? []).map((c) => [c.id, c.sort_order]));
    const insertAt = all.reduce((m, s) => {
      const so = catOrder.get(s.category_id);
      return so !== undefined && so <= cat.sort_order
        ? Math.max(m, s.sort_order + 1)
        : m;
    }, 0);
    try {
      await Promise.all(
        all
          .filter((s) => s.sort_order >= insertAt)
          .map((s) =>
            updateStatus.mutateAsync({ id: s.id, sortOrder: s.sort_order + 1 }),
          ),
      );
      await createStatus.mutateAsync({
        projectId,
        name,
        categoryId: cat.id,
        sortOrder: insertAt,
      });
    } catch {
      message.error("Couldn't add that status.");
    }
  }

  function onDelete(s: TaskStatusWithCategory) {
    modal.confirm({
      title: `Delete status "${s.name}"?`,
      content: s.category?.is_done
        ? "Finished tasks on this status will revert to NOT done and lose their completion dates — move them to another Closed status first."
        : "Tasks still on this status keep working but lose the status — move them first if needed.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteStatus.mutateAsync(s.id);
        } catch {
          message.error("Couldn't delete — tasks may still use this status.");
        }
      },
    });
  }

  return (
    <Modal
      title="Edit statuses"
      open={open}
      onCancel={onClose}
      footer={null}
      width={520}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 6 }}>
        {(categories ?? []).map((cat) => (
          <div key={cat.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                }}
              >
                {cat.name}
              </span>
              <Tooltip title={STAGE_HINTS[cat.name]}>
                <span
                  className="material-symbols-rounded"
                  style={{ fontSize: 13, color: token.colorTextQuaternary }}
                >
                  info
                </span>
              </Tooltip>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(byCategory.get(cat.id) ?? []).map((s) => (
                <StatusRow
                  key={s.id}
                  status={s}
                  onRename={(name) =>
                    updateStatus
                      .mutateAsync({ id: s.id, name })
                      .catch(() => message.error("Couldn't rename the status."))
                  }
                  onDelete={() => onDelete(s)}
                />
              ))}
              <AddStatusRow onAdd={(name) => onAdd(cat, name)} />
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
