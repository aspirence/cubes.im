"use client";

import type { ReactNode } from "react";
import { create } from "zustand";

interface ViewToolbarSlotState {
  node: ReactNode;
  setNode: (node: ReactNode) => void;
}

/**
 * A slot on the project tab bar that the ACTIVE view fills with its own controls
 * (group-by, filter).
 *
 * Those controls are driven by the view's own state and data — statuses,
 * priorities, labels, members are all fetched inside the view tab. Rendering
 * them on the tab row would normally mean lifting that entire data layer up into
 * the page just to draw two buttons; instead the view publishes its toolbar here
 * on mount and clears it on unmount. Tabs use `destroyOnHidden`, so switching to
 * a view that publishes nothing (Activity, Overview) empties the slot on its own.
 */
export const useViewToolbarSlot = create<ViewToolbarSlotState>((set) => ({
  node: null,
  setNode: (node) => set({ node }),
}));

/** Renders whatever the active view published. */
export function ViewToolbarSlot() {
  const node = useViewToolbarSlot((s) => s.node);
  return <>{node}</>;
}
