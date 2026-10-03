"use client";

/**
 * Google Picker for Video Review — videos AND folders.
 *
 * Deliberately a near-twin of app-sheets/google-picker.ts rather than a shared
 * abstraction: the two differ in the view they build (spreadsheets vs. videos
 * plus selectable folders) and in what they resolve with, which is most of what
 * either file does. A shared version would be a pile of options with one caller
 * each. What matters is that both obey the same rule, so it is repeated here:
 *
 * the Picker MUST be opened with the access token of the team's stored
 * connection. `drive.file` grants access to a file per consent, so a file
 * picked under any other token is a file the server then cannot read — the
 * read comes back 404 and the video looks broken for no visible reason.
 */

export interface PickedDriveItem {
  kind: "file" | "folder";
  id: string;
  name: string;
  mimeType: string | null;
  url: string | null;
  /** Drive sends these for videos it has finished processing; often absent. */
  sizeBytes: number | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
}

/* Minimal shapes of the parts of gapi / google.picker used here. */
interface PickerDoc {
  id: string;
  name?: string;
  mimeType?: string;
  url?: string;
  sizeBytes?: number | string;
  duration?: number | string;
  durationMillis?: number | string;
  thumbnails?: { url: string; width?: number; height?: number }[];
}
interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
}
interface PickerInstance {
  setVisible(v: boolean): void;
  dispose(): void;
}
interface DocsViewInstance {
  setMimeTypes(m: string): unknown;
  setIncludeFolders(v: boolean): unknown;
  setSelectFolderEnabled(v: boolean): unknown;
  setMode(m: unknown): unknown;
  setLabel?(l: string): unknown;
}
interface PickerBuilderInstance {
  addView(view: unknown): PickerBuilderInstance;
  setOAuthToken(t: string): PickerBuilderInstance;
  setDeveloperKey(k: string): PickerBuilderInstance;
  setAppId(id: string): PickerBuilderInstance;
  setOrigin(o: string): PickerBuilderInstance;
  setTitle(t: string): PickerBuilderInstance;
  setCallback(cb: (r: PickerResponse) => void): PickerBuilderInstance;
  enableFeature(f: unknown): PickerBuilderInstance;
  build(): PickerInstance;
}
interface PickerNamespace {
  PickerBuilder: new () => PickerBuilderInstance;
  DocsView: new (viewId?: unknown) => DocsViewInstance;
  ViewId: { DOCS_VIDEOS: unknown; FOLDERS: unknown; DOCS: unknown };
  DocsViewMode: { GRID: unknown; LIST: unknown };
  Action: { PICKED: string; CANCEL: string };
  Feature: { NAV_HIDDEN: unknown; SUPPORT_DRIVES: unknown };
}
type PickerWindow = Window & {
  gapi?: { load: (lib: string, cb: { callback: () => void; onerror: () => void }) => void };
  google?: { picker?: PickerNamespace };
};

const SCRIPT_SRC = "https://apis.google.com/js/api.js";
const FOLDER_MIME = "application/vnd.google-apps.folder";

let loading: Promise<PickerNamespace> | null = null;

function loadPicker(): Promise<PickerNamespace> {
  const w = window as PickerWindow;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  if (loading) return loading;
  loading = new Promise<PickerNamespace>((resolve, reject) => {
    const withGapi = () => {
      if (!w.gapi) {
        reject(new Error("Google’s script loaded without gapi."));
        return;
      }
      w.gapi.load("picker", {
        callback: () =>
          w.google?.picker
            ? resolve(w.google.picker)
            : reject(new Error("Google Picker didn’t load.")),
        onerror: () => reject(new Error("Google Picker didn’t load.")),
      });
    };
    if (w.gapi) {
      withGapi();
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = withGapi;
    script.onerror = () =>
      reject(
        new Error(
          "Couldn’t reach Google (apis.google.com). Check your connection or content blockers.",
        ),
      );
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later click try again instead of caching the failure forever.
    loading = null;
    throw err;
  });
  return loading;
}

interface PickerToken {
  accessToken: string;
  developerKey?: string;
  appId?: string;
}

function toNumber(value: number | string | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/** The largest thumbnail the Picker offered, which is still only ~256px wide. */
function bestThumbnail(doc: PickerDoc): string | null {
  const thumbs = doc.thumbnails ?? [];
  if (thumbs.length === 0) return null;
  return thumbs.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a)).url ?? null;
}

function toPicked(doc: PickerDoc): PickedDriveItem {
  const mimeType = doc.mimeType ?? null;
  return {
    kind: mimeType === FOLDER_MIME ? "folder" : "file",
    id: doc.id,
    name: doc.name ?? "Untitled",
    mimeType,
    url: doc.url ?? null,
    sizeBytes: toNumber(doc.sizeBytes),
    // Drive has used both spellings over the years; take whichever arrives.
    durationMs: toNumber(doc.durationMillis ?? doc.duration),
    thumbnailUrl: bestThumbnail(doc),
  };
}

/**
 * Opens the Picker on the team's Google account and resolves with what the user
 * chose, or null when they closed it. Videos and folders are both selectable:
 * choosing a video attaches it, choosing a folder hands the caller a folder to
 * browse in-app — which is the whole point, since a folder link used to be
 * rejected outright.
 *
 * Throws with a readable message when Google, or our token route, is unusable.
 */
export async function pickFromDrive(
  teamId: string,
  connectionId: string,
): Promise<PickedDriveItem | null> {
  const res = await fetch(
    `/api/integrations/google/picker-token?teamId=${encodeURIComponent(teamId)}&connectionId=${encodeURIComponent(connectionId)}`,
  );
  const body = (await res.json().catch(() => null)) as
    | (PickerToken & { error?: string; reconnect?: boolean })
    | null;
  if (!res.ok || !body?.accessToken) {
    throw new Error(
      body?.reconnect
        ? "Google needs to be reconnected before Drive can be opened."
        : (body?.error ?? `Couldn’t open Google Drive (${res.status}).`),
    );
  }
  const developerKey = body.developerKey || process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "";
  const appId = body.appId || process.env.NEXT_PUBLIC_GOOGLE_APP_ID || "";
  if (!developerKey || !appId) {
    throw new Error(
      "Google Picker isn’t configured (NEXT_PUBLIC_GOOGLE_API_KEY / NEXT_PUBLIC_GOOGLE_APP_ID).",
    );
  }
  const picker = await loadPicker();

  return new Promise<PickedDriveItem | null>((resolve) => {
    // Two views, because one cannot be both: a videos view that hides
    // everything else, and a folders view for "give me the whole folder".
    const videos = new picker.DocsView(picker.ViewId.DOCS_VIDEOS);
    videos.setIncludeFolders(true);
    videos.setSelectFolderEnabled(true);
    videos.setMode(picker.DocsViewMode.GRID);
    videos.setLabel?.("Videos");

    const folders = new picker.DocsView(picker.ViewId.FOLDERS);
    folders.setIncludeFolders(true);
    folders.setSelectFolderEnabled(true);
    folders.setMimeTypes(FOLDER_MIME);
    folders.setMode(picker.DocsViewMode.LIST);
    folders.setLabel?.("Folders");

    let instance: PickerInstance | null = null;
    instance = new picker.PickerBuilder()
      .addView(videos)
      .addView(folders)
      // Shared drives are where agency footage usually lives, so a picker that
      // only saw "My Drive" would miss the common case.
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(body.accessToken)
      .setDeveloperKey(developerKey)
      .setAppId(appId)
      .setOrigin(window.location.origin)
      .setTitle("Choose a video, or a folder to browse")
      .setCallback((r) => {
        if (r.action === picker.Action.PICKED && r.docs?.[0]) {
          resolve(toPicked(r.docs[0]));
          instance?.dispose();
        } else if (r.action === picker.Action.CANCEL) {
          resolve(null);
          instance?.dispose();
        }
      })
      .build();
    instance.setVisible(true);
  });
}
