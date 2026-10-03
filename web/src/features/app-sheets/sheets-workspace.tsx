"use client";

/**
 * Sheets app — the workspace. One component serves both surfaces, like
 * Content Studio: `/apps/sheets` (a rail with "Workspace sheets" and every
 * project the app is active in) and a project's Sheets tab (`embedded`, that
 * project's sheets only).
 *
 * URL: on the app page the open scope and sheet ride in `?project=` and
 * `?sheet=`, so a workflow's run log or a teammate can link straight to a
 * sheet. `?newSheet=<template key>` opens the wizard on that template (the
 * Content Studio card uses it) and `?sheetsWizard=1` brings a parked wizard
 * draft back after the Google consent redirect.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Alert, Button, Input, Segmented, Skeleton, Tooltip, Typography } from "antd";
import { SOURCES } from "@/lib/sheets/sources";
import { MONO_FONT } from "@/lib/theme";
import { useActivateAppForProject, useAppActivatedProjects, useAppScope } from "@/features/apps-platform/app-scope";
import { useInstallApp, useInstalledApps, useIsTeamAdmin } from "@/features/apps-platform/use-installed-apps";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import { useProjects } from "@/features/projects/use-projects";
import { MIcon, useC } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import { GoogleCheckFailedNotice, GoogleRequiredNotice } from "./google-setup";
import { googleGate } from "./sheet-model";
import { NewSheetWizard, clearParkedDraft, peekParkedDraft, type WizardDraft } from "./new-sheet-wizard";
import { SheetView } from "./sheet-view";
import { SheetsMigrationPendingError, useGoogleConnections, useIsLimitedMember, useSheets } from "./use-sheets";
import {
  SheetsCollection,
  SheetsGridSkeleton,
  SheetsListStyles,
  useSheetsViewMode,
  type SheetsGoogleAccess,
  type SheetsViewMode,
} from "./sheet-collection";
import { createShortcuts } from "./sheet-card";
import { SheetStarters } from "./sheet-starters";

const { Title, Paragraph } = Typography;

/** Hides a label from sight but not from a screen reader (the view toggle is icons only). */
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

/**
 * How far below a project's tab bar the Sheets tab starts — measured, not
 * picked: in the same project, Board's first column and List's first group
 * both begin 33–34px under the bar (their own small toolbar line sits in that
 * band). The Sheets header is the tab's first content, so it starts where
 * theirs does instead of touching the bar.
 */
const EMBEDDED_TOP_GAP = 34;

/** One-shot URL flags, dropped as soon as they have been acted on. */
const EPHEMERAL_PARAMS = ["newSheet", "sheetsWizard", "sheetsPanel", "google", "reason"];

function currentUrl(): URL | null {
  return typeof window === "undefined" ? null : new URL(window.location.href);
}

/** Rewrites only this workspace's params, without a navigation. */
function writeParams(params: Record<string, string | null>) {
  const url = currentUrl();
  if (!url) return;
  for (const [k, v] of Object.entries(params)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Where Google should send the user back to, with our own flags added. */
function returnToWith(extra: Record<string, string>): string {
  const url = currentUrl();
  if (!url) return "/apps/sheets";
  for (const k of EPHEMERAL_PARAMS) url.searchParams.delete(k);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}`;
}

/** What the URL asked for when the workspace mounted. Pure: safe in state initializers. */
function readBootParams() {
  const p = currentUrl()?.searchParams;
  return {
    sheet: p?.get("sheet") ?? null,
    project: p?.get("project") ?? null,
    newSheet: p?.get("newSheet") ?? null,
    wizard: p?.get("sheetsWizard") === "1",
    panel: p?.get("sheetsPanel") ?? null,
    google: p?.get("google") ?? null,
    reason: p?.get("reason") ?? null,
  };
}

function InstallPrompt({ admin, installing, onInstall, onManage }: { admin: boolean; installing: boolean; onInstall: () => void; onManage: () => void }) {
  const C = useC();
  return (
    <div style={{ minHeight: 420, background: C.panelSoft, border: `1px solid ${C.hair}`, borderRadius: 26, padding: 28, display: "grid", placeItems: "center" }}>
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 22,
            margin: "0 auto 18px",
            background: "linear-gradient(135deg,#34c38f,#1e9e6a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 16px 40px rgba(30,158,106,0.25)",
          }}
        >
          <MIcon name="table_view" size={34} color="#fff" />
        </div>
        <Title level={2} style={{ marginBottom: 8 }}>
          Sheets
        </Title>
        <Paragraph style={{ color: C.textSecondary, fontSize: 15 }}>
          Spreadsheets built from templates or your own columns — bound to your tasks, Content Studio or Meta Ads data,
          and kept in two-way sync with Google Sheets.
        </Paragraph>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          {admin ? (
            <Button type="primary" size="large" loading={installing} onClick={onInstall}>
              Install Sheets
            </Button>
          ) : (
            <Button size="large" onClick={onManage}>
              Open App Center
            </Button>
          )}
          <Button size="large" onClick={onManage}>
            Manage apps
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SheetsWorkspace({ projectId, embedded = false }: { projectId?: string; embedded?: boolean }) {
  const router = useRouter();
  const C = useC();
  const { message } = App.useApp();
  const { data: team } = useActiveTeam();
  const { user } = useAuth();
  const installedQuery = useInstalledApps();
  const installedApps = installedQuery.data;
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const installApp = useInstallApp();
  const activate = useActivateAppForProject();
  const scope = useAppScope("sheets");
  const { data: activatedProjects } = useAppActivatedProjects("sheets");
  const { data: allProjects } = useProjects();
  const sheetsQuery = useSheets();
  // DECISION A: a sheet IS its Google Sheet, so creating one before an account
  // is connected would only make a placeholder that cannot be opened. The gate
  // lives HERE, on the buttons that start the wizard, rather than at the end of
  // it — see GoogleRequiredNotice. Sheets that already exist without a
  // spreadsheet are untouched; their own card still offers to make one.
  const connections = useGoogleConnections();
  // A limited member cannot own the creation either: the Google half of a new
  // sheet is refused for them by the routes (Drive shares the whole file, and
  // they are restricted to their own rows). They still open every sheet they
  // can see — in Cubes' own grid. See limited-grid.tsx.
  const { isLimited, known: accessKnown, failed: accessFailed, error: accessError, retry: retryAccess, retrying: accessRetrying } =
    useIsLimitedMember();

  // Deep links, a template to start from, and the return from Google's
  // consent screen are read once, as initial state. window.location rather
  // than useSearchParams keeps the app page free of a Suspense boundary; the
  // server renders the loading skeleton either way, so nothing mismatches.
  const [boot] = useState(readBootParams);
  // Standalone: which scope the rail shows ("ws" = workspace sheets).
  const [railScope, setRailScope] = useState<string>(() => (!embedded && boot.project) || "ws");
  const [openSheetId, setOpenSheetId] = useState<string | null>(boot.sheet);
  const [wizard, setWizard] = useState<{ restore: WizardDraft | null; template: string | null } | null>(() =>
    boot.wizard ? { restore: peekParkedDraft(), template: null } : boot.newSheet ? { restore: null, template: boot.newSheet } : null,
  );
  const [initialPanel, setInitialPanel] = useState<string | null>(boot.panel);
  const [listSearch, setListSearch] = useState("");
  // Cards or a compact list — this viewer's choice, remembered in this browser.
  const [view, setView] = useSheetsViewMode();

  const installRecord = installedApps?.find((a) => a.app_key === "sheets");
  const installed = Boolean(installRecord?.enabled);
  const teamId = team?.id;
  const scopeProjectId: string | null = embedded ? (projectId ?? null) : railScope === "ws" ? null : railScope;

  // The one-shot flags have been turned into state above; tell the user what
  // Google said, consume the parked draft and tidy the URL.
  //
  // The initial read can come up empty: on a client-side navigation (Content
  // Studio's "Create a Content calendar sheet" pushes
  // /apps/sheets?newSheet=content_calendar) the App Router commits the new URL
  // only after this component's first render, so `window.location` was still
  // the previous page when the state initializers ran. By the time this effect
  // fires the address bar is right, so re-read it and act on anything the
  // first read missed — otherwise those links land on a bare sheet list.
  const bootApplied = useRef(false);
  useEffect(() => {
    if (bootApplied.current) return;
    bootApplied.current = true;
    const late = readBootParams();
    // These run once, on mount, and only when the first read missed something
    // the address bar turned out to hold — the one moment the URL can be read
    // reliably without pulling the whole page under a Suspense boundary for
    // useSearchParams.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!boot.sheet && late.sheet) setOpenSheetId(late.sheet);
    if (!boot.panel && late.panel) setInitialPanel(late.panel);
    if (!embedded && !boot.project && late.project) setRailScope(late.project);
    if (!boot.wizard && !boot.newSheet && (late.wizard || late.newSheet)) {
      setWizard(late.wizard ? { restore: peekParkedDraft(), template: null } : { restore: null, template: late.newSheet });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    const google = boot.google ?? late.google;
    const reason = boot.reason ?? late.reason;
    if (google === "connected") message.success("Google account connected.");
    else if (google === "error") message.error(`Google didn't connect${reason ? ` (${reason})` : ""}. Try again or ask an admin.`);
    if (boot.wizard || late.wizard) clearParkedDraft();
    // In a project tab the open sheet isn't kept in the URL (the tab owns it),
    // so a `sheet` that came back from Google is dropped once it is open.
    writeParams({ google: null, reason: null, sheetsWizard: null, newSheet: null, sheetsPanel: null, ...(embedded ? { sheet: null } : {}) });
  }, [boot, message, embedded]);

  const projectName = useMemo(() => {
    const map = new Map((allProjects ?? []).map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "Project") : null);
  }, [allProjects]);
  // The app page's cards name each sheet's project the way the rail draws it:
  // its colour and its name. A workspace sheet has no colour of its own.
  const projectOf = useMemo(() => {
    const map = new Map((allProjects ?? []).map((p) => [p.id, { name: p.name, color: p.color_code ?? "#8a8d98" }]));
    return (id: string | null) => (id ? (map.get(id) ?? { name: "Project", color: "#8a8d98" }) : { name: "Workspace", color: null });
  }, [allProjects]);

  const sheets = sheetsQuery.data;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sheets ?? []) m.set(s.project_id ?? "ws", (m.get(s.project_id ?? "ws") ?? 0) + 1);
    return m;
  }, [sheets]);

  const scopedSheets = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return (sheets ?? [])
      .filter((s) => (s.project_id ?? null) === scopeProjectId)
      .filter((s) => !q || `${s.name} ${s.description ?? ""} ${SOURCES[s.source]?.label ?? ""}`.toLowerCase().includes(q));
  }, [sheets, scopeProjectId, listSearch]);

  // The open sheet is looked up, not stored: archived or deleted elsewhere, it
  // simply stops resolving and the list shows again.
  const openSheet = openSheetId ? (sheets ?? []).find((s) => s.id === openSheetId) ?? null : null;
  // A deep link to a sheet in another scope (or a project not in the rail)
  // still opens it; embedded tabs only open their own project's sheets.
  const openable = openSheet && (!embedded || openSheet.project_id === (projectId ?? null)) ? openSheet : null;

  const railProjects = useMemo(
    () =>
      (activatedProjects ?? [])
        .map((p) => ({ id: p.id, name: p.name, color: p.color_code ?? "#8a8d98", count: counts.get(p.id) ?? 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [activatedProjects, counts],
  );

  const selectScope = (next: string) => {
    setRailScope(next);
    setOpenSheetId(null);
    setListSearch("");
    writeParams({ project: next === "ws" ? null : next, sheet: null });
  };

  const openSheetById = (id: string | null) => {
    setOpenSheetId(id);
    setInitialPanel(null);
    if (!embedded) writeParams({ sheet: id });
  };

  const handleInstall = async () => {
    try {
      await installApp.mutateAsync("sheets");
      message.success("Sheets installed.");
    } catch (err) {
      message.error(errMsg(err, "Couldn't install Sheets."));
    }
  };

  if (installedQuery.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;

  if (!installed) {
    return (
      <InstallPrompt
        admin={Boolean(isTeamAdmin)}
        installing={installApp.isPending}
        onInstall={() => void handleInstall()}
        onManage={() => router.push("/apps?view=cubes")}
      />
    );
  }

  const notActiveHere = embedded && projectId && scope.mode === "selected" && !scope.projectIds.includes(projectId);
  const migrationPending = sheetsQuery.error instanceof SheetsMigrationPendingError;
  const scopeLabel = scopeProjectId ? projectName(scopeProjectId) : "Workspace sheets";
  // Three answers, not two: yes, no, and "we could not find out" (googleGate).
  // Unknown while a query is in flight — don't disable the button on a guess,
  // and don't show the notice before there is anything to report. FAILED is
  // its own state: a connections read that errored is not a workspace without
  // Google, and an access probe that errored is not a full member.
  const googleState = googleGate(connections);
  const checkFailed = googleState === "error" || accessFailed;
  const gateUnknown = !checkFailed && (googleState === "unknown" || !accessKnown);
  const needsGoogle = !gateUnknown && !checkFailed && !isLimited && googleState === "needs-google";
  const createBlocked = migrationPending || gateUnknown || checkFailed || isLimited || needsGoogle;
  const createBlockedWhy = migrationPending
    ? "Sheets isn't set up in this database yet."
    : checkFailed
      ? "Cubes couldn't check this workspace's Google connection — try again below."
      : isLimited
        ? "A sheet is created as a Google Sheet and shared with the whole workspace, so a full member has to make it."
        : needsGoogle
          ? "Connect a Google account first — every new sheet is created as a Google Sheet."
          : undefined;
  // Back to the list with the wizard open, so connecting from here lands
  // somewhere that can act on it rather than on a bare sheet list.
  const wizardReturnTo = returnToWith({ sheetsWizard: "1" });

  // The scope's own count, before the search narrows it — the header says
  // "3 of 7" while searching so the narrowing is visible.
  const scopeTotal = counts.get(scopeProjectId ?? "ws") ?? 0;
  const searching = Boolean(listSearch.trim());
  // Which Google controls the cards may offer this viewer — the same answer
  // the New sheet gate reads, never a guess while the probe is out.
  const googleAccess: SheetsGoogleAccess = accessFailed ? "failed" : !accessKnown ? "unknown" : isLimited ? "hidden" : "allowed";
  const startWizard = (template: string | null) => {
    // The create card and row are disabled when creating is blocked; this is
    // the second lock, so no stray event can open the wizard past the gate.
    if (createBlocked) return;
    setWizard({ restore: null, template });
  };

  const listView = (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px 16px", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span
              style={{
                fontSize: embedded ? 17 : 18,
                fontWeight: 800,
                letterSpacing: -0.2,
                color: C.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {embedded ? "Sheets" : scopeLabel}
            </span>
            {/* Hidden at zero: the empty state below already says so. */}
            {sheets && (scopeTotal > 0 || searching) ? (
              <span
                style={{
                  flex: "none",
                  fontFamily: MONO_FONT,
                  fontSize: 11.5,
                  fontWeight: 600,
                  lineHeight: "20px",
                  padding: "0 8px",
                  borderRadius: 999,
                  background: C.accentSoft,
                  color: C.accent,
                }}
              >
                {searching ? `${scopedSheets.length} of ${scopeTotal}` : scopeTotal}
              </span>
            ) : null}
          </div>
          {!embedded ? (
            <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 2 }}>
              {scopeProjectId ? "Sheets for this project's members." : "Sheets every workspace member can open."}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 380px", justifyContent: "flex-end", minWidth: 0 }}>
          <Input
            allowClear
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Find a sheet"
            prefix={<MIcon name="search" size={16} color={C.textTertiary} />}
            style={{ flex: "1 1 180px", maxWidth: 300, minWidth: 0 }}
          />
          {scopeTotal > 0 ? (
            <Segmented
              value={view}
              onChange={(v) => setView(v as SheetsViewMode)}
              options={[
                {
                  value: "grid",
                  title: "Cards",
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", height: "100%" }}>
                      <MIcon name="grid_view" size={17} />
                      <span style={VISUALLY_HIDDEN}>Cards</span>
                    </span>
                  ),
                },
                {
                  value: "list",
                  title: "List",
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", height: "100%" }}>
                      <MIcon name="view_list" size={17} />
                      <span style={VISUALLY_HIDDEN}>List</span>
                    </span>
                  ),
                },
              ]}
            />
          ) : null}
          <Tooltip title={createBlockedWhy}>
            <Button type="primary" icon={<MIcon name="add" size={17} />} onClick={() => setWizard({ restore: null, template: null })} disabled={createBlocked}>
              New sheet
            </Button>
          </Tooltip>
        </div>
      </div>
      {checkFailed ? (
        <GoogleCheckFailedNotice
          compact
          what={googleState === "error" ? "Google" : "your access"}
          error={googleState === "error" ? connections.error : accessError}
          retrying={googleState === "error" ? connections.isFetching : accessRetrying}
          onRetry={() => {
            if (googleState === "error") void connections.refetch();
            if (accessFailed) retryAccess();
          }}
        />
      ) : null}
      {needsGoogle && teamId ? (
        <GoogleRequiredNotice
          compact
          teamId={teamId}
          isAdmin={Boolean(isTeamAdmin)}
          returnTo={wizardReturnTo}
          connections={connections.data}
        />
      ) : null}
      {sheetsQuery.isLoading ? (
        <SheetsGridSkeleton />
      ) : sheetsQuery.isError ? (
        <Alert
          type={migrationPending ? "warning" : "error"}
          showIcon
          message={migrationPending ? "Sheets isn't set up in this database yet" : "Sheets couldn't be loaded"}
          description={errMsg(sheetsQuery.error, "Unknown error.")}
        />
      ) : scopedSheets.length === 0 ? (
        searching ? (
          // A search that finds nothing is not an empty scope: no templates here.
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "18px 2px", color: C.textSecondary, fontSize: 13.5 }}>
            <MIcon name="search_off" size={18} color={C.textTertiary} />
            <span>
              No sheets match <strong style={{ color: C.text }}>“{listSearch.trim()}”</strong>.
            </span>
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setListSearch("")}>
              Clear search
            </Button>
          </div>
        ) : (
          <SheetStarters
            projectId={scopeProjectId}
            installed={installedApps}
            blocked={createBlocked}
            blockedWhy={createBlockedWhy}
            onPick={(template) => setWizard({ restore: null, template })}
            onBrowse={() => setWizard({ restore: null, template: null })}
          />
        )
      ) : (
        <SheetsCollection
          sheets={scopedSheets}
          view={view}
          onOpen={(id) => openSheetById(id)}
          projectOf={embedded ? null : projectOf}
          googleAccess={googleAccess}
          // Not a search result, so it steps aside while a search is running;
          // the header's New sheet button stays reachable either way.
          create={
            searching
              ? null
              : {
                  blocked: createBlocked,
                  blockedWhy: createBlockedWhy,
                  shortcuts: createShortcuts(scopeProjectId, installedApps),
                  onNew: startWizard,
                }
          }
        />
      )}
    </div>
  );

  const content = notActiveHere ? (
    <Alert
      type="info"
      showIcon
      message="Sheets isn't active in this project"
      description="An admin chose which projects use Sheets. Activate it here to create this project's sheets."
      action={
        <Button
          size="small"
          loading={activate.isPending}
          onClick={() =>
            activate.mutate(
              { projectId: projectId as string, appKey: "sheets" },
              { onError: (err) => message.error(errMsg(err, "Only project admins can activate apps.")) },
            )
          }
        >
          Activate
        </Button>
      }
    />
  ) : openable && teamId ? (
    <SheetView
      key={openable.id}
      sheet={openable}
      teamId={teamId}
      isAdmin={Boolean(isTeamAdmin)}
      currentUserId={user?.id ?? null}
      projectName={projectName(openable.project_id)}
      returnTo={returnToWith({ sheet: openable.id, sheetsPanel: "google" })}
      initialPanel={initialPanel}
      onBack={() => openSheetById(null)}
    />
  ) : (
    listView
  );

  // The wizard offers the projects Sheets is active in — plus the one in view,
  // which a deep link (e.g. from Content Studio) can point at before an admin
  // has activated Sheets there.
  const wizardSource = embedded
    ? (allProjects ?? []).filter((p) => p.id === projectId)
    : [
        ...(activatedProjects ?? []),
        ...(allProjects ?? []).filter((p) => p.id === scopeProjectId && !(activatedProjects ?? []).some((a) => a.id === p.id)),
      ];
  const wizardProjects = wizardSource.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color_code ?? "#8a8d98",
  }));

  return (
    <>
      <div
        className={embedded ? "sheets-focus-sink" : "sheets-shell"}
        // In a project tab the nearest focusable ancestor is antd's tab pane
        // (tabIndex 0), so a click on blank space here focused the PANE, and
        // the next key press — even the ⌘⇧4 of a screenshot — lit antd's 3px
        // focus ring around the whole Sheets area. Catching that click here
        // (-1: never in the Tab order) keeps the pane's ring for keyboard users,
        // who reach the pane by Tab, and away from mouse users.
        tabIndex={embedded ? -1 : undefined}
        style={{
          display: embedded ? "block" : "flex",
          height: embedded ? "auto" : "calc(100vh - 58px)",
          margin: embedded ? 0 : "-22px -24px -48px",
          background: C.bg,
          overflow: "hidden",
        }}
      >
        {!embedded ? (
          <aside
            className="sheets-rail"
            style={{
              width: 252,
              flex: "none",
              minHeight: 0,
              borderRight: `1px solid ${C.hair}`,
              background: C.panel,
              padding: "16px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {(() => {
              const on = scopeProjectId === null;
              return (
                <button
                  type="button"
                  onClick={() => selectScope("ws")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    background: on ? C.accentSoft : "transparent",
                    color: on ? C.accentDeep : C.textSecondary,
                    fontSize: 13.5,
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  <MIcon name="table_view" size={18} color={on ? C.accentDeep : C.textTertiary} />
                  <span style={{ flex: 1 }}>Workspace sheets</span>
                  <span style={{ fontSize: 11.5, color: on ? C.accentDeep : C.textTertiary }}>{counts.get("ws") ?? 0}</span>
                </button>
              );
            })()}
            <div
              className="sheets-rail-label"
              style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.7, color: C.textTertiary, padding: "12px 10px 4px", textTransform: "uppercase" }}
            >
              Projects
            </div>
            <div className="sheets-rail-list" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {railProjects.length === 0 ? (
                <div style={{ fontSize: 12, color: C.textTertiary, padding: "4px 10px" }}>
                  {scope.mode === "selected" ? "Sheets isn't active in any project yet." : "No projects yet."}
                </div>
              ) : null}
              {railProjects.map((p) => {
                const on = scopeProjectId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectScope(p.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      background: on ? C.accentSoft : "transparent",
                      color: on ? C.accentDeep : C.textSecondary,
                      fontSize: 13.5,
                      fontWeight: on ? 700 : 500,
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: p.color, flex: "none" }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontSize: 11.5, color: on ? C.accentDeep : C.textTertiary }}>{p.count}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}

        <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: embedded ? `${EMBEDDED_TOP_GAP}px 0 18px` : "22px 24px 40px" }}>{content}</main>
      </div>

      {teamId ? (
        <NewSheetWizard
          open={wizard !== null}
          onClose={() => setWizard(null)}
          onCreated={(sheet) => {
            setWizard(null);
            if (!embedded) {
              const nextScope = sheet.project_id ?? "ws";
              setRailScope(nextScope);
              writeParams({ project: sheet.project_id ?? null });
            }
            openSheetById(sheet.id);
          }}
          teamId={teamId}
          isAdmin={Boolean(isTeamAdmin)}
          currentUserId={user?.id ?? null}
          projectId={scopeProjectId}
          lockProject={embedded}
          projects={wizardProjects}
          installed={installedApps}
          restore={wizard?.restore ?? null}
          initialTemplateKey={wizard?.template ?? null}
          returnTo={wizardReturnTo}
        />
      ) : null}
      <SheetsListStyles />
      {/* Below the shell's 900px breakpoint its padding shrinks to 16/14/40,
          and a 252px rail beside the list leaves a phone ~120px for sheets.
          So the app page matches the smaller padding and the rail becomes a
          strip of scope chips above the list — same buttons, same handlers. */}
      <style>{`
.sheets-focus-sink:focus, .sheets-focus-sink:focus-visible { outline: none; }
@media (max-width: 899px) {
  .sheets-shell { flex-direction: column; height: auto !important; margin: -16px -14px -40px !important; overflow: visible !important; }
  .sheets-shell > .sheets-rail { width: auto !important; flex-direction: row !important; align-items: center; gap: 6px !important;
    padding: 10px 14px !important; border-right: none !important; border-bottom: 1px solid ${C.hair}; overflow-x: auto; }
  .sheets-rail > *, .sheets-rail-list > * { flex: none !important; }
  .sheets-rail-label { display: none !important; }
  .sheets-rail-list { flex-direction: row !important; overflow: visible !important; gap: 6px !important; }
  .sheets-rail button { width: auto !important; white-space: nowrap; border: 1px solid ${C.hair} !important; }
  .sheets-shell > main { padding: 16px 14px 32px !important; overflow: visible !important; }
}`}</style>
    </>
  );
}
