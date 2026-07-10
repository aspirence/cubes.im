"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Local folder" access via the File System Access API — the user points at a
 * folder ON THEIR OWN MACHINE and browses it in the app WITHOUT uploading. The
 * chosen directory handle is persisted in IndexedDB (handles are structured-
 * cloneable) so it's remembered across sessions; the browser still requires a
 * user gesture to re-grant read permission each session.
 *
 * This is single-user, single-browser by nature (a web page is sandboxed and
 * cannot serve a local folder to other machines on the LAN — that needs a
 * native agent). Team sharing is handled separately by "Push to remote", which
 * uploads picked files to the project's cloud Files.
 */

export interface LocalEntry {
  name: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
  fileHandle?: FileSystemFileHandle;
  dirHandle?: FileSystemDirectoryHandle;
}

export type LocalPerm = "unsupported" | "none" | "prompt" | "granted";

type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (opts?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
};

type PermMode = "read" | "readwrite";
type PermCapableHandle = {
  queryPermission?: (o: { mode: PermMode }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: PermMode }) => Promise<PermissionState>;
};

const SUPPORTED =
  typeof window !== "undefined" &&
  typeof (window as PickerWindow).showDirectoryPicker === "function";

/* ------------------------------------------------------------ IndexedDB */

const DB_NAME = "cubes-local";
const STORE = "folder-handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key: string, val: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(val, key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
async function idbDel(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction(STORE, "readwrite")
      .objectStore(STORE)
      .delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

/* ---------------------------------------------------------------- utils */

function dirEntries(
  dir: FileSystemDirectoryHandle,
): AsyncIterableIterator<[string, FileSystemHandle]> {
  return (
    dir as unknown as {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    }
  ).entries();
}

async function queryPerm(handle: FileSystemDirectoryHandle): Promise<LocalPerm> {
  const q = (handle as PermCapableHandle).queryPermission;
  if (!q) return "granted";
  const state = await q.call(handle, { mode: "read" });
  return state === "granted" ? "granted" : "prompt";
}

/** All files under `dir`, recursively, with paths relative to it. */
export async function collectFiles(
  dir: FileSystemDirectoryHandle,
  prefix = "",
  acc: { file: File; rel: string }[] = [],
): Promise<{ file: File; rel: string }[]> {
  for await (const [name, handle] of dirEntries(dir)) {
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      acc.push({ file, rel: prefix + name });
    } else {
      await collectFiles(handle as FileSystemDirectoryHandle, prefix + name + "/", acc);
    }
  }
  return acc;
}

export async function copyFileTo(entry: LocalEntry): Promise<boolean> {
  if (!entry.fileHandle) return false;
  const w = window as PickerWindow;
  if (!w.showSaveFilePicker) return false;
  const file = await entry.fileHandle.getFile();
  const dest = await w.showSaveFilePicker({ suggestedName: entry.name });
  const writable = await (
    dest as unknown as {
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }
  ).createWritable();
  await writable.write(file);
  await writable.close();
  return true;
}

/* ----------------------------------------------------------------- hook */

export function useLocalFolder(projectId: string) {
  const key = `folder:${projectId}`;
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [perm, setPerm] = useState<LocalPerm>(SUPPORTED ? "none" : "unsupported");
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  // Mirror `path` into a ref so the navigation callbacks can read the latest
  // path without depending on it (keeps their identity stable).
  const pathRef = useRef<string[]>([]);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const resolveDir = useCallback(
    async (rootHandle: FileSystemDirectoryHandle, segs: string[]) => {
      let dir = rootHandle;
      for (const s of segs) dir = await dir.getDirectoryHandle(s);
      return dir;
    },
    [],
  );

  const listDir = useCallback(
    async (rootHandle: FileSystemDirectoryHandle, segs: string[]) => {
      setLoading(true);
      try {
        const dir = await resolveDir(rootHandle, segs);
        const out: LocalEntry[] = [];
        for await (const [name, handle] of dirEntries(dir)) {
          if (handle.kind === "directory") {
            out.push({ name, kind: "directory", dirHandle: handle as FileSystemDirectoryHandle });
          } else {
            const f = await (handle as FileSystemFileHandle).getFile();
            out.push({
              name,
              kind: "file",
              size: f.size,
              lastModified: f.lastModified,
              fileHandle: handle as FileSystemFileHandle,
            });
          }
        }
        out.sort((a, b) =>
          a.kind === b.kind
            ? a.name.localeCompare(b.name)
            : a.kind === "directory"
              ? -1
              : 1,
        );
        setEntries(out);
      } finally {
        setLoading(false);
      }
    },
    [resolveDir],
  );

  // Load a previously-configured handle for this project.
  useEffect(() => {
    if (!SUPPORTED) return;
    let cancelled = false;
    void (async () => {
      const h = await idbGet<FileSystemDirectoryHandle>(key);
      if (cancelled || !h) return;
      setRoot(h);
      const p = await queryPerm(h);
      setPerm(p);
      if (p === "granted") {
        setPath([]);
        await listDir(h, []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, listDir]);

  const configure = useCallback(async () => {
    const w = window as PickerWindow;
    if (!w.showDirectoryPicker) return;
    const h = await w.showDirectoryPicker({ mode: "read" });
    await idbSet(key, h);
    setRoot(h);
    setPerm("granted");
    setPath([]);
    await listDir(h, []);
  }, [key, listDir]);

  const reconnect = useCallback(async () => {
    if (!root) return;
    const req = (root as PermCapableHandle).requestPermission;
    const state = req ? await req.call(root, { mode: "read" }) : "granted";
    if (state === "granted") {
      setPerm("granted");
      setPath([]);
      await listDir(root, []);
    } else {
      setPerm("prompt");
    }
  }, [root, listDir]);

  const openDir = useCallback(
    async (name: string) => {
      if (!root) return;
      const next = [...pathRef.current, name];
      setPath(next);
      await listDir(root, next);
    },
    [root, listDir],
  );

  const goTo = useCallback(
    async (index: number) => {
      if (!root) return;
      const next = pathRef.current.slice(0, index);
      setPath(next);
      await listDir(root, next);
    },
    [root, listDir],
  );

  const refresh = useCallback(async () => {
    if (root && perm === "granted") await listDir(root, pathRef.current);
  }, [root, perm, listDir]);

  const disconnect = useCallback(async () => {
    await idbDel(key);
    setRoot(null);
    setPerm("none");
    setPath([]);
    setEntries([]);
  }, [key]);

  /** All files under the CURRENT folder (recursive) — for "Push all". */
  const collectCurrent = useCallback(async () => {
    if (!root) return [];
    const dir = await resolveDir(root, pathRef.current);
    return collectFiles(dir);
  }, [root, resolveDir]);

  /** Deletes an entry from the CURRENT folder on disk. Needs readwrite — the
   *  browser prompts for it the first time (returns false if not granted). */
  const deleteEntry = useCallback(
    async (name: string): Promise<boolean> => {
      if (!root) return false;
      const req = (root as PermCapableHandle).requestPermission;
      const state = req ? await req.call(root, { mode: "readwrite" }) : "granted";
      if (state !== "granted") return false;
      const dir = await resolveDir(root, pathRef.current);
      await (
        dir as unknown as {
          removeEntry: (n: string, o?: { recursive?: boolean }) => Promise<void>;
        }
      ).removeEntry(name, { recursive: true });
      await listDir(root, pathRef.current);
      return true;
    },
    [root, resolveDir, listDir],
  );

  return {
    supported: SUPPORTED,
    perm,
    rootName: root?.name ?? null,
    path,
    entries,
    loading,
    configure,
    reconnect,
    openDir,
    goTo,
    refresh,
    disconnect,
    collectCurrent,
    deleteEntry,
  };
}
