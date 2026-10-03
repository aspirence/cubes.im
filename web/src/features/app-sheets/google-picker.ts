"use client";

/**
 * Google Picker, loaded on demand.
 *
 * The integration holds only the `drive.file` scope, which lets the server
 * touch a spreadsheet the app created or one the user picked in the Picker —
 * never a file id someone pastes. So "use an existing sheet" must go through
 * here. The Picker has to be opened with the SAME Google account and OAuth
 * client the server syncs with, which is why the token comes from our
 * picker-token route (the team's stored connection) and why `setAppId` is the
 * project number: that is what attaches the file grant to this app.
 */

export interface PickedSpreadsheet {
  id: string;
  name: string;
  url: string | null;
}

/* Minimal shapes of the parts of gapi / google.picker used here. */
interface PickerDoc {
  id: string;
  name?: string;
  url?: string;
}
interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
}
interface PickerInstance {
  setVisible(v: boolean): void;
  dispose(): void;
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
  DocsView: new (viewId?: unknown) => {
    setMimeTypes(m: string): unknown;
    setIncludeFolders(v: boolean): unknown;
    setSelectFolderEnabled(v: boolean): unknown;
    setMode(m: unknown): unknown;
  };
  ViewId: { SPREADSHEETS: unknown };
  DocsViewMode: { LIST: unknown };
  Action: { PICKED: string; CANCEL: string };
  Feature: { NAV_HIDDEN: unknown };
}
type PickerWindow = Window & {
  gapi?: { load: (lib: string, cb: { callback: () => void; onerror: () => void }) => void };
  google?: { picker?: PickerNamespace };
};

const SCRIPT_SRC = "https://apis.google.com/js/api.js";
let loading: Promise<PickerNamespace> | null = null;

function loadPicker(): Promise<PickerNamespace> {
  const w = window as PickerWindow;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  if (loading) return loading;
  loading = new Promise<PickerNamespace>((resolve, reject) => {
    const withGapi = () => {
      if (!w.gapi) {
        reject(new Error("Google's script loaded without gapi."));
        return;
      }
      w.gapi.load("picker", {
        callback: () => (w.google?.picker ? resolve(w.google.picker) : reject(new Error("Google Picker didn't load."))),
        onerror: () => reject(new Error("Google Picker didn't load.")),
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
    script.onerror = () => reject(new Error("Couldn't reach Google (apis.google.com). Check your connection or content blockers."));
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

/**
 * Opens the Picker for spreadsheets and resolves with the chosen file, or
 * null when the user closes it. Throws with a readable message when Google or
 * our token route is not available.
 */
export async function pickSpreadsheet(teamId: string, connectionId: string): Promise<PickedSpreadsheet | null> {
  const res = await fetch(
    `/api/integrations/google/picker-token?teamId=${encodeURIComponent(teamId)}&connectionId=${encodeURIComponent(connectionId)}`,
  );
  const body = (await res.json().catch(() => null)) as (PickerToken & { error?: string; reconnect?: boolean }) | null;
  if (!res.ok || !body?.accessToken) {
    throw new Error(
      body?.reconnect
        ? "Google needs to be reconnected before a sheet can be picked."
        : (body?.error ?? `Couldn't open Google Drive (${res.status}).`),
    );
  }
  const developerKey = body.developerKey || process.env.NEXT_PUBLIC_GOOGLE_API_KEY || "";
  const appId = body.appId || process.env.NEXT_PUBLIC_GOOGLE_APP_ID || "";
  if (!developerKey || !appId) {
    throw new Error("Google Picker isn't configured (NEXT_PUBLIC_GOOGLE_API_KEY / NEXT_PUBLIC_GOOGLE_APP_ID).");
  }
  const picker = await loadPicker();

  return new Promise<PickedSpreadsheet | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
    view.setMimeTypes("application/vnd.google-apps.spreadsheet");
    view.setIncludeFolders(false);
    view.setSelectFolderEnabled(false);
    view.setMode(picker.DocsViewMode.LIST);
    let instance: PickerInstance | null = null;
    instance = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.NAV_HIDDEN)
      .setOAuthToken(body.accessToken)
      .setDeveloperKey(developerKey)
      .setAppId(appId)
      .setOrigin(window.location.origin)
      .setTitle("Choose a Google Sheet to sync with")
      .setCallback((r) => {
        if (r.action === picker.Action.PICKED && r.docs?.[0]) {
          const d = r.docs[0];
          resolve({ id: d.id, name: d.name ?? "Untitled spreadsheet", url: d.url ?? null });
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
