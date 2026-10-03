"use client";

/**
 * Sheets — the new-sheet wizard: template → details & data source → columns →
 * Google Sheets → create.
 *
 * A template only fills in the draft (the add-card gallery's rule): every
 * choice stays editable in the later steps. A template bound to an app that
 * isn't installed — or, for a project sheet, isn't active in that project —
 * is shown disabled with the reason, rather than hidden, so people learn the
 * option exists.
 *
 * Connecting Google is a full-page redirect through Google's consent screen.
 * The draft is parked in sessionStorage first and the workspace reopens the
 * wizard on the Google step when the user comes back (see
 * `peekParkedDraft`), so connecting mid-wizard doesn't cost the work so far.
 */

import { useMemo, useState } from "react";
import { App, Button, Dropdown, Empty, Input, Modal, Popconfirm, Select, Skeleton, Steps, Switch, Tag, Tooltip, theme } from "antd";
import { BUILT_IN_TEMPLATES } from "@/lib/sheets/templates";
import { SOURCES } from "@/lib/sheets/sources";
import { newColumnId, type SheetColumn, type SheetRecordRow, type SheetSource, type SheetTemplate } from "@/lib/sheets/types";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import { CURRENCIES, OptionsEditor, makeCustomColumn } from "./column-editor";
import {
  DEFAULT_GOOGLE_SETTINGS,
  GoogleCheckFailedNotice,
  GoogleRequiredNotice,
  GoogleSettingsFields,
  GoogleTargetChooser,
  defaultSettingsFor,
  pickConnection,
  type GoogleTarget,
} from "./google-setup";
import { APP_NAMES, TYPE_ICONS, TYPE_LABELS, configWithDefaults, googleGate, sourceAvailability, type InstalledLike } from "./sheet-model";
import { describeSheetCreated } from "./sync-status";
import {
  NEEDS_GOOGLE_TO_CREATE,
  columnsFromTemplate,
  useCreateSheet,
  useDeleteSheetTemplate,
  useGoogleConnections,
  useIsLimitedMember,
  useSheetTemplates,
  type GoogleSettings,
  type TeamSheetTemplate,
} from "./use-sheets";

/**
 * A limited member cannot be the one to create a sheet.
 *
 * Not a permission we invented: a sheet is created as a Google Sheet, and the
 * Google routes refuse a limited member outright, because Drive shares the
 * whole file and they are restricted to part of it. Creating one here would
 * leave exactly the half-provisioned sheet Decision A removes. They still open
 * every sheet they can see — in Cubes' own grid (limited-grid.tsx).
 */
function LimitedCannotCreate() {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        border: `1px dashed ${token.colorBorder}`,
        borderRadius: 12,
        padding: "32px 24px",
        display: "grid",
        gap: 12,
        justifyItems: "center",
        textAlign: "center",
        minHeight: 300,
        alignContent: "center",
      }}
    >
      <MIcon name="table_view" size={34} color={token.colorTextQuaternary} />
      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Sheets are made by full workspace members</div>
        <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
          Every sheet is created as a Google Sheet and shared with the whole workspace — a Google Sheet can only be
          shared whole. Your access here is limited to your own rows, so the sheets you open are shown to you in Cubes
          instead, and creating one is left to a full member.
        </div>
        <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
          Ask a colleague to create it and you will see it in the list straight away.
        </div>
      </div>
    </div>
  );
}

export interface WizardDraft {
  step: number;
  templateKey: string | null;
  name: string;
  description: string;
  projectId: string | null;
  source: SheetSource;
  sourceConfig: Record<string, unknown>;
  columns: SheetColumn[];
  target: GoogleTarget;
  connectionId: string | null;
  settings: GoogleSettings;
}

const PARK_KEY = "cubes:sheets:wizard-draft";

/** Keeps the draft across the Google consent redirect. */
export function parkDraft(draft: WizardDraft) {
  try {
    sessionStorage.setItem(PARK_KEY, JSON.stringify({ at: Date.now(), draft }));
  } catch {
    // Private mode / storage full: the user just redoes the wizard.
  }
}

/**
 * The parked draft if one is fresh (the consent flow is a 10-minute window).
 * A pure read — safe inside a state initializer; `clearParkedDraft` consumes it.
 *
 * Where it resumes depends on how far it got. A draft parked from the Google
 * step comes back to it. A draft parked from the "connect Google first" gate
 * was never filled in, and dropping that on the last step — empty name, dead
 * Create button — would be a worse welcome than the step it left from.
 */
export function peekParkedDraft(): WizardDraft | null {
  try {
    const raw = sessionStorage.getItem(PARK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; draft: WizardDraft };
    if (!parsed?.draft || Date.now() - parsed.at > 15 * 60_000) return null;
    const draft = parsed.draft;
    const ready = Boolean(draft.name?.trim()) && Array.isArray(draft.columns) && draft.columns.length > 0;
    const step = ready ? 3 : Math.min(Math.max(Number(draft.step) || 0, 0), 3);
    return { ...draft, step };
  } catch {
    return null;
  }
}

export function clearParkedDraft() {
  try {
    sessionStorage.removeItem(PARK_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

function defaultColumns(source: SheetSource): SheetColumn[] {
  const ids: string[] = [];
  return SOURCES[source].fields
    .filter((f) => f.defaultOn)
    .map((f) => {
      const id = newColumnId(ids);
      ids.push(id);
      return { id, label: f.label, type: f.type, field: f.key, ...(f.dynamicOptions ? { dynamicOptions: f.dynamicOptions } : {}) };
    });
}

function blankDraft(projectId: string | null): WizardDraft {
  const blank = BUILT_IN_TEMPLATES.find((t) => t.key === "blank");
  return {
    step: 0,
    templateKey: null,
    name: "",
    description: "",
    projectId,
    source: "custom",
    sourceConfig: {},
    columns: blank ? columnsFromTemplate(blank.columns) : [],
    // Every sheet IS a Google Sheet: the sheet view shows the live spreadsheet,
    // so "don't link" would create a sheet with nothing to display. The default
    // is a new spreadsheet, and the only other choice is one you already have.
    target: { mode: "create" },
    connectionId: null,
    settings: DEFAULT_GOOGLE_SETTINGS,
  };
}

function draftFromTemplate(base: WizardDraft, tpl: SheetTemplate): WizardDraft {
  return {
    ...base,
    step: 1,
    templateKey: tpl.builtIn ? tpl.key : null,
    name: base.name.trim() ? base.name : tpl.name,
    description: base.description.trim() ? base.description : tpl.builtIn ? "" : tpl.description,
    source: tpl.source,
    sourceConfig: configWithDefaults(tpl.source, tpl.sourceConfig),
    columns: columnsFromTemplate(tpl.columns),
    // How a sheet should sync depends on where its rows come from: a sheet
    // backed by tasks or Meta metrics lets Cubes win a tie, a sheet of its own
    // rows lets the newest edit win. Reset with the template, since choosing a
    // template is choosing the source.
    settings: defaultSettingsFor(tpl.source),
  };
}

const CATEGORY_ICON: Record<string, string> = {
  All: "apps",
  Content: "campaign",
  Tasks: "task_alt",
  Planning: "event_note",
  Custom: "grid_on",
  "Team templates": "bookmarks",
};
/**
 * The template gallery's layout.
 *
 * A CONTAINER query, not a media query: whether the 180px rail fits depends on
 * the modal's width, and the modal is min(980px, 100vw - 24px), so the
 * viewport would only be an indirect guess at it. Under 600px of gallery the
 * rail folds into a wrapping row of chips above the search (same buttons, same
 * handlers), because beside the rail the grid had less room than one tile.
 * The chips WRAP rather than scroll sideways, so none of them is half hidden,
 * and they drop their icons there to fit in two rows instead of three.
 *
 * The grid's track is min(200px, 100%) so a single column can never be wider
 * than the space it is in — the old bare 200px pushed tiles out of view.
 *
 * The scroller carries 4px of padding, cancelled by a negative margin on the
 * top, bottom and left so the tiles do not move, so a keyboard user's focus
 * ring on an edge tile is not cut off by the scroller's own edge. (Not on the
 * right: there it would poke 4px out of the modal body.) No hover on the tiles — cards in Sheets don't
 * change under the mouse — but a keyboard user always sees where they are.
 */
const GALLERY_CSS = `
.shw-gallery-wrap { container: shw-gallery / inline-size; }
.shw-gallery { display: flex; min-height: 420px; max-height: 62vh; }
.shw-rail { width: 180px; flex: none; border-right: 1px solid var(--shw-split); padding: 4px 10px 10px 0; display: flex; flex-direction: column; gap: 2px; }
.shw-cat { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 8px; border: none; cursor: pointer; text-align: left; font-size: 13px; }
.shw-cat-label { flex: 1; }
.shw-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding-left: 16px; }
.shw-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 4px; margin: -4px 0 -4px -4px; }
.shw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); gap: 12px; }
.shw-tile:focus-visible, .shw-cat:focus-visible { outline: 2px solid #1e9e6a; outline-offset: 2px; }
@container shw-gallery (max-width: 599px) {
  .shw-gallery { flex-direction: column; min-height: 0; }
  .shw-rail { width: auto; flex-direction: row; flex-wrap: wrap; gap: 6px; border-right: none; border-bottom: 1px solid var(--shw-split); padding: 0 0 12px; margin-bottom: 12px; }
  .shw-cat { padding: 4px 11px; border-radius: 999px; border: 1px solid var(--shw-hair); font-size: 12.5px; }
  .shw-cat .material-symbols-rounded { display: none; }
  .shw-main { padding-left: 0; }
}
`;

const CATEGORY_TINT: Record<string, string> = {
  Content: "#d9480f",
  Tasks: "#4a4ad0",
  Planning: "#2f9c9c",
  Custom: "#1e9e6a",
  "Team templates": "#862e9c",
};

export function NewSheetWizard({
  open,
  onClose,
  onCreated,
  teamId,
  isAdmin,
  currentUserId,
  projectId,
  lockProject,
  projects,
  installed,
  restore,
  returnTo,
  initialTemplateKey,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (sheet: SheetRecordRow) => void;
  teamId: string;
  isAdmin: boolean;
  currentUserId: string | null;
  /** Where the sheet goes by default (null = workspace). */
  projectId: string | null;
  /** Embedded in a project tab: the location is fixed. */
  lockProject: boolean;
  projects: { id: string; name: string; color: string }[];
  installed: InstalledLike[] | undefined;
  /** A draft parked before the Google consent redirect. */
  restore?: WizardDraft | null;
  returnTo: string;
  /** Opens straight on a template's details (e.g. "Content calendar"). */
  initialTemplateKey?: string | null;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const templates = useSheetTemplates();
  const deleteTemplate = useDeleteSheetTemplate();
  const connections = useGoogleConnections();
  const { isLimited, known: accessKnown, failed: accessFailed, error: accessError, retry: retryAccess, retrying: accessRetrying } =
    useIsLimitedMember();
  const createSheet = useCreateSheet();

  const [draft, setDraft] = useState<WizardDraft>(() => blankDraft(projectId));
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  // Re-seed every time the wizard opens: a previous, abandoned draft must not
  // reappear, and the location follows whatever scope the user is now in.
  const [seed, setSeed] = useState<string | null>(null);
  const seedKey = open ? `${projectId ?? "ws"}:${restore ? "restore" : ""}:${initialTemplateKey ?? ""}` : null;
  if (seedKey !== seed) {
    setSeed(seedKey);
    if (seedKey) {
      let next = restore ? { ...restore, projectId: lockProject ? projectId : restore.projectId } : blankDraft(projectId);
      if (!restore && initialTemplateKey) {
        const tpl = BUILT_IN_TEMPLATES.find((t) => t.key === initialTemplateKey);
        if (tpl) next = draftFromTemplate(next, tpl);
      }
      setDraft(next);
      setCategory("All");
      setSearch("");
    }
  }

  const set = (patch: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const allTemplates = useMemo(() => {
    const team = (templates.data ?? []).map((t) => ({ ...t, category: "Custom" as const }));
    return { builtIn: BUILT_IN_TEMPLATES, team };
  }, [templates.data]);

  const q = search.trim().toLowerCase();
  const shown: (SheetTemplate | TeamSheetTemplate)[] = useMemo(() => {
    const pool: (SheetTemplate | TeamSheetTemplate)[] =
      category === "Team templates" ? allTemplates.team : [...allTemplates.builtIn, ...allTemplates.team];
    return pool.filter((t) => {
      if (q) return `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q);
      if (category === "All" || category === "Team templates") return t.key !== "blank";
      return t.builtIn && t.category === category;
    });
  }, [allTemplates, category, q]);

  const availability = (source: SheetSource) => sourceAvailability(source, draft.projectId, installed);
  const sourceOk = availability(draft.source).ok;

  const changeSource = (source: SheetSource) => {
    if (source === draft.source) return;
    // Keep the user's own columns; swap the source fields for the new source's defaults.
    const custom = draft.columns.filter((c) => !c.field);
    const fields = source === "custom" ? [] : defaultColumns(source);
    const taken = fields.map((c) => c.id);
    const kept = custom.map((c) => (taken.includes(c.id) ? { ...c, id: newColumnId([...taken, ...custom.map((x) => x.id)]) } : c));
    set({ source, sourceConfig: configWithDefaults(source), columns: [...fields, ...kept], templateKey: null });
  };

  /* ---------------- steps ---------------- */

  const canNext = (() => {
    if (draft.step === 1) return Boolean(draft.name.trim()) && sourceOk;
    if (draft.step === 2) return draft.columns.length > 0 && draft.columns.every((c) => c.label.trim());
    return true;
  })();

  const create = async () => {
    if (!draft.name.trim()) {
      set({ step: 1 });
      return;
    }
    const conn = pickConnection(connections.data, draft.connectionId);
    // Decision A: a sheet IS its Google Sheet, so there is no sheet to make
    // without an account to make it in. The gate above means the wizard cannot
    // normally be reached in this state — this catches the account being
    // revoked while the wizard sat open.
    if (!conn) {
      message.warning(NEEDS_GOOGLE_TO_CREATE);
      return;
    }
    if (draft.target.mode === "existing" && !draft.target.picked) {
      message.warning("Choose the spreadsheet from Google Drive first.");
      return;
    }
    try {
      const { sheet, googleError, link, watch } = await createSheet.mutateAsync({
        name: draft.name,
        description: draft.description,
        projectId: draft.projectId,
        source: draft.source,
        sourceConfig: draft.sourceConfig,
        columns: draft.columns.map((c) => ({ ...c, label: c.label.trim() })),
        templateKey: draft.templateKey,
        google: {
          connectionId: conn.id,
          mode: draft.target.mode === "existing" ? "existing" : "create",
          spreadsheetId: draft.target.mode === "existing" ? draft.target.picked?.id : undefined,
          ...draft.settings,
        },
      });
      // One sentence for the whole outcome, in the Google panel's own words:
      // whether the sheet got its spreadsheet, AND whether Google will push
      // changes back or the timer is doing the work. Creating is where most
      // watch channels are born and it was the one place that said nothing.
      // Google refusing the spreadsheet keeps the sheet on purpose — its own
      // card offers "Try again".
      const notice = describeSheetCreated({
        googleError,
        watch,
        fallback: {
          autoSync: link?.auto_sync ?? draft.settings.autoSync,
          intervalMinutes: link?.interval_minutes ?? draft.settings.intervalMinutes,
        },
      });
      message[notice.tone]({ content: notice.text, duration: notice.tone === "success" ? 5 : 8 });
      onCreated(sheet);
    } catch (err) {
      message.error(errMsg(err, "Couldn't create the sheet."));
    }
  };

  /* ---------------- step 0: templates ---------------- */

  const tile = (t: SheetTemplate | TeamSheetTemplate) => {
    const av = availability(t.source);
    const tint = t.builtIn ? (CATEGORY_TINT[t.category] ?? "#1e9e6a") : CATEGORY_TINT["Team templates"];
    const ownTemplate = !t.builtIn && "createdBy" in t && (t.createdBy === currentUserId || isAdmin);
    const body = (
      <button
        type="button"
        disabled={!av.ok}
        onClick={() => setDraft((d) => draftFromTemplate(d, t))}
        className="shw-tile"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          cursor: av.ok ? "pointer" : "not-allowed",
          opacity: av.ok ? 1 : 0.55,
          textAlign: "left",
          minHeight: 150,
          padding: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 72,
            width: "100%",
            background: `color-mix(in srgb, ${tint} 9%, transparent)`,
          }}
        >
          <MIcon name={t.icon} size={30} color={tint} />
        </div>
        {/* border-box: with the default content-box, width 100% PLUS the side
            padding made this 24px wider than the tile, and the tile's
            overflow:hidden cut the end of every description off. */}
        <div style={{ padding: "10px 12px 12px", flex: 1, width: "100%", boxSizing: "border-box", minWidth: 0, overflowWrap: "anywhere" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t.name}</span>
            {t.builtIn ? null : (
              <Tag style={{ margin: 0, fontSize: 10, lineHeight: "15px" }} color="purple">
                Team
              </Tag>
            )}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.45 }}>
            {av.ok ? t.description : av.reason}
          </div>
          {t.source !== "custom" ? (
            <div style={{ marginTop: 6, fontSize: 11, color: token.colorTextTertiary, display: "flex", alignItems: "center", gap: 4 }}>
              <MIcon name={SOURCES[t.source].icon} size={12} /> {SOURCES[t.source].label}
            </div>
          ) : null}
        </div>
      </button>
    );
    return (
      <div key={`${t.builtIn ? "b" : "t"}:${t.key}`} style={{ position: "relative" }}>
        {av.ok ? body : <Tooltip title={av.reason}>{body}</Tooltip>}
        {ownTemplate ? (
          <Popconfirm
            title="Delete this team template?"
            description="Sheets already made from it are not affected."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() =>
              deleteTemplate.mutate(t.key, {
                onSuccess: () => message.success("Template deleted."),
                onError: (err) => message.error(errMsg(err, "Couldn't delete the template.")),
              })
            }
          >
            <Button
              size="small"
              type="text"
              aria-label="Delete template"
              icon={<MIcon name="delete" size={15} />}
              style={{ position: "absolute", top: 6, right: 6 }}
            />
          </Popconfirm>
        ) : null}
      </div>
    );
  };

  // Layout lives in the stylesheet at the bottom (GALLERY_CSS), not inline:
  // below ~600px of modal the 180px category rail left the grid ~110px, less
  // than one 200px tile, so every tile was cut off behind a sideways
  // scroller. The rail folds into a wrapping row of chips there, and that
  // swap needs a container query, which an inline style cannot express.
  // Colours stay inline because they come from the theme tokens.
  const galleryStep = (
    <div className="shw-gallery-wrap" style={{ ["--shw-hair" as string]: token.colorBorder, ["--shw-split" as string]: token.colorSplit }}>
      <div className="shw-gallery">
        <div className="shw-rail" role="group" aria-label="Template categories">
          {["All", "Content", "Tasks", "Planning", "Custom", "Team templates"].map((c) => {
            const activeCat = !q && c === category;
            const count = c === "Team templates" ? allTemplates.team.length : null;
            return (
              <button
                key={c}
                type="button"
                className="shw-cat"
                aria-pressed={activeCat}
                onClick={() => {
                  setCategory(c);
                  setSearch("");
                }}
                style={{
                  fontWeight: activeCat ? 600 : 500,
                  background: activeCat ? token.colorPrimaryBg : "transparent",
                  color: activeCat ? token.colorPrimary : token.colorTextSecondary,
                }}
              >
                <MIcon name={CATEGORY_ICON[c] ?? "widgets"} size={17} color={activeCat ? token.colorPrimary : token.colorTextTertiary} />
                <span className="shw-cat-label">{c}</span>
                {count ? <span style={{ fontSize: 11 }}>{count}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="shw-main">
          <Input
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
            style={{ maxWidth: 320, marginBottom: 12 }}
          />
          <div className="shw-scroll">
            {shown.length === 0 && (q || category === "Team templates") ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={q ? `Nothing matches "${search.trim()}"` : "No team templates yet — open a sheet and use “Save as template”."}
                style={{ marginTop: 40 }}
              />
            ) : (
              <div className="shw-grid">
                {!q && category === "All" ? (
                  <button
                    type="button"
                    className="shw-tile shw-scratch"
                    onClick={() => set({ ...blankDraft(draft.projectId), step: 1, name: draft.name })}
                      style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      borderRadius: 12,
                      border: `1.5px dashed ${token.colorBorder}`,
                      background: token.colorBgContainer,
                      cursor: "pointer",
                      textAlign: "left",
                      minHeight: 150,
                      padding: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, minHeight: 72, width: "100%" }}>
                      <MIcon name="add_circle" size={32} color={token.colorTextQuaternary} />
                    </div>
                    <div style={{ padding: "10px 12px 12px", width: "100%", boxSizing: "border-box", minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>Start from scratch</div>
                      <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.45 }}>
                        Pick a data source and build your own columns.
                      </div>
                    </div>
                  </button>
                ) : null}
                {shown.map(tile)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------------- step 1: details + source ---------------- */

  const detailsStep = (
    <div style={{ display: "grid", gap: 16, maxHeight: "62vh", overflowY: "auto", paddingRight: 4 }}>
      {/* Two columns while each can hold "Workspace (every member can open it)";
          on a phone the pair stacks, where side by side cut that label to
          "Workspace (ever…". */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Name</div>
          <Input autoFocus value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. March content calendar" />
        </div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Lives in</div>
          <Select
            disabled={lockProject}
            value={draft.projectId ?? "__ws"}
            onChange={(v) => set({ projectId: v === "__ws" ? null : v })}
            style={{ width: "100%" }}
            options={[
              { value: "__ws", label: "Workspace (every member can open it)" },
              ...projects.map((p) => ({
                value: p.id,
                label: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color }} />
                    {p.name}
                  </span>
                ),
              })),
            ]}
          />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Description (optional)</div>
        <Input.TextArea value={draft.description} maxLength={2000} autoSize={{ minRows: 1, maxRows: 4 }} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Rows come from</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
          {(Object.keys(SOURCES) as SheetSource[]).map((s) => {
            const d = SOURCES[s];
            const av = availability(s);
            const on = draft.source === s;
            const card = (
              <button
                key={s}
                type="button"
                disabled={!av.ok}
                onClick={() => changeSource(s)}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  width: "100%",
                  border: `1.5px solid ${on ? token.colorPrimary : token.colorBorderSecondary}`,
                  background: on ? token.colorPrimaryBg : token.colorBgContainer,
                  cursor: av.ok ? "pointer" : "not-allowed",
                  opacity: av.ok ? 1 : 0.55,
                }}
              >
                <MIcon name={d.icon} size={20} color={on ? token.colorPrimary : token.colorTextTertiary} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>{d.label}</span>
                  <span style={{ display: "block", fontSize: 11.5, color: token.colorTextSecondary, marginTop: 2 }}>
                    {av.ok ? d.description : av.reason}
                  </span>
                </span>
              </button>
            );
            return av.ok ? card : <Tooltip key={s} title={av.reason}>{card}</Tooltip>;
          })}
        </div>
        {(() => {
          const av = availability(draft.source);
          return av.ok ? null : <div style={{ fontSize: 12, color: token.colorErrorText, marginTop: 6 }}>{av.reason}</div>;
        })()}
      </div>
      {SOURCES[draft.source].config.length > 0 ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Settings</div>
          {SOURCES[draft.source].config.map((f) => {
            const v = draft.sourceConfig[f.key] ?? f.default;
            const setV = (value: unknown) => set({ sourceConfig: { ...draft.sourceConfig, [f.key]: value } });
            if (f.kind === "boolean") {
              return (
                <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <Switch size="small" checked={v === true} onChange={setV} /> {f.label}
                </label>
              );
            }
            if (f.kind === "select") {
              return (
                <div key={f.key} style={{ display: "grid", gridTemplateColumns: "140px 1fr", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13 }}>{f.label}</span>
                  <Select value={v as string} onChange={setV} options={f.options} />
                </div>
              );
            }
            return null;
          })}
        </div>
      ) : null}
    </div>
  );

  /* ---------------- step 2: columns ---------------- */

  const src = SOURCES[draft.source];
  const usedFields = new Set(draft.columns.filter((c) => c.field).map((c) => c.field));
  const addableFields = src.fields.filter((f) => !usedFields.has(f.key));
  const patchCol = (id: string, fn: (c: SheetColumn) => SheetColumn) => set({ columns: draft.columns.map((c) => (c.id === id ? fn(c) : c)) });
  const moveCol = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= draft.columns.length) return;
    const next = [...draft.columns];
    [next[i], next[j]] = [next[j], next[i]];
    set({ columns: next });
  };

  const columnsStep = (
    <div style={{ display: "grid", gap: 10, maxHeight: "62vh", overflowY: "auto", paddingRight: 4 }}>
      <div style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
        {draft.source === "custom"
          ? "Your columns, in order. Types can still change after the sheet is made."
          : `Fields from ${src.label} read and write the real records; custom columns hold your own notes next to them. Locked fields are read-only.`}
      </div>
      {draft.columns.map((c, i) => {
        const field = c.field ? src.fields.find((f) => f.key === c.field) : undefined;
        return (
          <div key={c.id} style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10, padding: "6px 10px", display: "grid", gap: 6 }}>
            {/* Wraps instead of squeezing: on a phone the type picker and the
                three buttons left the name box ~10px wide, so a column's own
                name could not be read. The name keeps at least 160px, and
                the type and buttons move to a second line AS ONE GROUP —
                wrapping them one by one split "up" from "down". */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <MIcon name={TYPE_ICONS[c.type]} size={16} color={token.colorTextTertiary} />
              <Input size="small" value={c.label} maxLength={120} onChange={(e) => patchCol(c.id, (x) => ({ ...x, label: e.target.value }))} style={{ flex: "1 1 160px", minWidth: 0 }} status={c.label.trim() ? undefined : "error"} />
              <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none", marginLeft: "auto" }}>
                {field ? (
                  <Tag style={{ margin: 0 }} icon={field.writable ? undefined : <MIcon name="lock" size={11} />}>
                    {TYPE_LABELS[c.type]}
                  </Tag>
                ) : (
                  <Select
                    size="small"
                    value={c.type}
                    style={{ width: 140 }}
                    onChange={(t) =>
                      patchCol(c.id, (x) => {
                        const fresh = makeCustomColumn(t, x.label, []);
                        return { ...fresh, id: x.id, label: x.label, ...(t === "select" || t === "multi_select" ? { options: x.options ?? [] } : {}) };
                      })
                    }
                    options={(Object.keys(TYPE_LABELS) as SheetColumn["type"][]).map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
                  />
                )}
                <Button size="small" type="text" aria-label="Move up" disabled={i === 0} onClick={() => moveCol(i, -1)} icon={<MIcon name="arrow_upward" size={15} />} />
                <Button size="small" type="text" aria-label="Move down" disabled={i === draft.columns.length - 1} onClick={() => moveCol(i, 1)} icon={<MIcon name="arrow_downward" size={15} />} />
                <Button size="small" type="text" aria-label="Remove column" onClick={() => set({ columns: draft.columns.filter((x) => x.id !== c.id) })} icon={<MIcon name="close" size={15} />} />
              </span>
            </div>
            {!field && (c.type === "select" || c.type === "multi_select") ? (
              <div style={{ paddingLeft: 24 }}>
                <OptionsEditor options={c.options ?? []} onChange={(options) => patchCol(c.id, (x) => ({ ...x, options }))} />
              </div>
            ) : null}
            {!field && c.type === "currency" ? (
              <div style={{ paddingLeft: 24 }}>
                <Select size="small" value={c.currency} allowClear placeholder="Currency" style={{ width: 140 }} onChange={(v) => patchCol(c.id, (x) => ({ ...x, currency: v || undefined }))} options={CURRENCIES.map((x) => ({ value: x, label: x }))} />
              </div>
            ) : null}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: (Object.keys(TYPE_LABELS) as SheetColumn["type"][]).map((t) => ({ key: t, label: TYPE_LABELS[t], icon: <MIcon name={TYPE_ICONS[t]} size={15} /> })),
            onClick: ({ key }) => {
              const t = key as SheetColumn["type"];
              set({ columns: [...draft.columns, makeCustomColumn(t, TYPE_LABELS[t], draft.columns.map((c) => c.id))] });
            },
          }}
        >
          <Button icon={<MIcon name="add" size={16} />}>Custom column</Button>
        </Dropdown>
        {addableFields.length > 0 ? (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: addableFields.map((f) => ({
                key: f.key,
                label: (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {f.label} {f.writable ? null : <MIcon name="lock" size={12} />}
                  </span>
                ),
                icon: <MIcon name={TYPE_ICONS[f.type]} size={15} />,
              })),
              onClick: ({ key }) => {
                const f = src.fields.find((x) => x.key === key);
                if (!f) return;
                set({
                  columns: [
                    ...draft.columns,
                    { id: newColumnId(draft.columns.map((c) => c.id)), label: f.label, type: f.type, field: f.key, ...(f.dynamicOptions ? { dynamicOptions: f.dynamicOptions } : {}) },
                  ],
                });
              },
            }}
          >
            <Button icon={<MIcon name={src.icon} size={16} />}>Field from {src.label}</Button>
          </Dropdown>
        ) : null}
      </div>
    </div>
  );

  /* ---------------- step 3: Google ---------------- */

  const googleStep = (
    <div style={{ display: "grid", gap: 16, maxHeight: "62vh", overflowY: "auto", paddingRight: 4 }}>
      <GoogleTargetChooser
        teamId={teamId}
        isAdmin={isAdmin}
        connections={connections.data}
        connectionsLoading={connections.isLoading}
        connectionId={draft.connectionId}
        onConnectionChange={(id) => set({ connectionId: id })}
        target={draft.target}
        onTargetChange={(target) => set({ target })}
        returnTo={returnTo}
        onBeforeConnect={() => parkDraft(draft)}
        allowNone={false}
      />
      <div style={{ borderTop: `1px solid ${token.colorSplit}`, paddingTop: 14 }}>
        <GoogleSettingsFields value={draft.settings} onChange={(settings) => set({ settings })} source={draft.source} />
      </div>
    </div>
  );

  const steps = [galleryStep, detailsStep, columnsStep, googleStep];
  const appHint = SOURCES[draft.source].appKey ? APP_NAMES[SOURCES[draft.source].appKey as string] : null;

  // DECISION A, GATED EARLY. The wizard's own entry points are already
  // disabled without a Google account, but a deep link (?newSheet=…), a
  // bookmarked ?sheetsWizard=1 or a stale tab can still land here — so the
  // whole body becomes the notice rather than four steps ending in a refusal.
  // Until the queries answer we know neither way: show a skeleton, not the
  // steps, so nothing is offered and then taken away.
  // A read that FAILED is its own answer — not "no Google account" and not
  // "a full member". It blocks creation (we genuinely do not know) and says
  // so, with a retry, rather than accusing the workspace of a missing
  // connection it may well have.
  const googleState = googleGate(connections);
  const checkFailed = googleState === "error" || accessFailed;
  const gateUnknown = !checkFailed && (googleState === "unknown" || !accessKnown);
  // A limited member's sheet cannot get its Google file at all (the routes
  // refuse them, because Drive shares the whole file and they are restricted
  // to their own rows), so creating one would make exactly the half-thing
  // Decision A removes. They still OPEN sheets, in their own grid.
  const gate: "none" | "limited" | "google" | "unavailable" = gateUnknown
    ? "none"
    : checkFailed
      ? "unavailable"
      : isLimited
        ? "limited"
        : googleState === "ready"
          ? "none"
          : "google";
  const blocked = gate !== "none";

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="min(980px, calc(100vw - 24px))"
      destroyOnHidden
      maskClosable={false}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <MIcon name="table_view" size={19} color="#1e9e6a" /> New sheet
          {!blocked && draft.step > 0 && appHint ? <Tag style={{ marginLeft: 4 }}>{appHint}</Tag> : null}
        </span>
      }
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!blocked && !gateUnknown && draft.step > 0 ? <Button onClick={() => set({ step: draft.step - 1 })}>Back</Button> : null}
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>{blocked ? "Close" : "Cancel"}</Button>
          {blocked || gateUnknown || draft.step === 0 ? null : draft.step < 3 ? (
            <Button type="primary" disabled={!canNext} onClick={() => set({ step: draft.step + 1 })}>
              Next
            </Button>
          ) : (
            <Button type="primary" loading={createSheet.isPending} onClick={() => void create()} disabled={!draft.name.trim() || !sourceOk || draft.columns.length === 0}>
              Create sheet
            </Button>
          )}
        </div>
      }
    >
      {gateUnknown ? (
        <Skeleton active paragraph={{ rows: 6 }} style={{ minHeight: 300 }} />
      ) : gate === "unavailable" ? (
        <GoogleCheckFailedNotice
          what={googleState === "error" ? "Google" : "your access"}
          error={googleState === "error" ? connections.error : accessError}
          retrying={googleState === "error" ? connections.isFetching : accessRetrying}
          onRetry={() => {
            if (googleState === "error") void connections.refetch();
            if (accessFailed) retryAccess();
          }}
        />
      ) : gate === "limited" ? (
        <LimitedCannotCreate />
      ) : gate === "google" ? (
        <GoogleRequiredNotice
          teamId={teamId}
          isAdmin={isAdmin}
          returnTo={returnTo}
          connections={connections.data}
          // Park whatever the template already filled in, so a deep link like
          // /apps/sheets?newSheet=content_calendar survives the consent
          // redirect and comes back with its template still chosen.
          onBeforeConnect={() => parkDraft(draft)}
        />
      ) : (
        <>
          <Steps
            size="small"
            current={draft.step}
            style={{ margin: "8px 0 18px" }}
            onChange={(s) => {
              // Jumping back is free; jumping ahead needs the details that the
              // skipped steps would have asked for.
              const ready = draft.step > 0 && Boolean(draft.name.trim()) && sourceOk && draft.columns.length > 0;
              if (s < draft.step || ready) set({ step: s });
            }}
            items={[{ title: "Template" }, { title: "Details" }, { title: "Columns" }, { title: "Google Sheets" }]}
          />
          {steps[draft.step]}
        </>
      )}
      <style>{GALLERY_CSS}</style>
    </Modal>
  );
}
