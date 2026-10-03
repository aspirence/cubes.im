"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Badge,
  Button,
  Checkbox,
  ConfigProvider,
  DatePicker,
  Dropdown,
  Input,
  Popover,
  Radio,
  Segmented,
  Table,
  Tooltip,
  theme,
  type InputRef,
  type MenuProps,
  type TableProps,
} from "antd";
import { useRouter } from "next/navigation";
import dayjs, { type Dayjs } from "dayjs";
import { MIcon } from "./m-icon";
import { EntityAvatar } from "../_lib/ui";

/**
 * The CRM's record tables — People, Companies, Deals, Tasks — in one visual
 * language: a card that holds its own toolbar (search, filter buttons,
 * "Manage columns", a view switch) above a calm, dense table with a light
 * header, avatar + name, email and phone as chips, the company with its mark,
 * tags as dotted pills, the created date and a relative "last update".
 *
 * Theme-aware without CSS variables: the table's look is antd component
 * tokens derived from the current theme (a nested ConfigProvider inherits the
 * rest), and the few rules tokens cannot express are generated from the same
 * token values at render time.
 *
 * The header and hover tints are SOLID colours (the theme's fill blended over
 * the card colour), never the translucent fills themselves: antd paints a
 * pinned (fixed: "right") cell with the header/hover background, so a
 * translucent one would let the columns scrolling underneath show through.
 */

/* ------------------------------------------------------------------ card */

export function CrmTableCard({
  toolbar,
  children,
  footer,
}: {
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 14,
        // clip, not hidden: rounds the corners without making the card a
        // scroll container, so a sticky bulk bar in the footer still sticks.
        overflow: "clip",
        boxShadow: "0 1px 2px rgba(16,24,40,.04)",
      }}
    >
      {toolbar ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "12px 14px",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {toolbar}
        </div>
      ) : null}
      {children}
      {footer}
    </div>
  );
}

/** A spacer that pushes the toolbar items after it to the right. */
export function ToolbarSpacer() {
  return <span style={{ flex: 1 }} />;
}

/* ----------------------------------------------------------------- table */

/**
 * antd Table in the CRM record style. Pass everything a Table takes; the
 * look (header, row height, hover, selection outline) is applied here.
 *
 * `rowContextMenu` adds a right-click menu to every row (see useContextMenu):
 * return the row's items, or null to leave that row with the browser's menu.
 */
export function CrmTable<T extends object>({
  rowContextMenu,
  ...props
}: TableProps<T> & {
  rowContextMenu?: (record: T) => CrmMenuItem[] | null | undefined;
}) {
  const { token } = theme.useToken();
  const headerBg = solidOver(token.colorFillTertiary, token.colorBgContainer);
  const hoverBg = solidOver(token.colorFillQuaternary, token.colorBgContainer);
  const css = useMemo(
    () => `
.crm-table .ant-table-thead > tr > th {
  font-size: 12.5px; font-weight: 600; letter-spacing: .1px;
}
.crm-table .ant-table-thead > tr > th::before { display: none; }
.crm-table .ant-table-tbody > tr > td { transition: background .12s ease; }
.crm-table .ant-table-tbody > tr.ant-table-row-selected > td:first-child,
.crm-table .ant-table-tbody > tr:focus-within > td:first-child,
.crm-table .ant-table-tbody > tr.crm-row-menu-open > td:first-child {
  box-shadow: inset 2px 0 0 ${token.colorPrimary};
}
.crm-table .ant-table-tbody > tr.crm-row-menu-open:not(.ant-table-row-selected) > td {
  background: ${hoverBg};
}
.crm-table .ant-table-tbody > tr.ant-table-row { cursor: pointer; }
.crm-table .ant-table-pagination.ant-pagination { margin: 12px 16px; }
`,
    [token.colorPrimary, hoverBg],
  );

  const menu = useContextMenu();
  const openMenu = menu.open;
  /** The row whose right-click menu is open, outlined like a selection. */
  const [menuRowKey, setMenuRowKey] = useState<React.Key | null>(null);
  const { rowKey, rowClassName } = props;
  const keyOf = useCallback(
    (record: T, index?: number): React.Key | undefined => {
      if (typeof rowKey === "function") return rowKey(record, index);
      const v = (record as Record<string, unknown>)[
        (rowKey as string | undefined) ?? "key"
      ];
      return typeof v === "string" || typeof v === "number" ? v : undefined;
    },
    [rowKey],
  );

  // A row's click opens its record — but only a click that lands on the row
  // itself. React bubbles events out of portals along the component tree, so
  // choosing an option in a cell's status menu, Select, "…" menu, confirm
  // popover or modal (all rendered in <body>) would otherwise reach the row
  // and open the drawer as well.
  const pageOnRow = props.onRow;
  const onRow = useMemo<TableProps<T>["onRow"]>(() => {
    if (!pageOnRow && !rowContextMenu) return undefined;
    return (record, index) => {
      const attrs = pageOnRow?.(record, index) ?? {};
      const click = attrs.onClick;
      const pageContextMenu = attrs.onContextMenu;
      return {
        ...attrs,
        onClick: click
          ? (e: React.MouseEvent<HTMLElement>) => {
              if (!isOwnRowClick(e)) return;
              click(e);
            }
          : undefined,
        onContextMenu: rowContextMenu
          ? (e: React.MouseEvent<HTMLElement>) => {
              pageContextMenu?.(e);
              if (e.defaultPrevented || !wantsCrmMenu(e)) return;
              const items = rowContextMenu(record);
              if (!items || items.length === 0) return;
              const key = keyOf(record, index);
              setMenuRowKey(key ?? null);
              openMenu(e, items, { onClose: () => setMenuRowKey(null) });
            }
          : pageContextMenu,
      };
    };
  }, [pageOnRow, rowContextMenu, keyOf, openMenu]);

  const mergedRowClassName = useMemo<TableProps<T>["rowClassName"]>(() => {
    if (menuRowKey === null) return rowClassName;
    return (record, index, indent) => {
      const own =
        typeof rowClassName === "function"
          ? rowClassName(record, index, indent)
          : (rowClassName ?? "");
      return keyOf(record, index) === menuRowKey
        ? `${own} crm-row-menu-open`.trim()
        : own;
    };
  }, [menuRowKey, rowClassName, keyOf]);

  return (
    <ConfigProvider
      theme={{
        components: {
          Table: {
            headerBg,
            headerColor: token.colorTextSecondary,
            headerSplitColor: "transparent",
            headerBorderRadius: 0,
            rowHoverBg: hoverBg,
            rowSelectedBg: token.colorPrimaryBg,
            rowSelectedHoverBg: token.colorPrimaryBgHover,
            borderColor: token.colorBorderSecondary,
            cellPaddingBlockMD: 11,
            cellPaddingInlineMD: 12,
            cellFontSizeMD: 13.5,
          },
        },
      }}
    >
      <style>{css}</style>
      <Table<T>
        size="middle"
        {...props}
        onRow={onRow}
        rowClassName={mergedRowClassName}
        className={["crm-table", props.className].filter(Boolean).join(" ")}
      />
      {/* Outside the <Table>: the menu's portal events bubble here, never
          through a row. */}
      {menu.element}
    </ConfigProvider>
  );
}

/* ---------------------------------------------------------- context menu */

/**
 * One entry of a right-click menu. `icon` is a Material Symbols name;
 * `checked` marks the current value in a choice list (a status, a stage);
 * `children` makes a submenu. Dividers are tidied (no leading, trailing or
 * doubled ones), so builders can add them freely.
 */
export interface CrmMenuAction {
  type?: undefined;
  key: string;
  label: React.ReactNode;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  /** Quiet text at the end of the row (a current value, a hint). */
  extra?: React.ReactNode;
  onSelect?: () => void;
  children?: CrmMenuItem[];
}
export type CrmMenuItem =
  | CrmMenuAction
  | { type: "divider" }
  | {
      type: "group";
      key: string;
      label: React.ReactNode;
      children: CrmMenuItem[];
    };

const MENU_SCROLL_CLASS = "crm-menu-scroll";
const MENU_SCROLL_CSS = `.${MENU_SCROLL_CLASS} .ant-dropdown-menu { max-height: min(340px, 70vh); overflow-y: auto; }`;

function tidyDividers(items: CrmMenuItem[]): CrmMenuItem[] {
  const out: CrmMenuItem[] = [];
  for (const item of items) {
    const isDivider = item.type === "divider";
    const prev = out[out.length - 1];
    if (isDivider && (!prev || prev.type === "divider")) continue;
    out.push(item);
  }
  while (out.length) {
    const last = out[out.length - 1];
    if (last.type === "divider") out.pop();
    else break;
  }
  return out;
}

function buildMenu(
  items: CrmMenuItem[],
  colors: { check: string; extra: string },
  actions: Map<string, () => void>,
  parent = "",
): NonNullable<MenuProps["items"]> {
  return tidyDividers(items).map((item, i) => {
    if (item.type === "divider")
      return { type: "divider" as const, key: `${parent}divider-${i}` };
    if (item.type === "group") {
      const key = `${parent}${item.key}`;
      return {
        type: "group" as const,
        key,
        label: item.label,
        children: buildMenu(item.children, colors, actions, `${key}/`),
      };
    }
    const it: CrmMenuAction = item;
    const key = `${parent}${it.key}`;
    const icon = it.icon ? <MIcon name={it.icon} size={16} /> : undefined;
    const extra = it.checked ? (
      <MIcon name="check" size={16} color={colors.check} />
    ) : it.extra ? (
      <span style={{ color: colors.extra, fontSize: 12 }}>{it.extra}</span>
    ) : undefined;
    if (it.children && it.children.length) {
      return {
        key,
        label: it.extra ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            {it.label}
            <span
              style={{
                color: colors.extra,
                fontSize: 12,
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {it.extra}
            </span>
          </span>
        ) : (
          it.label
        ),
        icon,
        disabled: it.disabled,
        // Long lists (projects, stages) scroll instead of running off screen.
        popupClassName: it.children.length > 10 ? MENU_SCROLL_CLASS : undefined,
        children: buildMenu(it.children, colors, actions, `${key}/`),
      };
    }
    if (it.onSelect) actions.set(key, it.onSelect);
    return {
      key,
      label: it.label,
      icon,
      danger: it.danger,
      disabled: it.disabled,
      extra,
    };
  });
}

/*
 * What the selection was just BEFORE a right-click. On macOS the browser
 * selects the word under the pointer before it dispatches `contextmenu`, so
 * the selection seen in the handler says nothing about what the user had
 * selected. A capture-phase mousedown listener (installed once, by the first
 * context menu mounted) records it first.
 */
let selectionBeforeContextClick: { text: string; anchor: Node | null } | null = null;
let selectionTrackerInstalled = false;

function installSelectionTracker() {
  if (selectionTrackerInstalled || typeof document === "undefined") return;
  selectionTrackerInstalled = true;
  document.addEventListener(
    "mousedown",
    (e) => {
      const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
      if (!(e.button === 2 || (mac && e.button === 0 && e.ctrlKey))) return;
      const sel = window.getSelection();
      selectionBeforeContextClick =
        sel && !sel.isCollapsed && sel.toString().trim() ? { text: sel.toString(), anchor: sel.anchorNode } : { text: "", anchor: null };
    },
    true,
  );
}

/**
 * Whether a right-click on a CRM item (a row, a card, a list row — the
 * element whose onContextMenu is running) should get the CRM menu rather than
 * the browser's. Use it on every surface that calls useContextMenu().open.
 *
 *  - Not when it came from a portal a cell opened (a status menu, a tag
 *    popover, a confirm): React bubbles those along the component tree.
 *  - Not with Shift held — the escape hatch to the browser menu.
 *  - Not in a text field.
 *  - Not when the user had text selected inside the item (so Copy works);
 *    a word the browser itself selected for the right-click doesn't count,
 *    and is cleared.
 */
export function wantsCrmMenu(e: React.MouseEvent<Element>): boolean {
  const host = e.currentTarget;
  const target = e.target;
  if (!(target instanceof Node) || !host.contains(target)) return false;
  if (e.shiftKey) return false;
  const el = target instanceof Element ? target : target.parentElement;
  if (el?.closest('input, textarea, select, [contenteditable="true"]')) return false;
  const snapshot = selectionBeforeContextClick;
  selectionBeforeContextClick = null;
  const sel = typeof window === "undefined" ? null : window.getSelection();
  const hadSelection = snapshot
    ? snapshot.text.trim() !== "" && snapshot.anchor !== null && host.contains(snapshot.anchor)
    : Boolean(sel && !sel.isCollapsed && sel.toString().trim() && host.contains(sel.anchorNode));
  if (hadSelection) return false;
  if (snapshot && sel && !sel.isCollapsed && host.contains(sel.anchorNode)) sel.removeAllRanges();
  return true;
}

/*
 * When the last context menu was dismissed by a click outside it. That click
 * is also a click on whatever is under the pointer; a row or card must not
 * open because the user was only closing the menu.
 */
let lastMenuDismissedAt = 0;

/** True for a click that is really the dismissal of a context menu (row/card click handlers skip it). */
export function crmMenuJustDismissed(): boolean {
  return typeof performance !== "undefined" && performance.now() - lastMenuDismissedAt < 500;
}

/**
 * A right-click menu at the pointer, for any CRM surface. Call `open(event,
 * items)` from an onContextMenu handler and render `element` somewhere OUTSIDE
 * the clicked item (its portal's events bubble to wherever it is rendered).
 * The menu closes on a pick, a click elsewhere, Escape, scrolling, resizing or
 * leaving the window; `onClose` runs when it does. Opened from the keyboard
 * (the menu key / Shift+F10, which report no pointer position) it appears at
 * the focused element instead.
 */
export function useContextMenu() {
  const { token } = theme.useToken();
  const [state, setState] = useState<{
    x: number;
    y: number;
    items: CrmMenuItem[];
  } | null>(null);
  const onCloseRef = useRef<(() => void) | undefined>(undefined);
  /** Where focus was when the menu opened; it goes back there on close. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => installSelectionTracker(), []);

  const close = useCallback(() => {
    setState(null);
    const done = onCloseRef.current;
    onCloseRef.current = undefined;
    done?.();
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const stranded = !active || active === document.body || Boolean(active.closest?.(".ant-dropdown, .ant-dropdown-menu-submenu-popup"));
      if (back && back.isConnected && stranded) back.focus({ preventScroll: true });
    });
  }, []);

  const open = useCallback(
    (
      e: React.MouseEvent<Element> | MouseEvent,
      items: CrmMenuItem[],
      opts?: { onClose?: () => void },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      let x = e.clientX;
      let y = e.clientY;
      if (x === 0 && y === 0 && e.target instanceof Element) {
        const r = e.target.getBoundingClientRect();
        x = r.left;
        y = r.bottom;
      }
      const previous = onCloseRef.current;
      onCloseRef.current = opts?.onClose;
      previous?.();
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !active.closest(".ant-dropdown")) returnFocusRef.current = active;
      else if (e.target instanceof HTMLElement) returnFocusRef.current = e.target.closest<HTMLElement>("[tabindex], a[href], button") ?? null;
      setState({ x, y, items });
    },
    [],
  );

  useEffect(() => {
    if (!state) return;
    const onScroll = (ev: Event) => {
      const t = ev.target;
      if (
        t instanceof Element &&
        t.closest(".ant-dropdown, .ant-dropdown-menu-submenu-popup")
      )
        return;
      close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [state, close]);

  const built = useMemo(() => {
    if (!state) return null;
    const actions = new Map<string, () => void>();
    const items = buildMenu(
      state.items,
      { check: token.colorPrimary, extra: token.colorTextTertiary },
      actions,
    );
    return { items, actions };
  }, [state, token.colorPrimary, token.colorTextTertiary]);

  const element = (
    <>
      <style>{MENU_SCROLL_CSS}</style>
      <Dropdown
        open={Boolean(state)}
        onOpenChange={(next, info) => {
          if (next) return;
          // A click elsewhere closed it: that click must not also act.
          if (info?.source === "trigger") lastMenuDismissedAt = performance.now();
          close();
        }}
        trigger={["contextMenu"]}
        placement="bottomLeft"
        autoFocus
        destroyOnHidden
        menu={{
          items: built?.items ?? [],
          // Never taller than the window: a long record menu scrolls inside
          // itself (the page can't be scrolled to it — scrolling closes it).
          style: { minWidth: 220, maxHeight: "calc(100vh - 16px)", overflowY: "auto" },
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            const action = built?.actions.get(key);
            close();
            action?.();
          },
        }}
      >
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: state?.x ?? 0,
            top: state?.y ?? 0,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        />
      </Dropdown>
    </>
  );

  return { open, close, element, isOpen: state !== null };
}

/**
 * Whether a click on a table row should open the row: it happened inside the
 * row's own DOM (not in a portal — a dropdown, select, popover or modal a
 * cell opened), not on a control inside the row that owns the click (a link,
 * button, input or checkbox; those stop propagation themselves, this is the
 * backstop), and it was not the end of a text-selection drag.
 */
function isOwnRowClick(e: React.MouseEvent<HTMLElement>): boolean {
  if (crmMenuJustDismissed()) return false;
  const row = e.currentTarget;
  const target = e.target;
  if (!(target instanceof Node) || !row.contains(target)) return false;
  const el = target instanceof Element ? target : target.parentElement;
  const control = el?.closest(
    'a[href], button, input, textarea, select, label, [role="button"], [role="checkbox"], [role="switch"], [role="combobox"], [contenteditable="true"], .ant-select, .ant-picker, .ant-checkbox-wrapper, .ant-dropdown-trigger',
  );
  if (control && control !== row && row.contains(control)) return false;
  const selection =
    typeof window === "undefined" ? null : window.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim() &&
    row.contains(selection.anchorNode)
  )
    return false;
  return true;
}

/* ----------------------------------------------------------------- cells */

const CHIP_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  maxWidth: "100%",
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 12.5,
  lineHeight: "20px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  textDecoration: "none",
};

/** An email as a pill that opens the mail app; the row click does not fire. */
export function EmailChip({ email }: { email: string | null | undefined }) {
  const { token } = theme.useToken();
  if (!email) return <EmptyCell />;
  return (
    <Tooltip title={email} mouseEnterDelay={0.5}>
      <a
        href={`mailto:${email}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...CHIP_BASE,
          color: token.colorPrimary,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {email}
        </span>
      </a>
    </Tooltip>
  );
}

/** A phone number as a pill that dials; the row click does not fire. */
export function PhoneChip({ phone }: { phone: string | null | undefined }) {
  const { token } = theme.useToken();
  if (!phone) return <EmptyCell />;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        ...CHIP_BASE,
        color: token.colorPrimary,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {phone}
    </a>
  );
}

/** A company with its mark (the CRM's company avatar), or a dash. */
export function OrgCell({
  name,
  onClick,
}: {
  name: string | null | undefined;
  onClick?: () => void;
}) {
  const { token } = theme.useToken();
  if (!name) return <EmptyCell />;
  const body = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <EntityAvatar name={name} kind="company" size={20} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: token.colorText,
        }}
      >
        {name}
      </span>
    </span>
  );
  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      // No CSS preflight in this app: a bare <button> keeps the browser's
      // button font unless told to inherit the row's.
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        minWidth: 0,
        maxWidth: "100%",
        font: "inherit",
        color: "inherit",
        textAlign: "left",
      }}
    >
      {body}
    </button>
  );
}

export type PillTone =
  "neutral" | "success" | "warning" | "danger" | "accent" | "info";

/** A tag or status as a soft pill with a leading dot — the reference's "Slow respone" chip. */
export function TagPill({
  label,
  tone = "neutral",
  color,
}: {
  label: React.ReactNode;
  tone?: PillTone;
  /** An entity colour (a tag's or a stage's own hex) instead of a tone. */
  color?: string | null;
}) {
  const { token } = theme.useToken();
  const tones: Record<PillTone, { fg: string; bg: string }> = {
    neutral: { fg: token.colorTextSecondary, bg: token.colorFillTertiary },
    success: { fg: token.colorSuccessText, bg: token.colorSuccessBg },
    warning: { fg: token.colorWarningText, bg: token.colorWarningBg },
    danger: { fg: token.colorErrorText, bg: token.colorErrorBg },
    accent: { fg: token.colorPrimaryText, bg: token.colorPrimaryBg },
    info: { fg: token.colorInfoText, bg: token.colorInfoBg },
  };
  const c = color ? { fg: color, bg: hexAlpha(color, 0.12) } : tones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 9px 1px 7px",
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: "20px",
        whiteSpace: "nowrap",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: c.fg,
          flex: "none",
        }}
      />
      {label}
    </span>
  );
}

/** "Nov 11, 2023". */
export function DateCell({ value }: { value: string | null | undefined }) {
  const { token } = theme.useToken();
  if (!value) return <EmptyCell />;
  return (
    <span
      style={{
        color: token.colorText,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {dayjs(value).format("MMM D, YYYY")}
    </span>
  );
}

/** "5 days ago", with the exact time on hover. */
export function UpdatedCell({ value }: { value: string | null | undefined }) {
  const { token } = theme.useToken();
  if (!value) return <EmptyCell />;
  const d = dayjs(value);
  return (
    <Tooltip title={d.format("D MMM YYYY, h:mm A")} mouseEnterDelay={0.4}>
      <span style={{ color: token.colorTextSecondary, whiteSpace: "nowrap" }}>
        {relative(d)}
      </span>
    </Tooltip>
  );
}

/** The quiet dash an empty cell shows. */
export function EmptyCell() {
  const { token } = theme.useToken();
  return <span style={{ color: token.colorTextQuaternary }}>—</span>;
}

function relative(d: dayjs.Dayjs): string {
  const mins = Math.round((Date.now() - d.valueOf()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** An "rgb(a)" or "#rrggbb" colour as channels, or null if it is neither. */
function parseColor(
  c: string,
): { r: number; g: number; b: number; a: number } | null {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
      a: hex[2] ? parseInt(hex[2], 16) / 255 : 1,
    };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
      c.trim(),
    );
  if (!rgb) return null;
  const alpha =
    rgb[4] === undefined
      ? 1
      : rgb[4].endsWith("%")
        ? parseFloat(rgb[4]) / 100
        : parseFloat(rgb[4]);
  return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: alpha };
}

/** `fg` laid over the opaque `bg`, as an opaque colour (falls back to `bg`). */
function solidOver(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return bg;
  const mix = (x: number, y: number) => Math.round(x * f.a + y * (1 - f.a));
  return `rgb(${mix(f.r, b.r)}, ${mix(f.g, b.g)}, ${mix(f.b, b.b)})`;
}

function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "rgba(128,128,128,0.12)";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* --------------------------------------------------------------- toolbar */

/**
 * The table's search. "/" focuses it from anywhere on the page (⌘K is the
 * app's global search, so it is not taken here); the hint shows while empty.
 */
export function TableSearch({
  value,
  onChange,
  placeholder = "Search",
  width = 240,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
}) {
  const { token } = theme.useToken();
  const ref = useRef<InputRef>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        t?.isContentEditable
      )
        return;
      // Not from inside a floating layer (the Manage columns menu, a status
      // menu…): pulling focus out of it would strand a keyboard drag there.
      if (
        t?.closest(
          ".ant-popover, .ant-dropdown, .ant-dropdown-menu, .ant-dropdown-menu-submenu-popup, .ant-select-dropdown, .ant-picker-dropdown",
        )
      )
        return;
      if (document.querySelector(".ant-modal-wrap, .ant-drawer-open")) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Input
      ref={ref}
      allowClear
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
      suffix={
        value ? null : (
          <kbd
            style={{
              fontSize: 11,
              lineHeight: "16px",
              padding: "0 5px",
              borderRadius: 4,
              border: `1px solid ${token.colorBorderSecondary}`,
              color: token.colorTextTertiary,
              fontFamily: "inherit",
            }}
          >
            /
          </kbd>
        )
      }
      style={{ width }}
    />
  );
}

/**
 * A toolbar filter: an icon + label that opens a small panel. Shows how many
 * values are on, and turns accent-tinted while it filters anything.
 */
export function FilterButton({
  icon,
  label,
  activeCount = 0,
  onClear,
  children,
  width = 260,
}: {
  icon: string;
  label: string;
  /** How many values this filter currently applies (0 = off). */
  activeCount?: number;
  onClear?: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const on = activeCount > 0;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      content={
        <div style={{ width, display: "grid", gap: 10 }}>
          {children}
          {on && onClear ? (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                size="small"
                type="link"
                style={{ padding: 0 }}
                onClick={onClear}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      }
    >
      <Button
        type="text"
        icon={
          <MIcon
            name={icon}
            size={17}
            color={on ? token.colorPrimary : token.colorTextSecondary}
          />
        }
        style={{
          color: on ? token.colorPrimary : token.colorTextSecondary,
          background: on ? token.colorPrimaryBg : undefined,
          fontWeight: on ? 600 : 400,
        }}
      >
        {label}
        {on ? (
          <Badge
            count={activeCount}
            size="small"
            color={token.colorPrimary}
            style={{ marginInlineStart: 4 }}
          />
        ) : null}
      </Button>
    </Popover>
  );
}

/* ------------------------------------------------------ date created */

/** A "Date created" choice: a quick window, or "custom" (the range picker). */
export type CreatedPreset = "any" | "7d" | "30d" | "90d" | "year" | "custom";

export type CreatedRange = [Dayjs, Dayjs];

const CREATED_PRESETS: {
  value: Exclude<CreatedPreset, "custom">;
  label: string;
}[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "year", label: "This year" },
];

/**
 * The span of creation times a "Date created" choice keeps (epoch ms; `to`
 * null = no upper bound), or null when it keeps everything. "Last N days"
 * counts today as one of the N; a custom range covers both of its days in
 * full; "custom" without a range filters nothing.
 */
export function createdWindow(
  preset: CreatedPreset,
  range: CreatedRange | null,
): { from: number; to: number | null } | null {
  const today = dayjs().startOf("day");
  switch (preset) {
    case "7d":
      return { from: today.subtract(6, "day").valueOf(), to: null };
    case "30d":
      return { from: today.subtract(29, "day").valueOf(), to: null };
    case "90d":
      return { from: today.subtract(89, "day").valueOf(), to: null };
    case "year":
      return { from: today.startOf("year").valueOf(), to: null };
    case "custom":
      return range
        ? {
            from: range[0].startOf("day").valueOf(),
            to: range[1].endOf("day").valueOf(),
          }
        : null;
    default:
      return null;
  }
}

/** Whether an ISO timestamp falls inside a createdWindow() (null keeps all). */
export function inCreatedWindow(
  span: { from: number; to: number | null } | null,
  iso: string,
): boolean {
  if (!span) return true;
  const at = dayjs(iso).valueOf();
  return at >= span.from && (span.to === null || at <= span.to);
}

/**
 * The toolbar's "Date created" filter: quick windows as a radio list, and a
 * custom day range under them. Picking a preset clears the range; picking a
 * full range switches to "custom"; clearing the range goes back to any time.
 */
export function DateCreatedFilter({
  preset,
  range,
  onChange,
  label = "Date created",
}: {
  preset: CreatedPreset;
  range: CreatedRange | null;
  onChange: (preset: CreatedPreset, range: CreatedRange | null) => void;
  label?: string;
}) {
  const { token } = theme.useToken();
  return (
    <FilterButton
      icon="calendar_today"
      label={label}
      activeCount={createdWindow(preset, range) ? 1 : 0}
      onClear={() => onChange("any", null)}
      width={280}
    >
      <Radio.Group
        // null (not undefined) keeps the group controlled while a custom
        // range is on and no preset is picked.
        value={preset === "custom" ? null : preset}
        onChange={(e) => onChange(e.target.value as CreatedPreset, null)}
        style={{ display: "grid", gap: 6 }}
      >
        {CREATED_PRESETS.map((o) => (
          <Radio key={o.value} value={o.value}>
            {o.label}
          </Radio>
        ))}
      </Radio.Group>
      <div style={{ display: "grid", gap: 6 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: token.colorTextSecondary,
          }}
        >
          Custom range
        </span>
        <DatePicker.RangePicker
          value={preset === "custom" ? range : null}
          format="MMM D, YYYY"
          allowClear
          style={{ width: "100%" }}
          onChange={(next) => {
            const [from, to] = next ?? [null, null];
            if (from && to) onChange("custom", [from, to]);
            else onChange("any", null);
          }}
        />
      </div>
    </FilterButton>
  );
}

/*
 * Column visibility, remembered per browser under "crm-columns:<table>".
 * Read through useSyncExternalStore with a null server snapshot, so the server
 * render and the first client render agree (defaults) and the saved choice is
 * applied right after hydration; open tabs follow each other via "storage".
 * If storage is blocked the choice still applies, held in memory.
 */
const columnListeners = new Set<() => void>();
const columnMemory = new Map<string, string | null>();

function readColumns(key: string): string | null {
  if (columnMemory.has(key)) return columnMemory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeColumns(key: string, value: string | null) {
  columnMemory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    // Stored: let storage stay the source, so other tabs' changes show here.
    columnMemory.delete(key);
  } catch {
    /* blocked: kept in memory for this tab */
  }
  columnListeners.forEach((l) => l());
}

function subscribeColumns(listener: () => void) {
  columnListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("crm-columns:")) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    columnListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/* ------------------------------------------------------ column layout */

/** One column a user can hide and move: its `key` in the columns array, and its menu title. */
export interface ColumnChoice {
  key: string;
  title: string;
}

/** A table's column layout: the user's order and hidden set, and the ways to change them. */
export interface ColumnLayout {
  /** Every choice, in the user's order. */
  choices: ColumnChoice[];
  hidden: Set<string>;
  isVisible: (key: string) => boolean;
  /** Show or hide one column. Hiding the last visible column is ignored. */
  toggle: (key: string, visible: boolean) => void;
  /** Move `key` to where `overKey` is (drag and drop). */
  move: (key: string, overKey: string) => void;
  /** Back to the table's default order and visibility. */
  reset: () => void;
  /** Whether the user has saved a layout of their own. */
  customized: boolean;
  /**
   * The table's columns in the user's order, without the hidden ones. Columns
   * that are not choices (the row actions, say) keep their own positions; the
   * slots the choices occupy are refilled in the user's order.
   */
  arrange: <C extends { key?: React.Key }>(columns: C[]) => C[];
}

interface StoredLayout {
  order: string[];
  hidden: Set<string>;
}

/**
 * Reads a saved layout. Two shapes exist: v1 (a bare array of hidden keys,
 * from before columns could move) and v2 `{ v: 2, order, hidden, known }`.
 * `known` lists the columns that existed when the layout was saved, so a
 * column added to the table later starts with its default visibility instead
 * of whatever "not in the hidden list" would imply. Unknown keys are dropped,
 * and new columns slot in after their default neighbour.
 */
function parseLayout(
  raw: string | null,
  keys: string[],
  defaultHidden: string[],
): StoredLayout {
  let savedOrder: string[] | null = null;
  let savedHidden: string[] | null = null;
  let known: string[] | null = null;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const strings = (v: unknown): string[] | null =>
        Array.isArray(v)
          ? v.filter((k): k is string => typeof k === "string")
          : null;
      if (Array.isArray(parsed)) {
        savedHidden = strings(parsed);
      } else if (parsed && typeof parsed === "object") {
        const o = parsed as Record<string, unknown>;
        savedOrder = strings(o.order);
        savedHidden = strings(o.hidden);
        known = strings(o.known);
      }
    } catch {
      /* unreadable: defaults */
    }
  }

  const order: string[] = [];
  for (const k of savedOrder ?? [])
    if (keys.includes(k) && !order.includes(k)) order.push(k);
  keys.forEach((k, i) => {
    if (order.includes(k)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = order.indexOf(keys[j]);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    order.splice(at, 0, k);
  });

  const hidden = new Set<string>();
  for (const k of keys) {
    const isKnown =
      savedHidden !== null && (known === null || known.includes(k));
    if (isKnown ? savedHidden!.includes(k) : defaultHidden.includes(k))
      hidden.add(k);
  }
  // A table always shows at least one column.
  if (keys.length && keys.every((k) => hidden.has(k))) hidden.delete(order[0]);
  return { order, hidden };
}

/**
 * A table's column layout — which columns show and in what order — remembered
 * per browser under "crm-columns:<tableKey>". `choices` are the columns a user
 * may hide and move, in their default order (every data column, the name
 * column included; not the row actions). At least one stays visible.
 */
export function useColumnLayout(
  tableKey: string,
  choices: ColumnChoice[],
  defaultHidden: string[] = [],
): ColumnLayout {
  const storageKey = `crm-columns:${tableKey}`;
  const raw = useSyncExternalStore(
    subscribeColumns,
    () => readColumns(storageKey),
    () => null,
  );
  // Serialised so callers can pass inline arrays without re-deriving each render.
  const choicesKey = JSON.stringify(choices.map((c) => [c.key, c.title]));
  const defaultKey = JSON.stringify(defaultHidden);

  return useMemo(() => {
    const list = (JSON.parse(choicesKey) as [string, string][]).map(
      ([key, title]) => ({ key, title }),
    );
    const keys = list.map((c) => c.key);
    const defaults = JSON.parse(defaultKey) as string[];
    const { order, hidden } = parseLayout(raw, keys, defaults);
    const byKey = new Map(list.map((c) => [c.key, c]));
    const save = (nextOrder: string[], nextHidden: Set<string>) =>
      writeColumns(
        storageKey,
        JSON.stringify({
          v: 2,
          order: nextOrder,
          hidden: [...nextHidden],
          known: keys,
        }),
      );

    return {
      choices: order
        .map((k) => byKey.get(k))
        .filter((c): c is ColumnChoice => Boolean(c)),
      hidden,
      isVisible: (key) => !hidden.has(key),
      toggle: (key, visible) => {
        if (!keys.includes(key)) return;
        const next = new Set(hidden);
        if (visible) next.delete(key);
        else {
          if (keys.filter((k) => !next.has(k)).length <= 1 && !next.has(key))
            return;
          next.add(key);
        }
        save(order, next);
      },
      move: (key, overKey) => {
        const from = order.indexOf(key);
        const to = order.indexOf(overKey);
        if (from < 0 || to < 0 || from === to) return;
        save(arrayMove(order, from, to), hidden);
      },
      reset: () => writeColumns(storageKey, null),
      customized: raw !== null,
      arrange: <C extends { key?: React.Key }>(columns: C[]): C[] => {
        const isChoice = (c: C) =>
          c.key !== undefined && byKey.has(String(c.key));
        const byColumnKey = new Map(
          columns.filter(isChoice).map((c) => [String(c.key), c]),
        );
        const queue = order
          .filter((k) => !hidden.has(k))
          .map((k) => byColumnKey.get(k))
          .filter((c): c is C => Boolean(c));
        const out: C[] = [];
        for (const c of columns) {
          if (!isChoice(c)) out.push(c);
          else {
            const next = queue.shift();
            if (next) out.push(next);
          }
        }
        return out;
      },
    };
  }, [raw, choicesKey, defaultKey, storageKey]);
}

/** Keeps a dragged menu row on its vertical track. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const MENU_CLASS = "crm-column-menu";

/** Lets long titles end in "…" inside antd's checkbox label. */
const MENU_CSS = `
.${MENU_CLASS} .ant-checkbox-wrapper { flex: 1; min-width: 0; }
.${MENU_CLASS} .ant-checkbox-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

/** Ends a keyboard drag the way the user would: dnd-kit's keyboard sensor cancels on Escape (listened for on the document). */
function cancelKeyboardDrag() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
    }),
  );
}

/**
 * "Manage columns": every column the table offers, with a checkbox to show or
 * hide it and a handle to drag it into place. Keyboard: opening the menu with
 * Enter/Space focuses the first handle; Space lifts, arrows move, Space drops,
 * Escape cancels (and, when nothing is being moved, closes the menu). The last
 * visible column cannot be unticked.
 */
export function ManageColumns({
  layout,
  size,
}: {
  layout: ColumnLayout;
  size?: "small" | "middle";
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openedByKeyboard = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const count = layout.choices.length;
  const titleOf = (id: UniqueIdentifier) =>
    layout.choices.find((c) => c.key === String(id))?.title ?? String(id);
  const positionOf = (id: UniqueIdentifier) =>
    layout.choices.findIndex((c) => c.key === String(id)) + 1;
  // Spoken with column titles and positions, not the raw column keys.
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${titleOf(active.id)}, column ${positionOf(active.id)} of ${count}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} is over position ${positionOf(over.id)} of ${count}.`
        : `${titleOf(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} dropped at position ${positionOf(over.id)} of ${count}.`
        : `${titleOf(active.id)} dropped where it was.`,
    onDragCancel: ({ active }) =>
      `Moving ${titleOf(active.id)} was cancelled; it stays at position ${positionOf(active.id)}.`,
  };

  const onOpenChange = (next: boolean) => {
    // Closing mid keyboard-drag (a click outside) must end the drag too: the
    // sensor listens on the document and would otherwise keep eating keys
    // typed anywhere on the page and drop the column on the next Space.
    if (!next && dragging) cancelKeyboardDrag();
    setOpen(next);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(false);
    if (!e.over || e.active.id === e.over.id) return;
    layout.move(String(e.active.id), String(e.over.id));
  };

  const visibleCount = layout.choices.filter((c) =>
    layout.isVisible(c.key),
  ).length;

  const content = (
    <div
      className={MENU_CLASS}
      style={{ width: 248, display: "grid", gap: 8 }}
      onKeyDown={(e) => {
        // Escape while nothing is lifted closes the menu and returns focus to
        // the button; while a column is lifted it only cancels that move.
        if (e.key !== "Escape" || dragging) return;
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <style>{MENU_CSS}</style>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: token.colorTextTertiary,
          }}
        >
          Columns
        </span>
        <span style={{ fontSize: 11.5, color: token.colorTextQuaternary }}>
          Drag to reorder
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "To move a column, press Space or Enter. Use the up and down arrow keys to move it, Space or Enter to drop it, or Escape to cancel.",
          },
        }}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={layout.choices.map((c) => c.key)}
          strategy={verticalListSortingStrategy}
        >
          <div
            ref={listRef}
            style={{
              display: "grid",
              gap: 2,
              maxHeight: 360,
              overflowY: "auto",
              overflowX: "hidden",
              marginInline: -6,
            }}
          >
            {layout.choices.map((c) => {
              const visible = layout.isVisible(c.key);
              return (
                <SortableColumnRow
                  key={c.key}
                  choice={c}
                  visible={visible}
                  locked={visible && visibleCount <= 1}
                  onToggle={(v) => layout.toggle(c.key, v)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          size="small"
          type="link"
          style={{ padding: 0 }}
          disabled={!layout.customized}
          onClick={layout.reset}
        >
          Reset
        </Button>
      </div>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={onOpenChange}
      content={content}
      afterOpenChange={(isOpen) => {
        if (isOpen) {
          // A keyboard user lands on the first handle (the popup lives at the
          // end of <body>, far from the button in tab order).
          if (openedByKeyboard.current)
            listRef.current?.querySelector<HTMLElement>("button")?.focus();
        } else if (listRef.current?.contains(document.activeElement)) {
          triggerRef.current?.focus();
        }
      }}
    >
      <Button
        ref={triggerRef}
        type="text"
        size={size}
        icon={
          <MIcon
            name="view_column"
            size={size === "small" ? 16 : 17}
            color={token.colorTextSecondary}
          />
        }
        style={{ color: token.colorTextSecondary }}
        // detail 0 = activated from the keyboard (Enter/Space), not a pointer.
        onClick={(e) => {
          openedByKeyboard.current = e.detail === 0;
        }}
      >
        Manage columns
      </Button>
    </Popover>
  );
}

function SortableColumnRow({
  choice,
  visible,
  locked,
  onToggle,
}: {
  choice: ColumnChoice;
  visible: boolean;
  /** The last visible column: it cannot be hidden. */
  locked: boolean;
  onToggle: (visible: boolean) => void;
}) {
  const { token } = theme.useToken();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: choice.key });
  const checkbox = (
    <Checkbox
      checked={visible}
      disabled={locked}
      onChange={(e) => onToggle(e.target.checked)}
    >
      <span
        style={{ color: visible ? token.colorText : token.colorTextTertiary }}
      >
        {choice.title}
      </span>
    </Checkbox>
  );
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 1 : undefined,
        display: "flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        padding: "3px 6px",
        borderRadius: 8,
        background: isDragging ? token.colorBgElevated : undefined,
        boxShadow: isDragging ? token.boxShadowSecondary : undefined,
      }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move ${choice.title}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 26,
          padding: 0,
          border: "none",
          borderRadius: 6,
          background: "transparent",
          color: token.colorTextQuaternary,
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
          flex: "none",
        }}
      >
        <MIcon name="drag_indicator" size={18} />
      </button>
      {locked ? (
        <Tooltip title="At least one column stays visible" placement="left">
          {checkbox}
        </Tooltip>
      ) : (
        checkbox
      )}
    </div>
  );
}

/** A two-or-more-way switch between sibling list pages (People ↔ Companies). */
export function ViewSwitch({
  value,
  options,
}: {
  value: string;
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <Segmented
      value={value}
      onChange={(v) => {
        const target = options.find((o) => o.value === v);
        if (target && target.value !== value) router.push(target.href);
      }}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
    />
  );
}
