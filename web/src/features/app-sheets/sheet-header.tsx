"use client";

/**
 * Sheets — the open sheet's header: back, the source tile, the name (renamed
 * in place), what the sheet is (source and project chips, the description on
 * its own line), and on the right the Google state and the sheet's actions.
 *
 * It wears the same pieces as the sheet's card in the list (sheet-chips.tsx),
 * so opening a sheet feels like the card grew rather than like a new page.
 *
 * The actions themselves (Columns, the ••• menu and who may see which) are
 * passed in by SheetView, which owns their behaviour; this file only lays
 * them out.
 */

import { useRef, useState, type ReactNode } from "react";
import { Button, Input, Tooltip } from "antd";
import { spreadsheetHref } from "@/lib/sheets/google-embed";
import type { GoogleLinkRow, SheetRecordRow } from "@/lib/sheets/types";
import { MIcon, useC } from "@/features/app-content-studio/ui";
import { useProjects } from "@/features/projects/use-projects";
import { GoogleStatusChip, ProjectChip, SourceChip, SourceTile } from "./sheet-chips";
import { describeListStatus, isChannelLive, type ListGoogleStatus } from "./sheet-list-model";
import { useSheetLiveChannel } from "./use-sheets";

/** Shown in the Google pill until the sheet's link has been read — a label, not a claim. */
const CHECKING: ListGoogleStatus = {
  kind: "not-linked",
  tone: "none",
  label: "Google Sheets",
  at: null,
  hint: "Checking this sheet's Google Sheet…",
};

export function SheetHeader({
  sheet,
  projectName,
  onBack,
  onRename,
  actions,
}: {
  sheet: SheetRecordRow;
  projectName: string | null;
  onBack: () => void;
  /** SheetView's rename: trims, ignores an empty or unchanged name, caps at 120. */
  onRename: (name: string) => void;
  actions: ReactNode;
}) {
  const C = useC();
  const { data: projects } = useProjects();
  const projectColor = sheet.project_id ? (projects?.find((p) => p.id === sheet.project_id)?.color_code ?? "#8a8d98") : null;

  return (
    <div className="sheet-head" style={{ display: "flex", alignItems: "flex-start", gap: "10px 16px", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0, flex: "1 1 340px" }}>
        <Tooltip title="All sheets">
          <Button type="text" onClick={onBack} icon={<MIcon name="arrow_back" size={18} />} aria-label="Back to all sheets" style={{ marginTop: 3, flex: "none" }} />
        </Tooltip>
        <span style={{ marginTop: 1, display: "inline-flex", flex: "none" }}>
          <SourceTile source={sheet.source} size={36} />
        </span>
        <div style={{ minWidth: 0, flex: "1 1 auto", display: "grid", gap: 5 }}>
          <InlineTitle name={sheet.name} onRename={onRename} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            <SourceChip source={sheet.source} />
            <ProjectChip name={projectName ?? "Workspace"} color={sheet.project_id ? projectColor : null} height={22} />
          </div>
          {sheet.description ? (
            <div
              title={sheet.description}
              style={{
                fontSize: 12.5,
                lineHeight: 1.5,
                color: C.textSecondary,
                maxWidth: 720,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {sheet.description}
            </div>
          ) : null}
        </div>
      </div>
      <div className="sheet-head-actions" style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {actions}
      </div>
      <style>{`
.sheet-title-btn { appearance: none; border: none; margin: 0 0 0 -6px; padding: 1px 6px; background: transparent; color: inherit;
  font: inherit; text-align: left; cursor: text; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;
  max-width: calc(100% + 6px); min-width: 0; justify-self: start; }
.sheet-title-btn:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 1px; }
.sheet-title-pencil { display: inline-flex; flex: none; color: ${C.textTertiary}; opacity: 0; transition: opacity .14s ease; }
.sheet-title-btn:hover .sheet-title-pencil, .sheet-title-btn:focus-visible .sheet-title-pencil { opacity: 1; }
@media (hover: none) { .sheet-title-pencil { opacity: .7; } }
@media (max-width: 640px) { .sheet-head-actions { margin-left: 0 !important; } }
@media (prefers-reduced-motion: reduce) { .sheet-title-pencil { transition: none; } }
`}</style>
    </div>
  );
}

/**
 * The name, renamed in place. At rest it is plain text in a button — the
 * pencil only appears on hover or keyboard focus, and there is no box. Click
 * (or Enter on it) turns it into an input: Enter or leaving the field saves,
 * Escape puts the old name back.
 */
function InlineTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const C = useC();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Enter and Escape unmount the input, which can fire a blur on the way out;
  // this makes sure one edit is saved (or cancelled) exactly once.
  const settled = useRef(false);

  const begin = () => {
    setDraft(name);
    settled.current = false;
    setEditing(true);
  };
  const finish = (save: boolean, refocus: boolean) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    if (save) onRename(draft);
    // Back on the name for a keyboard user; a click elsewhere keeps its own focus.
    if (refocus) requestAnimationFrame(() => buttonRef.current?.focus());
  };

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        maxLength={120}
        aria-label="Sheet name"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onPressEnter={(e) => {
          // A composing IME uses Enter to pick a word, not to submit.
          if (e.nativeEvent.isComposing) return;
          finish(true, true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false, true);
          }
        }}
        onBlur={() => finish(true, false)}
        style={{ fontSize: 17, fontWeight: 700, height: 30, padding: "0 7px", marginLeft: -8, maxWidth: 560, width: "calc(100% + 8px)" }}
      />
    );
  }
  return (
    <h2 style={{ margin: 0, minWidth: 0, display: "flex", fontSize: 17, fontWeight: 700, lineHeight: "28px", color: C.text, letterSpacing: -0.15 }}>
      <button ref={buttonRef} type="button" className="sheet-title-btn" onClick={begin} aria-label={`${name} — rename`} title={name}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{name}</span>
        <span className="sheet-title-pencil">
          <MIcon name="edit" size={16} />
        </span>
      </button>
    </h2>
  );
}

/**
 * The Google state as a pill that opens the Google panel (what the old
 * "Google Sheets" button did), and beside it, once there is a spreadsheet
 * this person may be given, a plain "Open in Google Sheets" icon button.
 *
 * "Live" is decided exactly as the list decides it (isChannelLive), so a
 * sheet never says Live on its card and Synced in its header.
 */
export function HeaderGoogleControls({
  sheetId,
  link,
  loading,
  canOpenFile,
  onOpenPanel,
}: {
  sheetId: string;
  link: GoogleLinkRow | null;
  loading: boolean;
  /** False until the access probe says this is a full member (Decision B). */
  canOpenFile: boolean;
  onOpenPanel: () => void;
}) {
  const ready = Boolean(link && link.provision_status === "ready");
  const channel = useSheetLiveChannel(sheetId, ready);
  const status = loading ? CHECKING : describeListStatus(link ?? undefined, isChannelLive(channel.data));
  const href = ready && link && canOpenFile ? spreadsheetHref(link) : null;
  return (
    <>
      <GoogleStatusChip size="md" status={status} onClick={onOpenPanel} />
      {href ? (
        <Tooltip title="Open in Google Sheets">
          <Button href={href} target="_blank" rel="noopener noreferrer" aria-label="Open in Google Sheets" icon={<MIcon name="open_in_new" size={16} />} />
        </Tooltip>
      ) : null}
    </>
  );
}
