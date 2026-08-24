import { create } from "zustand";

/**
 * Tiny store tracking which task (if any) is open in the task detail drawer.
 * The drawer component (agent D) reads `taskId` to decide whether to render and
 * what to load; any UI can call `open(id)` / `close()`.
 *
 * `focusCommentId` is a one-shot "reveal this comment" command carried by deep
 * links (`?task=<id>&comment=<id>` — mention/comment notifications). The
 * comments panel consumes it (scroll + flash) and clears it via
 * `clearFocusComment`; opening a task without a comment resets it so a stale
 * focus never leaks into a plain open.
 */
interface TaskDrawerState {
  taskId: string | null;
  focusCommentId: string | null;
  open: (id: string, opts?: { commentId?: string }) => void;
  close: () => void;
  clearFocusComment: () => void;
}

export const useTaskDrawer = create<TaskDrawerState>((set) => ({
  taskId: null,
  focusCommentId: null,
  open: (id, opts) => set({ taskId: id, focusCommentId: opts?.commentId ?? null }),
  close: () => set({ taskId: null, focusCommentId: null }),
  clearFocusComment: () => set({ focusCommentId: null }),
}));
