"use client";

/**
 * "Pick a video from Google Drive" — the whole flow, as one prop-driven
 * component so the new-review modal and the reviewer page's new-version modal
 * mount the same thing and cannot drift apart.
 *
 * The flow it owns:
 *   not connected  → explain the trade and offer Connect (admins) or who to ask
 *   connected      → open Google's Picker (videos and folders both selectable)
 *   picked a video → attach it
 *   picked a folder→ browse it here: thumbnails, names, durations, sizes,
 *                    subfolders, search, and (where it makes sense) "add all"
 *
 * Nothing in here talks to Google directly except the Picker, which needs the
 * team's own access token by design. Everything else goes through our routes so
 * the refresh token stays on the server.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Select, Spin, theme } from "antd";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import {
  DriveRouteUnavailableError,
  fetchDriveFile,
  fetchDriveFolder,
  type DriveAttachment,
  type DriveFolderRef,
  type DriveVideo,
} from "./drive-api";
import { pickFromDrive } from "./drive-picker";
import { DriveFolderBrowser } from "./drive-folder-browser";
import { AttachedDriveCard, type ImportState } from "./attached-drive-card";
import {
  currentFolder,
  initialPickingState,
  isBusy,
  pickingReducer,
} from "./picking-state";
import {
  connectDriveHref,
  pickDriveConnection,
  useDriveConnections,
} from "./use-drive-connections";

export type { DriveAttachment } from "./drive-api";

export function DriveSourcePicker({
  teamId,
  returnTo,
  value,
  onChange,
  connectionId: controlledConnectionId,
  onConnectionChange,
  openFolder,
  onAddMany,
  addManyLabel,
  importState,
  importError,
  onImport,
  importAsIntent,
  importIntent,
  onImportIntentChange,
  onBeforeConnect,
}: {
  teamId: string | undefined;
  /** Where Google's consent screen returns to — normally this page plus a
   *  marker the caller reads to reopen its modal. */
  returnTo: string;
  value: DriveAttachment | null;
  onChange: (next: DriveAttachment | null) => void;
  connectionId?: string | null;
  onConnectionChange?: (id: string) => void;
  /** Start inside this folder — used when a pasted link turned out to be one. */
  openFolder?: DriveFolderRef | null;
  /** Only the new-review modal can make many reviews at once. */
  onAddMany?: (videos: DriveVideo[], connectionId: string) => void;
  addManyLabel?: string;
  importState?: ImportState;
  importError?: string | null;
  onImport?: () => void;
  importAsIntent?: boolean;
  importIntent?: boolean;
  onImportIntentChange?: (next: boolean) => void;
  onBeforeConnect?: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { data: connections, isLoading: connectionsLoading } = useDriveConnections();
  const [localConnectionId, setLocalConnectionId] = useState<string | null>(null);
  const connectionId = controlledConnectionId ?? localConnectionId;
  const chosen = pickDriveConnection(connections, connectionId);
  const usable = (connections ?? []).filter((c) => c.usable);
  const broken = (connections ?? []).filter((c) => !c.usable);

  const [state, dispatch] = useReducer(pickingReducer, initialPickingState);
  const [selected, setSelected] = useState<DriveVideo[]>([]);

  // The attachment is owned by the caller (it is part of their form), but the
  // step is ours. Keep them agreeing without making the caller drive both.
  useEffect(() => {
    if (value && state.step !== "attached") {
      dispatch({ type: "attach", connectionId: value.connectionId, video: value.video });
    } else if (!value && state.step === "attached") {
      dispatch({ type: "detach" });
    }
    // Only the caller's value should re-run this; `state.step` is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // A pasted link that turned out to be a folder drops the user straight into
  // it. Guarded by the last id we honoured so re-renders don't yank them back.
  const honouredFolder = useRef<string | null>(null);
  useEffect(() => {
    if (openFolder && honouredFolder.current !== openFolder.id) {
      honouredFolder.current = openFolder.id;
      dispatch({ type: "enterFolder", folder: openFolder });
    }
    if (!openFolder) honouredFolder.current = null;
  }, [openFolder]);

  const folder = currentFolder(state);

  const listing = useQuery({
    queryKey: ["video-review-drive-folder", chosen?.id, folder?.id],
    enabled: Boolean(chosen?.id && folder?.id),
    queryFn: ({ signal }) =>
      fetchDriveFolder({
        connectionId: chosen?.id as string,
        folderId: folder?.id as string,
        folderName: folder?.name,
        signal,
      }),
    // A folder's contents rarely change inside one modal session, and each
    // fetch costs a Drive API call against the team's quota.
    staleTime: 60_000,
    retry: false,
  });

  const connect = () => {
    if (!teamId) return;
    onBeforeConnect?.();
    window.location.assign(connectDriveHref(teamId, returnTo));
  };

  const setConnection = (id: string) => {
    if (onConnectionChange) onConnectionChange(id);
    else setLocalConnectionId(id);
  };

  const attach = useCallback(
    (video: DriveVideo, connId: string) => {
      dispatch({ type: "attach", connectionId: connId, video });
      onChange({ connectionId: connId, video });
      setSelected([]);
    },
    [onChange],
  );

  const openPicker = async () => {
    if (!teamId || !chosen) return;
    dispatch({ type: "openPicker" });
    try {
      const picked = await pickFromDrive(teamId, chosen.id);
      if (!picked) {
        dispatch({ type: "cancelled" });
        return;
      }
      if (picked.kind === "folder") {
        dispatch({ type: "enterFolder", folder: { id: picked.id, name: picked.name } });
        return;
      }
      // The Picker's payload has the id and the name but usually no size or
      // duration, so the file is re-read through our route: one call buys the
      // metadata the card shows, and proves the server can actually read the
      // file before the user commits to it.
      dispatch({ type: "resolve" });
      try {
        const resolved = await fetchDriveFile({
          connectionId: chosen.id,
          fileId: picked.id,
        });
        if (resolved.kind === "folder") {
          dispatch({ type: "enterFolder", folder: resolved.folder });
          return;
        }
        attach(resolved.video, chosen.id);
      } catch (err) {
        // A refusal from Drive — not a video, downloads blocked, access gone —
        // has to be shown: attaching anyway would produce a review that plays
        // as a black rectangle. Only a missing route falls back to what the
        // Picker already told us, which is enough to keep working.
        if (!(err instanceof DriveRouteUnavailableError)) {
          dispatch({ type: "failed", message: errMsg(err, "Couldn’t use that Drive file.") });
          return;
        }
        attach(
          {
            id: picked.id,
            name: picked.name,
            mimeType: picked.mimeType ?? "video/mp4",
            sizeBytes: picked.sizeBytes,
            durationMs: picked.durationMs,
            thumbnailUrl: picked.thumbnailUrl,
            modifiedAt: null,
            canDownload: true,
          },
          chosen.id,
        );
        message.warning(errMsg(err, "Attached, but Drive details couldn’t be read yet."));
      }
    } catch (err) {
      dispatch({ type: "failed", message: errMsg(err, "Couldn’t open Google Drive.") });
    }
  };

  const toggleSelect = (video: DriveVideo) => {
    setSelected((prev) =>
      prev.some((v) => v.id === video.id)
        ? prev.filter((v) => v.id !== video.id)
        : [...prev, video],
    );
  };

  const selectedIds = useMemo(() => selected.map((v) => v.id), [selected]);

  /* ---------------------------------------------------------------- *
   * Not connected — the only honest thing to do is explain and offer.
   * ---------------------------------------------------------------- */
  if (!connectionsLoading && usable.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message={broken.length ? "Google needs to be reconnected" : "Connect Google Drive"}
        description={
          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 12.5 }}>
              Cubes only sees the videos and folders you pick here — nothing else in your
              Drive. Connecting is what lets a Drive video carry timestamped comments and
              drawings, because Cubes can then play it in its own player instead of Drive’s.
            </span>
            {broken.length && broken[0].lastTestError ? (
              <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                Last error: {broken[0].lastTestError}
              </span>
            ) : null}
            <Button
              type="primary"
              onClick={connect}
              disabled={!teamId}
              icon={<MIcon name="link" size={16} />}
              style={{ justifySelf: "start" }}
            >
              {broken.length ? "Reconnect Google" : "Connect Google"}
            </Button>
            <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
              Not an admin? Ask a workspace admin to connect Google — or upload the file
              instead, which always supports timestamps.
            </span>
          </div>
        }
      />
    );
  }

  if (connectionsLoading) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 18 }}>
        <Spin size="small" />
      </div>
    );
  }

  /* ---------------------------------------------------------------- *
   * Attached.
   * ---------------------------------------------------------------- */
  if (state.step === "attached") {
    return (
      <AttachedDriveCard
        attachment={state.attachment}
        accountEmail={chosen?.email}
        onDetach={() => {
          dispatch({ type: "detach" });
          onChange(null);
        }}
        importState={importState}
        importError={importError}
        onImport={onImport}
        importAsIntent={importAsIntent}
        importIntent={importIntent}
        onImportIntentChange={onImportIntentChange}
      />
    );
  }

  /* ---------------------------------------------------------------- *
   * Browsing a folder.
   * ---------------------------------------------------------------- */
  if (state.step === "browsing") {
    return (
      <DriveFolderBrowser
        trail={state.trail}
        listing={listing.data}
        loading={listing.isLoading || listing.isFetching}
        error={
          state.error ??
          (listing.error ? errMsg(listing.error, "Couldn’t read that folder.") : null)
        }
        search={state.search}
        onSearch={(v) => dispatch({ type: "search", value: v })}
        onCrumb={(i) => dispatch({ type: "crumb", index: i })}
        onOpenFolder={(f) => dispatch({ type: "enterFolder", folder: f })}
        onChoose={(video) => chosen && attach(video, chosen.id)}
        multiSelect={Boolean(onAddMany)}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        addSelectedLabel={addManyLabel}
        onAddSelected={() => {
          if (chosen && selected.length) {
            onAddMany?.(selected, chosen.id);
            setSelected([]);
          }
        }}
        onBack={() => dispatch({ type: "reset" })}
      />
    );
  }

  /* ---------------------------------------------------------------- *
   * Idle / waiting.
   * ---------------------------------------------------------------- */
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {usable.length > 1 ? (
        <Select
          size="small"
          value={chosen?.id}
          onChange={setConnection}
          options={usable.map((c) => ({ value: c.id, label: c.email ?? "Google account" }))}
          style={{ width: "100%" }}
        />
      ) : null}

      <Button
        type="primary"
        block
        loading={isBusy(state)}
        onClick={openPicker}
        icon={<MIcon name="add_to_drive" size={16} />}
      >
        Choose from Google Drive
      </Button>

      <div style={{ fontSize: 11.5, color: token.colorTextTertiary, lineHeight: 1.5 }}>
        Pick a video, or a whole folder and choose from what’s inside it. Cubes plays it in
        its own player, so comments and drawings can be pinned to the second
        {chosen?.email ? ` · ${chosen.email}` : ""}
      </div>

      {state.error ? <Alert type="error" showIcon message={state.error} /> : null}
    </div>
  );
}
