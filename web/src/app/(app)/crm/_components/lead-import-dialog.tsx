"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Checkbox,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Result,
  Segmented,
  Select,
  Steps,
  Tooltip,
  Typography,
  Upload,
  theme,
} from "antd";
import dayjs from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmCampaigns } from "@/features/app-crm/use-crm-campaigns";
import { useCrmLabels } from "@/features/app-crm/use-crm-labels";
import { useLeadImport, type LeadImportProgress, type LeadImportResult } from "@/features/app-crm/use-crm-import";
import { CRM_LEAD_STATUSES, crmLeadStatusMeta, type CrmLeadStatus } from "@/features/app-crm/types";
import { MIcon } from "./m-icon";
import { ProjectPicker } from "./target-picker";
import { CrmTable, TagPill } from "./data-table";
import { NO_PROJECT, useCrmScope, useScopeMismatchNotice } from "../_lib/crm-scope";
import { useCrmPrefsStore } from "../_lib/crm-prefs-store";
import { CRM_RECORD_PARAM } from "../_lib/record-deep-link";
import {
  IGNORE,
  LEAD_FIELDS,
  LEAD_IMPORT_ACCEPT,
  LeadImportError,
  TO_NOTE,
  autoMap,
  autoMapHeaderless,
  buildDrafts,
  checkColumn,
  importRefOf,
  isColumnTarget,
  looksLikeHeader,
  mappingSignature,
  matchDrafts,
  normalizeSource,
  parseDelimited,
  readLeadFile,
  toCsv,
  type ColumnTarget,
  type DraftMatch,
  type ImportTable,
  type LeadDraft,
  type LeadField,
} from "../_lib/lead-import";

/**
 * "Import leads": bring leads from anywhere — a Meta Lead Ads download, an
 * Excel or Google Sheets export, a CSV from another CRM or a portal, or rows
 * pasted straight from a spreadsheet — into the CRM as deals with their
 * contacts and companies, filed under a project.
 *
 *   1. Upload / paste       — CSV, TSV, .xlsx, or pasted rows; recent imports
 *                             can be reopened from here
 *   2. Match columns        — every column read from the file, guessed from
 *                             its header (or its values), each one editable,
 *                             with a live preview of how a row will land
 *   3. Review               — defaults (project, stage, status, owner, campaign,
 *                             source, tags), duplicates, and every row's fate
 *   4. Import               — progress, then the batch opened as its own view
 *                             (/crm/deals?import=<id>), Undo, and the skipped
 *                             rows as a CSV
 *
 * The file is read in the browser; nothing is uploaded anywhere but the CRM.
 */

type Step = 0 | 1 | 2 | 3;
type DupMode = "skip" | "link";
type RowState = "ready" | "duplicate" | "repeat" | "error";
type SavedMappings = Record<string, { targets: string[]; at: number }>;

interface ReviewRow {
  draft: LeadDraft;
  match: DraftMatch;
  state: RowState;
  reason: string | null;
}

/** What was loaded and how its columns start out mapped. */
interface Loaded {
  tables: ImportTable[];
  tableIndex: number;
  hasHeader: boolean;
  mapping: ColumnTarget[];
  /** The mapping came from the last import of this same layout. */
  remembered: boolean;
}

const IDENTITY: LeadField[] = ["deal_name", "full_name", "first_name", "last_name", "email", "phone", "company"];

/** What the Source box suggests; anything typed is kept as typed. */
const COMMON_SOURCES = [
  "Facebook",
  "Instagram",
  "Google Ads",
  "Website",
  "WhatsApp",
  "IndiaMART",
  "JustDial",
  "Referral",
  "Walk-in",
  "LinkedIn",
  "Cold call",
];

const SAMPLE_CSV = toCsv([
  ["Name", "Phone", "Email", "Company", "City", "Source", "Campaign", "Tags", "Lead date", "Notes"],
  ["Riya Sharma", "+91 98765 43210", "riya@example.com", "Sharma Traders", "Jaipur", "Facebook", "Diwali offer", "hot, retail", "2026-09-28", "Wants a demo on Monday"],
  ["Aman Verma", "9812345678", "", "", "Delhi", "Website", "", "", "2026-09-29", "Asked for pricing"],
]);

function columnLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const columnName = (i: number) => `Column ${columnLetter(i)}`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The starting mapping for a table: last time's, when this exact header row
 * was imported before; otherwise guessed from the headers and the first rows'
 * values (or from the values alone, with no header row).
 */
function startMapping(rows: string[][], hasHeader: boolean, saved: SavedMappings) {
  if (!hasHeader) return { mapping: autoMapHeaderless(rows.slice(0, 50)), remembered: false };
  const head = rows[0] ?? [];
  const prior = saved[mappingSignature(head)];
  if (prior && prior.targets.length === head.length && prior.targets.every(isColumnTarget)) {
    return { mapping: prior.targets as ColumnTarget[], remembered: true };
  }
  return { mapping: autoMap(head, rows.slice(1, 51)), remembered: false };
}

function prepare(next: ImportTable[], saved: SavedMappings): Loaded | null {
  const tables = next.filter((t) => t.rows.length > 0);
  if (!tables.length) return null;
  const first = tables[0];
  const hasHeader = looksLikeHeader(first.rows[0] ?? []);
  return { tables, tableIndex: 0, hasHeader, ...startMapping(first.rows, hasHeader, saved) };
}

export function LeadImportDialog({
  open,
  onClose,
  initialText = null,
}: {
  open: boolean;
  onClose: () => void;
  /** Rows pasted on a CRM page: the dialog opens on them, at the mapping step. */
  initialText?: string | null;
}) {
  return open ? <LeadImportFlow onClose={onClose} initialText={initialText} /> : null;
}

/** Mounted only while open, so every open starts from a clean slate. */
function LeadImportFlow({ onClose, initialText }: { onClose: () => void; initialText: string | null }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const router = useRouter();
  const { user } = useAuth();
  const scope = useCrmScope();
  const notify = useScopeMismatchNotice();
  const { data: members } = useTeamMembers();
  const { data: stages } = useCrmStages();
  const { data: campaigns } = useCrmCampaigns();
  const { data: labels } = useCrmLabels();
  const { data: people } = useCrmPeople();
  const { data: deals } = useCrmDeals();
  const importer = useLeadImport();
  const savedMappings = useCrmPrefsStore((s) => s.importMappings);
  const saveImportMapping = useCrmPrefsStore((s) => s.saveImportMapping);

  // Pasted rows arrive already loaded: straight to the mapping step.
  const [boot] = useState<Loaded | null>(() =>
    initialText ? prepare([{ name: null, rows: parseDelimited(initialText) }], savedMappings) : null,
  );

  const [step, setStep] = useState<Step>(boot ? 1 : 0);
  // 1. Source
  const [tables, setTables] = useState<ImportTable[]>(boot?.tables ?? []);
  const [tableIndex, setTableIndex] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(boot?.hasHeader ?? true);
  const [paste, setPaste] = useState("");
  const [reading, setReading] = useState(false);
  // 2. Mapping
  const [mapping, setMapping] = useState<ColumnTarget[]>(boot?.mapping ?? []);
  const [remembered, setRemembered] = useState(boot?.remembered ?? false);
  const [previewIndex, setPreviewIndex] = useState(0);
  // 3. Settings
  const [projectId, setProjectId] = useState<string | null>(scope.projectId);
  const [stageId, setStageId] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<CrmLeadStatus>("new");
  const [ownerId, setOwnerId] = useState<string | null>(user?.id ?? null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [dupMode, setDupMode] = useState<DupMode>("skip");
  const [createContacts, setCreateContacts] = useState(true);
  const [createCompanies, setCreateCompanies] = useState(true);
  const [createMissingTags, setCreateMissingTags] = useState(true);
  const [useLeadDates, setUseLeadDates] = useState(true);
  const [filter, setFilter] = useState<"all" | "ready" | "skipped" | "warnings">("all");
  // 4. Import
  const [progress, setProgress] = useState<LeadImportProgress | null>(null);
  const [result, setResult] = useState<LeadImportResult | null>(null);
  const [undone, setUndone] = useState(false);

  const table = tables[tableIndex] ?? null;
  const headers = useMemo(() => {
    if (!table) return [];
    const width = table.rows[0]?.length ?? 0;
    return Array.from({ length: width }, (_, i) => (hasHeader ? table.rows[0]?.[i] || columnName(i) : columnName(i)));
  }, [table, hasHeader]);
  const dataRows = useMemo(() => (table ? table.rows.slice(hasHeader ? 1 : 0) : []), [table, hasHeader]);
  const firstRow = hasHeader ? 2 : 1;

  const effectiveStageId = stageId === undefined ? ((stages ?? [])[0]?.id ?? null) : stageId;

  /* ---------- step 1: load ---------- */

  const load = (next: ImportTable[], name: string | null) => {
    const loaded = prepare(next, savedMappings);
    if (!loaded) {
      message.error("No rows found in that file.");
      return;
    }
    setTables(loaded.tables);
    setTableIndex(0);
    setFileName(name);
    setHasHeader(loaded.hasHeader);
    setMapping(loaded.mapping);
    setRemembered(loaded.remembered);
    setPreviewIndex(0);
    // The columns are read: mapping them is the next thing to do.
    setStep(1);
  };

  const remap = (rows: string[][], header: boolean) => {
    const next = startMapping(rows, header, savedMappings);
    setMapping(next.mapping);
    setRemembered(next.remembered);
    setPreviewIndex(0);
  };

  const pickTable = (i: number) => {
    setTableIndex(i);
    const rows = tables[i]?.rows ?? [];
    const header = looksLikeHeader(rows[0] ?? []);
    setHasHeader(header);
    remap(rows, header);
  };

  const toggleHeader = (next: boolean) => {
    setHasHeader(next);
    remap(table?.rows ?? [], next);
  };

  /** "Match again": forget last time's mapping for this file and guess afresh. */
  const rematch = () => {
    const rows = table?.rows ?? [];
    setMapping(hasHeader ? autoMap(rows[0] ?? [], rows.slice(1, 51)) : autoMapHeaderless(rows.slice(0, 50)));
    setRemembered(false);
  };

  const readFile = async (file: File) => {
    setReading(true);
    try {
      load(await readLeadFile(file), file.name);
    } catch (err) {
      message.error(err instanceof LeadImportError ? err.message : "Couldn't read that file.");
    } finally {
      setReading(false);
    }
  };

  /** Earlier imports, newest first, reopenable as their own view. */
  const recentImports = useMemo(() => {
    const byId = new Map<string, { importId: string; file: string | null; count: number; at: string; projectId: string | null }>();
    for (const d of deals ?? []) {
      if (d.deleted_at) continue;
      const ref = importRefOf(d.source_ref);
      if (!ref) continue;
      const cur = byId.get(ref.importId);
      if (cur) cur.count += 1;
      else byId.set(ref.importId, { importId: ref.importId, file: ref.file, count: 1, at: ref.importedAt ?? d.created_at, projectId: d.project_id });
    }
    return Array.from(byId.values())
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 5);
  }, [deals]);

  const projectName = (id: string | null) =>
    id ? (scope.projects.find((p) => p.id === id)?.name ?? "another project") : "No project";

  /**
   * Opens an import as its own view on the Deals page — just its leads, in
   * file order — with the CRM switched to the project it was filed under.
   * Also from a project's CRM tab, whose own scope is pinned: the global
   * switcher is pointed there directly so the Deals page opens on it.
   */
  const openImport = (importId: string, importProjectId: string | null, dealId?: string) => {
    if (scope.teamId && (scope.fixed || !scope.inScope(importProjectId))) {
      useCrmPrefsStore.getState().setScope(scope.teamId, importProjectId ?? NO_PROJECT);
    }
    const qs = new URLSearchParams({ import: importId });
    if (dealId) qs.set(CRM_RECORD_PARAM, dealId);
    onClose();
    router.push(`/crm/deals?${qs.toString()}`);
  };

  /* ---------- step 2: mapping ---------- */

  const setTarget = (col: number, target: ColumnTarget) => {
    setMapping((prev) => {
      const multi = target !== IGNORE && target !== TO_NOTE && LEAD_FIELDS.find((f) => f.key === target)?.multi;
      const single = target !== IGNORE && target !== TO_NOTE && !multi;
      return prev.map((t, i) => {
        if (i === col) return target;
        // A single-value field moves: the column that had it keeps its data
        // on the note rather than silently dropping out.
        if (single && t === target) return TO_NOTE;
        return t;
      });
    });
  };

  /** Every column not matched to a field goes to the note, or is skipped. */
  const setUnmatched = (target: typeof TO_NOTE | typeof IGNORE) =>
    setMapping((prev) => prev.map((t) => (t === TO_NOTE || t === IGNORE ? target : t)));

  const hasIdentity = mapping.some((t) => IDENTITY.includes(t as LeadField));
  const mappedFields = mapping.filter((t): t is LeadField => t !== IGNORE && t !== TO_NOTE);
  const toNoteCount = mapping.filter((t) => t === TO_NOTE).length;
  const skippedCount = mapping.filter((t) => t === IGNORE).length;

  /** Per column: how many rows fill it, and how many values the chosen field can't use. */
  const checks = useMemo(
    () => (step === 1 ? headers.map((_, i) => checkColumn(dataRows.map((r) => r[i] ?? ""), mapping[i] ?? IGNORE)) : []),
    [step, headers, dataRows, mapping],
  );

  const previewRow = Math.min(previewIndex, Math.max(0, dataRows.length - 1));
  const preview = useMemo(
    () =>
      step === 1 && dataRows[previewRow]
        ? buildDrafts([dataRows[previewRow]], headers, mapping, { firstRow: firstRow + previewRow })[0]
        : null,
    [step, dataRows, previewRow, headers, mapping, firstRow],
  );

  /* ---------- step 3: review ---------- */

  const drafts = useMemo(
    () => (step >= 2 ? buildDrafts(dataRows, headers, mapping, { firstRow }) : []),
    [step, dataRows, headers, mapping, firstRow],
  );
  const hasLeadDates = mapping.includes("lead_date");
  const hasSourceColumn = mapping.includes("source");

  const reviewRows = useMemo<ReviewRow[]>(() => {
    if (!drafts.length) return [];
    const inProject = <T extends { project_id: string | null; deleted_at: string | null }>(r: T) =>
      !r.deleted_at && (r.project_id ?? null) === projectId;
    const livePeople = (people ?? []).filter(inProject);
    const personById = new Map(livePeople.map((p) => [p.id, p]));
    const matches = matchDrafts(drafts, {
      people: livePeople.map((p) => ({ id: p.id, email: p.email, phone: p.phone })),
      deals: (deals ?? []).filter(inProject).map((d) => {
        const contact = d.contact_id ? personById.get(d.contact_id) : undefined;
        return { id: d.id, name: d.name, phone: d.phone, contactEmail: contact?.email ?? null, contactPhone: contact?.phone ?? null };
      }),
    });
    return drafts.map((draft, i) => {
      const match = matches[i];
      if (draft.error) return { draft, match, state: "error", reason: draft.error };
      if (match.dealId && dupMode === "skip") return { draft, match, state: "duplicate", reason: `Already in the CRM as "${match.dealName}"` };
      if (match.sameAsRow && dupMode === "skip") return { draft, match, state: "repeat", reason: `Same phone or email as row ${match.sameAsRow}` };
      return { draft, match, state: "ready", reason: null };
    });
  }, [drafts, people, deals, projectId, dupMode]);

  const counts = useMemo(() => {
    const c = { ready: 0, duplicate: 0, repeat: 0, error: 0, warnings: 0 };
    for (const r of reviewRows) {
      c[r.state] += 1;
      if (r.state === "ready" && r.draft.warnings.length) c.warnings += 1;
    }
    return c;
  }, [reviewRows]);

  const shownRows = useMemo(() => {
    switch (filter) {
      case "ready":
        return reviewRows.filter((r) => r.state === "ready");
      case "skipped":
        return reviewRows.filter((r) => r.state !== "ready");
      case "warnings":
        return reviewRows.filter((r) => r.draft.warnings.length > 0);
      default:
        return reviewRows;
    }
  }, [reviewRows, filter]);

  const unknownTags = useMemo(() => {
    const known = new Set((labels ?? []).map((l) => l.name.trim().toLowerCase()));
    return Array.from(
      new Set(reviewRows.filter((r) => r.state === "ready").flatMap((r) => r.draft.tags).filter((t) => !known.has(t.trim().toLowerCase()))),
    );
  }, [reviewRows, labels]);

  /* ---------- step 4: import ---------- */

  const startImport = async () => {
    const ready = reviewRows.filter((r) => r.state === "ready");
    if (!ready.length) return;
    // Next time this layout comes in, its columns come back mapped like this.
    if (hasHeader && table?.rows[0]) saveImportMapping(mappingSignature(table.rows[0]), mapping);
    setStep(3);
    setProgress({ done: 0, total: ready.length, step: "Starting" });
    const res = await importer.run(
      {
        projectId,
        fileName,
        rows: ready.map((r) => ({
          draft: r.draft,
          personId: r.match.personId,
          sameAsRow: r.match.personId ? null : r.match.sameAsRow,
        })),
        defaults: { stageId: effectiveStageId, status, ownerId, campaignId, labelIds, source: source.trim() || null },
        createContacts,
        createCompanies,
        createMissingTags,
        useLeadDates: hasLeadDates && useLeadDates,
      },
      setProgress,
    );
    setResult(res);
    if (!res.error && projectId !== scope.projectId) notify({ recordProjectId: projectId, noun: "Leads", verb: "imported into" });
  };

  const undo = async () => {
    if (!result) return;
    try {
      await importer.undo(result);
      setUndone(true);
      message.success("Import undone — everything it created was removed.");
    } catch (err) {
      message.error(`Couldn't undo the whole import: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const skippedCsv = () => {
    const skipped = reviewRows.filter((r) => r.state !== "ready");
    const idx = new Map(dataRows.map((cells, i) => [firstRow + i, cells]));
    download(
      `${(fileName ?? "leads").replace(/\.[^.]+$/, "")}-skipped.csv`,
      toCsv([["Row", "Reason", ...headers], ...skipped.map((r) => [String(r.draft.row), r.reason ?? "", ...(idx.get(r.draft.row) ?? [])])]),
    );
  };

  /* ---------- options ---------- */

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.id === user?.id ? `${m.user!.name} (you)` : m.user!.name })),
    [members, user?.id],
  );

  /** Field options, each saying which column holds it now (picking it moves it). */
  const fieldOptions = useMemo(() => {
    const holder = new Map<LeadField, number>();
    mapping.forEach((t, i) => {
      if (t !== IGNORE && t !== TO_NOTE && !holder.has(t)) holder.set(t, i);
    });
    return [
      { value: TO_NOTE, search: "Add to note", label: "Add to note" },
      { value: IGNORE, search: "Don't import skip", label: "Don't import" },
      ...(["Lead", "Contact", "Company"] as const).map((group) => ({
        label: group,
        options: LEAD_FIELDS.filter((f) => f.group === group).map((f) => {
          const at = holder.get(f.key);
          return {
            value: f.key,
            search: f.label,
            label:
              at !== undefined && !f.multi ? (
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{f.label}</span>
                  <span style={{ color: token.colorTextQuaternary, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {headers[at]}
                  </span>
                </span>
              ) : (
                f.label
              ),
          };
        }),
      })),
    ];
  }, [mapping, headers, token.colorTextQuaternary]);

  /* ---------- render ---------- */

  const busy = step === 3 && !result;
  const footer = (() => {
    if (step === 0)
      return [
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="next" type="primary" disabled={!table} onClick={() => setStep(1)}>
          Match columns
        </Button>,
      ];
    if (step === 1)
      return [
        <Button key="back" onClick={() => setStep(0)}>
          Back
        </Button>,
        <Button key="next" type="primary" disabled={!hasIdentity || dataRows.length === 0} onClick={() => setStep(2)}>
          Review {dataRows.length} {dataRows.length === 1 ? "row" : "rows"}
        </Button>,
      ];
    if (step === 2)
      return [
        <Button key="back" onClick={() => setStep(1)}>
          Back
        </Button>,
        <Button key="go" type="primary" disabled={counts.ready === 0} onClick={() => void startImport()} icon={<MIcon name="upload" size={16} />}>
          Import {counts.ready} {counts.ready === 1 ? "lead" : "leads"}
        </Button>,
      ];
    return null;
  })();

  const panelStyle: React.CSSProperties = {
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 12,
    overflow: "hidden",
  };

  return (
    <Modal
      open
      title="Import leads"
      width="min(1080px, calc(100vw - 32px))"
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={false}
      keyboard={!busy}
      footer={footer}
      destroyOnHidden
      styles={{ body: { paddingTop: 8 } }}
    >
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 18 }}
        items={[{ title: "Upload" }, { title: "Match columns" }, { title: "Review" }, { title: "Import" }]}
      />

      {step === 0 ? (
        <div style={{ display: "grid", gap: 14 }}>
          <Upload.Dragger
            accept={LEAD_IMPORT_ACCEPT}
            multiple={false}
            showUploadList={false}
            disabled={reading}
            beforeUpload={(file) => {
              void readFile(file);
              return false;
            }}
          >
            <p style={{ margin: "6px 0" }}>
              <MIcon name="upload_file" size={34} color={token.colorPrimary} />
            </p>
            <p style={{ margin: 0, fontWeight: 600 }}>{reading ? "Reading…" : "Drop a file here, or click to choose"}</p>
            <p style={{ margin: "4px 0 0", color: token.colorTextSecondary, fontSize: 13 }}>
              Excel (.xlsx), CSV or TSV — Facebook / Meta lead downloads, Google Sheets, IndiaMART, JustDial, other CRMs
            </p>
          </Upload.Dragger>

          <div style={{ display: "grid", gap: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Or paste rows copied from Excel or Google Sheets (with the header row):
            </Typography.Text>
            <Input.TextArea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder={"Name\tPhone\tEmail\nRiya Sharma\t+91 98765 43210\triya@example.com"}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
              <Button size="small" type="link" style={{ padding: 0 }} icon={<MIcon name="download" size={15} />} onClick={() => download("leads-sample.csv", SAMPLE_CSV)}>
                Download a sample CSV
              </Button>
              <Button size="small" disabled={!paste.trim()} onClick={() => load([{ name: null, rows: parseDelimited(paste) }], null)}>
                Use pasted rows
              </Button>
            </div>
          </div>

          {recentImports.length ? (
            <div style={{ display: "grid", gap: 6 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Recent imports
              </Typography.Text>
              <div style={panelStyle}>
                {recentImports.map((r, i) => (
                  <div
                    key={r.importId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderTop: i === 0 ? "none" : `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <MIcon name="description" size={18} color={token.colorTextTertiary} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.file ?? "Pasted rows"}
                      </div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                        {r.count} {r.count === 1 ? "lead" : "leads"} · {dayjs(r.at).format("D MMM YYYY, h:mm A")} · {projectName(r.projectId)}
                      </div>
                    </div>
                    <Button size="small" onClick={() => openImport(r.importId, r.projectId)}>
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 && table ? (
        <div style={{ display: "grid", gap: 12 }}>
          {/* What was read, and the two things that change how it's read. */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <MIcon name="description" size={18} color={token.colorTextTertiary} />
            <span style={{ fontWeight: 600 }}>{fileName ?? "Pasted rows"}</span>
            <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
              {dataRows.length} {dataRows.length === 1 ? "row" : "rows"} · {headers.length} columns
            </span>
            <span style={{ flex: 1 }} />
            {tables.length > 1 ? (
              <Select
                size="small"
                value={tableIndex}
                onChange={pickTable}
                style={{ minWidth: 180 }}
                options={tables.map((t, i) => ({ value: i, label: `${t.name ?? `Sheet ${i + 1}`} · ${t.rows.length} rows` }))}
              />
            ) : null}
            <Checkbox checked={hasHeader} onChange={(e) => toggleHeader(e.target.checked)}>
              First row has column names
            </Checkbox>
          </div>

          {remembered ? (
            <Alert
              type="info"
              showIcon
              message="Mapped the way you mapped this file layout last time."
              action={
                <Button size="small" type="text" onClick={rematch}>
                  Match again
                </Button>
              }
            />
          ) : null}
          {!hasIdentity ? (
            <Alert type="warning" showIcon message="Match at least one column to a name, phone, email, company or lead name — that's what a lead is called." />
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)", gap: 14, alignItems: "start" }}>
            {/* Every column in the file, what it holds, and where it goes. */}
            <div style={panelStyle}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(120px, 1fr) minmax(120px, 1.2fr) minmax(190px, 1fr)",
                  gap: 12,
                  padding: "8px 14px",
                  background: token.colorFillQuaternary,
                  fontSize: 12,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                }}
              >
                <span>Column in your file</span>
                <span>Sample values</span>
                <span>Import as</span>
              </div>
              <div style={{ maxHeight: 440, overflowY: "auto" }}>
                {headers.map((h, i) => {
                  const samples = dataRows.map((r) => r[i]).filter(Boolean).slice(0, 3);
                  const target = mapping[i] ?? IGNORE;
                  const check = checks[i];
                  const skipped = target === IGNORE;
                  return (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(120px, 1fr) minmax(120px, 1.2fr) minmax(190px, 1fr)",
                        gap: 12,
                        alignItems: "start",
                        padding: "9px 14px",
                        borderTop: `1px solid ${token.colorBorderSecondary}`,
                        opacity: skipped ? 0.6 : 1,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h}>
                          {h}
                        </div>
                        <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                          {columnLetter(i)} · {check ? `${check.filled} of ${dataRows.length} filled` : ""}
                        </div>
                      </div>
                      <span
                        style={{ color: token.colorTextSecondary, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingTop: 2 }}
                        title={samples.join(" · ")}
                      >
                        {samples.length ? samples.join(" · ") : <em>empty</em>}
                      </span>
                      <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                        <Select<ColumnTarget>
                          value={target}
                          onChange={(v) => setTarget(i, v)}
                          options={fieldOptions}
                          showSearch
                          optionFilterProp="search"
                          optionLabelProp="search"
                          popupMatchSelectWidth={260}
                          style={{ width: "100%" }}
                          status={check && check.invalid > 0 ? "warning" : undefined}
                        />
                        {check && check.invalid > 0 ? (
                          <Tooltip title={check.example ? `For example “${check.example}”` : undefined}>
                            <span style={{ fontSize: 11.5, color: token.colorWarningText }}>
                              {check.invalid} {check.invalid === 1 ? "value doesn't" : "values don't"} fit — left out
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                  padding: "8px 14px",
                  borderTop: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                  fontSize: 12.5,
                  color: token.colorTextSecondary,
                }}
              >
                <span>
                  {mappedFields.length} as fields · {toNoteCount} to the note · {skippedCount} skipped
                </span>
                <span style={{ flex: 1 }} />
                <span>Unmatched columns:</span>
                <Button size="small" onClick={() => setUnmatched(TO_NOTE)} disabled={skippedCount === 0}>
                  All to note
                </Button>
                <Button size="small" onClick={() => setUnmatched(IGNORE)} disabled={toNoteCount === 0}>
                  Skip all
                </Button>
              </div>
            </div>

            {/* The row as it will land in the CRM, re-read on every change. */}
            <div style={{ ...panelStyle, position: "sticky", top: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 8px 6px 14px",
                  background: token.colorFillQuaternary,
                  fontSize: 12,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                }}
              >
                <span style={{ flex: 1 }}>Preview · row {firstRow + previewRow}</span>
                <Button
                  size="small"
                  type="text"
                  aria-label="Previous row"
                  disabled={previewRow === 0}
                  onClick={() => setPreviewIndex(previewRow - 1)}
                  icon={<MIcon name="chevron_left" size={18} />}
                />
                <span style={{ fontWeight: 400 }}>
                  {previewRow + 1} / {dataRows.length}
                </span>
                <Button
                  size="small"
                  type="text"
                  aria-label="Next row"
                  disabled={previewRow >= dataRows.length - 1}
                  onClick={() => setPreviewIndex(previewRow + 1)}
                  icon={<MIcon name="chevron_right" size={18} />}
                />
              </div>
              <div style={{ padding: 14, maxHeight: 440, overflowY: "auto" }}>
                {preview ? <LeadPreview draft={preview} /> : <Typography.Text type="secondary">No rows to preview.</Typography.Text>}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              padding: 14,
              borderRadius: 12,
              background: token.colorFillQuaternary,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Setting label="Project">
              <ProjectPicker value={projectId} onChange={setProjectId} />
            </Setting>
            <Setting label="Stage" hint="Rows with a Stage column use theirs">
              <Select
                value={effectiveStageId ?? undefined}
                onChange={(v: string | undefined) => setStageId(v ?? null)}
                allowClear
                placeholder="No stage"
                options={(stages ?? []).map((s) => ({ value: s.id, label: s.name }))}
                style={{ width: "100%" }}
              />
            </Setting>
            <Setting label="Lead status" hint="Rows with a Status column use theirs">
              <Select value={status} onChange={setStatus} options={CRM_LEAD_STATUSES.map((s) => ({ value: s.value, label: s.label }))} style={{ width: "100%" }} />
            </Setting>
            <Setting label="Owner" hint="Rows with an Owner column use theirs, when it names a team member">
              <Select
                value={ownerId ?? undefined}
                onChange={(v: string | undefined) => setOwnerId(v ?? null)}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Unassigned"
                options={memberOptions}
                style={{ width: "100%" }}
              />
            </Setting>
            <Setting label="Campaign" hint="Rows whose campaign matches one of yours use it">
              <Select
                value={campaignId ?? undefined}
                onChange={(v: string | undefined) => setCampaignId(v ?? null)}
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="None"
                options={(campaigns ?? []).filter((c) => !c.deleted_at).map((c) => ({ value: c.id, label: c.name }))}
                style={{ width: "100%" }}
              />
            </Setting>
            <Setting label="Source" hint={hasSourceColumn ? "Rows with a Source value use theirs" : "Where these leads came from"}>
              <AutoComplete
                value={source}
                onChange={(v) => setSource(v ?? "")}
                allowClear
                placeholder={hasSourceColumn ? "From the file" : "e.g. Facebook, IndiaMART"}
                options={COMMON_SOURCES.map((v) => ({ value: v }))}
                filterOption={(input, option) => String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())}
                style={{ width: "100%" }}
              />
            </Setting>
            <Setting label="Tag every lead">
              <Select
                mode="multiple"
                value={labelIds}
                onChange={setLabelIds}
                placeholder="No extra tags"
                optionFilterProp="label"
                options={(labels ?? []).map((l) => ({ value: l.id, label: l.name }))}
                style={{ width: "100%" }}
                maxTagCount="responsive"
              />
            </Setting>
          </div>

          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Leads already in {projectId ? (scope.projects.find((p) => p.id === projectId)?.name ?? "this project") : "No project"}
              </Typography.Text>
              <Radio.Group value={dupMode} onChange={(e) => setDupMode(e.target.value as DupMode)} style={{ display: "grid", gap: 4 }}>
                <Radio value="skip">Skip them (same phone or email)</Radio>
                <Radio value="link">Import anyway, linked to the existing contact</Radio>
              </Radio.Group>
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Also create
              </Typography.Text>
              <Checkbox checked={createContacts} onChange={(e) => setCreateContacts(e.target.checked)}>
                Contacts (people) for new leads
              </Checkbox>
              <Checkbox checked={createCompanies} onChange={(e) => setCreateCompanies(e.target.checked)}>
                Companies named in the file
              </Checkbox>
              <Checkbox checked={createMissingTags} onChange={(e) => setCreateMissingTags(e.target.checked)} disabled={unknownTags.length === 0}>
                New tags{unknownTags.length ? ` (${unknownTags.slice(0, 3).join(", ")}${unknownTags.length > 3 ? "…" : ""})` : ""}
              </Checkbox>
            </div>
            {hasLeadDates ? (
              <div style={{ display: "grid", gap: 4, maxWidth: 300 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  Dates
                </Typography.Text>
                <Checkbox checked={useLeadDates} onChange={(e) => setUseLeadDates(e.target.checked)}>
                  Date each lead by its Lead date
                </Checkbox>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Reports then count a lead on the day it came in, not the day it was imported.
                </Typography.Text>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <TagPill tone="success" label={`${counts.ready} ready`} />
            {counts.duplicate ? <TagPill tone="warning" label={`${counts.duplicate} already in the CRM`} /> : null}
            {counts.repeat ? <TagPill tone="warning" label={`${counts.repeat} repeated in the file`} /> : null}
            {counts.error ? <TagPill tone="danger" label={`${counts.error} can't be imported`} /> : null}
            {counts.warnings ? <TagPill tone="info" label={`${counts.warnings} with warnings`} /> : null}
            <span style={{ flex: 1 }} />
            <Segmented
              size="small"
              value={filter}
              onChange={(v) => setFilter(v as typeof filter)}
              options={[
                { value: "all", label: "All" },
                { value: "ready", label: "Ready" },
                { value: "skipped", label: "Skipped" },
                { value: "warnings", label: "Warnings" },
              ]}
            />
          </div>

          <div style={panelStyle}>
            <CrmTable<ReviewRow>
              rowKey={(r) => String(r.draft.row)}
              dataSource={shownRows}
              size="small"
              pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
              scroll={{ x: 820 }}
              columns={[
                { title: "Row", key: "row", width: 64, render: (_, r) => <span style={{ color: token.colorTextTertiary }}>{r.draft.row}</span> },
                {
                  title: "Lead",
                  key: "lead",
                  render: (_, r) => (
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.draft.dealName || "—"}</div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                        {[`${r.draft.firstName} ${r.draft.lastName}`.trim(), r.draft.company].filter(Boolean).join(" · ") || " "}
                      </div>
                    </div>
                  ),
                },
                { title: "Phone", key: "phone", width: 150, render: (_, r) => r.draft.phone ?? <span style={{ color: token.colorTextQuaternary }}>—</span> },
                { title: "Email", key: "email", width: 200, ellipsis: true, render: (_, r) => r.draft.email ?? <span style={{ color: token.colorTextQuaternary }}>—</span> },
                {
                  title: "Result",
                  key: "result",
                  width: 230,
                  render: (_, r) => (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {r.state === "ready" ? (
                        <TagPill tone="success" label={r.match.personId ? "Ready · existing contact" : "Ready"} />
                      ) : (
                        <Tooltip title={r.reason}>
                          <span>
                            <TagPill tone={r.state === "error" ? "danger" : "warning"} label={r.state === "error" ? "Can't import" : "Skipped"} />
                          </span>
                        </Tooltip>
                      )}
                      {r.draft.warnings.length ? (
                        <Tooltip title={<div>{r.draft.warnings.map((w) => <div key={w}>{w}</div>)}</div>}>
                          <span>
                            <MIcon name="warning" size={16} color={token.colorWarning} />
                          </span>
                        </Tooltip>
                      ) : null}
                    </span>
                  ),
                },
              ]}
            />
          </div>

          <Alert
            type="info"
            showIcon
            message="Each imported lead counts as a new deal: workflows that start on “Deal created” will run for every one of them."
          />
        </div>
      ) : null}

      {step === 3 ? (
        result ? (
          <Result
            status={result.error ? "warning" : undone ? "info" : "success"}
            title={
              undone
                ? "Import undone"
                : result.error
                  ? `Imported ${result.deals.length} leads, then stopped`
                  : `${result.deals.length} ${result.deals.length === 1 ? "lead" : "leads"} imported`
            }
            subTitle={
              undone ? (
                "Everything this import created was removed."
              ) : (
                <span>
                  {result.people.length} contacts · {result.companies.length} companies · {result.labels.length} new tags
                  {result.notes.length ? ` · ${result.notes.length} notes` : ""}
                  {result.error ? (
                    <>
                      <br />
                      <Typography.Text type="danger">{result.error}</Typography.Text>
                    </>
                  ) : (
                    <>
                      <br />
                      Open them as their own list — just these leads, in the order of your file.
                    </>
                  )}
                </span>
              )
            }
            extra={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {!undone && result.deals.length ? (
                  <>
                    <Button type="primary" icon={<MIcon name="table_rows" size={16} />} onClick={() => openImport(result.importId, projectId)}>
                      Open imported leads
                    </Button>
                    <Button icon={<MIcon name="open_in_new" size={16} />} onClick={() => openImport(result.importId, projectId, result.deals[0])}>
                      Open first lead
                    </Button>
                  </>
                ) : null}
                {counts.duplicate + counts.repeat + counts.error > 0 ? (
                  <Button icon={<MIcon name="download" size={16} />} onClick={skippedCsv}>
                    Skipped rows (CSV)
                  </Button>
                ) : null}
                {!undone && (result.deals.length || result.people.length || result.companies.length) ? (
                  <Popconfirm
                    title="Undo this import?"
                    description={`Deletes the ${result.deals.length} leads, ${result.people.length} contacts and ${result.companies.length} companies it created.`}
                    okText="Undo import"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void undo()}
                  >
                    <Button loading={importer.running} danger>
                      Undo import
                    </Button>
                  </Popconfirm>
                ) : null}
                <Button onClick={onClose} disabled={importer.running}>
                  Close
                </Button>
              </div>
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 14, placeItems: "center", padding: "36px 0" }}>
            <Progress
              type="circle"
              percent={progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0}
              size={96}
            />
            <Typography.Text type="secondary">
              {progress?.step ?? "Starting"}… {progress ? `${progress.done} of ${progress.total}` : ""}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Keep this window open until it finishes.
            </Typography.Text>
          </div>
        )
      ) : null}
    </Modal>
  );
}

/**
 * One row as the CRM will hold it: the lead, its contact and company, the
 * details, the note — and whatever was dropped on the way in. Only what the
 * row actually fills is shown, so a wrong mapping shows up as a gap.
 */
function LeadPreview({ draft }: { draft: LeadDraft }) {
  const { token } = theme.useToken();
  const person = `${draft.firstName} ${draft.lastName}`.trim();
  const status = draft.status ? crmLeadStatusMeta(draft.status) : null;
  const line = (icon: string, text: React.ReactNode, key: string) => (
    <div key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, minWidth: 0 }}>
      <MIcon name={icon} size={16} color={token.colorTextTertiary} style={{ marginTop: 1, flex: "none" }} />
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{text}</span>
    </div>
  );
  const section = (title: string, rows: React.ReactNode[]) =>
    rows.length ? (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: token.colorTextTertiary }}>{title}</div>
        {rows}
      </div>
    ) : null;

  if (draft.error) {
    return <Alert type="error" showIcon message="This row won't import" description={draft.error} />;
  }

  const details = [
    draft.stageName ? line("view_kanban", `Stage: ${draft.stageName}`, "stage") : null,
    draft.campaignName ? line("campaign", draft.campaignName, "campaign") : null,
    draft.source ? line("hub", `Source: ${normalizeSource(draft.source)}`, "source") : null,
    draft.ownerRaw ? line("person_pin", `Owner: ${draft.ownerRaw}`, "owner") : null,
    draft.leadAt ? line("schedule", `Came in ${dayjs(draft.leadAt).format("D MMM YYYY, h:mm A")}`, "lead") : null,
    draft.closeDate ? line("event", `Closes ${dayjs(draft.closeDate).format("D MMM YYYY")}`, "close") : null,
  ].filter(Boolean) as React.ReactNode[];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 600, fontSize: 15, overflowWrap: "anywhere" }}>{draft.dealName}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {status ? <TagPill tone={status.tone} label={status.label} /> : <TagPill label="Status: import default" />}
          {draft.tags.map((t) => (
            <TagPill key={t} tone="accent" label={t} />
          ))}
        </div>
      </div>
      {section(
        "Contact",
        [
          person ? line("person", [person, draft.jobTitle, draft.city].filter(Boolean).join(" · "), "name") : null,
          draft.phone ? line("call", draft.phone, "phone") : null,
          draft.email ? line("mail", draft.email, "email") : null,
          draft.linkedin ? line("link", draft.linkedin, "linkedin") : null,
        ].filter(Boolean) as React.ReactNode[],
      )}
      {section(
        "Company",
        draft.company ? [line("domain", [draft.company, draft.website].filter(Boolean).join(" · "), "company")] : [],
      )}
      {section("Details", details)}
      {draft.note ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: token.colorTextTertiary }}>Note</div>
          <div
            style={{
              fontSize: 12.5,
              whiteSpace: "pre-wrap",
              color: token.colorTextSecondary,
              background: token.colorFillQuaternary,
              borderRadius: 8,
              padding: "8px 10px",
              maxHeight: 160,
              overflowY: "auto",
              overflowWrap: "anywhere",
            }}
          >
            {draft.note}
          </div>
        </div>
      ) : null}
      {draft.warnings.length ? (
        <div style={{ display: "grid", gap: 4 }}>
          {draft.warnings.map((w) => (
            <div key={w} style={{ display: "flex", gap: 6, fontSize: 12, color: token.colorWarningText }}>
              <MIcon name="warning" size={14} color={token.colorWarning} style={{ marginTop: 1, flex: "none" }} />
              <span>{w}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Setting({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>
        {label}
        {hint ? (
          <Tooltip title={hint}>
            <span style={{ marginLeft: 4, verticalAlign: "middle" }}>
              <MIcon name="info" size={13} color={token.colorTextQuaternary} />
            </span>
          </Tooltip>
        ) : null}
      </span>
      {children}
    </label>
  );
}
