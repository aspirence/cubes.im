"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Sticky choices the CRM's create forms make on the user's behalf. Leads
 * usually arrive in runs for the same account, so the company picked last
 * time is the right guess for the next one — the field stays editable, this
 * only saves the trip through the dropdown.
 */
interface CrmPrefsState {
  lastCompanyId: string | null;
  setLastCompanyId: (id: string | null) => void;
}

export const useCrmPrefsStore = create<CrmPrefsState>()(
  persist(
    (set) => ({
      lastCompanyId: null,
      setLastCompanyId: (id) => set({ lastCompanyId: id }),
    }),
    {
      name: "crm-prefs",
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            }
          : window.localStorage,
      ),
      version: 1,
    },
  ),
);
