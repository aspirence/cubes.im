"use client";

/**
 * Sheets list — the empty state, as the templates themselves.
 *
 * A scope with no sheets shows real starting points instead of a grey "no
 * data" picture: each card draws the same mini spreadsheet a sheet made from
 * it will have, and one click opens the wizard on that template. Like every
 * card in Sheets it has no hover state (see SheetsListStyles): the cursor and
 * a keyboard focus ring are its only affordances.
 *
 * It is not a way around the gate. When the workspace cannot create a sheet
 * (no Google account, a limited member, a check that failed) every card is
 * disabled and says the same reason the New sheet button does; and a template
 * whose source is not available in this scope says why instead of opening a
 * wizard step that cannot be finished.
 */

import type { CSSProperties } from "react";
import { Button, Tooltip } from "antd";
import { BUILT_IN_TEMPLATES } from "@/lib/sheets/templates";
import type { SheetTemplate } from "@/lib/sheets/types";
import { MIcon, useC } from "@/features/app-content-studio/ui";
import { sourceAvailability, type InstalledLike } from "./sheet-model";
import { MiniSheet } from "./sheet-preview";
import { SourceChip, accentFor } from "./sheet-chips";

/** The starters, in the order they are offered. "blank" first: it is the one everybody understands. */
const STARTER_KEYS = ["blank", "content_calendar", "content_ideas", "task_tracker"];

const BLANK_BLURB = "Three columns to start. Name them, add your own, and build it up from there.";

export function SheetStarters({
  projectId,
  installed,
  blocked,
  blockedWhy,
  onPick,
  onBrowse,
}: {
  /** The scope a new sheet lands in — decides which sources are available. */
  projectId: string | null;
  installed: InstalledLike[] | undefined;
  /** createBlocked from the workspace: the gate, unchanged. */
  blocked: boolean;
  blockedWhy: string | undefined;
  onPick: (templateKey: string) => void;
  onBrowse: () => void;
}) {
  const C = useC();
  const starters = STARTER_KEYS.map((key) => BUILT_IN_TEMPLATES.find((t) => t.key === key))
    .filter((t): t is SheetTemplate => Boolean(t))
    .map((t) => ({ t, availability: sourceAvailability(t.source, projectId, installed) }));
  // Usable ones first; a template that needs an app keeps its place at the end.
  const ordered = [...starters.filter((s) => s.availability.ok), ...starters.filter((s) => !s.availability.ok)];

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.hair}`, borderRadius: 18, padding: "20px 20px 22px", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>No sheets here yet</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 3, maxWidth: 620 }}>
            Pick a starting point. Each one becomes a Google Sheet your team can edit here or in Google Sheets.
          </div>
        </div>
        <Tooltip title={blockedWhy}>
          <Button onClick={onBrowse} disabled={blocked} icon={<MIcon name="apps" size={16} />}>
            All templates
          </Button>
        </Tooltip>
      </div>
      {blocked && blockedWhy ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 10,
            background: C.panelSoft,
            color: C.textSecondary,
            fontSize: 12.5,
          }}
        >
          <MIcon name="lock" size={16} color={C.textTertiary} />
          <span>{blockedWhy}</span>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 232px), 1fr))", gap: 12 }}>
        {ordered.map(({ t, availability }) => (
          <StarterCard
            key={t.key}
            template={t}
            // The gate's reason wins: it is true of every card at once.
            disabledWhy={blocked ? (blockedWhy ?? null) : availability.ok ? null : (availability.reason ?? "Not available here.")}
            disabled={blocked || !availability.ok}
            showReason={!blocked && !availability.ok}
            onPick={() => onPick(t.key)}
          />
        ))}
      </div>
    </div>
  );
}

function StarterCard({
  template,
  disabled,
  disabledWhy,
  showReason,
  onPick,
}: {
  template: SheetTemplate;
  disabled: boolean;
  disabledWhy: string | null;
  /** Print the reason on the card (per-card reasons); the shared gate reason is printed once above. */
  showReason: boolean;
  onPick: () => void;
}) {
  const C = useC();
  const accent = accentFor(template.source, C);
  const blank = template.key === "blank";
  const card = (
    <button
      type="button"
      className="sheets-card"
      disabled={disabled}
      onClick={onPick}
      aria-label={disabled && disabledWhy ? `${template.name} — ${disabledWhy}` : `Start a ${template.name}`}
      style={
        {
          "--sheet-accent": accent,
          appearance: "none",
          margin: 0,
          padding: 0,
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          border: `1px solid ${C.hair}`,
          background: C.panel,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        } as CSSProperties
      }
    >
      {/* Just the preview. The blank card used to float a big "+" over it,
          which read as a hover state; the title says what the card does. */}
      <span style={{ display: "block", width: "100%" }}>
        <MiniSheet columns={template.columns} seed={template.key} accent={accent} height={92} rows={4} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, width: "100%", minWidth: 0, boxSizing: "border-box", padding: "11px 13px 13px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <MIcon name={template.icon} size={16} color={accent} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {template.name}
          </span>
        </span>
        <span
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: C.textSecondary,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {blank ? BLANK_BLURB : template.description}
        </span>
        <span style={{ marginTop: "auto", paddingTop: 7, display: "flex", minWidth: 0 }}>
          {showReason && disabledWhy ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: C.textTertiary, minWidth: 0 }}>
              <MIcon name="info" size={14} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{disabledWhy}</span>
            </span>
          ) : (
            <SourceChip source={template.source} />
          )}
        </span>
      </span>
    </button>
  );
  // A disabled <button> swallows the hover a tooltip needs, so the reason
  // hangs on a wrapper instead.
  return disabled && disabledWhy ? (
    <Tooltip title={disabledWhy}>
      <div style={{ display: "flex", minWidth: 0 }}>{card}</div>
    </Tooltip>
  ) : (
    card
  );
}
