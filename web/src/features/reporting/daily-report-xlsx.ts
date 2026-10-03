"use client";

/**
 * The daily report as an Excel workbook: a Summary sheet, then one sheet per
 * section with every row (the PDF caps its long tables; this never does).
 * Headers are bold, frozen and filterable; numbers are real numbers, so the
 * sheets sum and pivot without cleanup.
 *
 * A minimal SpreadsheetML writer zipped with fflate — the same library the
 * CRM lead import already uses to read .xlsx.
 */

import dayjs from "dayjs";
import { strToU8, zipSync } from "fflate";
import {
  reportFileStem,
  type DailyReport,
  type ReportSections,
} from "./daily-report";
import { reportHeadline } from "./daily-report-pdf";

type Cell = string | number | null;

interface Sheet {
  name: string;
  /** Column widths in characters. */
  widths: number[];
  /** Rows above the table (title/notes), written unstyled. */
  preamble?: Cell[][];
  header?: string[];
  rows: Cell[][];
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Style ids from styles.xml below: 0 plain, 1 header, 2 title, 3 muted. */
function cellXml(ref: string, v: Cell, style = 0): string {
  const s = style ? ` s="${style}"` : "";
  if (v == null || v === "") return `<c r="${ref}"${s}/>`;
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<c r="${ref}"${s}><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const rows: string[] = [];
  let r = 1;
  for (const [i, line] of (sheet.preamble ?? []).entries()) {
    rows.push(
      `<row r="${r}">${line
        .map((v, c) => cellXml(`${colName(c)}${r}`, v, i === 0 ? 2 : 3))
        .join("")}</row>`,
    );
    r++;
  }
  if (sheet.preamble?.length) r++; // one blank row before the table
  const headerRow = sheet.header ? r : null;
  if (sheet.header) {
    rows.push(
      `<row r="${r}">${sheet.header
        .map((h, c) => cellXml(`${colName(c)}${r}`, h, 1))
        .join("")}</row>`,
    );
    r++;
  }
  for (const line of sheet.rows) {
    rows.push(
      `<row r="${r}">${line.map((v, c) => cellXml(`${colName(c)}${r}`, v)).join("")}</row>`,
    );
    r++;
  }

  const cols = sheet.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const pane = headerRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const filter =
    headerRow && sheet.rows.length
      ? `<autoFilter ref="A${headerRow}:${colName((sheet.header?.length ?? 1) - 1)}${r - 1}"/>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<cols>${cols}</cols><sheetData>${rows.join("")}</sheetData>${filter}</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF17171C"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF4A4AD0"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF6A6D78"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFECEEFB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function workbook(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("\n")}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
      .map(
        (s, i) =>
          `<sheet name="${esc(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}

/** Hours with two decimals — sums cleanly in a spreadsheet. */
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
const stamp = (iso: string | null) =>
  iso ? dayjs(iso).format("YYYY-MM-DD HH:mm") : "";
const date = (iso: string | null) => (iso ? dayjs(iso).format("YYYY-MM-DD") : "");

/** Builds the workbook and triggers the download. */
export function downloadReportXlsx(
  report: DailyReport,
  sections: ReportSections,
): void {
  const k = report.kpis;
  const sheets: Sheet[] = [];

  const summaryRows: Cell[][] = [
    ["Tasks completed", k.completed, report.previous.completed],
    ["New tasks", k.created, report.previous.created],
    ["Hours logged", hours(k.minutes), hours(report.previous.minutes)],
    ["Billable hours", hours(k.billableMinutes), null],
    ["Active people", k.activePeople, null],
    ["Overdue open tasks", k.overdue, null],
    [report.days === 1 ? "Due today (open)" : "Due in period (open)", k.dueInWindow, null],
    ["Comments", k.comments, null],
  ];
  if (report.crm) {
    summaryRows.push(
      ["New leads", report.crm.newLeads, null],
      ["Leads converted", report.crm.converted, null],
      [`New pipeline (${report.crm.currency})`, report.crm.pipelineValue, null],
    );
  }
  if (report.attendance) {
    for (const c of report.attendance.counts) {
      summaryRows.push([`Attendance: ${c.label}`, c.count, null]);
    }
  }
  sheets.push({
    name: "Summary",
    widths: [34, 16, 22],
    preamble: [
      [`${report.teamName} — ${report.days === 1 ? "Daily report" : "Report"}`],
      [report.label],
      [reportHeadline(report)],
      [`Generated ${dayjs(report.generatedAt).format("D MMM YYYY, h:mm A")} by ${report.generatedBy}`],
    ],
    header: [
      "Metric",
      "This period",
      report.days === 1 ? "Previous day" : `Previous ${report.days} days`,
    ],
    rows: summaryRows,
  });

  if (sections.projects) {
    sheets.push({
      name: "Projects",
      widths: [36, 12, 10, 12, 12],
      header: ["Project", "Completed", "New", "Hours", "Overdue open"],
      rows: report.projects.map((p) => [p.name, p.completed, p.created, hours(p.minutes), p.overdue]),
    });
  }
  if (sections.people) {
    sheets.push({
      name: "People",
      widths: [28, 12, 10, 14, 11, 14, 10, 10],
      header: ["Member", "Completed", "Hours", "Billable hours", "Comments", "Attendance", "In", "Out"],
      rows: report.people.map((p) => [
        p.name,
        p.completed,
        hours(p.minutes),
        hours(p.billableMinutes),
        p.comments,
        p.attendance ?? "",
        p.clockIn ? dayjs(p.clockIn).format("HH:mm") : "",
        p.clockOut ? dayjs(p.clockOut).format("HH:mm") : "",
      ]),
    });
  }
  const taskSheet = (name: string, rows: DailyReport["completedTasks"], atLabel: string) => ({
    name,
    widths: [12, 48, 26, 28, 18, 12, 10],
    header: ["ID", "Task", "Project", "Assignees", atLabel, "Due", "Days late"],
    rows: rows.map((t) => [
      t.code,
      t.name,
      t.project,
      t.assignees,
      stamp(t.at),
      date(t.due),
      t.daysLate ?? 0,
    ]),
  });
  if (sections.completed) sheets.push(taskSheet("Completed", report.completedTasks, "Completed at"));
  if (sections.attention) sheets.push(taskSheet("Needs attention", report.attention, "Created at"));
  if (sections.created) sheets.push(taskSheet("New tasks", report.createdTasks, "Created at"));
  if (sections.time) {
    sheets.push({
      name: "Time log",
      widths: [18, 24, 12, 44, 26, 10, 10, 40],
      header: ["Logged at", "Member", "ID", "Task", "Project", "Hours", "Billable", "Note"],
      rows: report.timeLogs.map((l) => [
        stamp(l.at),
        l.person,
        l.code,
        l.task,
        l.project,
        hours(l.minutes),
        l.billable ? "Yes" : "No",
        l.note,
      ]),
    });
  }
  if (sections.crm && report.crm) {
    sheets.push({
      name: "CRM leads",
      widths: [30, 26, 22, 16, 14, 18],
      header: ["Lead", "Company", "Source", "Status", `Value (${report.crm.currency})`, "Created at"],
      rows: report.crm.leads.map((l) => [l.name, l.company, l.source, l.status, l.amount, stamp(l.createdAt)]),
    });
  }
  if (sections.attendance && report.attendance) {
    sheets.push({
      name: "Attendance",
      widths: [12, 28, 14, 10, 10, 12],
      header: ["Date", "Employee", "Status", "In", "Out", "Worked hours"],
      rows: report.attendance.rows.map((a) => [
        a.date,
        a.name,
        a.status,
        a.clockIn ? dayjs(a.clockIn).format("HH:mm") : "",
        a.clockOut ? dayjs(a.clockOut).format("HH:mm") : "",
        a.workMinutes != null ? hours(a.workMinutes) : null,
      ]),
    });
    if (report.attendance.leaves.length) {
      sheets.push({
        name: "Leave",
        widths: [28, 18, 12, 12, 8, 12],
        header: ["Employee", "Type", "From", "To", "Days", "Status"],
        rows: report.attendance.leaves.map((l) => [l.name, l.type, l.from, l.to, l.days, l.status]),
      });
    }
  }

  const bytes = workbook(sheets);
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportFileStem(report)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
