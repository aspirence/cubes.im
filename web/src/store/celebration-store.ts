import { create } from "zustand";

import type { CelebrationTemplate } from "@/features/celebrations/use-celebrations";

/**
 * A raw "something succeeded" signal from a call site. Deliberately dumb: call
 * sites only report the fact; ALL gating (rule enabled/template/mute, award
 * lookup, milestone derivation) happens in the overlay controller, so adding a
 * celebration to a new site stays a one-liner.
 */
export interface CelebrationSignal {
  kind: "task_done";
  taskId: string;
  taskName?: string;
  /** Date.now() at enqueue — anchors the fresh-award window. */
  at: number;
  /**
   * Settings "Preview": render this template with sample data, skipping every
   * gate (mute, enabled, award lookup).
   */
  preview?: CelebrationTemplate;
}

interface CelebrationState {
  queue: CelebrationSignal[];
  enqueue: (signal: CelebrationSignal) => void;
  /**
   * Drops queue[0] once its screens have been shown/dropped. Passing the
   * signal makes the call idempotent: the auto-dismiss timer, Escape and a
   * backdrop click can all race on the same screen, and only the first may
   * actually consume the queue head — an unconditional second shift would
   * silently drop the NEXT queued celebration.
   */
  shift: (expected?: CelebrationSignal) => void;
}

export const useCelebrationStore = create<CelebrationState>((set) => ({
  queue: [],
  enqueue: (signal) => set((s) => ({ queue: [...s.queue, signal] })),
  shift: (expected) =>
    set((s) =>
      expected === undefined || s.queue[0] === expected
        ? { queue: s.queue.slice(1) }
        : s,
    ),
}));
