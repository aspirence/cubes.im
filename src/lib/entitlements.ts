/**
 * Free vs paid workspace entitlements for the hosted Cloud product.
 *
 * These numbers MIRROR the DB guards in migration
 * `20261049000000_plan_entitlements.sql` — keep them in sync. The DB triggers
 * are the authoritative enforcement (they can't be bypassed); the values here
 * drive the UI (upgrade prompts, disabled buttons, usage meters).
 *
 * Everything is gated by `isCloud()`: self-hosted installs
 * (`NEXT_PUBLIC_CUBES_CLOUD` unset) are fully unlimited with no billing UI.
 */

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export type Plan = "free" | "cloud";

export interface Entitlements {
  /** Workspaces a free account may create before needing a plan. `null` = unlimited. */
  maxWorkspacesPerAccount: number | null;
  maxProjectsPerWorkspace: number | null;
  maxMembersPerWorkspace: number | null;
  /** Total stored bytes per workspace. `null` = tier-based / unlimited. */
  storageBytes: number | null;
  /** Largest single upload. `null` = provider default. */
  maxUploadBytes: number | null;
  /** AI runs (breakdown/standup/task) per workspace per month. `null` = unlimited. */
  aiRunsPerMonth: number | null;
  /** May install/use premium apps (see PREMIUM_APP_KEYS). */
  premiumApps: boolean;
}

export const FREE: Entitlements = {
  maxWorkspacesPerAccount: 1,
  maxProjectsPerWorkspace: 2,
  maxMembersPerWorkspace: 3,
  storageBytes: 1 * GB,
  maxUploadBytes: 25 * MB,
  aiRunsPerMonth: 20,
  premiumApps: false,
};

export const PAID: Entitlements = {
  maxWorkspacesPerAccount: null,
  maxProjectsPerWorkspace: null,
  maxMembersPerWorkspace: null,
  storageBytes: null, // capacity comes from the chosen team_subscriptions.storage_gb tier
  maxUploadBytes: null,
  aiRunsPerMonth: null,
  premiumApps: true,
};

/** App keys locked behind a paid plan on the Cloud product. */
export const PREMIUM_APP_KEYS = [
  "video-review",
  "social-studio",
  "client-portals",
  "hr",
] as const;

export type PremiumAppKey = (typeof PREMIUM_APP_KEYS)[number];

/**
 * True when this deployment is the paid, hosted Cloud product — enables plan
 * limits and billing UI. Self-hosted installs leave NEXT_PUBLIC_CUBES_CLOUD
 * unset and stay fully unlimited.
 */
export function isCloud(): boolean {
  return process.env.NEXT_PUBLIC_CUBES_CLOUD === "true";
}

export function entitlementsFor(plan: Plan): Entitlements {
  return plan === "cloud" ? PAID : FREE;
}

/** Structured codes raised by the DB guards, for mapping to upgrade prompts. */
export const PLAN_LIMIT_CODES = {
  workspaces: "PLAN_LIMIT_WORKSPACES",
  projects: "PLAN_LIMIT_PROJECTS",
  members: "PLAN_LIMIT_MEMBERS",
  storage: "PLAN_LIMIT_STORAGE",
  fileSize: "PLAN_LIMIT_FILESIZE",
} as const;

/** Extracts a PLAN_LIMIT_* code from a thrown Supabase/postgres error message. */
export function planLimitCode(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = message.match(/PLAN_LIMIT_[A-Z]+/);
  return m ? m[0] : null;
}
