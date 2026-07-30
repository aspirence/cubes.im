/**
 * The CRM's colour vocabulary — one place, so the eight pages never drift.
 *
 * These hexes are *entity/brand accents* (data), which is why they are literal:
 * a person is always sky, a company always indigo, a deal always teal, no
 * matter which page you are on. Chrome (backgrounds, text, borders) still comes
 * from AntD tokens — never add one of those here.
 */

import type { CrmLeadStatus, CrmTargetType } from "@/features/app-crm/types";

/**
 * Semantic accents shared by every stat tile in the module. A metric keeps its
 * colour across pages: "Open deals" is `deal` on the dashboard *and* on the
 * deals board, "Tasks completed" is `done`, not `person`.
 */
export const CRM_ACCENT = {
  /** People / contacts. */
  person: "#0ea5e9",
  /** Companies / accounts. */
  company: "#6366f1",
  /** Deals / opportunities. */
  deal: "#14b8a6",
  /** Tasks completed / anything "done". */
  done: "#16a34a",
  /**
   * Campaigns and campaign money — "Spend this month" is `campaign` on the
   * dashboard AND on the campaigns page. Amber rather than the deal teal
   * because a campaign is spend, not a pipeline object.
   */
  campaign: "#b45309",
} as const;

/** The campaign glyph, alongside the accent so the pair never drifts. */
export const CAMPAIGN_ICON = "campaign";

/**
 * A glyph per lead status.
 *
 * Seven statuses share five chip tones, so colour alone collides: New and
 * Qualified are both `accent`, Contacted and Not interested are both `neutral`.
 * On a board card the pill is the only fast signal, so every status also carries
 * its own glyph and the pairs separate without relying on colour at all.
 */
export const LEAD_STATUS_ICON: Record<CrmLeadStatus, string> = {
  new: "fiber_new",
  contacted: "call",
  follow_up: "alarm",
  qualified: "verified",
  not_interested: "do_not_disturb_on",
  junk: "block",
  converted: "check_circle",
};

/** Safe lookup for a stored status string (falls back to "new"'s glyph). */
export function leadStatusIcon(value: CrmLeadStatus): string {
  return LEAD_STATUS_ICON[value] ?? LEAD_STATUS_ICON.new;
}

export type EntityMeta = {
  /** Material Symbols glyph. */
  icon: string;
  /** Entity accent hex. */
  color: string;
  /** Singular label ("Person"). */
  label: string;
  /** Plural label ("People"). */
  plural: string;
};

/** Per-record-type glyph, accent and labels. */
export const ENTITY_META: Record<CrmTargetType, EntityMeta> = {
  person: {
    icon: "person",
    color: CRM_ACCENT.person,
    label: "Person",
    plural: "People",
  },
  company: {
    icon: "domain",
    color: CRM_ACCENT.company,
    label: "Company",
    plural: "Companies",
  },
  deal: {
    icon: "target",
    color: CRM_ACCENT.deal,
    label: "Deal",
    plural: "Deals",
  },
};

/** Safe lookup for the polymorphic `target_type` strings coming off the API. */
export function entityMeta(type: string | null | undefined): EntityMeta {
  return ENTITY_META[type as CrmTargetType] ?? ENTITY_META.person;
}

/**
 * Neutral accent for the orphan "No stage" column/row — data, not chrome, so it
 * reads the same on the board, in the table and on the dashboard.
 */
export const NO_STAGE_COLOR = "#8a8d98";
