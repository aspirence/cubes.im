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
  "/chat",
  "/schedule",
  "/reporting/time",
  "/workflows",
  "/people",
  "/apps",
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
      version: 3,
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
        // v2: Time analytics rail item (added after the first release).
        if (!ids.includes("/reporting/time")) {
          const anchor = ids.indexOf("/schedule");
          if (anchor >= 0) ids.splice(anchor + 1, 0, "/reporting/time");
          else ids.splice(Math.min(1, ids.length), 0, "/reporting/time");
        }
        // v3: Social Studio became Content Studio. An installed app's rail item is
        // identified as `app:${app.key}`, so anyone who had it pinned has the old
        // key sitting in localStorage. The catalog no longer answers to it, and the
        // reverse lookup in primary-sidebar.ts would quietly drop the item off their
        // rail. Rewrite it in place rather than re-pinning, so it keeps its position.
        const stale = ids.indexOf("app:social_studio");
        if (stale >= 0) {
          if (ids.includes("app:content_studio")) ids.splice(stale, 1);
          else ids[stale] = "app:content_studio";
        }
        return { ...s, sidebarPinnedItemIds: ids };
      },
    },
  ),
);
