"use client";

/**
 * Sheets list — the sheets themselves, as cards or as a compact list.
 *
 * Every card and row shows the sheet's Google state, because every sheet IS a
 * Google Sheet now and whether it is in sync is the first thing anyone needs
 * to know about it. That state comes from ONE team-wide read
 * (useSheetsGoogleStatus), made here and not per card, and until it has
 * answered no status is drawn at all — a blank is honest, a guess is not.
 *
 * Each card also says who can open its Google Sheet (the Access row). That
 * too is one read for the whole list (useSheetsAccessList), never one per
 * card, and it is not made at all for a limited member, who is never given the
 * file (Decision B).
 *
 * The first card of the grid (and the first row of the list) makes a new
 * sheet. It is gated exactly like the header's New sheet button — the
 * workspace hands both the same createBlocked — and it steps aside while a
 * search is running, because it is not a search result.
 */

import { useCallback, useMemo, useSyncExternalStore, type CSSProperties } from "react";
import dayjs from "dayjs";
import { Tooltip } from "antd";
import { spreadsheetHref } from "@/lib/sheets/google-embed";
import type { SheetRecordRow } from "@/lib/sheets/types";
import { MONO_FONT } from "@/lib/theme";
import { MIcon, useC } from "@/features/app-content-studio/ui";
import { useAuth } from "@/features/auth/use-auth";
import { CreateSheetCard, SheetCard, frameSurface, type CardAccess, type CardGoogleFile, type CreateShortcut } from "./sheet-card";
import { ELLIPSIS, GoogleStatusChip, OpenInGoogle, SourceChip, SourceTile, useCreators } from "./sheet-chips";
import { describeAccess, describeListStatus, sheetFileText, shortAgo, type ListGoogleStatus } from "./sheet-list-model";
import { useSheetsAccessList, useSheetsGoogleStatus } from "./use-sheets";

/** Resets a <button> so it can hold a row's layout without the browser's chrome. */
const BARE_BUTTON: CSSProperties = {
  appearance: "none",
  border: "none",
  margin: 0,
  padding: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

/** Wide enough that a card's property list breathes; min() keeps one column from overflowing a phone. */
export const CARD_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
  gap: 16,
};

/* ------------------------------------------------------------------ *
 * Grid or list — a per-viewer convenience, remembered in this browser
 * ------------------------------------------------------------------ */

export type SheetsViewMode = "grid" | "list";

const VIEW_KEY = "cubes.sheets.view";
// What this tab chose, for when storage refuses the write (a private window):
// the toggle still works for the visit, it just isn't remembered.
let chosenView: SheetsViewMode | null = null;
const viewListeners = new Set<() => void>();

function readView(): SheetsViewMode {
  if (chosenView) return chosenView;
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function subscribeView(onChange: () => void) {
  viewListeners.add(onChange);
  return () => {
    viewListeners.delete(onChange);
  };
}

/**
 * Read through useSyncExternalStore so the server render (and hydration) is
 * always "grid" and the stored choice applies right after, without a
 * hydration mismatch and without a setState-in-effect.
 */
export function useSheetsViewMode(): [SheetsViewMode, (next: SheetsViewMode) => void] {
  const view = useSyncExternalStore(subscribeView, readView, () => "grid" as const);
  const setView = useCallback((next: SheetsViewMode) => {
    chosenView = next;
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage is unavailable or full; the in-memory choice above still holds.
    }
    for (const l of viewListeners) l();
  }, []);
  return [view, setView];
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

export interface SheetsCreateEntry {
  /** createBlocked from the workspace: the gate, unchanged. */
  blocked: boolean;
  blockedWhy: string | undefined;
  shortcuts: CreateShortcut[];
  /** null opens the wizard on its template gallery; a key opens it on that template. */
  onNew: (templateKey: string | null) => void;
}

/** The list's first row: the same gate and the same wizard as the create card. */
function CreateRow({ create }: { create: SheetsCreateEntry }) {
  const C = useC();
  const { blocked, blockedWhy } = create;
  const row = (
    <div className="sheets-trow sheets-trow-body sheets-trow-create" style={{ borderTop: `1px solid ${C.hair}` }}>
      <button
        type="button"
        disabled={blocked}
        onClick={() => create.onNew(null)}
        aria-label={blocked && blockedWhy ? `New sheet — ${blockedWhy}` : "New sheet — from a template or your own columns"}
        style={{
          ...BARE_BUTTON,
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          minWidth: 0,
          minHeight: 52,
          padding: "8px 14px",
          cursor: blocked ? "not-allowed" : "pointer",
          opacity: blocked ? 0.6 : 1,
        }}
      >
        <span
          className="sheets-create-plus"
          style={{
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1.5px dashed ${blocked ? C.hair : `color-mix(in srgb, ${C.accent} 45%, transparent)`}`,
            color: blocked ? C.textTertiary : C.accent,
          }}
        >
          <MIcon name={blocked ? "lock" : "add"} size={blocked ? 16 : 18} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: blocked ? C.textSecondary : C.accent, flex: "none" }}>New sheet</span>
        <span className="sheets-create-row-hint" style={{ ...ELLIPSIS, fontSize: 12.5, color: C.textTertiary, minWidth: 0 }}>
          From a template or your own columns
        </span>
      </button>
    </div>
  );
  return blocked && blockedWhy ? <Tooltip title={blockedWhy}>{row}</Tooltip> : row;
}

function SheetsTable({
  sheets,
  statusOf,
  hrefOf,
  projectOf,
  create,
  onOpen,
}: {
  sheets: SheetRecordRow[];
  statusOf: (s: SheetRecordRow) => ListGoogleStatus | null;
  hrefOf: (s: SheetRecordRow) => string | null;
  projectOf: ((id: string | null) => { name: string; color: string | null }) | null;
  create: SheetsCreateEntry | null;
  onOpen: (id: string) => void;
}) {
  const C = useC();
  const withProject = projectOf !== null;
  const grid = `sheets-tgrid${withProject ? " with-project" : ""}`;
  const headCell: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: C.textTertiary };
  return (
    <div className="sheets-table" style={{ border: `1px solid ${C.hair}`, borderRadius: 14, background: C.panel, overflow: "hidden" }}>
      <div className="sheets-trow" style={{ background: frameSurface(C) }}>
        <div className={grid} style={{ padding: "9px 0 9px 14px" }}>
          <span style={headCell}>Name</span>
          <span className="sheets-tc-source" style={headCell}>Source</span>
          <span style={headCell}>Google</span>
          <span className="sheets-tc-cols" style={{ ...headCell, textAlign: "right" }}>Cols</span>
          <span className="sheets-tc-updated" style={headCell}>Updated</span>
          {withProject ? <span className="sheets-tc-project" style={headCell}>Project</span> : null}
        </div>
        <span />
      </div>
      {create ? <CreateRow create={create} /> : null}
      {sheets.map((s) => {
        const status = statusOf(s);
        const href = hrefOf(s);
        const project = projectOf ? projectOf(s.project_id) : null;
        return (
          <div key={s.id} className="sheets-trow sheets-trow-body" data-sheet-id={s.id} style={{ borderTop: `1px solid ${C.hair}` }}>
            <button
              type="button"
              className={grid}
              onClick={() => onOpen(s.id)}
              style={{ ...BARE_BUTTON, width: "100%", minHeight: 52, padding: "8px 0 8px 14px" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <SourceTile source={s.source} size={26} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span title={s.name} style={{ ...ELLIPSIS, fontSize: 13.5, fontWeight: 600, color: C.text }}>
                    {s.name}
                  </span>
                  {s.description ? (
                    <span title={s.description} style={{ ...ELLIPSIS, fontSize: 11.5, color: C.textTertiary }}>
                      {s.description}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="sheets-tc-source" style={{ display: "flex", minWidth: 0 }}>
                <SourceChip source={s.source} />
              </span>
              <span style={{ display: "flex", minWidth: 0 }}>{status ? <GoogleStatusChip status={status} /> : null}</span>
              <span className="sheets-tc-cols" style={{ fontFamily: MONO_FONT, fontSize: 12, color: C.textSecondary, textAlign: "right" }}>
                {s.columns.filter((c) => !c.hidden).length}
              </span>
              <Tooltip title={`Updated ${dayjs(s.updated_at).format("D MMM YYYY, HH:mm")}`}>
                <span className="sheets-tc-updated" style={{ fontFamily: MONO_FONT, fontSize: 12, color: C.textSecondary, whiteSpace: "nowrap" }}>
                  {shortAgo(s.updated_at)}
                </span>
              </Tooltip>
              {withProject ? (
                <span className="sheets-tc-project" style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, fontSize: 12.5, color: C.textSecondary }}>
                  {project?.color ? <span style={{ width: 8, height: 8, flex: "none", borderRadius: 999, background: project.color }} /> : null}
                  <span style={ELLIPSIS}>{project?.name ?? "Workspace"}</span>
                </span>
              ) : null}
            </button>
            <span style={{ display: "flex", justifyContent: "center" }}>{href ? <OpenInGoogle href={href} name={s.name} /> : null}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The collection — where the one status read happens
 * ------------------------------------------------------------------ */

/**
 * Whether this viewer may be handed the Google file at all.
 *  allowed  a full member
 *  hidden   a limited member: Drive shares whole files, so they are never
 *           granted the spreadsheet and the link would land them on Google's
 *           access wall — the card leaves the row out entirely
 *  unknown  the access probe hasn't answered: no link on a guess
 *  failed   the access probe failed: the notice above says so; the card says
 *           "Unavailable" rather than wait forever
 */
export type SheetsGoogleAccess = "allowed" | "hidden" | "unknown" | "failed";

export function SheetsCollection({
  sheets,
  view,
  onOpen,
  projectOf,
  googleAccess,
  create,
}: {
  sheets: SheetRecordRow[];
  view: SheetsViewMode;
  onOpen: (id: string) => void;
  /** App mode names each sheet's project; a project tab passes null (the tab already says it). */
  projectOf: ((id: string | null) => { name: string; color: string | null }) | null;
  googleAccess: SheetsGoogleAccess;
  /** The create card / row; null hides it (while searching). */
  create: SheetsCreateEntry | null;
}) {
  // Mounted only while the list is on screen, so coming back from a sheet
  // re-reads the team's Google state (the hook's staleTime is 0).
  const statusQuery = useSheetsGoogleStatus();
  const data = statusQuery.data;
  const statusFailed = !data && statusQuery.isError;
  const live = useMemo(() => new Set(data?.live ?? []), [data]);
  const creators = useCreators();
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  // Asked only for a full member: a limited one never holds the file, and the
  // function answers them nothing anyway.
  const accessQuery = useSheetsAccessList(googleAccess === "allowed");

  const statusOf = (s: SheetRecordRow): ListGoogleStatus | null =>
    data ? describeListStatus(data.links[s.id], live.has(s.id)) : null;
  const hrefOf = (s: SheetRecordRow): string | null => {
    if (googleAccess !== "allowed" || !data) return null;
    const link = data.links[s.id];
    return link && link.provision_status === "ready" ? spreadsheetHref(link) : null;
  };
  const fileOf = (s: SheetRecordRow): CardGoogleFile => {
    if (googleAccess === "hidden") return { kind: "hidden" };
    if (googleAccess === "failed") return { kind: "text", text: "Unavailable" };
    if (!data || googleAccess === "unknown") return { kind: "loading" };
    const row = data.links[s.id];
    const text = sheetFileText(row);
    if (text) return { kind: "text", text };
    const href = row ? spreadsheetHref(row) : null;
    return href ? { kind: "link", href } : { kind: "text", text: "Link unavailable" };
  };
  const accessOf = (s: SheetRecordRow): CardAccess => {
    if (googleAccess === "hidden") return { kind: "limited" };
    if (googleAccess === "failed" || statusFailed) return { kind: "unavailable" };
    if (!data || googleAccess === "unknown") return { kind: "loading" };
    const row = data.links[s.id];
    // No file yet: nobody has it, whatever the people list says.
    if (!row || row.provision_status !== "ready") return { kind: "view", view: describeAccess(row, null, viewerId) };
    if (accessQuery.isPending) return { kind: "loading" };
    // A failed read, or a database without the function, falls back to the
    // share pass's own counts (entries null) — never to "everyone".
    const bySheet = accessQuery.data?.bySheet ?? null;
    return { kind: "view", view: describeAccess(row, bySheet ? (bySheet[s.id] ?? []) : null, viewerId) };
  };

  if (view === "list") {
    return <SheetsTable sheets={sheets} statusOf={statusOf} hrefOf={hrefOf} projectOf={projectOf} create={create} onOpen={onOpen} />;
  }
  return (
    <div style={CARD_GRID}>
      {create ? <CreateSheetCard blocked={create.blocked} blockedWhy={create.blockedWhy} shortcuts={create.shortcuts} onNew={create.onNew} /> : null}
      {sheets.map((s) => (
        <SheetCard
          key={s.id}
          sheet={s}
          status={statusOf(s)}
          statusFailed={statusFailed}
          file={fileOf(s)}
          access={accessOf(s)}
          viewerId={viewerId}
          project={projectOf ? projectOf(s.project_id) : undefined}
          creators={creators}
          onOpen={() => onOpen(s.id)}
        />
      ))}
    </div>
  );
}

/** Card-shaped placeholders while the sheet list loads: the frame, the inset panel, the footer. */
export function SheetsGridSkeleton({ count = 3 }: { count?: number }) {
  const C = useC();
  const bar = (width: number | string, height = 10): CSSProperties => ({
    display: "block",
    width,
    height,
    borderRadius: 999,
    background: `color-mix(in srgb, ${C.text} 7%, transparent)`,
  });
  return (
    <div style={CARD_GRID} aria-busy="true" aria-label="Loading sheets">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sheets-skel" style={{ border: `1px solid ${C.hair}`, borderRadius: 16, background: frameSurface(C), overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 11px 12px" }}>
            <span style={{ ...bar(24, 24), borderRadius: 7 }} />
            <span style={bar("46%", 12)} />
            <span style={{ ...bar(20, 20), marginLeft: "auto" }} />
          </div>
          <div style={{ margin: "0 3px", padding: "12px 12px", background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 13, display: "grid", gap: 16 }}>
            {[62, 88, 54, 96].map((w, r) => (
              <div key={r} style={{ display: "grid", gridTemplateColumns: "96px 1fr", alignItems: "center", gap: 8 }}>
                <span style={bar(58, 9)} />
                <span style={bar(w, 12)} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 14px 13px" }}>
            <span style={bar(30, 9)} />
            <span style={{ ...bar(34, 9), marginLeft: "auto" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The list's focus and responsive rules — the parts inline styles cannot
 * express. Rendered once by the workspace.
 *
 * NO CARD HOVERS. A card (a sheet, the "New sheet" card, a template starter)
 * looks exactly the same under the mouse as away from it: no lift, no border
 * or glow change, no tile turning colour. The cursor says it is clickable and
 * a keyboard user gets a focus ring. Only the small links INSIDE a card (the
 * Google link chip, the template chips) and the list's rows keep a quiet
 * colour change, so they still read as the separate targets they are.
 */
export function SheetsListStyles() {
  const C = useC();
  return (
    <style>{`
.sheets-card { position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: 16px; cursor: pointer;
  container: sheets-card / inline-size;
  box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 10px 22px -18px rgba(16,24,40,.22); }
.sheets-card:is(button):focus-visible, .sheets-card:has(.sheets-card-title:focus-visible) {
  outline: 2px solid var(--sheet-accent); outline-offset: 2px; }
.sheets-card-title:focus-visible { outline: none; }
.sheets-prop { display: grid; grid-template-columns: 112px minmax(0, 1fr); align-items: center; column-gap: 8px; min-height: 32px; }
@container sheets-card (max-width: 300px) {
  .sheets-prop { grid-template-columns: 86px minmax(0, 1fr); }
  .sheets-prop-icon { display: none !important; } }
.sheets-link-chip { transition: border-color .14s ease, color .14s ease; }
.sheets-link-chip:hover, .sheets-link-chip:focus-visible { border-color: color-mix(in srgb, ${C.accent} 55%, transparent) !important; color: ${C.accent} !important; }
.sheets-link-chip:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 1px; }
.sheets-create { position: relative; display: flex; flex-direction: column; width: 100%; min-width: 0; min-height: 214px;
  border-radius: 16px; border: 1.5px dashed var(--sheets-create-line); background: transparent; }
.sheets-create.is-blocked { opacity: .62; }
.sheets-create:has(.sheets-create-hit:focus-visible) { outline: 2px solid ${C.accent}; outline-offset: 2px; }
.sheets-create-hit:focus-visible { outline: none; }
.sheets-create-chip { transition: border-color .14s ease, color .14s ease; }
.sheets-create-chip:not(:disabled):hover { border-color: color-mix(in srgb, ${C.accent} 55%, transparent) !important; color: ${C.accent} !important; }
.sheets-create-chip:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 1px; }
.sheets-status-btn { transition: border-color .14s ease; }
.sheets-status-btn:hover { border-color: color-mix(in srgb, ${C.accent} 55%, transparent) !important; }
.sheets-status-btn:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 1px; }
.sheets-create.is-blocked button, .sheets-trow-create > button:disabled { pointer-events: none; }
.sheets-skel span { animation: sheets-skel 1.3s ease-in-out infinite alternate; }
@keyframes sheets-skel { from { opacity: 1; } to { opacity: .45; } }
.sheets-dot-pulse { animation: sheets-pulse 1.8s ease-out infinite; }
@keyframes sheets-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sheets-dot) 60%, transparent); }
  70%, 100% { box-shadow: 0 0 0 5px transparent; } }
.sheets-table { container-type: inline-size; }
.sheets-trow { display: grid; grid-template-columns: minmax(0, 1fr) 44px; align-items: center; }
.sheets-trow-body:hover { background: ${C.panelSoft}; }
.sheets-trow-body > button:focus-visible { outline: 2px solid ${C.accent}; outline-offset: -2px; }
.sheets-tgrid { display: grid; align-items: center; column-gap: 14px;
  grid-template-columns: minmax(0, 2.6fr) minmax(0, 1.4fr) minmax(0, 1.3fr) 44px 72px; }
.sheets-tgrid.with-project { grid-template-columns: minmax(0, 2.4fr) minmax(0, 1.35fr) minmax(0, 1.25fr) 44px 72px minmax(0, 1fr); }
@container (max-width: 860px) {
  .sheets-tgrid, .sheets-tgrid.with-project { grid-template-columns: minmax(0, 2fr) minmax(0, 1.25fr) minmax(0, 1.2fr) 64px; }
  .sheets-tc-cols, .sheets-tc-project { display: none !important; } }
@container (max-width: 600px) {
  .sheets-tgrid, .sheets-tgrid.with-project { grid-template-columns: minmax(0, 1fr) auto 64px; }
  .sheets-tc-source { display: none !important; } }
@container (max-width: 440px) {
  .sheets-tgrid, .sheets-tgrid.with-project { grid-template-columns: minmax(0, 1fr) auto; }
  .sheets-tc-updated, .sheets-create-row-hint { display: none !important; }
  /* A phone-width list gives the name the room; the time stays in the tooltip. */
  .sheets-table .sheets-chip-at { display: none; } }
@media (prefers-reduced-motion: reduce) {
  .sheets-link-chip, .sheets-create-chip, .sheets-status-btn { transition: none; }
  .sheets-dot-pulse, .sheets-skel span { animation: none; } }
`}</style>
  );
}
