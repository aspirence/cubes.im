"use client";

/**
 * Sheets — the Google Sheets link settings, shared by the new-sheet wizard
 * and the Google panel of an open sheet so both explain the same choices in
 * the same words.
 */

import { useState } from "react";
import { App, Alert, Button, Radio, Select, Switch, theme } from "antd";
import type { SheetSource } from "@/lib/sheets/types";
import { defaultGoogleSettings } from "@/lib/sheets/google-embed";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import type { GoogleConnection, GoogleSettings } from "./use-sheets";
import { pickSpreadsheet, type PickedSpreadsheet } from "./google-picker";

/** The starting point for a NEW link. A bound source starts at "Cubes wins" —
 *  see defaultGoogleSettings in @/lib/sheets/google-embed for why. */
export const DEFAULT_GOOGLE_SETTINGS: GoogleSettings = defaultGoogleSettings("custom");

export function defaultSettingsFor(source: SheetSource): GoogleSettings {
  return defaultGoogleSettings(source);
}

export const INTERVALS = [
  { value: 5, label: "Every 5 minutes" },
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Every hour" },
  { value: 180, label: "Every 3 hours" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Once a day" },
];

/** Where the Google consent flow sends the user back to. Admin-only on the server. */
export function connectGoogleHref(teamId: string, returnTo: string): string {
  return `/api/integrations/google/start?teamId=${encodeURIComponent(teamId)}&returnTo=${encodeURIComponent(returnTo)}`;
}

function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: token.colorText }}>{children}</div>
      {hint ? <div style={{ fontSize: 11.5, color: token.colorTextTertiary, marginTop: 1 }}>{hint}</div> : null}
    </div>
  );
}

export function GoogleSettingsFields({
  value,
  onChange,
  disabled,
}: {
  value: GoogleSettings;
  onChange: (next: GoogleSettings) => void;
  source: SheetSource;
  disabled?: boolean;
}) {
  const set = <K extends keyof GoogleSettings>(k: K, v: GoogleSettings[K]) => onChange({ ...value, [k]: v });
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <Label hint="Which way changes travel.">Direction</Label>
        <Radio.Group
          disabled={disabled}
          value={value.direction}
          onChange={(e) => set("direction", e.target.value)}
          optionType="button"
          options={[
            { value: "both", label: "Two-way" },
            { value: "push", label: "Cubes → Google" },
            { value: "pull", label: "Google → Cubes" },
          ]}
        />
      </div>
      {value.direction === "both" ? (
        <div>
          <Label hint="When the same cell changed in both places since the last sync.">If both sides changed</Label>
          <Select
            disabled={disabled}
            value={value.conflictPolicy}
            onChange={(v) => set("conflictPolicy", v)}
            style={{ width: "100%" }}
            options={[
              { value: "newest", label: "Newest change wins" },
              { value: "cubes", label: "Cubes wins" },
              { value: "google", label: "Google Sheets wins" },
            ]}
          />
        </div>
      ) : null}
      <div>
        <Label hint="When a row disappears on one side.">Deleted rows</Label>
        <Select
          disabled={disabled}
          value={value.deletePolicy}
          onChange={(v) => set("deletePolicy", v)}
          style={{ width: "100%" }}
          options={[
            { value: "keep", label: "Keep the other side's row (safer)" },
            { value: "delete", label: "Delete it on the other side too" },
          ]}
        />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Switch disabled={disabled} checked={value.autoSync} onChange={(v) => set("autoSync", v)} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Sync automatically</span>
        </div>
        {value.autoSync ? (
          <Select
            disabled={disabled}
            value={value.intervalMinutes}
            onChange={(v) => set("intervalMinutes", v)}
            style={{ width: "100%", marginTop: 8 }}
            options={INTERVALS}
          />
        ) : (
          <div style={{ fontSize: 11.5, marginTop: 6, opacity: 0.75 }}>
            Sync with the button, or from a workflow step (&ldquo;Sync a sheet with Google&rdquo;) on any schedule you like.
          </div>
        )}
      </div>
    </div>
  );
}

/** The connection a Google step uses: the one chosen, else the newest usable one. */
export function pickConnection(connections: GoogleConnection[] | undefined, connectionId: string | null): GoogleConnection | null {
  const usable = (connections ?? []).filter((c) => c.usable);
  return usable.find((c) => c.id === connectionId) ?? usable[0] ?? null;
}

/**
 * The gate on making a NEW sheet.
 *
 * A sheet IS its Google Sheet now — that is what the sheet view renders — so a
 * sheet created before a Google account is connected would open onto an empty
 * "set this up" card and stay there. Rather than make that half-thing and
 * explain it afterwards, creation is switched off until Google is connected,
 * and this is the notice that says so.
 *
 * It is deliberately shown BEFORE any effort is spent: next to the New sheet
 * button, and as the whole body of the wizard if something opened it anyway
 * (a deep link, a stale tab). Being told this after filling in four steps is
 * the version worth avoiding.
 *
 * It never blocks sheets that ALREADY exist without a spreadsheet: those keep
 * their own "Create one now / use one I have" card in the sheet view.
 */
export function GoogleRequiredNotice({
  teamId,
  isAdmin,
  returnTo,
  connections,
  compact = false,
  onBeforeConnect,
}: {
  teamId: string;
  isAdmin: boolean;
  returnTo: string;
  connections: GoogleConnection[] | undefined;
  /** Inline next to a button (true) or the centre of an empty modal (false). */
  compact?: boolean;
  onBeforeConnect?: () => void;
}) {
  const { token } = theme.useToken();
  // A revoked / disabled account is a different sentence from never having had
  // one: the admin has to go and re-consent, not discover the feature.
  const broken = (connections ?? []).filter((c) => !c.usable);
  const title = broken.length ? "Google needs to be reconnected before a new sheet" : "Connect Google to create sheets";
  const why =
    "Every sheet in Cubes is a real Google Sheet — that spreadsheet is what you open, edit and share. Until a Google account is connected there is nowhere to create one, so new sheets are switched off.";
  const who = isAdmin
    ? "One connection covers the whole workspace, and Cubes only ever touches the spreadsheets it creates or you pick."
    : "Ask a workspace admin to connect one — they do it once for the whole workspace, and new sheets work for everyone straight after.";
  const reason = broken.find((c) => c.lastTestError)?.lastTestError ?? null;

  const connect = () => {
    onBeforeConnect?.();
    window.location.assign(connectGoogleHref(teamId, returnTo));
  };

  const button = isAdmin ? (
    <Button type="primary" onClick={connect} icon={<MIcon name="link" size={16} />} style={{ justifySelf: "start" }}>
      {broken.length ? "Reconnect Google" : "Connect Google"}
    </Button>
  ) : null;

  if (compact) {
    return (
      <Alert
        type="info"
        showIcon
        message={title}
        description={
          <div style={{ display: "grid", gap: 8 }}>
            <span>
              {why} {who}
            </span>
            {reason ? <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>Google said: {reason}</span> : null}
            {button}
          </div>
        }
      />
    );
  }

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
        minHeight: 300,
        alignContent: "center",
      }}
    >
      <MIcon name="link_off" size={34} color={token.colorTextQuaternary} />
      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        <div style={{ fontSize: 13, color: token.colorTextSecondary }}>{why}</div>
        <div style={{ fontSize: 13, color: token.colorTextSecondary }}>{who}</div>
        {reason ? <div style={{ fontSize: 12, color: token.colorTextTertiary }}>Google said: {reason}</div> : null}
      </div>
      {isAdmin ? (
        <Button type="primary" onClick={connect} icon={<MIcon name="link" size={16} />}>
          {broken.length ? "Reconnect Google" : "Connect Google"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The OTHER answer to "may this workspace create a sheet?": we could not find
 * out.
 *
 * It used to be folded into "connect Google" — the connections query errored,
 * the gate saw no data, and a workspace with Google connected was told to
 * connect it and had creation switched off. A failed read is not a fact about
 * the workspace, so it says what actually happened, keeps creation blocked
 * (the answer really is unknown), and offers the one thing that can change it.
 *
 * Also used for the access probe (is_limited_member): the same sentence fits,
 * because the consequence is the same — we do not know, so we do not guess.
 */
export function GoogleCheckFailedNotice({
  error,
  onRetry,
  retrying = false,
  compact = false,
  what = "Google",
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  /** Inline next to a button (true) or the centre of an empty modal (false). */
  compact?: boolean;
  /** What could not be checked, for the first sentence. */
  what?: string;
}) {
  const { token } = theme.useToken();
  const title = `Cubes couldn't check ${what} for this workspace`;
  const why =
    "This is a failed check, not a verdict: the connection may be perfectly fine. Creating a sheet stays switched off only until the check answers, because a new sheet is created as a real Google Sheet and Cubes will not start one on a guess.";
  const reason = errMsg(error, "No reason was given.");
  const button = (
    <Button onClick={onRetry} loading={retrying} icon={<MIcon name="refresh" size={16} />} style={{ justifySelf: "start" }}>
      Try again
    </Button>
  );

  if (compact) {
    return (
      <Alert
        type="warning"
        showIcon
        message={title}
        description={
          <div style={{ display: "grid", gap: 8 }}>
            <span>{why}</span>
            <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>{reason}</span>
            {button}
          </div>
        }
      />
    );
  }

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
        minHeight: 300,
        alignContent: "center",
      }}
    >
      <MIcon name="cloud_off" size={34} color={token.colorTextQuaternary} />
      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        <div style={{ fontSize: 13, color: token.colorTextSecondary }}>{why}</div>
        <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{reason}</div>
      </div>
      <Button onClick={onRetry} loading={retrying} icon={<MIcon name="refresh" size={16} />}>
        Try again
      </Button>
    </div>
  );
}

export type GoogleTarget =
  | { mode: "none" }
  | { mode: "create" }
  | { mode: "existing"; picked: PickedSpreadsheet | null };

/**
 * Choosing the Google side: which connected account, and a new spreadsheet or
 * one picked from Drive. Connecting an account is a redirect through Google's
 * consent screen, so `onBeforeConnect` lets the caller stash anything it
 * wants back afterwards.
 */
export function GoogleTargetChooser({
  teamId,
  isAdmin,
  connections,
  connectionsLoading,
  connectionId,
  onConnectionChange,
  target,
  onTargetChange,
  returnTo,
  onBeforeConnect,
  allowNone = true,
}: {
  teamId: string;
  isAdmin: boolean;
  connections: GoogleConnection[] | undefined;
  connectionsLoading: boolean;
  connectionId: string | null;
  onConnectionChange: (id: string) => void;
  target: GoogleTarget;
  onTargetChange: (t: GoogleTarget) => void;
  returnTo: string;
  onBeforeConnect?: () => void;
  allowNone?: boolean;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [picking, setPicking] = useState(false);
  const usable = (connections ?? []).filter((c) => c.usable);
  const chosen = pickConnection(connections, connectionId);
  const broken = (connections ?? []).filter((c) => !c.usable);

  const connect = () => {
    onBeforeConnect?.();
    window.location.assign(connectGoogleHref(teamId, returnTo));
  };

  const pick = async () => {
    if (!chosen) return;
    setPicking(true);
    try {
      const picked = await pickSpreadsheet(teamId, chosen.id);
      if (picked) onTargetChange({ mode: "existing", picked });
    } catch (err) {
      message.error(errMsg(err, "Couldn't open Google Drive."));
    } finally {
      setPicking(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Radio.Group
        value={target.mode}
        onChange={(e) => {
          const mode = e.target.value as GoogleTarget["mode"];
          onTargetChange(mode === "existing" ? { mode, picked: null } : { mode });
        }}
        style={{ display: "grid", gap: 8 }}
      >
        {allowNone ? <Radio value="none">Don&apos;t link — keep this sheet in Cubes only</Radio> : null}
        <Radio value="create">Create a new Google Sheet — Cubes owns it and shares it with the workspace</Radio>
        <Radio value="existing">Sync with a Google Sheet I already have</Radio>
      </Radio.Group>

      {target.mode !== "none" ? (
        connectionsLoading ? null : usable.length === 0 ? (
          <Alert
            type="info"
            showIcon
            message={broken.length ? "Google needs to be reconnected" : "Connect a Google account first"}
            description={
              isAdmin ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <span>
                    Cubes only gets access to spreadsheets it creates or that you pick — nothing else in your Drive.
                  </span>
                  <Button type="primary" onClick={connect} icon={<MIcon name="link" size={16} />} style={{ justifySelf: "start" }}>
                    {broken.length ? "Reconnect Google" : "Connect Google"}
                  </Button>
                </div>
              ) : (
                "Ask a workspace admin to connect Google in any sheet's Google panel."
              )
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <Label>Google account</Label>
              <Select
                value={chosen?.id}
                onChange={onConnectionChange}
                style={{ width: "100%" }}
                options={usable.map((c) => ({ value: c.id, label: c.email ?? "Google account" }))}
                popupRender={(menu) => (
                  <>
                    {menu}
                    {isAdmin ? (
                      <Button type="link" size="small" onClick={connect} style={{ margin: 4 }}>
                        + Connect another account
                      </Button>
                    ) : null}
                  </>
                )}
              />
            </div>
            {target.mode === "existing" ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px dashed ${token.colorBorder}`,
                }}
              >
                <MIcon name="table_view" size={20} color="#1e9e6a" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {target.picked ? (
                    <>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{target.picked.name}</div>
                      <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                        The first tab is used; a &ldquo;Cubes ID&rdquo; column is added as column A. This file stays yours, so
                        Cubes can&apos;t share it — the team needs access to it in Google Drive to see it here.
                      </div>
                    </>
                  ) : (
                    <span style={{ color: token.colorTextSecondary }}>
                      {isAdmin ? "Pick the spreadsheet from Google Drive." : "Only workspace admins can pick a sheet from Drive."}
                    </span>
                  )}
                </div>
                <Button onClick={() => void pick()} loading={picking} disabled={!isAdmin}>
                  {target.picked ? "Change" : "Choose from Drive"}
                </Button>
              </div>
            ) : null}
          </div>
        )
      ) : null}
      {/* The Picker is an iframe dialog Google appends to <body>; lift it above antd's modal layer. */}
      <style>{`.picker-dialog-bg { z-index: 2000 !important; } .picker-dialog { z-index: 2001 !important; }`}</style>
    </div>
  );
}
