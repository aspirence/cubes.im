"use client";

/**
 * Sheets — one open sheet: its toolbar (rename, columns, CSV, Google,
 * template, archive), the LIVE GOOGLE SHEET, and the drawers they open.
 *
 * The sheet itself is an embedded Google Sheet now, not our own grid — see
 * sheet-embed.tsx for why, and for what that costs. What stays on this side is
 * everything Google has no idea about: the sheet's name and description, which
 * of the source's fields are columns (that is the Google header layout), how it
 * syncs, and the exports.
 *
 * Two things the grid used to own went with it: in-sheet SEARCH and row
 * SELECTION/delete. Google's own Ctrl-F searches the real sheet better than we
 * did, and deleting rows is a right-click in the frame — with the delete policy
 * deciding whether the record follows. Neither is worth a control that acts on
 * something the reader cannot see.
 *
 * ONE READER DOES NOT GET THE FRAME. A limited member — restricted to their own
 * rows — can never be given the Drive file, because Drive shares files and not
 * rows, so they get our grid over the rows the data route filtered for them
 * (limited-grid.tsx). Search and selection come back with it, because there
 * they act on something the reader CAN see.
 *
 * The parent keys this component by sheet id, so switching sheets remounts it
 * and no open drawer leaks from one sheet into the next.
 */

import { useMemo, useState } from "react";
import { App, Alert, Button, Dropdown, Modal, Input, Tag, theme } from "antd";
import dayjs from "dayjs";
import type { SheetColumn, SheetData, SheetRecordRow } from "@/lib/sheets/types";
import { SOURCES } from "@/lib/sheets/sources";
import type { MemberOption } from "@/features/team-members/member-select";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import { ColumnEditorDrawer } from "./column-editor";
import { GooglePanel } from "./google-panel";
import { connectGoogleHref } from "./google-setup";
import { toCsv } from "./grid-values";
import { LimitedSheetGrid } from "./limited-grid";
import { SheetEmbed } from "./sheet-embed";
import { HeaderGoogleControls, SheetHeader } from "./sheet-header";
import { optionsFor } from "./sheet-model";
import { describeWatch } from "./sync-status";
import {
  useDeleteSheet,
  useGoogleConnections,
  useGoogleLink,
  useIsLimitedMember,
  useProvisionGoogle,
  useSaveSheetTemplate,
  useSheetData,
  useUpdateSheet,
} from "./use-sheets";

function downloadText(filename: string, text: string, type: string) {
  // A BOM so Excel opens UTF-8 (₹, names with accents) correctly.
  const blob = new Blob(["﻿", text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "sheet";
}

/**
 * Which of the two views this person gets is decided by the access probe, and
 * the probe can fail. When it does there is nothing honest left to render: the
 * iframe would be a guess ("not limited") that lands a restricted member on
 * Google's access wall, and Cubes' own grid would be a guess in the other
 * direction. So the sheet says what happened and offers the only thing that
 * can fix it, instead of the reserved grey block it used to sit in forever.
 */
function AccessCheckFailed({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        border: `1px dashed ${token.colorBorder}`,
        borderRadius: 12,
        padding: "32px 24px",
        display: "grid",
        gap: 14,
        justifyItems: "center",
        textAlign: "center",
        minHeight: 260,
        alignContent: "center",
      }}
    >
      <MIcon name="cloud_off" size={34} color={token.colorTextQuaternary} />
      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Cubes couldn&apos;t check your access to this sheet</div>
        <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
          Nothing is wrong with the sheet and nothing has been lost. Cubes shows this sheet one way to a full member and
          another way to a member limited to their own rows, and the check that decides which one you get did not
          answer — so it is not showing you either on a guess.
        </div>
        <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{errMsg(error, "No reason was given.")}</div>
      </div>
      <Button onClick={onRetry} loading={retrying} icon={<MIcon name="refresh" size={16} />}>
        Try again
      </Button>
    </div>
  );
}

export function SheetView({
  sheet,
  teamId,
  isAdmin,
  currentUserId,
  projectName,
  returnTo,
  initialPanel,
  onBack,
}: {
  sheet: SheetRecordRow;
  teamId: string;
  isAdmin: boolean;
  currentUserId: string | null;
  projectName: string | null;
  returnTo: string;
  /** "google" reopens the Google panel after the consent redirect. */
  initialPanel?: string | null;
  onBack: () => void;
}) {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  // The embed does not need this — Google renders the rows. It is still read,
  // because the CSV export and the "what this sheet had to leave out" notices
  // both come from it, because a source that cannot be read at all is worth
  // saying out loud even when the spreadsheet renders fine, and because a
  // limited member's whole view IS these rows (see below).
  const dataQuery = useSheetData(sheet.id);
  // DECISION B. Drive shares a file, not a row, so a limited member can never
  // be given this sheet's spreadsheet without being shown everybody's rows.
  // They get Cubes' own grid over the rows the data route already filtered —
  // and never the embed, whose footer would tell them to ask for the file.
  const {
    isLimited,
    known: accessKnown,
    failed: accessFailed,
    error: accessError,
    retry: retryAccess,
    retrying: accessRetrying,
  } = useIsLimitedMember();
  const linkQuery = useGoogleLink(sheet.id);
  const connections = useGoogleConnections();
  const provision = useProvisionGoogle(sheet.id);
  const updateSheet = useUpdateSheet();
  const deleteSheet = useDeleteSheet();
  const saveTemplate = useSaveSheetTemplate();
  const { data: teamMembers } = useTeamMembers();

  const [columnsOpen, setColumnsOpen] = useState<{ focus?: string } | null>(null);
  const [googleOpen, setGoogleOpen] = useState(initialPanel === "google");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");

  const data = dataQuery.data;
  const src = SOURCES[sheet.source];
  const canManage = isAdmin || sheet.created_by === currentUserId;

  // People pickers: the team's members with avatars, plus any member the data
  // route resolved that the roster doesn't carry (e.g. deactivated since).
  const memberOptions: MemberOption[] = useMemo(() => {
    const out: MemberOption[] = [];
    const seen = new Set<string>();
    for (const m of teamMembers ?? []) {
      if (m.active === false) continue;
      seen.add(m.id);
      out.push({ value: m.id, label: m.user?.name || m.user?.email || "Member", avatarUrl: m.user?.avatar_url ?? null, email: m.user?.email ?? null });
    }
    for (const o of data?.options?.team_members ?? []) {
      if (!seen.has(o.value)) out.push({ value: o.value, label: o.label });
    }
    return out;
  }, [teamMembers, data?.options?.team_members]);

  const saveColumns = async (columns: SheetColumn[]) => {
    await updateSheet.mutateAsync({ id: sheet.id, patch: { columns } });
  };

  const rename = (name: string) => {
    const t = name.trim();
    if (!t || t === sheet.name) return;
    updateSheet.mutate(
      { id: sheet.id, patch: { name: t.slice(0, 120) } },
      { onError: (err) => message.error(errMsg(err, "Couldn't rename the sheet.")) },
    );
  };

  const exportCsv = () => {
    if (!data) return;
    const columns = sheet.columns.filter((c) => !c.hidden);
    const members = memberOptions.map((m) => ({ value: m.value, label: m.label, email: m.email ?? null }));
    const rows = [...data.rows].sort((a, b) => a.position - b.position);
    const csv = toCsv(columns, rows, (c) => ({
      options: optionsFor(c, sheet.source, data.options),
      members,
      currency: c.currency ?? data.currency ?? null,
    }));
    downloadText(`${fileSafe(sheet.name)} ${dayjs().format("YYYY-MM-DD")}.csv`, csv, "text/csv;charset=utf-8");
  };

  const archive = () =>
    modal.confirm({
      title: "Archive this sheet?",
      content: "It disappears from the list. A linked Google Sheet stops syncing but stays in Drive.",
      okText: "Archive",
      onOk: async () => {
        try {
          await updateSheet.mutateAsync({ id: sheet.id, patch: { archived: true } });
          message.success("Sheet archived.");
          onBack();
        } catch (err) {
          message.error(errMsg(err, "Couldn't archive the sheet."));
        }
      },
    });

  const remove = () =>
    modal.confirm({
      title: "Delete this sheet for good?",
      content:
        sheet.source === "custom"
          ? "Its rows are deleted too. A linked Google Sheet stays in Drive."
          : `Only the sheet and your custom columns go — the ${src.label} records stay. A linked Google Sheet stays in Drive.`,
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteSheet.mutateAsync(sheet.id);
          message.success("Sheet deleted.");
          onBack();
        } catch (err) {
          message.error(errMsg(err, "Couldn't delete the sheet."));
        }
      },
    });

  const openTemplate = () => {
    setTemplateName(sheet.name);
    setTemplateDesc(sheet.description ?? "");
    setTemplateOpen(true);
  };

  const submitTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      await saveTemplate.mutateAsync({
        name: templateName,
        description: templateDesc,
        icon: src.icon,
        source: sheet.source,
        sourceConfig: sheet.source_config,
        columns: sheet.columns,
      });
      setTemplateOpen(false);
      message.success("Saved — it's under “Team templates” when you make a new sheet.");
    } catch (err) {
      message.error(errMsg(err, "Couldn't save the template."));
    }
  };

  const link = linkQuery.data ?? null;
  // SheetData plus the route's `notices` (not part of the shared type).
  const rawNotices: unknown = data ? (data as SheetData & { notices?: unknown }).notices : undefined;
  const notices = Array.isArray(rawNotices) ? rawNotices.filter((n): n is string => typeof n === "string") : [];
  const hasConnection = (connections.data ?? []).some((c) => c.usable);

  const doProvision = async () => {
    try {
      const res = await provision.mutateAsync({});
      if (res.status !== "ready") {
        message.warning(res.reason ?? "The Google Sheet couldn't be created.");
        return;
      }
      message.success("Google Sheet created and filled in.");
      // Whether Google will also PUSH changes back is decided at this moment,
      // and the route says so. Worth one line: "live" and "every 15 minutes"
      // are different promises, and a silent fallback to the second is how
      // people come to believe the sync is broken.
      const watch = describeWatch(res.watch, { autoSync: res.link?.auto_sync, intervalMinutes: res.link?.interval_minutes });
      if (watch && watch.tone !== "success" && watch.body) {
        message[watch.tone === "warning" ? "warning" : "info"]({ content: `${watch.title}. ${watch.body}`, duration: 8 });
      }
    } catch (err) {
      message.error(errMsg(err, "Couldn't create the Google Sheet."));
    }
  };

  return (
    // minmax(0, 1fr): without a track that may shrink, the implicit "auto"
    // column grows to its content's natural width and the toolbar above is
    // stretched off the right edge of the page.
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
      <SheetHeader
        sheet={sheet}
        projectName={projectName}
        onBack={onBack}
        onRename={rename}
        actions={
          <>
            {/* Every control in the Google panel — link, unlink, sync, re-share,
                provision — is refused for a limited member by the routes, and its
                "whoever owns it has to share it from Drive" line is the advice
                Decision B exists to keep away from them. So it is not offered —
                neither the state pill that opens the panel nor the link out. */}
            {isLimited ? null : (
              <HeaderGoogleControls
                sheetId={sheet.id}
                link={link}
                loading={linkQuery.isLoading}
                canOpenFile={accessKnown}
                onOpenPanel={() => setGoogleOpen(true)}
              />
            )}
            {isLimited && !canManage ? null : (
              <Button onClick={() => setColumnsOpen({})} icon={<MIcon name="view_column" size={16} />}>
                Columns
              </Button>
            )}
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "csv", label: "Export CSV", icon: <MIcon name="download" size={16} />, disabled: !data },
                  ...(isLimited ? [] : [{ key: "template", label: "Save as template…", icon: <MIcon name="bookmark_add" size={16} /> }]),
                  { key: "refresh", label: "Refresh data", icon: <MIcon name="refresh" size={16} /> },
                  ...(isLimited
                    ? []
                    : [
                        { type: "divider" as const },
                        { key: "archive", label: "Archive sheet", icon: <MIcon name="archive" size={16} /> },
                        ...(canManage ? [{ key: "delete", label: "Delete sheet", icon: <MIcon name="delete_forever" size={16} />, danger: true }] : []),
                      ]),
                ],
                onClick: ({ key }) => {
                  if (key === "csv") exportCsv();
                  else if (key === "template") openTemplate();
                  else if (key === "refresh") void dataQuery.refetch();
                  else if (key === "archive") archive();
                  else if (key === "delete") remove();
                },
              }}
            >
              <Button icon={<MIcon name="more_horiz" size={18} />} aria-label="More" />
            </Dropdown>
          </>
        }
      />

      {/* The data route explains what it had to leave out (an app turned off, a
          project the source isn't active in). It is about what SYNCS into the
          spreadsheet, so it still belongs above it. A failure to read the
          source is a warning, not the page: the Google Sheet is what the reader
          came for and it renders regardless. */}
      {notices.map((n) => (
        <Alert key={n} type="info" showIcon message={n} closable />
      ))}
      {dataQuery.isError && !isLimited ? (
        <Alert
          type="warning"
          showIcon
          message={`Cubes can't read this sheet's ${src.label.toLowerCase()} data right now — the spreadsheet below still opens, but syncing and CSV export will fail until this clears`}
          description={errMsg(dataQuery.error, "Unknown error.")}
          action={
            <Button size="small" onClick={() => void dataQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {accessFailed ? (
        <AccessCheckFailed error={accessError} onRetry={retryAccess} retrying={accessRetrying} />
      ) : accessKnown && isLimited ? (
        // Their own rows, in our grid. Never the iframe: the frame renders on
        // the viewer's Google session, and they were deliberately not granted
        // the file (google-share.ts, reason 'limited').
        <LimitedSheetGrid
          sheet={sheet}
          data={data}
          loading={dataQuery.isLoading}
          error={dataQuery.isError ? dataQuery.error : null}
          onRetry={() => void dataQuery.refetch()}
          memberOptions={memberOptions}
          canManage={canManage}
          onColumnsChange={saveColumns}
          onEditColumns={(focus) => setColumnsOpen({ focus })}
        />
      ) : (
        <SheetEmbed
          sheet={sheet}
          link={link}
          // Until we know which of the two views this person gets, the embed
          // renders only its reserved block — no frame, and no footer telling
          // anyone to ask for access.
          loading={linkQuery.isLoading || !accessKnown}
          canManage={canManage}
          isAdmin={isAdmin}
          hasConnection={hasConnection}
          connectHref={connectGoogleHref(teamId, returnTo)}
          onProvision={() => void doProvision()}
          onOpenPanel={() => setGoogleOpen(true)}
          provisioning={provision.isPending}
        />
      )}

      <ColumnEditorDrawer
        open={columnsOpen !== null}
        focusColumnId={columnsOpen?.focus}
        sheet={sheet}
        onClose={() => setColumnsOpen(null)}
        onSave={saveColumns}
      />

      {isLimited ? null : (
        <GooglePanel open={googleOpen} onClose={() => setGoogleOpen(false)} sheet={sheet} teamId={teamId} isAdmin={isAdmin} returnTo={returnTo} />
      )}

      <Modal
        open={templateOpen}
        title="Save as a team template"
        okText="Save template"
        onOk={() => void submitTemplate()}
        okButtonProps={{ disabled: !templateName.trim() }}
        confirmLoading={saveTemplate.isPending}
        onCancel={() => setTemplateOpen(false)}
        destroyOnHidden
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
            Saves the data source, its settings and the columns — not the rows or the Google link. Everyone in the workspace
            can use it.
          </div>
          <Input value={templateName} maxLength={120} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" />
          <Input.TextArea value={templateDesc} maxLength={2000} onChange={(e) => setTemplateDesc(e.target.value)} placeholder="What it's for (optional)" autoSize={{ minRows: 2, maxRows: 5 }} />
          {src.appKey ? (
            <Tag style={{ justifySelf: "start" }} icon={<MIcon name={src.icon} size={12} />}>
              Needs {src.label}
            </Tag>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
