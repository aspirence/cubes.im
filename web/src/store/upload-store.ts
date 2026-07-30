import { create } from "zustand";

/**
 * Global registry of in-flight background uploads. Uploads run detached from the
 * component that started them (a modal can close while bytes keep flowing), and
 * the app-shell header renders live progress from here with a per-file cancel.
 */
export type UploadStatus = "uploading" | "done" | "error" | "canceled";

export interface UploadJob {
  id: string;
  name: string;
  /** 0..1 */
  progress: number;
  status: UploadStatus;
  /** Human-readable reason when status === "error". */
  error?: string;
  /** Aborts the transfer (best-effort). */
  cancel: () => void;
}

interface UploadState {
  jobs: UploadJob[];
  add: (job: UploadJob) => void;
  update: (id: string, patch: Partial<UploadJob>) => void;
  remove: (id: string) => void;
  /** Drop everything that's no longer uploading. */
  clearFinished: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  jobs: [],
  add: (job) => set((s) => ({ jobs: [...s.jobs, job] })),
  update: (id, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    })),
  remove: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
  clearFinished: () =>
    set((s) => ({ jobs: s.jobs.filter((j) => j.status === "uploading") })),
}));
