import { create } from "zustand";

/**
 * Tiny store tracking which task (if any) is open in the task detail drawer.
 * The drawer component (agent D) reads `taskId` to decide whether to render and
 * what to load; any UI can call `open(id)` / `close()`.
 */
interface TaskDrawerState {
  taskId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useTaskDrawer = create<TaskDrawerState>((set) => ({
  taskId: null,
  open: (id) => set({ taskId: id }),
  close: () => set({ taskId: null }),
}));
