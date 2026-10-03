"use client";

/**
 * Sheets — what a LIMITED member sees where everyone else sees the Google Sheet.
 *
 * WHY THIS EXISTS
 * Google Drive shares a FILE. There is no per-row permission and there never
 * will be. A member whose access is restricted to their own rows therefore
 * cannot be given the spreadsheet at all: handing it over would show them the
 * whole team's rows, which is exactly what the restriction exists to prevent.
 * The server already holds both ends of that — google-share.ts skips them with
 * reason 'limited', and the data route filters their rows (route-auth.ts
 * limitToUserId) — but the client had no notion of it, so a limited member got
 * the iframe, met Google's access wall, and was told to ask the owner to share
 * the file with their Google account. Following that advice is the widening.
 *
 * So: Cubes' own grid, over the rows the server already filtered. That is the
 * only mechanism that can honour row-level access, which is why the notice at
 * the top states it as the design rather than apologising for it.
 *
 * The renderer is sheet-grid.tsx — the same one the sheet used before it became
 * an embed, cells and all. Nothing here re-implements a cell.
 */

import { useState } from "react";
import { App, Alert, Button, Input, Popconfirm, Skeleton, theme } from "antd";
import type { SheetColumn, SheetData, SheetRecordRow } from "@/lib/sheets/types";
import { SOURCES } from "@/lib/sheets/sources";
import type { MemberOption } from "@/features/team-members/member-select";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import { SheetGrid } from "./sheet-grid";
import { limitedViewNote } from "./sheet-model";
import { useDeleteRows } from "./use-sheets";

/** Matches the embed's frame height, so switching viewer doesn't reflow the page. */
const GRID_MIN_HEIGHT = "clamp(420px, calc(100dvh - 300px), 1400px)";

export function LimitedSheetGrid({
  sheet,
  data,
  loading,
  error,
  onRetry,
  memberOptions,
  canManage,
  onColumnsChange,
  onEditColumns,
}: {
  sheet: SheetRecordRow;
  data: SheetData | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  memberOptions: MemberOption[];
  /** The sheet's creator or a workspace admin — who may change its columns. */
  canManage: boolean;
  onColumnsChange: (columns: SheetColumn[]) => Promise<void>;
  onEditColumns: (columnId?: string) => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const deleteRows = useDeleteRows(sheet.id);
  const note = limitedViewNote(sheet.source);
  // Only a source that owns its rows can lose them; for the bound sources the
  // grid's checkboxes stay a selection, nothing more.
  const canDelete = SOURCES[sheet.source].canDelete;

  const removeSelected = async () => {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    try {
      await deleteRows.mutateAsync(keys);
      setSelectedKeys(new Set());
      message.success(`${keys.length} row${keys.length === 1 ? "" : "s"} deleted.`);
    } catch (err) {
      message.error(errMsg(err, "Couldn't delete those rows."));
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* Information, not a warning: this is the view that matches their
          access, not a fallback from a broken one. */}
      {note ? <Alert type="info" showIcon message={note.title} description={note.body} /> : null}

      {error ? (
        <Alert
          type="error"
          showIcon
          message={`Cubes couldn't read this sheet's ${SOURCES[sheet.source].label.toLowerCase()} data`}
          description={errMsg(error, "Unknown error.")}
          action={
            <Button size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Input
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search this sheet"
          prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
          style={{ width: 240 }}
        />
        {canDelete && selectedKeys.size > 0 ? (
          <Popconfirm
            title={`Delete ${selectedKeys.size} row${selectedKeys.size === 1 ? "" : "s"}?`}
            description="They go from the sheet and from the linked Google Sheet on the next sync."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => void removeSelected()}
          >
            <Button danger loading={deleteRows.isPending} icon={<MIcon name="delete" size={16} />}>
              Delete {selectedKeys.size}
            </Button>
          </Popconfirm>
        ) : null}
      </div>

      {loading && !data ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : data ? (
        <div style={{ minHeight: GRID_MIN_HEIGHT }}>
          <SheetGrid
            sheet={sheet}
            data={data}
            search={search}
            memberOptions={memberOptions}
            selectedKeys={selectedKeys}
            onSelectedKeysChange={setSelectedKeys}
            onColumnsChange={onColumnsChange}
            onEditColumns={onEditColumns}
            canEditColumns={canManage}
          />
        </div>
      ) : null}
    </div>
  );
}
