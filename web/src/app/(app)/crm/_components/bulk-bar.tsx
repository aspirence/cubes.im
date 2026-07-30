"use client";

import { useState } from "react";
import { App, Button, Tooltip, theme } from "antd";
import { MIcon } from "./m-icon";

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
