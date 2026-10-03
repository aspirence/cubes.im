"use client";

import { useMemo, useState } from "react";
import { App, Button, Select, Tooltip, theme } from "antd";
import { MIcon } from "./m-icon";
import { NO_PROJECT, useCrmScope } from "../_lib/crm-scope";

/**
 * The bar that appears once rows are selected.
 *
 * Every CRM list is worked in batches — twenty pasted leads that all belong to
 * one account, six tasks that are done, a screen of junk. Doing that a row at
 * a time is the whole cost of the job, so selection plus this bar is the point
 * of those tables rather than a decoration on them.
 *
 * It sticks to the bottom of its scroll container instead of taking layout, so
 * it never pushes the rows it acts on.
 */
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  /** The actions — plain small Buttons / Dropdowns / Popconfirms. */
  children: React.ReactNode;
}) {
  const { token } = theme.useToken();
  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={`${count} selected`}
      style={{
        position: "sticky",
        bottom: 16,
        zIndex: 5,
        margin: "0 auto 16px",
        width: "fit-content",
        maxWidth: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "8px 10px",
        borderRadius: 10,
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorder}`,
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <span
        style={{ fontSize: 12.5, fontWeight: 600, color: token.colorText }}
      >
        {count} selected
      </span>
      <span style={{ width: 1, height: 18, background: token.colorSplit }} />
      {children}
      <Tooltip title="Clear selection">
        <Button
          size="small"
          type="text"
          aria-label="Clear selection"
          onClick={onClear}
          icon={<MIcon name="close" size={15} />}
        />
      </Tooltip>
    </div>
  );
}

/**
 * Runs one mutation across a selection and reports honestly.
 *
 * Partial failure is the NORMAL failure here — a row someone else deleted, one
 * RLS refusal in twenty — so it says how many landed instead of pretending the
 * whole batch died. The selection is cleared either way: leaving rows ticked
 * after a partial run invites a blind retry over the ones that already worked.
 */
export function useBulkRun(onDone?: () => void) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const run = async (
    ids: string[],
    label: string,
    apply: (id: string) => Promise<unknown>,
  ) => {
    if (ids.length === 0) return;
    setBusy(true);
    const results = await Promise.allSettled(ids.map(apply));
    setBusy(false);
    onDone?.();
    const failed = results.filter((r) => r.status === "rejected").length;
    const noun = `${ids.length} row${ids.length === 1 ? "" : "s"}`;
    if (failed === 0) {
      message.success(`${label} · ${noun}`);
    } else {
      message.warning(
        `${label} · ${ids.length - failed} done, ${failed} failed`,
      );
    }
  };

  return { run, busy };
}

/** A BulkMoveToProject option — `label` stays a plain string so search still works. */
type MoveOption = { value: string; label: string; color: string | null; disabled?: boolean };

/**
 * The bulk bar's "Move to project" picker: files every selected record under
 * one project, or under none. An action, not a field — it never holds a value,
 * so the same project can be picked again for the next batch. The project the
 * view is already on is disabled (moving there is a no-op). Hidden when the
 * team has no projects, since there is nowhere to move anything.
 *
 * `onMove` gets the project id (null = no project) and its name for the
 * result message.
 */
export function BulkMoveToProject({
  disabled,
  onMove,
}: {
  disabled?: boolean;
  onMove: (projectId: string | null, name: string) => void;
}) {
  const { token } = theme.useToken();
  const { projects, selection } = useCrmScope();

  const options = useMemo(
    () => [
      {
        label: "Projects",
        options: projects.map<MoveOption>((p) => ({
          value: p.id,
          label: p.name,
          color: p.color,
          disabled: p.id === selection,
        })),
      },
      {
        label: "Unfiled",
        options: [
          {
            value: NO_PROJECT,
            label: "No project",
            color: null,
            disabled: selection === NO_PROJECT,
          } satisfies MoveOption,
        ],
      },
    ],
    [projects, selection],
  );

  if (projects.length === 0) return null;

  return (
    <Select<string>
      size="small"
      showSearch
      optionFilterProp="label"
      disabled={disabled}
      // Always empty: picking is the action, and the next batch starts fresh.
      value={null}
      placeholder={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: token.colorText }}>
          <MIcon name="drive_file_move" size={15} />
          Move to project
        </span>
      }
      aria-label="Move to project"
      popupMatchSelectWidth={false}
      style={{ width: 170 }}
      options={options}
      onChange={(v) => {
        if (!v) return;
        if (v === NO_PROJECT) {
          onMove(null, "No project");
          return;
        }
        onMove(v, projects.find((p) => p.id === v)?.name ?? "another project");
      }}
      optionRender={(opt) => {
        const d = opt.data as unknown as MoveOption;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {d.value === NO_PROJECT ? (
              <MIcon name="folder_off" size={15} color={token.colorTextSecondary} />
            ) : (
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: d.color ?? token.colorTextQuaternary,
                  flex: "none",
                }}
              />
            )}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.label}
            </span>
          </span>
        );
      }}
    />
  );
}
