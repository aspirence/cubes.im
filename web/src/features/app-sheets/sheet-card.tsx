"use client";

/**
 * Sheets list — one sheet as a card, and the card that makes a new one.
 *
 * The card is built like a CRM pipeline card, in three layers: a soft tinted
 * FRAME that carries the sheet's identity (its source tile, its name, how
 * many columns, who made it) and a footer (what the columns are made of,
 * when it last changed); and, inset in the frame, a white PANEL with the
 * facts a person scans for — where the rows come from, the Google Sheet
 * itself, whether it is in sync, what is in it, and (in the app) which
 * project it belongs to.
 *
 * The whole frame opens the sheet on click. The keyboard gets a real button
 * — the sheet's name — rather than a <div> pretending to be one, and the link
 * to Google is its own link that stops its click on the way out, so opening
 * the spreadsheet never also opens the Cubes view.
 */

import type { CSSProperties, ReactNode } from "react";
import dayjs from "dayjs";
import { Tooltip, theme } from "antd";
import { SOURCES } from "@/lib/sheets/sources";
import { BUILT_IN_TEMPLATES } from "@/lib/sheets/templates";
import type { SheetRecordRow, SheetSource } from "@/lib/sheets/types";
import { MONO_FONT } from "@/lib/theme";
import { MIcon, useC } from "@/features/app-content-studio/ui";
import { sourceAvailability, type InstalledLike } from "./sheet-model";
import {
  ColumnPills,
  CreatorAvatar,
  ELLIPSIS,
  GoogleLinkChip,
  GoogleStatusChip,
  ProjectChip,
  SourceChip,
  SourceTile,
  STACK_OVERLAP,
  StackAvatar,
  accentFor,
  type CreatorInfo,
} from "./sheet-chips";
import { accessLine, accessTipLines, cardColumns, footerAgo, pickCreateShortcuts, type AccessView, type ListGoogleStatus } from "./sheet-list-model";

type Palette = ReturnType<typeof useC>;

/** The frame's surface: a step from the page toward the text colour — darker on light, lighter on dark. */
export function frameSurface(C: Palette): string {
  return `color-mix(in srgb, ${C.text} 2.6%, ${C.bg})`;
}

/** Resets a <button> so it can hold text without the browser's chrome. */
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

/** What the "Google Sheet" row shows. */
export type CardGoogleFile =
  | { kind: "link"; href: string }
  | { kind: "text"; text: string }
  /** The team's Google state has not answered yet: draw nothing rather than guess. */
  | { kind: "loading" }
  /** A limited member: Drive shares whole files, so they are never given it (see limited-grid.tsx). */
  | { kind: "hidden" };

/** What the "Access" row shows. */
export type CardAccess =
  | { kind: "view"; view: AccessView }
  /** The status or the people list is still on its way: draw nothing rather than guess. */
  | { kind: "loading" }
  /** The Google state could not be read at all. */
  | { kind: "unavailable" }
  /**
   * A limited member looking. Decision B: they are never given the file, so
   * the row says where the sheet opens for them — and nothing about who holds
   * the file or how to get it, because following that advice IS the leak.
   */
  | { kind: "limited" };

/* ------------------------------------------------------------------ *
 * Sheet card
 * ------------------------------------------------------------------ */

export function SheetCard({
  sheet,
  status,
  statusFailed,
  file,
  access,
  viewerId,
  project,
  creators,
  onOpen,
}: {
  sheet: SheetRecordRow;
  /** null while the team's Google status is still loading. */
  status: ListGoogleStatus | null;
  /** The status read failed: say so instead of loading forever. */
  statusFailed: boolean;
  file: CardGoogleFile;
  access: CardAccess;
  viewerId: string | null;
  /** App mode only — the project tab leaves the row out (it would repeat the tab). */
  project?: { name: string; color: string | null };
  creators: Map<string, CreatorInfo> | undefined;
  onOpen: () => void;
}) {
  const C = useC();
  const { token } = theme.useToken();
  const accent = accentFor(sheet.source, C);
  const src = SOURCES[sheet.source] ?? SOURCES.custom;
  const cols = cardColumns(sheet.columns);
  const count = cols.visible.length;
  const updated = footerAgo(sheet.updated_at);

  return (
    <div
      className="sheets-card"
      data-sheet-id={sheet.id}
      // Mouse convenience for the whole frame; the name below is the real,
      // focusable control, and its click bubbles here like any other.
      onClick={onOpen}
      style={{ "--sheet-accent": accent, background: frameSurface(C), border: `1px solid ${C.hair}` } as CSSProperties}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "11px 14px 10px 12px" }}>
        <SourceTile source={sheet.source} size={24} />
        <button
          type="button"
          className="sheets-card-title"
          title={sheet.description ? `${sheet.name}\n${sheet.description}` : sheet.name}
          style={{ ...BARE_BUTTON, ...ELLIPSIS, flex: "1 1 auto", minWidth: 0, fontSize: 14, fontWeight: 600, color: C.text, letterSpacing: -0.1 }}
        >
          {sheet.name}
        </button>
        <Tooltip title={`${count} column${count === 1 ? "" : "s"}${cols.hidden ? `, ${cols.hidden} hidden` : ""}`}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              flex: "none",
              fontFamily: MONO_FONT,
              fontSize: 12,
              color: C.textTertiary,
            }}
          >
            <MIcon name="view_week" size={14} />
            {count}
          </span>
        </Tooltip>
        {sheet.created_by ? (
          <>
            <span aria-hidden style={{ width: 1, height: 14, flex: "none", background: C.hair }} />
            <CreatorAvatar userId={sheet.created_by} creators={creators} size={20} />
          </>
        ) : null}
      </div>

      <div
        className="sheets-card-panel"
        style={{
          // Grows when a taller card shares the row, so every footer lines up.
          flex: "1 1 auto",
          margin: "0 3px",
          padding: "6px 12px",
          // Elevated, not plain panel: white on light, and on dark a step
          // LIGHTER than the frame, so the panel still reads as lifted out of it.
          background: token.colorBgElevated,
          border: `1px solid ${C.hair}`,
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 2px 8px -4px rgba(16,24,40,0.06)",
        }}
      >
        <dl className="sheets-props" style={{ margin: 0 }}>
          <Prop icon="database" label="Source">
            <SourceChip source={sheet.source} />
          </Prop>
          {file.kind === "hidden" ? null : (
            <Prop icon="cloud" label="Google Sheet">
              {file.kind === "link" ? (
                <GoogleLinkChip href={file.href} name={sheet.name} />
              ) : file.kind === "text" ? (
                <span style={{ ...ELLIPSIS, fontSize: 12.5, color: C.textTertiary }}>{file.text}</span>
              ) : statusFailed ? (
                <Unavailable C={C} />
              ) : (
                <Placeholder C={C} width={112} />
              )}
            </Prop>
          )}
          <Prop icon="group" label="Access" tall={access.kind === "view" && accessLine(access.view).suffix !== null}>
            {access.kind === "view" ? (
              <AccessSummary view={access.view} people={creators} viewerId={viewerId} ring={token.colorBgElevated} />
            ) : access.kind === "limited" ? (
              <LimitedAccess C={C} />
            ) : access.kind === "unavailable" ? (
              <Unavailable C={C} />
            ) : (
              <Placeholder C={C} width={96} />
            )}
          </Prop>
          <Prop icon="sync" label="Sync">
            {status ? <GoogleStatusChip status={status} /> : statusFailed ? <Unavailable C={C} /> : <Placeholder C={C} width={78} />}
          </Prop>
          <Prop icon="view_week" label="Columns">
            <ColumnPills cols={cols} />
          </Prop>
          {project ? (
            <Prop icon="folder_open" label="Project">
              <ProjectChip name={project.name} color={project.color} />
            </Prop>
          ) : null}
        </dl>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, padding: "9px 14px 10px" }}>
        {cols.bound > 0 ? (
          <Stat
            icon="link"
            value={cols.bound}
            tip={`${cols.bound} column${cols.bound === 1 ? "" : "s"} kept in step with ${src.label.toLowerCase()}`}
          />
        ) : null}
        {cols.own > 0 ? (
          <Stat
            icon="edit_note"
            value={cols.own}
            tip={
              sheet.source === "custom"
                ? `${cols.own} column${cols.own === 1 ? "" : "s"} of this sheet's own rows`
                : `${cols.own} column${cols.own === 1 ? "" : "s"} of this sheet's own, beside the ${src.label.toLowerCase()}`
            }
          />
        ) : null}
        {updated ? (
          <Tooltip title={`Updated ${dayjs(sheet.updated_at).format("D MMM YYYY, HH:mm")}`}>
            <span
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                flex: "none",
                fontFamily: MONO_FONT,
                fontSize: 12,
                color: C.textTertiary,
                whiteSpace: "nowrap",
              }}
            >
              <MIcon name="schedule" size={15} />
              {updated}
            </span>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/** One line of the property list: a glyph and a grey label on the left, the value on the right. */
function Prop({ icon, label, children, tall = false }: { icon: string; label: string; children: ReactNode; tall?: boolean }) {
  const C = useC();
  return (
    // A two-line value keeps its label on its FIRST line rather than centred
    // between the two.
    <div className="sheets-prop" style={tall ? { alignItems: "start", padding: "4px 0" } : undefined}>
      <dt style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, color: C.textSecondary, fontSize: 12.5, marginTop: tall ? 3 : 0 }}>
        <span className="sheets-prop-icon" style={{ display: "inline-flex", flex: "none", color: C.textTertiary }}>
          <MIcon name={icon} size={16} />
        </span>
        <span style={ELLIPSIS}>{label}</span>
      </dt>
      <dd style={{ margin: 0, display: "flex", alignItems: "center", minWidth: 0 }}>{children}</dd>
    </div>
  );
}

function Stat({ icon, value, tip }: { icon: string; value: number; tip: string }) {
  const C = useC();
  return (
    <Tooltip title={tip}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none", color: C.textTertiary }}>
        <MIcon name={icon} size={15} />
        <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: C.textSecondary }}>{value}</span>
      </span>
    </Tooltip>
  );
}

function Placeholder({ C, width }: { C: Palette; width: number }) {
  return <span aria-hidden style={{ display: "block", width, maxWidth: "100%", height: 10, borderRadius: 999, background: C.panelSoft }} />;
}

function Unavailable({ C }: { C: Palette }) {
  return (
    <Tooltip title="Cubes couldn't read the Google state just now. It is read again when you come back to this list.">
      <span style={{ fontSize: 12.5, color: C.textTertiary }}>Unavailable</span>
    </Tooltip>
  );
}

/**
 * A limited member's Access line. True and calm: where the sheet opens for
 * them. No "ask someone to share it" — the file holds every row, and handing
 * it over is exactly the widening their limit exists to prevent.
 */
function LimitedAccess({ C }: { C: Palette }) {
  return (
    <Tooltip title="A Google Sheet can only be shared whole, so this sheet opens for you as its own grid here in Cubes, showing what your access covers.">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: 12.5, color: C.textSecondary }}>
        <MIcon name="grid_on" size={15} color={C.textTertiary} />
        <span style={ELLIPSIS}>Opens here in Cubes</span>
      </span>
    </Tooltip>
  );
}

/** At most this many faces; the rest are "+N". */
const STACK_MAX = 4;

/**
 * Who can open the Google Sheet: up to four faces (the viewer first, ringed
 * in indigo when they are one of them), then "+N", then what that means for
 * the person looking; under it, only when someone is missing, a quiet
 * "N without access". The tooltip names everyone and says why anyone is missing.
 *
 * Every face is someone describeAccess() says HAS the file — ownership, or
 * the last share pass's record of what Drive did — never someone who merely
 * belongs to the team. The tooltip's words come from accessTipLines() so a
 * node suite can hold them to the same record.
 */
function AccessSummary({
  view,
  people,
  viewerId,
  ring,
}: {
  view: AccessView;
  people: Map<string, CreatorInfo> | undefined;
  viewerId: string | null;
  /** The panel colour behind the stack, for the rings that part the faces. */
  ring: string;
}) {
  const C = useC();
  const { text, suffix } = accessLine(view);
  const shown = view.people.slice(0, STACK_MAX);
  const extra = view.people.length - shown.length;
  const plainName = (id: string) => (id === viewerId ? "You" : (people?.get(id)?.name ?? "A member"));
  const quiet = view.state === "not-shared" || (view.state === "shared" && view.total === 0);
  const textColor = quiet ? C.textTertiary : view.viewer === "in" ? C.text : C.textSecondary;
  const lines = accessTipLines(view, plainName);

  const tip = (
    <div style={{ maxWidth: 300, display: "grid", gap: 4 }}>
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {view.sharedAt ? <div style={{ opacity: 0.72 }}>Last shared {dayjs(view.sharedAt).format("D MMM YYYY, HH:mm")}</div> : null}
    </div>
  );

  const faces = shown.length ? (
    <span aria-hidden style={{ display: "inline-flex", alignItems: "center", flex: "none", padding: "2px 0 2px 2px" }}>
      {shown.map((id, i) => (
        <StackAvatar
          key={id}
          userId={id}
          people={people}
          ring={ring}
          first={i === 0}
          z={shown.length - i + 1}
          mark={id === viewerId && view.viewer === "in"}
        />
      ))}
      {extra > 0 ? (
        <span
          style={{
            marginLeft: -STACK_OVERLAP,
            position: "relative",
            zIndex: 1,
            height: 20,
            minWidth: 20,
            padding: "0 5px",
            boxSizing: "border-box",
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            // Solid, not a tint: it tucks under the last face.
            background: `color-mix(in srgb, ${C.text} 8%, ${ring})`,
            boxShadow: `0 0 0 1.5px ${ring}`,
            fontFamily: MONO_FONT,
            fontSize: 10.5,
            fontWeight: 600,
            color: C.textSecondary,
          }}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  ) : null;

  // Two lines at most: who, then — only when someone is missing — how many
  // are without it. A card's value column is ~195px: too narrow for faces,
  // the viewer's standing and that count on one line without cutting the
  // words that matter.
  return (
    <Tooltip title={tip}>
      <span className="sheets-access" style={{ display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {faces}
          <span style={{ ...ELLIPSIS, flex: "0 1 auto", minWidth: 0, fontSize: 12.5, fontWeight: view.viewer === "in" ? 600 : 500, color: textColor }}>
            {text}
          </span>
        </span>
        {suffix ? (
          <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, marginTop: 1, fontSize: 11.5, color: C.textTertiary }}>
            <MIcon name="person_off" size={13} />
            <span style={ELLIPSIS}>{suffix}</span>
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ *
 * The card that makes a new sheet
 * ------------------------------------------------------------------ */

/** The templates the create card offers first, then what to offer where those can't be used. */
const PREFERRED_SHORTCUTS = ["content_calendar", "task_tracker", "content_ideas"];
const FALLBACK_SHORTCUTS = ["ad_campaign_plan", "client_report"];

/** Chip-sized names: the full template names wrap a 300px card into three lines. */
const SHORT_NAMES: Record<string, string> = {
  content_calendar: "Content calendar",
  task_tracker: "Task tracker",
  content_ideas: "Ideas backlog",
  ad_campaign_plan: "Campaign plan",
  client_report: "Client report",
};

export interface CreateShortcut {
  key: string;
  label: string;
  icon: string;
  source: SheetSource;
}

/** The three one-click templates for this scope — only ones that can actually be made here. */
export function createShortcuts(projectId: string | null, installed: InstalledLike[] | undefined): CreateShortcut[] {
  const byKey = new Map(BUILT_IN_TEMPLATES.map((t) => [t.key, t]));
  const keys = pickCreateShortcuts(PREFERRED_SHORTCUTS, FALLBACK_SHORTCUTS, (key) => {
    const t = byKey.get(key);
    return Boolean(t) && sourceAvailability(t!.source, projectId, installed).ok;
  });
  return keys.map((key) => {
    const t = byKey.get(key)!;
    return { key, label: SHORT_NAMES[key] ?? t.name, icon: t.icon, source: t.source };
  });
}

/**
 * The first card of the grid. The same frame as a sheet, drawn as a ghost,
 * so it reads as "a sheet that isn't there yet" — and it is the SAME gate as
 * the New sheet button: when creating is blocked, the card and every chip on
 * it are disabled and hovering it says why. It is never a way round Google.
 *
 * The card's own button covers the whole frame (so the whole card is one
 * target); the template chips sit above it as buttons of their own, because
 * a button inside a button is invalid and unreachable by keyboard.
 */
export function CreateSheetCard({
  blocked,
  blockedWhy,
  shortcuts,
  onNew,
}: {
  blocked: boolean;
  blockedWhy: string | undefined;
  shortcuts: CreateShortcut[];
  onNew: (templateKey: string | null) => void;
}) {
  const C = useC();
  const card = (
    <div
      className={`sheets-create${blocked ? " is-blocked" : ""}`}
      style={{ "--sheet-accent": C.accent, "--sheets-create-line": `color-mix(in srgb, ${C.text} 20%, transparent)` } as CSSProperties}
    >
      <button
        type="button"
        className="sheets-create-hit"
        disabled={blocked}
        onClick={() => onNew(null)}
        aria-label={blocked && blockedWhy ? `New sheet — ${blockedWhy}` : "New sheet — from a template or your own columns"}
        style={{ ...BARE_BUTTON, position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: 16, cursor: blocked ? "not-allowed" : "pointer" }}
      />
      <div
        style={{
          position: "relative",
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 4,
          padding: "22px 18px",
          minHeight: "100%",
          boxSizing: "border-box",
        }}
      >
        <span
          className="sheets-create-plus"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            marginBottom: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: blocked ? C.panelSoft : C.accentSoft,
            color: blocked ? C.textTertiary : C.accent,
          }}
        >
          <MIcon name={blocked ? "lock" : "add"} size={blocked ? 20 : 24} />
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 650, color: blocked ? C.textSecondary : C.text }}>New sheet</span>
        <span style={{ fontSize: 12.5, color: C.textSecondary }}>From a template or your own columns</span>
        {shortcuts.length ? (
          <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 14, maxWidth: 300 }}>
            {shortcuts.map((s) => {
              const tint = accentFor(s.source, C);
              return (
                <button
                  key={s.key}
                  type="button"
                  className="sheets-create-chip"
                  disabled={blocked}
                  onClick={() => onNew(s.key)}
                  aria-label={`New sheet from the ${s.label} template`}
                  style={{
                    ...BARE_BUTTON,
                    pointerEvents: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 26,
                    padding: "0 10px 0 8px",
                    borderRadius: 999,
                    border: `1px solid color-mix(in srgb, ${C.text} 13%, transparent)`,
                    background: C.panel,
                    color: C.text,
                    fontSize: 12,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    cursor: blocked ? "not-allowed" : "pointer",
                  }}
                >
                  <MIcon name={s.icon} size={15} color={blocked ? C.textTertiary : tint} />
                  {s.label}
                </button>
              );
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
  // A disabled button swallows the hover a tooltip needs, so the reason hangs
  // on a wrapper around the whole card.
  return blocked && blockedWhy ? (
    <Tooltip title={blockedWhy}>
      <div style={{ display: "flex", minWidth: 0 }}>{card}</div>
    </Tooltip>
  ) : (
    card
  );
}
