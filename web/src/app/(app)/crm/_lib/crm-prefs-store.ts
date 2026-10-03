"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Sticky choices the CRM makes on the user's behalf.
 *
 * `lastCompanyId` / `lastCampaignId`: what the create forms picked last time.
 * Leads usually arrive in runs — same account, and above all same campaign —
 * so what was picked last time is the right guess for the next one. The
 * fields stay editable; this only saves the trip through the dropdown, and in
 * the campaign's case it is what keeps a pasted lead attributable instead of
 * landing with `campaign_id = null` and disappearing from every cost-per-lead
 * number.
 *
 * `scopeByTeam` / `recentByTeam`: the CRM's "current project" — the switcher
 * in the bar above every CRM tab (see _lib/crm-scope.tsx). Keyed by team
 * because a project id from workspace A must never filter workspace B: the
 * team switcher persists `users.active_team` server-side, and each workspace
 * remembers its own project. A cleared scope deletes the key rather than
 * storing null, so "no scope" and "never set" look the same.
 *
 * `importMappings`: how each lead-file layout was mapped last time, keyed by
 * its header row (see `mappingSignature`). The same Meta form or portal
 * export comes back every week; its columns should come back mapped the way
 * they were fixed the first time.
 */
interface CrmPrefsState {
  lastCompanyId: string | null;
  setLastCompanyId: (id: string | null) => void;
  lastCampaignId: string | null;
  setLastCampaignId: (id: string | null) => void;
  /** teamId → the project the CRM is on (or NO_PROJECT). */
  scopeByTeam: Record<string, string>;
  /** teamId → the projects picked most recently, newest first, at most 5. */
  recentByTeam: Record<string, string[]>;
  setScope: (teamId: string, projectId: string | null) => void;
  /** header signature → column targets, plus when it was saved (for eviction). */
  importMappings: Record<string, { targets: string[]; at: number }>;
  saveImportMapping: (signature: string, targets: string[]) => void;
}

const RECENT_MAX = 5;
const IMPORT_MAPPINGS_MAX = 25;

/** The switcher value for "records filed under no project". Never a project id. */
export const NO_PROJECT = "__none__";

export const useCrmPrefsStore = create<CrmPrefsState>()(
  persist(
    (set) => ({
      lastCompanyId: null,
      setLastCompanyId: (id) => set({ lastCompanyId: id }),
      lastCampaignId: null,
      setLastCampaignId: (id) => set({ lastCampaignId: id }),
      scopeByTeam: {},
      recentByTeam: {},
      setScope: (teamId, projectId) =>
        set((s) => {
          const scopeByTeam = { ...s.scopeByTeam };
          if (projectId) scopeByTeam[teamId] = projectId;
          else delete scopeByTeam[teamId];
          const recentByTeam = { ...s.recentByTeam };
          // "No project" is a view, not a project: it must not evict one of
          // the five recent projects.
          if (projectId && projectId !== NO_PROJECT) {
            recentByTeam[teamId] = [projectId, ...(s.recentByTeam[teamId] ?? []).filter((id) => id !== projectId)].slice(
              0,
              RECENT_MAX,
            );
          }
          return { scopeByTeam, recentByTeam };
        }),
      importMappings: {},
      saveImportMapping: (signature, targets) =>
        set((s) => {
          const next = { ...s.importMappings, [signature]: { targets, at: Date.now() } };
          const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at);
          for (const k of keys.slice(IMPORT_MAPPINGS_MAX)) delete next[k];
          return { importMappings: next };
        }),
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
      version: 3,
      // v1 held only the two create-form defaults; carry them forward — losing
      // them would blank the company/campaign the deal forms preselect. v2's
      // scope held COMPANY ids (the CRM was scoped by company for a day); the
      // scope is by project now, so those are dropped, not reinterpreted.
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<CrmPrefsState>;
        return {
          lastCompanyId: s.lastCompanyId ?? null,
          lastCampaignId: s.lastCampaignId ?? null,
          scopeByTeam: version >= 3 ? (s.scopeByTeam ?? {}) : {},
          recentByTeam: version >= 3 ? (s.recentByTeam ?? {}) : {},
          importMappings: s.importMappings ?? {},
        } as CrmPrefsState;
      },
    },
  ),
);
