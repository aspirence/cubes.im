"use client";

/**
 * Sheets list — the small spreadsheet drawn at the top of every card.
 *
 * It is the reason a sheet card reads as a SHEET: the header row carries the
 * sheet's real column labels, and the rows under it are placeholder shapes
 * that follow each column's type (a pill under a Status column, a right-aligned
 * bar under Spend, a tick box under Done). Everything comes from the columns
 * the list already holds, so a card never fetches rows to draw itself, and two
 * sheets with different columns never look alike.
 *
 * The bars are placeholders on purpose — the list does not have the rows, and
 * inventing plausible values would be lying about someone's data.
 */

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useC } from "@/features/app-content-studio/ui";
import { MONO_FONT } from "@/lib/theme";
import { previewColumns, seeded, type PreviewColumn, type PreviewColumnInput } from "./sheet-list-model";

type Palette = ReturnType<typeof useC>;

/** A column's placeholder for a sheet with no visible columns at all. */
const LETTERS: PreviewColumn[] = ["A", "B", "C", "D"].map((label) => ({ label, type: "text", weight: 1, colors: [] }));

const HEADER_H = 24;
const ROW_H = 20;

/** Text in an accent hue, pulled toward the theme's text colour so it stays legible on light and dark. */
export function inkOf(accent: string, C: Palette): string {
  return `color-mix(in srgb, ${accent} 72%, ${C.text})`;
}

export function MiniSheet({
  columns,
  seed,
  accent,
  height = 112,
  rows = 5,
}: {
  columns: readonly PreviewColumnInput[];
  /** Keeps the placeholder bars stable per sheet (its id, or a template key). */
  seed: string;
  accent: string;
  height?: number;
  rows?: number;
}) {
  const C = useC();
  const cols = useMemo(() => previewColumns(columns), [columns]);
  const empty = cols.length === 0;
  const shown = empty ? LETTERS : cols;
  const more = columns.filter((c) => !c.hidden).length > shown.length;

  const line = `color-mix(in srgb, ${accent} 15%, ${C.hair})`;
  const paper = `color-mix(in srgb, ${accent} 4%, ${C.panel})`;
  const head = `color-mix(in srgb, ${accent} 12%, ${C.panel})`;
  const gutter = `color-mix(in srgb, ${accent} 7%, ${C.panel})`;
  const template = `20px ${shown.map((c) => `minmax(0, ${c.weight}fr)`).join(" ")}`;

  const cell: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
    overflow: "hidden",
    padding: "0 6px",
    borderRight: `1px solid ${line}`,
    borderBottom: `1px solid ${line}`,
  };

  return (
    <div aria-hidden style={{ position: "relative", height, overflow: "hidden", background: paper, borderBottom: `1px solid ${line}` }}>
      <div style={{ display: "grid", gridTemplateColumns: template, gridAutoRows: ROW_H, gridTemplateRows: `${HEADER_H}px` }}>
        <div style={{ ...cell, padding: 0, background: head }} />
        {shown.map((c, i) => (
          <div
            key={`h${i}`}
            style={{
              ...cell,
              background: head,
              fontSize: 10.5,
              fontWeight: 650,
              letterSpacing: 0.1,
              color: inkOf(accent, C),
              justifyContent: empty ? "center" : "flex-start",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
          </div>
        ))}
        {Array.from({ length: rows }, (_, r) => (
          <Row key={r} r={r} shown={shown} cell={cell} gutter={gutter} seed={seed} accent={accent} empty={empty} C={C} />
        ))}
      </div>
      {/* The sheet runs on past the card: fade the last rows into it, and the
          right edge too when there are more columns than fit. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: [
            `linear-gradient(to bottom, transparent 52%, ${C.panel} 100%)`,
            more ? `linear-gradient(to right, transparent 82%, ${paper} 100%)` : null,
          ]
            .filter(Boolean)
            .join(", "),
        }}
      />
    </div>
  );
}

function Row({
  r,
  shown,
  cell,
  gutter,
  seed,
  accent,
  empty,
  C,
}: {
  r: number;
  shown: PreviewColumn[];
  cell: CSSProperties;
  gutter: string;
  seed: string;
  accent: string;
  empty: boolean;
  C: Palette;
}) {
  return (
    <>
      <div
        style={{
          ...cell,
          padding: 0,
          justifyContent: "center",
          background: gutter,
          fontFamily: MONO_FONT,
          fontSize: 9,
          color: C.textTertiary,
        }}
      >
        {r + 1}
      </div>
      {shown.map((c, i) => (
        <div key={i} style={{ ...cell, justifyContent: isNumeric(c) ? "flex-end" : "flex-start" }}>
          {empty ? null : placeholder(c, seeded(`${seed}:${i}:${r}`), r, accent, C)}
        </div>
      ))}
    </>
  );
}

function isNumeric(c: PreviewColumn) {
  return c.type === "number" || c.type === "currency" || c.type === "percent";
}

function bar(width: number, color: string, h = 5): ReactNode {
  return <span style={{ display: "block", flex: "none", width: `${Math.round(width)}%`, height: h, borderRadius: 3, background: color }} />;
}

/** The shape a value of this type makes in a cell. `f` is a stable 0..1 per cell. */
function placeholder(c: PreviewColumn, f: number, r: number, accent: string, C: Palette): ReactNode {
  const faint = `color-mix(in srgb, ${C.text} 12%, transparent)`;
  const soft = `color-mix(in srgb, ${C.text} 17%, transparent)`;
  switch (c.type) {
    case "checkbox": {
      const on = f > 0.42;
      return (
        <span
          style={{
            width: 8,
            height: 8,
            flex: "none",
            borderRadius: 2.5,
            border: `1.5px solid ${on ? accent : soft}`,
            background: on ? accent : "transparent",
          }}
        />
      );
    }
    case "select":
    case "multi_select": {
      const hue = c.colors.length ? c.colors[(r + Math.floor(f * 5)) % c.colors.length] : accent;
      const pill = (w: number, key?: number) => (
        <span
          key={key}
          style={{
            display: "block",
            flex: "none",
            width: `${Math.round(w)}%`,
            height: 9,
            borderRadius: 999,
            background: `color-mix(in srgb, ${hue} 32%, transparent)`,
          }}
        />
      );
      return c.type === "multi_select" ? [pill(28 + f * 14, 0), pill(22 + (1 - f) * 12, 1)] : pill(42 + f * 36);
    }
    case "person":
    case "people": {
      const dot = (k: number, hue: string) => (
        <span
          key={k}
          style={{
            width: 9,
            height: 9,
            flex: "none",
            borderRadius: 999,
            background: `color-mix(in srgb, ${hue} 45%, transparent)`,
            marginLeft: k ? -4 : 0,
            boxShadow: k ? `0 0 0 1.5px ${C.panel}` : undefined,
          }}
        />
      );
      return [
        dot(0, accent),
        ...(c.type === "people" && f > 0.35 ? [dot(1, C.gold)] : []),
        <span key="n" style={{ display: "block", flex: "none", width: `${Math.round(30 + f * 25)}%`, height: 5, borderRadius: 3, background: faint, marginLeft: 3 }} />,
      ];
    }
    case "number":
    case "currency":
    case "percent":
      return bar(28 + f * 40, soft);
    case "date":
    case "datetime":
      return bar(50 + f * 22, faint);
    case "url":
    case "email":
      return bar(40 + f * 45, `color-mix(in srgb, ${accent} 34%, transparent)`);
    default:
      return bar(c.type === "long_text" ? 55 + f * 40 : 35 + f * 55, faint);
  }
}
