"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Sticky choices the CRM's create forms make on the user's behalf. Leads
 * usually arrive in runs — same account, and above all same campaign — so what
 * was picked last time is the right guess for the next one. The fields stay
 * editable; this only saves the trip through the dropdown, and in the campaign's
 * case it is what keeps a pasted lead attributable instead of landing with
 * `campaign_id = null` and disappearing from every cost-per-lead number.
 */
interface CrmPrefsState {
  lastCompanyId: string | null;
  setLastCompanyId: (id: string | null) => void;
  lastCampaignId: string | null;
  setLastCampaignId: (id: string | null) => void;
}

export const useCrmPrefsStore = create<CrmPrefsState>()(
  persist(
    (set) => ({
      lastCompanyId: null,
      setLastCompanyId: (id) => set({ lastCompanyId: id }),
      lastCampaignId: null,
      setLastCampaignId: (id) => set({ lastCampaignId: id }),
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
