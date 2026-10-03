"use client";

/**
 * Sheets grid — a spreadsheet-feeling editor on antd's virtual Table.
 *
 * Why antd Table and not a grid library: nothing grid-shaped is installed and
 * the rule is no new dependencies; antd's `virtual` mode (rc-virtual-list)
 * only mounts the rows in view, which is what keeps 2–5k rows smooth. Virtual
 * mode needs numeric scroll sizes and a fixed width on every column, so both
 * are always set.
 *
 * The active cell and the selection range are held by ROW KEY and COLUMN ID,
 * not by index: a write that re-sorts the rows, a search that filters them or
 * a refetch that inserts one must not move the cursor onto a different
 * record. Indices are derived per render.
 *
 * Keyboard: arrows move (Shift extends, Cmd/Ctrl jumps to the edge), Tab /
 * Shift+Tab move sideways, Enter or F2 edits, typing over a cell replaces
 * it, Delete clears the range, Space flips a checkbox, Cmd/Ctrl+A selects
 * everything, Cmd/Ctrl+C copies the range as TSV and a paste from Excel or
 * Google Sheets lands at the range (see planPaste in grid-values.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Empty, Form, Input, Modal, Table, Tooltip, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { SheetColumn, SheetData, SheetRecordRow, SheetRow } from "@/lib/sheets/types";
import { SOURCES } from "@/lib/sheets/sources";
import type { MemberOption } from "@/features/team-members/member-select";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import { CellDisplay, CellEditor, isNumericColumn, type CommitMove } from "./cell-editors";
import {
  exportCell,
  formatCell,
  isEmptyValue,
  parseTsv,
  planPaste,
  toTsv,
  valuesEqual,
  type CellContext,
} from "./grid-values";
import {
  TYPE_ICONS,
  TYPE_LABELS,
  canGrowOptions,
  columnWidth,
  lockReason,
  optionsFor,
  requiredOnCreate,
  writableOnCreate,
} from "./sheet-model";
import { useAddRow, useUpdateCell } from "./use-sheets";

type CellRef = { key: string; col: string };
type Editing = CellRef & { initialText?: string };
type Sort = { col: string; dir: "asc" | "desc" } | null;

const ROW_HEIGHT = 34;
const ROW_HEADER_WIDTH = 64;
/** Concurrent cell writes during a paste / clear — enough to be quick, few enough not to trip rate limits. */
const WRITE_CONCURRENCY = 6;
/** Types where a printable key starts a text edit seeded with that key. */
const TYPE_TO_EDIT = new Set<SheetColumn["type"]>(["text", "long_text", "number", "currency", "percent", "url", "email", "phone"]);

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function compareForSort(a: unknown, b: unknown, column: SheetColumn, ctx: CellContext): number {
  const ae = isEmptyValue(a);
  const be = isEmptyValue(b);
  if (ae && be) return 0;
  if (ae) return 1; // empties last, whatever the direction (flipped below)
  if (be) return -1;
  if (isNumericColumn(column)) return Number(a) - Number(b);
  if (column.type === "date" || column.type === "datetime") return String(a).localeCompare(String(b));
  if (column.type === "checkbox") return (a === true ? 1 : 0) - (b === true ? 1 : 0);
  return formatCell(a, column, ctx).localeCompare(formatCell(b, column, ctx), undefined, { numeric: true, sensitivity: "base" });
}

export interface SheetGridProps {
  sheet: SheetRecordRow;
  data: SheetData;
  search: string;
  memberOptions: MemberOption[];
  selectedKeys: Set<string>;
  onSelectedKeysChange: (keys: Set<string>) => void;
  /** Persist a new column list (resize, hide, options grown by a paste). */
  onColumnsChange: (columns: SheetColumn[]) => Promise<void>;
  /** Open the column editor, optionally on one column. */
  onEditColumns: (columnId?: string) => void;
  canEditColumns: boolean;
}

export function SheetGrid({
  sheet,
  data,
  search,
  memberOptions,
  selectedKeys,
  onSelectedKeysChange,
  onColumnsChange,
  onEditColumns,
  canEditColumns,
}: SheetGridProps) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const updateCell = useUpdateCell(sheet.id);
  const addRow = useAddRow(sheet.id);

  const containerRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<{ scrollTo: (c: { index?: number; key?: React.Key; top?: number }) => void } | null>(null);
  const dragging = useRef(false);

  const [active, setActive] = useState<CellRef | null>(null);
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [sort, setSort] = useState<Sort>(null);
  const [widthDraft, setWidthDraft] = useState<Record<string, number>>({});
  const [bodyHeight, setBodyHeight] = useState(520);
  const [newRowOpen, setNewRowOpen] = useState(false);
  const [newRowForm] = Form.useForm<Record<string, string>>();

  const source = sheet.source;
  const members = useMemo(() => new Map(memberOptions.map((m) => [m.value, m])), [memberOptions]);
  const memberLikes = useMemo(
    () => memberOptions.map((m) => ({ value: m.value, label: m.label, email: m.email ?? null })),
    [memberOptions],
  );

  const columns = useMemo(() => sheet.columns.filter((c) => !c.hidden), [sheet.columns]);
  const colIndex = useMemo(() => new Map(columns.map((c, i) => [c.id, i])), [columns]);

  const ctxById = useMemo(() => {
    const map = new Map<string, CellContext>();
    for (const c of sheet.columns) {
      map.set(c.id, {
        options: optionsFor(c, source, data.options),
        members: memberLikes,
        currency: c.currency ?? data.currency ?? null,
      });
    }
    return map;
  }, [sheet.columns, source, data.options, data.currency, memberLikes]);
  const ctxFor = useCallback((c: SheetColumn): CellContext => ctxById.get(c.id) ?? {}, [ctxById]);

  /* ---------------- rows: search + sort ---------------- */

  const rows = useMemo(() => {
    let list = data.rows;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((row) =>
        columns.some((c) => formatCell(row.values[c.id], c, ctxFor(c)).toLowerCase().includes(q)),
      );
    }
    if (sort) {
      const column = sheet.columns.find((c) => c.id === sort.col);
      if (column) {
        const ctx = ctxFor(column);
        const dir = sort.dir === "asc" ? 1 : -1;
        list = [...list].sort((a, b) => {
          const av = a.values[column.id];
          const bv = b.values[column.id];
          if (isEmptyValue(av) !== isEmptyValue(bv)) return isEmptyValue(av) ? 1 : -1;
          return dir * compareForSort(av, bv, column, ctx);
        });
      }
    } else {
      list = [...list].sort((a, b) => a.position - b.position);
    }
    return list;
  }, [data.rows, search, sort, columns, sheet.columns, ctxFor]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);

  /* ---------------- locks ---------------- */

  const lockedFor = useCallback(
    (row: SheetRow, column: SheetColumn) => lockReason(column, source, row.readonly),
    [source],
  );

  /* ---------------- geometry ---------------- */

  // The body fills the viewport below the grid's top edge, whichever surface
  // (app page or project tab) it sits in. Measured, not guessed, because the
  // header card above it wraps on narrow screens.
  useEffect(() => {
    const measure = () => {
      const el = tableWrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setBodyHeight(Math.max(280, Math.round(window.innerHeight - top - 120)));
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && tableWrapRef.current?.parentElement) ro.observe(tableWrapRef.current.parentElement);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, []);

  const widthOf = useCallback((c: SheetColumn) => widthDraft[c.id] ?? columnWidth(c), [widthDraft]);
  const totalWidth = useMemo(
    () => ROW_HEADER_WIDTH + columns.reduce((sum, c) => sum + widthOf(c), 0),
    [columns, widthOf],
  );

  /* ---------------- selection helpers ---------------- */

  const pos = useCallback(
    (ref: CellRef | null): { r: number; c: number } | null => {
      if (!ref) return null;
      const r = rowIndex.get(ref.key);
      const c = colIndex.get(ref.col);
      return r === undefined || c === undefined ? null : { r, c };
    },
    [rowIndex, colIndex],
  );
  const refAt = useCallback(
    (r: number, c: number): CellRef | null => {
      const row = rows[r];
      const col = columns[c];
      return row && col ? { key: row.key, col: col.id } : null;
    },
    [rows, columns],
  );

  const activePos = pos(active);
  const anchorPos = pos(anchor) ?? activePos;
  const range = useMemo(() => {
    if (!activePos || !anchorPos) return null;
    return {
      r0: Math.min(activePos.r, anchorPos.r),
      r1: Math.max(activePos.r, anchorPos.r),
      c0: Math.min(activePos.c, anchorPos.c),
      c1: Math.max(activePos.c, anchorPos.c),
    };
  }, [activePos, anchorPos]);

  const focusGrid = () => containerRef.current?.focus({ preventScroll: true });

  // Keep the active cell on screen after keyboard moves. Only a side effect on
  // the DOM — no state is set here.
  const activeKey = active ? `${active.key}|${active.col}` : null;
  useEffect(() => {
    if (!activeKey || !activePos) return;
    const find = () =>
      containerRef.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(activeKey)}"]`) ?? null;
    const el = find();
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    tableRef.current?.scrollTo({ index: activePos.r });
    const raf = requestAnimationFrame(() => find()?.scrollIntoView({ block: "nearest", inline: "nearest" }));
    return () => cancelAnimationFrame(raf);
    // activePos is derived from activeKey + rows; the key alone decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  /* ---------------- writes ---------------- */

  const write = useCallback(
    (key: string, columnId: string, value: unknown) => {
      updateCell.mutate(
        { key, columnId, value },
        { onError: (err) => message.error(errMsg(err, "Couldn't save that cell.")) },
      );
    },
    [updateCell, message],
  );

  const runWrites = useCallback(
    async (
      updates: { key: string; columnId: string; value: unknown }[],
      creates: Record<string, unknown>[],
      label: string,
    ) => {
      const total = updates.length + creates.length;
      if (total === 0) return { failed: 0 };
      const progressKey = `sheet-writes-${sheet.id}`;
      if (total > 3) message.open({ key: progressKey, type: "loading", content: `${label} ${total} changes…`, duration: 0 });
      let failed = 0;
      let firstError: string | null = null;
      await runPool(updates, WRITE_CONCURRENCY, async (u) => {
        try {
          await updateCell.mutateAsync(u);
        } catch (err) {
          failed += 1;
          firstError ??= errMsg(err, "A cell couldn't be saved.");
        }
      });
      // New rows go one at a time so they keep the clipboard's order.
      for (const values of creates) {
        try {
          await addRow.mutateAsync({ values });
        } catch (err) {
          failed += 1;
          firstError ??= errMsg(err, "A row couldn't be added.");
        }
      }
      if (total > 3) message.destroy(progressKey);
      if (failed > 0) message.error(`${failed} of ${total} changes failed: ${firstError}`);
      return { failed };
    },
    [sheet.id, updateCell, addRow, message],
  );

  const commitEdit = (value: unknown, move: CommitMove) => {
    const target = editing;
    setEditing(null);
    focusGrid();
    if (!target) return;
    const row = data.rows.find((r) => r.key === target.key);
    if (row && !valuesEqual(row.values[target.col], value)) write(target.key, target.col, value);
    const p = pos(target);
    if (p && move !== "none") {
      const next =
        move === "down" ? refAt(Math.min(rows.length - 1, p.r + 1), p.c)
        : move === "right" ? refAt(p.r, Math.min(columns.length - 1, p.c + 1))
        : refAt(p.r, Math.max(0, p.c - 1));
      if (next) {
        setActive(next);
        setAnchor(null);
      }
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    focusGrid();
  };

  const startEdit = (ref: CellRef, initialText?: string) => {
    const row = data.rows.find((r) => r.key === ref.key);
    const column = columns.find((c) => c.id === ref.col);
    if (!row || !column) return;
    const reason = lockedFor(row, column);
    if (reason) {
      message.info({ content: reason, key: "sheet-locked" });
      return;
    }
    if (column.type === "checkbox") {
      write(row.key, column.id, row.values[column.id] !== true);
      return;
    }
    setEditing({ ...ref, initialText });
  };

  /* ---------------- clipboard ---------------- */

  const rangeMatrix = (): string[][] => {
    if (!range) return [];
    const out: string[][] = [];
    for (let r = range.r0; r <= range.r1; r += 1) {
      const row = rows[r];
      const line: string[] = [];
      for (let c = range.c0; c <= range.c1; c += 1) {
        const col = columns[c];
        line.push(exportCell(row.values[col.id], col, ctxFor(col)));
      }
      out.push(line);
    }
    return out;
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || !range) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", toTsv(rangeMatrix()));
    const cells = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
    if (cells > 1) message.success({ content: `Copied ${cells} cells`, key: "sheet-copy", duration: 1.2 });
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    if (editing) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const start = range ?? { r0: rows.length, r1: rows.length, c0: 0, c1: 0 };
    const plan = planPaste({
      matrix: parseTsv(text),
      range: start,
      columns,
      rows,
      lockedReason: (r, column) => lockedFor(rows[r], column),
      writableOnCreate: (column) => writableOnCreate(column, source),
      ctxFor,
      allowNewOptions: canGrowOptions,
      canCreateRows: data.canCreateRows,
      maxNewRows: 2000,
    });
    // Grow the options first, so the new option values exist before the cells that use them.
    const grown = Object.keys(plan.newOptions);
    if (grown.length > 0) {
      try {
        await onColumnsChange(
          sheet.columns.map((c) =>
            plan.newOptions[c.id] ? { ...c, options: [...(c.options ?? []), ...plan.newOptions[c.id]] } : c,
          ),
        );
      } catch (err) {
        message.error(errMsg(err, "Couldn't add the new options."));
        return;
      }
    }
    const { failed } = await runWrites(plan.updates, plan.creates, "Pasting");
    const written = plan.updates.length + plan.creates.length - failed;
    const notes: string[] = [];
    if (plan.skipped.length) {
      const reasons = [...new Set(plan.skipped.map((s) => s.reason))].slice(0, 2).join("; ");
      notes.push(`${plan.skipped.length} skipped (${reasons})`);
    }
    if (plan.droppedRows) {
      notes.push(
        data.canCreateRows
          ? `${plan.droppedRows} rows over the limit were left out`
          : `${plan.droppedRows} rows past the end were left out — ${SOURCES[source].label} rows can't be added here`,
      );
    }
    if (grown.length) notes.push("new options were added to the column");
    const summary = `${written} cell${written === 1 ? "" : "s"} updated${plan.creates.length ? `, ${plan.creates.length} rows added` : ""}.`;
    if (notes.length) message.warning({ content: `${summary} ${notes.join(" · ")}`, duration: 6 });
    else if (written > 0) message.success(summary);
    else message.info("Nothing changed — the pasted values match what's there.");
  };

  const clearRange = () => {
    if (!range) return;
    const updates: { key: string; columnId: string; value: unknown }[] = [];
    let locked = 0;
    for (let r = range.r0; r <= range.r1; r += 1) {
      const row = rows[r];
      for (let c = range.c0; c <= range.c1; c += 1) {
        const col = columns[c];
        if (lockedFor(row, col)) {
          locked += 1;
          continue;
        }
        const empty = col.type === "checkbox" ? false : col.type === "multi_select" || col.type === "people" ? [] : null;
        if (!valuesEqual(row.values[col.id], empty)) updates.push({ key: row.key, columnId: col.id, value: empty });
      }
    }
    if (locked && updates.length === 0) {
      message.info({ content: "Those cells are locked.", key: "sheet-locked" });
      return;
    }
    void runWrites(updates, [], "Clearing");
  };

  /* ---------------- keyboard ---------------- */

  const move = (dr: number, dc: number, extend: boolean, jump: boolean) => {
    if (rows.length === 0 || columns.length === 0) return;
    const p = activePos ?? { r: 0, c: 0 };
    let r = p.r;
    let c = p.c;
    if (jump) {
      if (dr) r = dr > 0 ? rows.length - 1 : 0;
      if (dc) c = dc > 0 ? columns.length - 1 : 0;
    } else {
      r = Math.max(0, Math.min(rows.length - 1, r + dr));
      c = Math.max(0, Math.min(columns.length - 1, c + dc));
    }
    const next = refAt(r, c);
    if (!next) return;
    if (extend) {
      if (!anchor) setAnchor(active ?? next);
    } else {
      setAnchor(null);
    }
    setActive(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    // Keys typed into the toolbar or a popover are not the grid's.
    if (e.target !== containerRef.current) return;
    const mod = e.metaKey || e.ctrlKey;
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dr, dc] = arrows[e.key];
      move(dr, dc, e.shiftKey, mod);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1, false, false);
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const first = refAt(0, 0);
      const last = refAt(rows.length - 1, columns.length - 1);
      if (first && last) {
        setAnchor(first);
        setActive(last);
      }
      return;
    }
    if (!active) {
      if (e.key === "Enter") {
        e.preventDefault();
        move(0, 0, false, false);
      }
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      if (e.key === "Enter" && e.shiftKey) {
        move(-1, 0, false, false);
        return;
      }
      startEdit(active);
      return;
    }
    if (e.key === "Escape") {
      setAnchor(null);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearRange();
      return;
    }
    const column = columns[colIndex.get(active.col) ?? -1];
    if (!column) return;
    if (e.key === " " && column.type === "checkbox") {
      e.preventDefault();
      startEdit(active);
      return;
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      startEdit(active, TYPE_TO_EDIT.has(column.type) ? e.key : undefined);
    }
  };

  /* ---------------- rows: add ---------------- */

  const required = useMemo(() => requiredOnCreate(source), [source]);
  const requiredColumns = useMemo(
    () => required.map((f) => ({ ...f, column: sheet.columns.find((c) => c.field === f.key) })),
    [required, sheet.columns],
  );

  const addEmptyRow = async () => {
    if (!data.canCreateRows) return;
    if (required.length > 0) {
      const missing = requiredColumns.filter((f) => !f.column);
      if (missing.length > 0) {
        message.warning(`Add the ${missing.map((m) => m.label).join(" and ")} column to create rows here.`);
        return;
      }
      // The modal is destroyed on close with preserve={false}, so it opens empty.
      setNewRowOpen(true);
      return;
    }
    try {
      const { row } = await addRow.mutateAsync({});
      const first = columns[0];
      if (row?.key && first) {
        setActive({ key: row.key, col: first.id });
        setAnchor(null);
        focusGrid();
      }
    } catch (err) {
      message.error(errMsg(err, "Couldn't add a row."));
    }
  };

  const submitNewRow = async () => {
    const values = await newRowForm.validateFields();
    const payload: Record<string, unknown> = {};
    for (const f of requiredColumns) {
      if (f.column) payload[f.column.id] = String(values[f.key] ?? "").trim();
    }
    try {
      const { row } = await addRow.mutateAsync({ values: payload });
      setNewRowOpen(false);
      if (row?.key && columns[0]) {
        setActive({ key: row.key, col: columns[0].id });
        setAnchor(null);
        focusGrid();
      }
    } catch (err) {
      message.error(errMsg(err, "Couldn't add the row."));
    }
  };

  /* ---------------- column resize ---------------- */

  const startResize = (e: React.MouseEvent, column: SheetColumn) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(column);
    let latest = startW;
    const onMove = (ev: MouseEvent) => {
      latest = Math.max(70, Math.min(600, startW + ev.clientX - startX));
      setWidthDraft((d) => ({ ...d, [column.id]: latest }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (latest !== startW && canEditColumns) {
        onColumnsChange(sheet.columns.map((c) => (c.id === column.id ? { ...c, width: latest } : c)))
          .catch((err) => message.error(errMsg(err, "Couldn't save the column width.")))
          .finally(() =>
            setWidthDraft((d) => {
              const next = { ...d };
              delete next[column.id];
              return next;
            }),
          );
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const hideColumn = (column: SheetColumn) => {
    onColumnsChange(sheet.columns.map((c) => (c.id === column.id ? { ...c, hidden: true } : c))).catch((err) =>
      message.error(errMsg(err, "Couldn't hide the column.")),
    );
  };

  /* ---------------- columns for antd ---------------- */

  const allSelected = rows.length > 0 && rows.every((r) => selectedKeys.has(r.key));
  const someSelected = !allSelected && rows.some((r) => selectedKeys.has(r.key));

  const tableColumns: ColumnsType<SheetRow> = useMemo(() => {
    const rowHeader: ColumnsType<SheetRow>[number] = {
      key: "__row",
      width: ROW_HEADER_WIDTH,
      fixed: "left",
      title: (
        <label className="sg-rowhead" title="Select all rows" style={{ justifyContent: "center" }}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={(e) => onSelectedKeysChange(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())}
          />
        </label>
      ),
      render: (_: unknown, row: SheetRow, index: number) => {
        const checked = selectedKeys.has(row.key);
        return (
          <label className={`sg-rowhead${checked ? " sg-rowhead-on" : ""}`}>
            <span className="sg-rownum">{index + 1}</span>
            <input
              type="checkbox"
              className="sg-rowcheck"
              checked={checked}
              onChange={(e) => {
                const next = new Set(selectedKeys);
                if (e.target.checked) next.add(row.key);
                else next.delete(row.key);
                onSelectedKeysChange(next);
              }}
            />
          </label>
        );
      },
    };

    const dataColumns: ColumnsType<SheetRow> = columns.map((column, c) => {
      const width = widthOf(column);
      const ctx = ctxFor(column);
      const colLock = lockReason(column, source, undefined);
      const sorted = sort?.col === column.id ? sort.dir : null;
      return {
        key: column.id,
        width,
        title: (
          <div className="sg-head" style={{ width: width - 1 }}>
            <MIcon name={TYPE_ICONS[column.type]} size={14} color={token.colorTextTertiary} />
            <span className="sg-head-label" title={`${column.label} · ${TYPE_LABELS[column.type]}`}>
              {column.label}
            </span>
            {colLock ? (
              <Tooltip title={colLock}>
                <span style={{ display: "inline-flex" }}>
                  <MIcon name="lock" size={13} color={token.colorTextQuaternary} />
                </span>
              </Tooltip>
            ) : null}
            {sorted ? <MIcon name={sorted === "asc" ? "arrow_upward" : "arrow_downward"} size={13} color={token.colorPrimary} /> : null}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "asc", label: "Sort A → Z", icon: <MIcon name="arrow_upward" size={15} /> },
                  { key: "desc", label: "Sort Z → A", icon: <MIcon name="arrow_downward" size={15} /> },
                  ...(sorted ? [{ key: "unsort", label: "Clear sort", icon: <MIcon name="swap_vert" size={15} /> }] : []),
                  { type: "divider" as const },
                  { key: "edit", label: "Edit column…", icon: <MIcon name="edit" size={15} />, disabled: !canEditColumns },
                  { key: "hide", label: "Hide column", icon: <MIcon name="visibility_off" size={15} />, disabled: !canEditColumns },
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  if (key === "asc" || key === "desc") setSort({ col: column.id, dir: key });
                  else if (key === "unsort") setSort(null);
                  else if (key === "edit") onEditColumns(column.id);
                  else if (key === "hide") hideColumn(column);
                },
              }}
            >
              <button type="button" className="sg-head-menu" aria-label={`${column.label} column menu`}>
                <MIcon name="expand_more" size={16} />
              </button>
            </Dropdown>
            {canEditColumns ? (
              <span className="sg-resize" onMouseDown={(e) => startResize(e, column)} aria-hidden />
            ) : null}
          </div>
        ),
        onCell: (row: SheetRow) =>
          ({
            "data-cell": `${row.key}|${column.id}`,
            onMouseDown: (e: React.MouseEvent) => {
              if (e.button !== 0) return;
              if (editing && editing.key === row.key && editing.col === column.id) return;
              e.preventDefault();
              const ref = { key: row.key, col: column.id };
              if (e.shiftKey && active) {
                if (!anchor) setAnchor(active);
              } else {
                setAnchor(null);
              }
              setActive(ref);
              dragging.current = true;
              const up = () => {
                dragging.current = false;
                window.removeEventListener("mouseup", up);
              };
              window.addEventListener("mouseup", up);
              if (editing) setEditing(null);
              focusGrid();
            },
            onMouseEnter: () => {
              if (!dragging.current || !active) return;
              if (!anchor) setAnchor(active);
              setActive({ key: row.key, col: column.id });
            },
            onDoubleClick: () => startEdit({ key: row.key, col: column.id }),
          }) as React.TdHTMLAttributes<HTMLElement>,
        render: (_: unknown, row: SheetRow, r: number) => {
          const value = row.values[column.id];
          const isActive = active?.key === row.key && active.col === column.id;
          const inRange = Boolean(range && r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1);
          const lock = lockedFor(row, column);
          const isEditing = editing?.key === row.key && editing.col === column.id;
          const cls = ["sg-in", isActive ? "sg-active" : "", inRange && !isActive ? "sg-range" : "", lock ? "sg-locked" : ""]
            .filter(Boolean)
            .join(" ");
          const inner = isEditing ? (
            <div className="sg-in sg-editing">
              <CellEditor
                column={column}
                value={value}
                ctx={ctx}
                memberOptions={memberOptions}
                initialText={editing?.initialText}
                onCommit={commitEdit}
                onCancel={cancelEdit}
              />
            </div>
          ) : (
            <div className={cls} title={lock && !isActive ? lock : undefined}>
              <CellDisplay
                value={value}
                column={column}
                ctx={ctx}
                members={members}
                locked={Boolean(lock)}
                onToggle={(next) => write(row.key, column.id, next)}
              />
            </div>
          );
          if (isActive && lock && !isEditing) {
            return (
              <Tooltip title={lock} placement="top" mouseEnterDelay={0.3}>
                {inner}
              </Tooltip>
            );
          }
          return inner;
        },
      };
    });
    return [rowHeader, ...dataColumns];
    // commitEdit / cancelEdit / startEdit close over the latest state through
    // `editing`, `active`, `anchor` and `rows`, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    columns,
    widthOf,
    ctxFor,
    source,
    sort,
    token,
    canEditColumns,
    active,
    anchor,
    range,
    editing,
    rows,
    members,
    memberOptions,
    selectedKeys,
    allSelected,
    someSelected,
    lockedFor,
  ]);

  /* ---------------- status line ---------------- */

  const activeColumn = active ? columns[colIndex.get(active.col) ?? -1] : undefined;
  const activeRow = active ? rows[rowIndex.get(active.key) ?? -1] : undefined;
  const activeLock = activeRow && activeColumn ? lockedFor(activeRow, activeColumn) : null;
  const rangeCells = range ? (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1) : 0;

  const empty = data.rows.length === 0;

  return (
    <div className="sheet-grid-root">
      <div
        ref={containerRef}
        tabIndex={0}
        className="sheet-grid"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={(e) => void onPaste(e)}
        aria-label={`${sheet.name} grid`}
        role="grid"
        style={{ outline: "none", border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, overflow: "hidden", background: token.colorBgContainer }}
      >
        <div ref={tableWrapRef}>
          {columns.length === 0 ? (
            <Empty
              style={{ padding: 40 }}
              description={
                <span>
                  Every column is hidden.{" "}
                  {canEditColumns ? (
                    <Button type="link" size="small" onClick={() => onEditColumns()}>
                      Show columns
                    </Button>
                  ) : null}
                </span>
              }
            />
          ) : (
            <Table<SheetRow>
              ref={tableRef as never}
              virtual
              size="small"
              rowKey="key"
              columns={tableColumns}
              dataSource={rows}
              pagination={false}
              tableLayout="fixed"
              scroll={{ x: totalWidth, y: bodyHeight }}
              rowClassName={(row) => (selectedKeys.has(row.key) ? "sg-row-selected" : "")}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      search.trim() && !empty
                        ? `Nothing matches "${search.trim()}"`
                        : data.canCreateRows
                          ? "No rows yet — add one, or paste a block from Excel or Google Sheets."
                          : `No ${SOURCES[source].label} rows for this sheet's settings yet.`
                    }
                  />
                ),
              }}
            />
          )}
        </div>
      </div>

      <div className="sg-status">
        {data.canCreateRows ? (
          <Button size="small" type="text" onClick={() => void addEmptyRow()} loading={addRow.isPending} icon={<MIcon name="add" size={16} />}>
            New row
          </Button>
        ) : null}
        <span>
          {rows.length === data.rows.length ? `${rows.length} rows` : `${rows.length} of ${data.rows.length} rows`}
          {selectedKeys.size ? ` · ${selectedKeys.size} selected` : ""}
          {rangeCells > 1 ? ` · ${rangeCells} cells` : ""}
        </span>
        {activeColumn ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
            {activeLock ? <MIcon name="lock" size={13} color={token.colorTextTertiary} /> : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeLock ? activeLock : `${activeColumn.label} · ${TYPE_LABELS[activeColumn.type]}`}
            </span>
          </span>
        ) : null}
        <span style={{ marginLeft: "auto", color: token.colorTextQuaternary, whiteSpace: "nowrap" }} className="sg-hint">
          Enter to edit · paste from Excel or Sheets · ⌘/Ctrl+C to copy
        </span>
      </div>

      <Modal
        open={newRowOpen}
        title={`New ${SOURCES[source].key === "tasks" ? "task" : "item"}`}
        okText="Add row"
        onOk={() => void submitNewRow()}
        confirmLoading={addRow.isPending}
        onCancel={() => setNewRowOpen(false)}
        destroyOnHidden
      >
        <Form form={newRowForm} layout="vertical" preserve={false}>
          {requiredColumns.map((f) => (
            <Form.Item
              key={f.key}
              name={f.key}
              label={f.column?.label ?? f.label}
              rules={[{ required: true, whitespace: true, message: `${f.label} is required.` }]}
            >
              {f.column?.type === "long_text" ? <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} /> : <Input autoFocus />}
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <style>{`
        .sheet-grid:focus-visible { box-shadow: 0 0 0 2px ${token.colorPrimaryBorder}; }
        .sheet-grid .ant-table-cell { padding: 0 !important; height: ${ROW_HEIGHT}px; border-inline-end: 1px solid ${token.colorBorderSecondary}; }
        .sheet-grid .ant-table-thead > tr > th { background: ${token.colorFillQuaternary} !important; font-weight: 600; }
        .sheet-grid .ant-table-thead > tr > th::before { display: none; }
        .sheet-grid .ant-table-tbody > tr > td { border-bottom: 1px solid ${token.colorBorderSecondary}; }
        .sheet-grid .ant-table-tbody .ant-table-row:hover > td { background: inherit; }
        .sheet-grid .sg-in { height: ${ROW_HEIGHT - 1}px; padding: 0 8px; display: flex; align-items: center; overflow: hidden; font-size: 13px; cursor: cell; user-select: none; box-sizing: border-box; }
        .sheet-grid .sg-editing { padding: 0 2px; cursor: auto; user-select: auto; }
        .sheet-grid .sg-range { background: ${token.colorPrimaryBg}; }
        .sheet-grid .sg-active { box-shadow: inset 0 0 0 2px ${token.colorPrimary}; background: ${token.colorBgContainer}; }
        .sheet-grid .sg-locked { background: ${token.colorFillQuaternary}; color: ${token.colorTextSecondary}; }
        .sheet-grid .sg-locked.sg-active { background: ${token.colorFillTertiary}; }
        .sheet-grid .sg-row-selected > td { background: ${token.colorPrimaryBg} !important; }
        .sheet-grid .sg-rowhead { display: flex; align-items: center; justify-content: center; gap: 6px; height: ${ROW_HEIGHT - 1}px; font-size: 11.5px; color: ${token.colorTextTertiary}; cursor: pointer; font-variant-numeric: tabular-nums; }
        .sheet-grid .sg-rowcheck { display: none; margin: 0; }
        .sheet-grid .ant-table-row:hover .sg-rowcheck, .sheet-grid .sg-rowhead-on .sg-rowcheck { display: inline-block; }
        .sheet-grid .ant-table-row:hover .sg-rownum, .sheet-grid .sg-rowhead-on .sg-rownum { display: none; }
        .sheet-grid .sg-head { position: relative; display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 4px 0 8px; box-sizing: border-box; font-size: 12.5px; }
        .sheet-grid .sg-head-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sheet-grid .sg-head-menu { border: none; background: transparent; padding: 0; width: 20px; height: 20px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: ${token.colorTextTertiary}; opacity: 0; }
        .sheet-grid th:hover .sg-head-menu, .sheet-grid .sg-head-menu:focus-visible, .sheet-grid .sg-head-menu[aria-expanded="true"] { opacity: 1; }
        .sheet-grid .sg-head-menu:hover { background: ${token.colorFillSecondary}; }
        .sheet-grid .sg-resize { position: absolute; right: -4px; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 2; }
        .sheet-grid .sg-resize:hover { background: ${token.colorPrimaryBorder}; }
        .sheet-grid-root .sg-status { display: flex; align-items: center; gap: 12px; padding: 6px 4px 0; font-size: 12px; color: ${token.colorTextTertiary}; min-height: 30px; }
        @media (max-width: 720px) { .sheet-grid-root .sg-hint { display: none; } }
      `}</style>
    </div>
  );
}
