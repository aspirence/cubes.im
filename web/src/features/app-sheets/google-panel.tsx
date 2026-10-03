"use client";

/**
 * Sheets — the Google panel of an open sheet: whether it is linked, how the
 * last sync went, whether the sync is LIVE, "Sync now", the link settings, run
 * history and unlink. Unlinked, the same panel links the sheet (new spreadsheet
 * or one picked from Drive), so a sheet made without Google can gain it later.
 *
 * A limited member never opens this panel — sheet-view.tsx does not render it
 * for them. Every control here is refused for them by the routes, and the
 * "whoever owns it has to share it from Drive" line is the advice that would
 * widen their access to the whole team's rows. See limited-grid.tsx.
 */

import { useState } from "react";
import { App, Alert, Button, Drawer, Empty, Popconfirm, Skeleton, Tag, Tooltip, theme } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import type { GoogleLinkRow, SheetRecordRow, SyncCounts } from "@/lib/sheets/types";
import { spreadsheetHref } from "@/lib/sheets/google-embed";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import {
  DEFAULT_GOOGLE_SETTINGS,
  GoogleSettingsFields,
  GoogleTargetChooser,
  connectGoogleHref,
  pickConnection,
  type GoogleTarget,
} from "./google-setup";
import { describeLiveChannel, describeWatch, type TimerFallback, type WatchNotice } from "./sync-status";
import {
  useGoogleConnections,
  useGoogleLink,
  useLinkGoogle,
  useShareGoogle,
  useSheetLiveChannel,
  useSheetShares,
  useSyncNow,
  useSyncRuns,
  useUnlinkGoogle,
  useUpdateGoogleLink,
  type GoogleSettings,
  type SharePlanView,
} from "./use-sheets";

dayjs.extend(relativeTime);

/** Re-exported so callers that already import it from here keep working; the
 *  URL itself is built in the pure module the embed shares. */
export { spreadsheetHref };

export function countsSummary(c: Partial<SyncCounts> | null | undefined): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.pushed) parts.push(`${c.pushed} sent to Google`);
  if (c.pulled) parts.push(`${c.pulled} brought in`);
  if (c.created) parts.push(`${c.created} rows created`);
  if (c.deleted) parts.push(`${c.deleted} deleted`);
  if (c.conflicts) parts.push(`${c.conflicts} conflicts resolved`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  return parts.length ? parts.join(" · ") : "Already in step — nothing to change";
}

function settingsOf(link: GoogleLinkRow): GoogleSettings {
  return {
    direction: link.direction,
    conflictPolicy: link.conflict_policy,
    deletePolicy: link.delete_policy,
    autoSync: link.auto_sync,
    intervalMinutes: link.interval_minutes,
  };
}

export function GoogleStatusTag({ link }: { link: GoogleLinkRow | null | undefined }) {
  if (!link) return null;
  if (link.last_status === "running") return <Tag color="processing" style={{ margin: 0 }}>Syncing…</Tag>;
  if (link.last_status === "error") return <Tag color="error" style={{ margin: 0 }}>Sync failed</Tag>;
  if (link.last_status === "ok") return <Tag color="success" style={{ margin: 0 }}>In sync</Tag>;
  return <Tag style={{ margin: 0 }}>Not synced yet</Tag>;
}

const TONE_TAG: Record<WatchNotice["tone"], string | undefined> = {
  success: "success",
  info: undefined,
  warning: "warning",
};

/**
 * Whether Google PUSHES this sheet's changes back, or whether the timer is
 * doing all the work.
 *
 * Both halves are shown because they answer different questions. The badge is
 * the durable state, read straight from app_sheet_drive_channels — a member
 * opening this drawer tomorrow still gets an answer. The alert underneath is
 * what the request they just made reported, which is the only thing that can
 * explain WHY the badge says what it says.
 *
 * "Not live" is never dressed up as a failure when it isn't one: on a
 * deployment Google cannot reach — every dev box — there is simply no channel,
 * and the hint says the sheet syncs on its timer instead. See sync-status.ts.
 */
function LiveSyncSection({
  channel,
  loading,
  notice,
  fallback,
}: {
  channel: Parameters<typeof describeLiveChannel>[0];
  loading: boolean;
  notice: WatchNotice | null;
  fallback: TimerFallback;
}) {
  const { token } = theme.useToken();
  const badge = describeLiveChannel(channel, fallback);
  return (
    <Section
      title="Live sync"
      extra={
        loading ? null : (
          <Tag color={TONE_TAG[badge.tone]} style={{ margin: 0 }}>
            {badge.label}
          </Tag>
        )
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 1 }} title={false} />
      ) : (
        <div style={{ fontSize: 12.5, color: token.colorTextSecondary }}>{badge.hint}</div>
      )}
      {notice ? (
        <Alert
          type={notice.tone === "warning" ? "warning" : notice.tone === "success" ? "success" : "info"}
          showIcon
          message={notice.title}
          description={notice.body}
        />
      ) : null}
    </Section>
  );
}

function Section({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, padding: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{title}</div>
        {extra}
      </div>
      {children}
    </div>
  );
}

const SKIP_REASON: Record<string, string> = {
  no_email: "no Google address on file — they will see Google's access screen",
  limited: "a limited member, who is only shown their own rows in Cubes",
  owner: "owns the file already",
};

/**
 * Who can open the Google file.
 *
 * This is the section that makes removing our grid honest. The embed renders on
 * the VIEWER's Google session, so a colleague who was never granted the file
 * sees Google's access wall where their data should be — and nothing in the
 * browser can tell us that happened. The only defence is to share the file
 * properly and to show, here, exactly who was and was not reached.
 *
 * Names, never addresses: this panel is open to the whole workspace.
 */
function ShareSection({
  link,
  shares,
  loading,
  isAdmin,
  onReshare,
  resharing,
}: {
  link: GoogleLinkRow;
  shares: SharePlanView | undefined;
  loading: boolean;
  isAdmin: boolean;
  onReshare: (scope?: "team") => void;
  resharing: boolean;
}) {
  const { token } = theme.useToken();

  if (!link.owned_by_us) {
    return (
      <Section title="Who can open it">
        <div style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
          This spreadsheet is in someone&apos;s own Google Drive rather than one Cubes made, so Cubes can&apos;t share it.
          Whoever owns it has to share it with the team from Google Drive — otherwise they&apos;ll be asked for access when
          they open this sheet.
        </div>
      </Section>
    );
  }

  const skipped = shares?.plan?.skipped ?? [];
  const noEmail = skipped.filter((s) => s.reason === "no_email");
  const grants = shares?.plan?.grants ?? [];

  return (
    <Section
      title="Who can open it"
      extra={
        <Button size="small" onClick={() => onReshare()} loading={resharing} icon={<MIcon name="group_add" size={14} />}>
          Re-share
        </Button>
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : (
        <div style={{ display: "grid", gap: 8, fontSize: 12.5, color: token.colorTextSecondary }}>
          <span>
            Shared with <b>{grants.length}</b> {grants.length === 1 ? "person" : "people"} as{" "}
            {grants.some((g) => g.role === "reader") && !grants.some((g) => g.role === "writer") ? "readers" : "editors"}
            {link.shared_at ? ` · last checked ${dayjs(link.shared_at).fromNow()}` : ""}.
          </span>
          {noEmail.length > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`${noEmail.length} ${noEmail.length === 1 ? "person has" : "people have"} no Google address on file`}
              description={
                <span>
                  {noEmail.map((s) => s.who).join(", ")} can open this sheet in Cubes, but Google will ask them for access.
                  Add the Google address they actually sign in with to their profile, then press Re-share.
                </span>
              }
            />
          ) : null}
          {skipped.filter((s) => s.reason === "limited").length > 0 ? (
            <span style={{ color: token.colorTextTertiary }}>
              {skipped.filter((s) => s.reason === "limited").length} limited{" "}
              {skipped.filter((s) => s.reason === "limited").length === 1 ? "member is" : "members are"} deliberately left
              out: {SKIP_REASON.limited}.
            </span>
          ) : null}
          {link.share_error && noEmail.length === 0 ? (
            <Alert type="warning" showIcon message="Not everyone could be given access" description={link.share_error} />
          ) : null}
          <span style={{ color: token.colorTextTertiary }}>
            Only named people — this file is never shared with &ldquo;anyone with the link&rdquo;.
          </span>
          {/* Someone joins the WORKSPACE, not one sheet, so the useful button
              after adding a colleague does every sheet Cubes owns at once. */}
          {isAdmin ? (
            <Button
              size="small"
              type="link"
              style={{ justifySelf: "start", padding: 0, height: "auto" }}
              onClick={() => onReshare("team")}
              loading={resharing}
            >
              Someone just joined? Re-share every sheet in this workspace
            </Button>
          ) : null}
        </div>
      )}
    </Section>
  );
}

export function GooglePanel({
  open,
  onClose,
  sheet,
  teamId,
  isAdmin,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  sheet: SheetRecordRow;
  teamId: string;
  isAdmin: boolean;
  returnTo: string;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const linkQuery = useGoogleLink(sheet.id);
  // A 'pending' or 'failed' row means "this sheet has no Google Sheet yet, and
  // here is why" — the panel treats it as unlinked (so it offers the chooser)
  // and shows the reason above it.
  const linkRow = linkQuery.data ?? null;
  const link = linkRow?.provision_status === "ready" ? linkRow : null;
  const connections = useGoogleConnections();
  const runs = useSyncRuns(sheet.id, open && Boolean(link));
  const shares = useSheetShares(sheet.id, open && Boolean(link));
  const channel = useSheetLiveChannel(sheet.id, open && Boolean(link));
  const linkGoogle = useLinkGoogle(sheet.id);
  const updateLink = useUpdateGoogleLink(sheet.id);
  const unlink = useUnlinkGoogle(sheet.id);
  const syncNow = useSyncNow(sheet.id);
  const reshare = useShareGoogle(sheet.id);

  // Local drafts, re-seeded whenever the drawer opens or the link it edits is
  // replaced — never carried over from a previous opening. Not re-seeded when
  // a sync merely updates the link row, or a background refresh would wipe
  // settings the user is in the middle of changing.
  const [draft, setDraft] = useState<GoogleSettings>(DEFAULT_GOOGLE_SETTINGS);
  const [target, setTarget] = useState<GoogleTarget>({ mode: "create" });
  const [connectionId, setConnectionId] = useState<string | null>(null);
  // What the last link / settings write said about the Drive push channel.
  // Transient by nature — it describes a request, not a state — so it is
  // cleared with the rest of the drawer's drafts.
  const [watchNotice, setWatchNotice] = useState<WatchNotice | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const seedKey = open && !linkQuery.isLoading ? `${sheet.id}:${link?.id ?? "none"}` : null;
  if (seedKey !== seed) {
    setSeed(seedKey);
    if (seedKey) {
      setDraft(link ? settingsOf(link) : DEFAULT_GOOGLE_SETTINGS);
      setTarget({ mode: "create" });
      setConnectionId(link?.connection_id ?? null);
    }
  }
  // The watch notice is re-seeded on the DRAWER, not on the link: linking is
  // the moment that produces it, and that same moment replaces link.id — a
  // seed keyed on the link would wipe the notice in the render right after it
  // was set.
  const [noticeSeed, setNoticeSeed] = useState<string | null>(null);
  const noticeSeedKey = open ? sheet.id : null;
  if (noticeSeedKey !== noticeSeed) {
    setNoticeSeed(noticeSeedKey);
    setWatchNotice(null);
  }

  const connection = link ? (connections.data ?? []).find((c) => c.id === link.connection_id) : undefined;
  const settingsDirty = link ? JSON.stringify(settingsOf(link)) !== JSON.stringify(draft) : false;

  const doLink = async () => {
    const conn = pickConnection(connections.data, connectionId);
    if (!conn) return;
    if (target.mode === "existing" && !target.picked) {
      message.warning("Choose the spreadsheet from Google Drive first.");
      return;
    }
    try {
      const res = await linkGoogle.mutateAsync({
        connectionId: conn.id,
        mode: target.mode === "existing" ? "existing" : "create",
        spreadsheetId: target.mode === "existing" ? target.picked?.id : undefined,
        ...draft,
      });
      message.success(target.mode === "existing" ? "Linked — the first sync has run." : "Google Sheet created and filled in.");
      // The link is made either way; whether Google will also push changes
      // back is a separate answer, and this is where it is reported.
      setWatchNotice(describeWatch(res?.watch, draft));
    } catch (err) {
      message.error(errMsg(err, "Couldn't link Google Sheets."));
    }
  };

  const doSync = async () => {
    try {
      const res = await syncNow.mutateAsync();
      if (res?.status === "error") message.error("Sync finished with an error — see below.");
      else message.success(countsSummary(res));
    } catch (err) {
      message.error(errMsg(err, "Sync failed."));
    }
  };

  const saveSettings = async () => {
    try {
      const res = await updateLink.mutateAsync(draft);
      message.success("Sync settings saved.");
      // Direction and auto-sync decide whether a channel is wanted at all, so
      // saving them is exactly when the push state can change under the user.
      setWatchNotice(describeWatch(res?.watch, draft));
    } catch (err) {
      message.error(errMsg(err, "Couldn't save the sync settings."));
    }
  };

  const doReshare = async (scope?: "team") => {
    try {
      const res = await reshare.mutateAsync(scope ? { scope } : {});
      if ("scope" in res) {
        message.success(`${res.shared} of ${res.sheets} sheets re-shared with the workspace.`);
      } else if (res.status === "ok") {
        message.success(
          res.counts.granted > 0
            ? `${res.counts.granted} more ${res.counts.granted === 1 ? "person" : "people"} can open it now.`
            : "Everyone who can see this sheet already has the file.",
        );
      } else {
        message.warning(res.error ?? "Some people still can't open the Google Sheet.");
      }
    } catch (err) {
      message.error(errMsg(err, "Couldn't update who this Google Sheet is shared with."));
    }
  };

  const doUnlink = async () => {
    try {
      const res = await unlink.mutateAsync();
      // `stopping` is how many live channels were marked for cancellation on
      // the way out. Saying it is the difference between "Google may still
      // call us about this file for a while" being a surprise or not.
      const stopping = res?.stopping ?? 0;
      message.success(
        stopping > 0
          ? `Unlinked. The Google Sheet is still in Drive, and Cubes stops watching it on the next pass.`
          : "Unlinked. The Google Sheet is still in Drive.",
      );
    } catch (err) {
      message.error(errMsg(err, "Couldn't unlink."));
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      destroyOnHidden
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <MIcon name="sync_alt" size={18} color="#1e9e6a" /> Google Sheets
        </span>
      }
    >
      {linkQuery.isLoading ? (
        <Skeleton active />
      ) : linkQuery.isError ? (
        <Alert type="error" showIcon message={errMsg(linkQuery.error, "Couldn't load the Google link.")} />
      ) : !link ? (
        <div style={{ display: "grid", gap: 16 }}>
          {linkRow?.provision_error ? (
            <Alert
              type={linkRow.provision_status === "failed" ? "error" : "info"}
              showIcon
              message={linkRow.provision_status === "failed" ? "Setting up this sheet's Google Sheet failed" : "No Google Sheet yet"}
              description={linkRow.provision_error}
            />
          ) : null}
          <div style={{ color: token.colorTextSecondary, fontSize: 13 }}>
            <b>{sheet.name}</b> shows its Google Sheet as the sheet itself, so it needs one. Make a new spreadsheet and Cubes
            fills it in and shares it with the workspace, or point it at one you already have.
          </div>
          <Section title="Spreadsheet">
            <GoogleTargetChooser
              teamId={teamId}
              isAdmin={isAdmin}
              connections={connections.data}
              connectionsLoading={connections.isLoading}
              connectionId={connectionId}
              onConnectionChange={setConnectionId}
              target={target}
              onTargetChange={setTarget}
              returnTo={returnTo}
              allowNone={false}
            />
          </Section>
          <Section title="How it syncs">
            <GoogleSettingsFields value={draft} onChange={setDraft} source={sheet.source} />
          </Section>
          <Button
            type="primary"
            size="large"
            onClick={() => void doLink()}
            loading={linkGoogle.isPending}
            disabled={!pickConnection(connections.data, connectionId) || (target.mode === "existing" && !target.picked)}
          >
            {target.mode === "existing" ? "Link and sync" : "Create Google Sheet"}
          </Button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Section
            title={link.sheet_title ? `Tab “${link.sheet_title}”` : "Linked spreadsheet"}
            extra={<GoogleStatusTag link={link} />}
          >
            <div style={{ fontSize: 12.5, color: token.colorTextSecondary, display: "grid", gap: 4 }}>
              <span>
                {link.last_synced_at ? (
                  <Tooltip title={dayjs(link.last_synced_at).format("D MMM YYYY, HH:mm:ss")}>
                    Last synced {dayjs(link.last_synced_at).fromNow()}
                  </Tooltip>
                ) : (
                  "Not synced yet"
                )}
                {link.auto_sync && link.next_run_at ? ` · next ${dayjs(link.next_run_at).fromNow()}` : ""}
                {!link.auto_sync ? " · automatic sync is off" : ""}
              </span>
              {link.last_counts ? <span>{countsSummary(link.last_counts)}</span> : null}
              <span>
                Account: {connection?.email ?? "Google account"}
                {connection && !connection.usable ? (
                  <Tag color="warning" style={{ marginLeft: 6 }}>
                    needs reconnecting
                  </Tag>
                ) : null}
              </span>
            </div>
            {link.last_status === "error" && link.last_error ? (
              <Alert type="error" showIcon message="The last sync failed" description={link.last_error} />
            ) : null}
            {connection && !connection.usable && isAdmin ? (
              <Button href={connectGoogleHref(teamId, returnTo)} icon={<MIcon name="link" size={16} />}>
                Reconnect Google
              </Button>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                type="primary"
                onClick={() => void doSync()}
                loading={syncNow.isPending || link.last_status === "running"}
                icon={<MIcon name="sync" size={16} />}
              >
                Sync now
              </Button>
              <Button
                href={spreadsheetHref(link) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                icon={<MIcon name="open_in_new" size={16} />}
              >
                Open in Google Sheets
              </Button>
            </div>
          </Section>

          <LiveSyncSection
            channel={channel.data}
            loading={channel.isLoading}
            notice={watchNotice}
            fallback={{ autoSync: link.auto_sync, intervalMinutes: link.interval_minutes }}
          />

          <ShareSection
            link={link}
            shares={shares.data}
            loading={shares.isLoading}
            isAdmin={isAdmin}
            onReshare={(scope) => void doReshare(scope)}
            resharing={reshare.isPending}
          />

          <Section
            title="How it syncs"
            extra={
              settingsDirty ? (
                <Button size="small" type="primary" onClick={() => void saveSettings()} loading={updateLink.isPending}>
                  Save
                </Button>
              ) : null
            }
          >
            <GoogleSettingsFields value={draft} onChange={setDraft} source={sheet.source} />
          </Section>

          <Section title="Recent syncs">
            {runs.isLoading ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : runs.isError ? (
              <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>{errMsg(runs.error, "Couldn't load the history.")}</span>
            ) : (runs.data ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No syncs yet" />
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {(runs.data ?? []).map((r) => (
                  <div
                    key={r.id}
                    style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 12.5, paddingBottom: 6, borderBottom: `1px solid ${token.colorSplit}` }}
                  >
                    <MIcon
                      name={r.status === "ok" ? "check_circle" : r.status === "error" ? "error" : "progress_activity"}
                      size={16}
                      color={r.status === "ok" ? "#2f8f5f" : r.status === "error" ? "#c0453c" : token.colorPrimary}
                    />
                    <span>
                      <b>{dayjs(r.started_at).format("D MMM, HH:mm")}</b>
                      <span style={{ color: token.colorTextTertiary }}>
                        {" "}
                        · {r.trigger === "auto" ? "automatic" : r.trigger === "workflow" ? "workflow" : "manual"}
                      </span>
                    </span>
                    <span />
                    <span style={{ color: r.status === "error" ? "#c0453c" : token.colorTextSecondary }}>
                      {r.status === "error" ? (r.error ?? "Failed") : r.status === "running" ? "Running…" : countsSummary(r.counts)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Popconfirm
            title="Unlink this Google Sheet?"
            description="Syncing stops. The spreadsheet stays in Google Drive and this sheet keeps its rows."
            okText="Unlink"
            okButtonProps={{ danger: true }}
            onConfirm={() => void doUnlink()}
          >
            <Button danger type="text" icon={<MIcon name="link_off" size={16} />} loading={unlink.isPending} style={{ justifySelf: "start" }}>
              Unlink from Google
            </Button>
          </Popconfirm>
        </div>
      )}
    </Drawer>
  );
}
