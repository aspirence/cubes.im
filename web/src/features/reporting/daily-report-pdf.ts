"use client";

/**
 * The daily report as a printable A4 PDF: a title band, KPI tiles with the
 * change against the previous window, then one table per section. Tables
 * break across pages and repeat their header; every page carries a footer
 * with the team, the window and "page X of Y".
 *
 * jsPDF's built-in Helvetica only covers WinAnsi, so text is passed through
 * `safe()` — anything it can't draw (emoji, ₹, non-Latin scripts) becomes a
 * close ASCII stand-in or is dropped rather than printing as garbage.
 */

import dayjs from "dayjs";
import type { jsPDF as JsPdf } from "jspdf";
import {
  reportFileStem,
  type DailyReport,
  type ReportSections,
} from "./daily-report";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40; // page margin
const CONTENT_W = PAGE_W - M * 2;
const FOOTER_H = 28;

type RGB = [number, number, number];
const INK: RGB = [23, 23, 28];
const MUTED: RGB = [106, 109, 120];
const FAINT: RGB = [154, 157, 168];
const ACCENT: RGB = [74, 74, 208];
const ACCENT_SOFT: RGB = [236, 238, 251];
const HAIRLINE: RGB = [232, 232, 238];
const ZEBRA: RGB = [248, 248, 251];
const GREEN: RGB = [47, 143, 95];
const RED: RGB = [192, 69, 60];

/** Keeps text inside WinAnsi so Helvetica can draw it. */
function safe(text: string): string {
  return text
    .replace(/₹/g, "Rs ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E -ÿ–—•…]/g, "")
    .trim();
}

export function formatMinutesLabel(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function formatMoney(amount: number, currency: string): string {
  const n = Math.round(amount).toLocaleString("en-IN");
  return `${currency} ${n}`;
}

/** "+3 vs previous day" / "-20% vs previous 7 days" / "" when no baseline. */
export function deltaLabel(
  now: number,
  prev: number,
  days: number,
  asMinutes = false,
): { text: string; tone: "up" | "down" | "flat" } | null {
  const period = days === 1 ? "yesterday" : `previous ${days} days`;
  if (now === prev) return { text: `same as ${period}`, tone: "flat" };
  const diff = now - prev;
  const sign = diff > 0 ? "+" : "-";
  const abs = Math.abs(diff);
  const amount = asMinutes ? formatMinutesLabel(abs) : abs.toLocaleString();
  return {
    text: `${sign}${amount} vs ${period}`,
    tone: diff > 0 ? "up" : "down",
  };
}

interface Column<R> {
  header: string;
  /** Fraction of the content width. */
  width: number;
  align?: "left" | "right";
  value: (row: R) => string;
  /** Optional per-cell colour. */
  color?: (row: R) => RGB | null;
}

class Writer {
  y = M;
  constructor(
    readonly doc: JsPdf,
    readonly report: DailyReport,
  ) {}

  font(size: number, style: "normal" | "bold" = "normal", color: RGB = INK) {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
  }

  /** Starts a new page when fewer than `needed` points remain. */
  ensure(needed: number) {
    if (this.y + needed > PAGE_H - M - FOOTER_H) {
      this.doc.addPage();
      this.y = M;
    }
  }

  fit(text: string, width: number): string {
    const clean = safe(text);
    if (this.doc.getTextWidth(clean) <= width) return clean;
    let lo = 0;
    let hi = clean.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.doc.getTextWidth(clean.slice(0, mid) + "…") <= width) lo = mid;
      else hi = mid - 1;
    }
    return clean.slice(0, lo).trimEnd() + "…";
  }

  titleBand() {
    const { doc, report } = this;
    doc.setFillColor(...ACCENT);
    doc.rect(0, 0, PAGE_W, 92, "F");
    this.font(9, "bold", [206, 208, 250]);
    doc.text(
      report.days === 1 ? "DAILY COMPANY REPORT" : "COMPANY REPORT",
      M,
      34,
    );
    this.font(20, "bold", [255, 255, 255]);
    doc.text(this.fit(report.teamName, CONTENT_W * 0.62), M, 60);
    this.font(11, "normal", [228, 229, 252]);
    doc.text(safe(report.label), M, 78);

    this.font(8, "normal", [206, 208, 250]);
    const gen = `Generated ${dayjs(report.generatedAt).format("D MMM YYYY, h:mm A")}`;
    const by = safe(`by ${report.generatedBy}`);
    doc.text(gen, PAGE_W - M, 60, { align: "right" });
    doc.text(this.fit(by, CONTENT_W * 0.35), PAGE_W - M, 72, { align: "right" });
    this.y = 92 + 22;
  }

  /** Plain-language headline: the day in one or two sentences. */
  summary(text: string) {
    this.font(10, "normal", INK);
    const lines = this.doc.splitTextToSize(safe(text), CONTENT_W) as string[];
    this.ensure(lines.length * 14 + 8);
    this.doc.text(lines, M, this.y);
    this.y += lines.length * 14 + 10;
  }

  kpis(
    tiles: {
      label: string;
      value: string;
      delta?: ReturnType<typeof deltaLabel>;
      danger?: boolean;
    }[],
  ) {
    const perRow = 4;
    const gap = 10;
    const w = (CONTENT_W - gap * (perRow - 1)) / perRow;
    const h = 58;
    for (let i = 0; i < tiles.length; i += perRow) {
      this.ensure(h + gap);
      tiles.slice(i, i + perRow).forEach((t, j) => {
        const x = M + j * (w + gap);
        this.doc.setDrawColor(...HAIRLINE);
        this.doc.setFillColor(255, 255, 255);
        this.doc.roundedRect(x, this.y, w, h, 6, 6, "FD");
        this.font(8, "normal", MUTED);
        this.doc.text(this.fit(t.label.toUpperCase(), w - 20), x + 10, this.y + 16);
        this.font(17, "bold", t.danger ? RED : INK);
        this.doc.text(this.fit(t.value, w - 20), x + 10, this.y + 37);
        if (t.delta) {
          const tone =
            t.delta.tone === "up" ? GREEN : t.delta.tone === "down" ? RED : FAINT;
          this.font(7.5, "normal", tone);
          this.doc.text(this.fit(t.delta.text, w - 20), x + 10, this.y + 50);
        }
      });
      this.y += h + gap;
    }
    this.y += 6;
  }

  section(title: string, note?: string) {
    this.ensure(60);
    this.y += 8;
    this.doc.setFillColor(...ACCENT);
    this.doc.rect(M, this.y - 9, 3, 12, "F");
    this.font(12, "bold", INK);
    this.doc.text(safe(title), M + 9, this.y + 1);
    if (note) {
      this.font(8.5, "normal", FAINT);
      this.doc.text(this.fit(note, CONTENT_W * 0.55), PAGE_W - M, this.y + 1, {
        align: "right",
      });
    }
    this.y += 14;
  }

  empty(text: string) {
    this.ensure(24);
    this.font(9, "normal", FAINT);
    this.doc.text(safe(text), M, this.y + 8);
    this.y += 22;
  }

  table<R>(rows: R[], cols: Column<R>[], opts: { max?: number } = {}) {
    const shown = opts.max != null ? rows.slice(0, opts.max) : rows;
    const rowH = 17;
    const pad = 6;
    const widths = cols.map((c) => c.width * CONTENT_W);

    const header = () => {
      this.doc.setFillColor(...ACCENT_SOFT);
      this.doc.rect(M, this.y, CONTENT_W, rowH, "F");
      this.font(7.5, "bold", MUTED);
      let x = M;
      cols.forEach((c, i) => {
        const tx = c.align === "right" ? x + widths[i] - pad : x + pad;
        this.doc.text(this.fit(c.header.toUpperCase(), widths[i] - pad * 2), tx, this.y + 11.5, {
          align: c.align === "right" ? "right" : "left",
        });
        x += widths[i];
      });
      this.y += rowH;
    };

    this.ensure(rowH * 3);
    header();
    shown.forEach((row, r) => {
      if (this.y + rowH > PAGE_H - M - FOOTER_H) {
        this.doc.addPage();
        this.y = M;
        header();
      }
      if (r % 2 === 1) {
        this.doc.setFillColor(...ZEBRA);
        this.doc.rect(M, this.y, CONTENT_W, rowH, "F");
      }
      let x = M;
      cols.forEach((c, i) => {
        this.font(8.5, i === 0 ? "bold" : "normal", c.color?.(row) ?? INK);
        const text = this.fit(c.value(row), widths[i] - pad * 2);
        const tx = c.align === "right" ? x + widths[i] - pad : x + pad;
        this.doc.text(text, tx, this.y + 11.5, {
          align: c.align === "right" ? "right" : "left",
        });
        x += widths[i];
      });
      this.doc.setDrawColor(...HAIRLINE);
      this.doc.line(M, this.y + rowH, M + CONTENT_W, this.y + rowH);
      this.y += rowH;
    });
    if (shown.length < rows.length) {
      this.font(8, "normal", FAINT);
      this.ensure(16);
      this.doc.text(
        `+ ${rows.length - shown.length} more — the Excel download has every row.`,
        M,
        this.y + 12,
      );
      this.y += 16;
    }
    this.y += 10;
  }

  footers() {
    const { doc, report } = this;
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setDrawColor(...HAIRLINE);
      doc.line(M, PAGE_H - M + 4, PAGE_W - M, PAGE_H - M + 4);
      this.font(7.5, "normal", FAINT);
      doc.text(
        this.fit(`${report.teamName} · ${report.label}`, CONTENT_W * 0.7),
        M,
        PAGE_H - M + 16,
      );
      doc.text(`Page ${p} of ${total}`, PAGE_W - M, PAGE_H - M + 16, {
        align: "right",
      });
    }
  }
}

/** One-paragraph headline for the top of the report (also shown on screen). */
export function reportHeadline(report: DailyReport): string {
  const k = report.kpis;
  const span = report.days === 1 ? "The team" : "Over these days the team";
  const parts = [
    `${span} completed ${k.completed} task${k.completed === 1 ? "" : "s"}, opened ${k.created} new one${k.created === 1 ? "" : "s"} and logged ${formatMinutesLabel(k.minutes)} across ${report.projects.filter((p) => p.completed || p.minutes || p.created).length} project${report.projects.length === 1 ? "" : "s"}.`,
  ];
  if (k.activePeople) {
    parts.push(`${k.activePeople} ${k.activePeople === 1 ? "person was" : "people were"} active.`);
  }
  if (k.overdue) {
    parts.push(`${k.overdue} open task${k.overdue === 1 ? " is" : "s are"} past due.`);
  }
  if (report.crm && report.crm.newLeads) {
    parts.push(
      `CRM took in ${report.crm.newLeads} new lead${report.crm.newLeads === 1 ? "" : "s"}${report.crm.converted ? ` and converted ${report.crm.converted}` : ""}.`,
    );
  }
  return parts.join(" ");
}

const time = (iso: string | null) => (iso ? dayjs(iso).format("h:mm A") : "—");

/** Builds the PDF and triggers the download. */
export async function downloadReportPdf(
  report: DailyReport,
  sections: ReportSections,
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setProperties({
    title: `${report.teamName} — ${report.label}`,
    subject: "Company report",
    creator: "Cubes",
  });
  const w = new Writer(doc, report);
  const k = report.kpis;
  const multiDay = report.days > 1;
  const dateOrTime = (iso: string) =>
    multiDay ? dayjs(iso).format("D MMM, h:mm A") : dayjs(iso).format("h:mm A");

  w.titleBand();
  w.summary(reportHeadline(report));

  const tiles: Parameters<Writer["kpis"]>[0] = [
    {
      label: "Tasks completed",
      value: k.completed.toLocaleString(),
      delta: deltaLabel(k.completed, report.previous.completed, report.days),
    },
    {
      label: "New tasks",
      value: k.created.toLocaleString(),
      delta: deltaLabel(k.created, report.previous.created, report.days),
    },
    {
      label: "Time logged",
      value: formatMinutesLabel(k.minutes),
      delta: deltaLabel(k.minutes, report.previous.minutes, report.days, true),
    },
    {
      label: "Billable",
      value: formatMinutesLabel(k.billableMinutes),
      delta: k.minutes
        ? {
            text: `${Math.round((k.billableMinutes / k.minutes) * 100)}% of logged time`,
            tone: "flat",
          }
        : null,
    },
    { label: "Active people", value: k.activePeople.toLocaleString() },
    { label: "Overdue (open)", value: k.overdue.toLocaleString(), danger: k.overdue > 0 },
    { label: multiDay ? "Due in period" : "Due today", value: k.dueInWindow.toLocaleString() },
    { label: "Comments", value: k.comments.toLocaleString() },
  ];
  if (sections.crm && report.crm) {
    tiles.push(
      { label: "New leads", value: report.crm.newLeads.toLocaleString() },
      { label: "Converted", value: report.crm.converted.toLocaleString() },
      {
        label: "New pipeline",
        value: formatMoney(report.crm.pipelineValue, report.crm.currency),
      },
      { label: "Lead updates", value: report.crm.statusChanges.toLocaleString() },
    );
  }
  w.kpis(tiles);

  if (sections.projects) {
    const active = report.projects;
    w.section("Projects", `${active.length} with activity or overdue work`);
    if (active.length === 0) w.empty("No project activity in this period.");
    else
      w.table(active, [
        { header: "Project", width: 0.4, value: (r) => r.name },
        { header: "Completed", width: 0.15, align: "right", value: (r) => String(r.completed) },
        { header: "New", width: 0.13, align: "right", value: (r) => String(r.created) },
        { header: "Time", width: 0.16, align: "right", value: (r) => (r.minutes ? formatMinutesLabel(r.minutes) : "—") },
        {
          header: "Overdue",
          width: 0.16,
          align: "right",
          value: (r) => String(r.overdue),
          color: (r) => (r.overdue ? RED : null),
        },
      ]);
  }

  if (sections.people) {
    const showAttendance = report.days === 1 && report.people.some((p) => p.attendance);
    w.section("People", `${k.activePeople} of ${report.people.length} active`);
    const cols: Column<DailyReport["people"][number]>[] = [
      { header: "Member", width: showAttendance ? 0.28 : 0.4, value: (r) => r.name },
      { header: "Completed", width: 0.14, align: "right", value: (r) => String(r.completed) },
      { header: "Time", width: 0.13, align: "right", value: (r) => (r.minutes ? formatMinutesLabel(r.minutes) : "—") },
      { header: "Billable", width: 0.13, align: "right", value: (r) => (r.billableMinutes ? formatMinutesLabel(r.billableMinutes) : "—") },
      { header: "Comments", width: showAttendance ? 0.12 : 0.2, align: "right", value: (r) => String(r.comments) },
    ];
    if (showAttendance) {
      cols.push({
        header: "Attendance",
        width: 0.2,
        value: (r) =>
          r.attendance
            ? `${r.attendance}${r.clockIn ? ` · ${time(r.clockIn)}` : ""}`
            : "—",
      });
    }
    if (report.people.length === 0) w.empty("No active members.");
    else w.table(report.people, cols);
  }

  if (sections.completed) {
    w.section("Completed tasks", `${report.completedTasks.length} closed`);
    if (report.completedTasks.length === 0) w.empty("Nothing was completed in this period.");
    else
      w.table(
        report.completedTasks,
        [
          { header: "Task", width: 0.4, value: (r) => (r.code ? `${r.code}  ${r.name}` : r.name) },
          { header: "Project", width: 0.2, value: (r) => r.project },
          { header: "Assignees", width: 0.2, value: (r) => r.assignees || "—" },
          { header: multiDay ? "Done" : "Done at", width: 0.1, align: "right", value: (r) => dateOrTime(r.at) },
          {
            header: "Late",
            width: 0.1,
            align: "right",
            value: (r) => (r.daysLate ? `${r.daysLate}d` : "On time"),
            color: (r) => (r.daysLate ? RED : GREEN),
          },
        ],
        { max: 150 },
      );
  }

  if (sections.attention) {
    w.section(
      "Needs attention",
      `${k.dueInWindow} due${multiDay ? " in period" : " today"} · ${k.overdue} overdue`,
    );
    if (report.attention.length === 0) w.empty("Nothing is overdue. Nice.");
    else
      w.table(
        report.attention,
        [
          { header: "Task", width: 0.4, value: (r) => (r.code ? `${r.code}  ${r.name}` : r.name) },
          { header: "Project", width: 0.2, value: (r) => r.project },
          { header: "Assignees", width: 0.2, value: (r) => r.assignees || "Unassigned" },
          { header: "Due", width: 0.1, align: "right", value: (r) => (r.due ? dayjs(r.due).format("D MMM") : "—") },
          {
            header: "Late",
            width: 0.1,
            align: "right",
            value: (r) => (r.daysLate ? `${r.daysLate}d` : "Due"),
            color: (r) => (r.daysLate ? RED : MUTED),
          },
        ],
        { max: 40 },
      );
  }

  if (sections.created && report.createdTasks.length) {
    w.section("New tasks", `${report.createdTasks.length} opened`);
    w.table(
      report.createdTasks,
      [
        { header: "Task", width: 0.46, value: (r) => (r.code ? `${r.code}  ${r.name}` : r.name) },
        { header: "Project", width: 0.22, value: (r) => r.project },
        { header: "Assignees", width: 0.2, value: (r) => r.assignees || "—" },
        { header: "Due", width: 0.12, align: "right", value: (r) => (r.due ? dayjs(r.due).format("D MMM") : "—") },
      ],
      { max: 100 },
    );
  }

  if (sections.time) {
    w.section("Time log", `${formatMinutesLabel(k.minutes)} in ${report.timeLogs.length} entries`);
    if (report.timeLogs.length === 0) w.empty("No time was logged in this period.");
    else
      w.table(
        report.timeLogs,
        [
          { header: multiDay ? "When" : "At", width: 0.12, value: (r) => dateOrTime(r.at) },
          { header: "Member", width: 0.18, value: (r) => r.person },
          { header: "Task", width: 0.36, value: (r) => (r.code ? `${r.code}  ${r.task}` : r.task) },
          { header: "Project", width: 0.2, value: (r) => r.project },
          {
            header: "Time",
            width: 0.14,
            align: "right",
            value: (r) => `${formatMinutesLabel(r.minutes)}${r.billable ? " · B" : ""}`,
          },
        ],
        { max: 200 },
      );
  }

  if (sections.crm && report.crm) {
    const c = report.crm;
    w.section("CRM", `${c.newLeads} new leads · ${c.converted} converted`);
    if (c.bySource.length) {
      w.table(
        c.bySource,
        [
          { header: "Lead source", width: 0.8, value: (r) => r.label },
          { header: "Leads", width: 0.2, align: "right", value: (r) => String(r.count) },
        ],
        { max: 12 },
      );
    }
    if (c.leads.length === 0) w.empty("No new leads in this period.");
    else
      w.table(
        c.leads,
        [
          { header: "Lead", width: 0.3, value: (r) => r.name },
          { header: "Company", width: 0.2, value: (r) => r.company || "—" },
          { header: "Source", width: 0.18, value: (r) => r.source },
          { header: "Status", width: 0.14, value: (r) => r.status },
          {
            header: "Value",
            width: 0.18,
            align: "right",
            value: (r) => (r.amount ? formatMoney(r.amount, c.currency) : "—"),
          },
        ],
        { max: 100 },
      );
  }

  if (sections.attendance && report.attendance) {
    const a = report.attendance;
    w.section(
      "Attendance",
      a.counts.map((x) => `${x.count} ${x.label.toLowerCase()}`).join(" · "),
    );
    if (a.rows.length)
      w.table(
        a.rows,
        [
          ...(multiDay
            ? [{ header: "Date", width: 0.14, value: (r: (typeof a.rows)[number]) => dayjs(r.date).format("D MMM") }]
            : []),
          { header: "Employee", width: multiDay ? 0.3 : 0.4, value: (r) => r.name },
          { header: "Status", width: 0.16, value: (r) => r.status },
          { header: "In", width: 0.13, align: "right", value: (r) => time(r.clockIn) },
          { header: "Out", width: 0.13, align: "right", value: (r) => time(r.clockOut) },
          {
            header: "Worked",
            width: multiDay ? 0.14 : 0.18,
            align: "right",
            value: (r) => (r.workMinutes ? formatMinutesLabel(r.workMinutes) : "—"),
          },
        ],
        { max: 150 },
      );
    if (a.leaves.length) {
      w.table(a.leaves, [
        { header: "On leave", width: 0.34, value: (r) => r.name },
        { header: "Type", width: 0.22, value: (r) => r.type },
        {
          header: "Dates",
          width: 0.24,
          value: (r) =>
            r.from === r.to
              ? dayjs(r.from).format("D MMM")
              : `${dayjs(r.from).format("D MMM")} – ${dayjs(r.to).format("D MMM")}`,
        },
        { header: "Status", width: 0.2, align: "right", value: (r) => r.status },
      ]);
    }
  }

  w.footers();
  doc.save(`${reportFileStem(report)}.pdf`);
}
