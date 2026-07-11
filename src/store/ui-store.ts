import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ThemeMode } from "@/lib/theme";

interface UIState {
  themeMode: ThemeMode;
  sidebarCollapsed: boolean;
  sidebarPinnedItemIds: string[];
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarPinnedItems: (ids: string[]) => void;
  resetSidebarPinnedItems: () => void;
}

export const DEFAULT_SIDEBAR_PINNED_ITEM_IDS = [
  "/home",
  "/schedule",
  "/workflows",
  "/apps",
  "/reporting/overview",
  "/admin-center/overview",
  "/settings/profile",
] as const;

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      themeMode: "light",
      sidebarCollapsed: false,
      sidebarPinnedItemIds: [...DEFAULT_SIDEBAR_PINNED_ITEM_IDS],
      toggleTheme: () =>
        set((state) => ({
          themeMode: state.themeMode === "light" ? "dark" : "light",
        })),
      setThemeMode: (mode) => set({ themeMode: mode }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setSidebarPinnedItems: (ids) =>
        set({
          sidebarPinnedItemIds: Array.from(
            new Set(ids.filter((id) => typeof id === "string" && id.length > 0)),
          ),
        }),
      resetSidebarPinnedItems: () =>
        set({
          sidebarPinnedItemIds: [...DEFAULT_SIDEBAR_PINNED_ITEM_IDS],
        }),
    }),
    {
      name: "cubes-ui",
      // SSR-safe: only touch localStorage in the browser. On the server (and in
      // Node's experimental web-storage), fall back to a no-op store so module
      // evaluation never throws during prerendering.
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            },
      ),
      partialize: (state) => ({
        themeMode: state.themeMode,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarPinnedItemIds: state.sidebarPinnedItemIds,
      }),
      // Bump when a NEW item is added to the default rail so it reaches users
      // who already have a persisted (older) pinned set — otherwise the saved
      // localStorage value hides the new default forever.
      version: 1,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as {
          themeMode?: UIState["themeMode"];
          sidebarCollapsed?: boolean;
          sidebarPinnedItemIds?: string[];
        };
        const ids = Array.isArray(s.sidebarPinnedItemIds)
          ? [...s.sidebarPinnedItemIds]
          : [...DEFAULT_SIDEBAR_PINNED_ITEM_IDS];
        // Ensure Workflows is pinned by default (added after the first release).
        if (!ids.includes("/workflows")) {
          const anchor = ids.indexOf("/schedule");
          if (anchor >= 0) ids.splice(anchor + 1, 0, "/workflows");
          else ids.splice(Math.min(1, ids.length), 0, "/workflows");
        }
        return { ...s, sidebarPinnedItemIds: ids };
      },
    },
  ),
);
