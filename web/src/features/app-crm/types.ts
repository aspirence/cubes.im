import type { Database } from "@/types/database";

export type CrmAdmin = Database["public"]["Tables"]["app_crm_admins"]["Row"];
export type CrmStage = Database["public"]["Tables"]["app_crm_stages"]["Row"];
export type CrmCompany = Database["public"]["Tables"]["app_crm_companies"]["Row"];
export type CrmPerson = Database["public"]["Tables"]["app_crm_people"]["Row"];
export type CrmDeal = Database["public"]["Tables"]["app_crm_deals"]["Row"];
export type CrmTask = Database["public"]["Tables"]["app_crm_tasks"]["Row"];
export type CrmNote = Database["public"]["Tables"]["app_crm_notes"]["Row"];
export type CrmTaskTarget =
  Database["public"]["Tables"]["app_crm_task_targets"]["Row"];
export type CrmNoteTarget =
  Database["public"]["Tables"]["app_crm_note_targets"]["Row"];
export type CrmActivity =
  Database["public"]["Tables"]["app_crm_activities"]["Row"];
export type CrmCampaign =
  Database["public"]["Tables"]["app_crm_campaigns"]["Row"];
export type CrmCampaignSpend =
  Database["public"]["Tables"]["app_crm_campaign_spend"]["Row"];
export type CrmReminder =
  Database["public"]["Tables"]["app_crm_reminders"]["Row"];

/** The polymorphic target of a task / note / activity (Twenty's morph set). */
export type CrmTargetType = "person" | "company" | "deal";

export type CrmTargetRef = { type: CrmTargetType; id: string };

export type CrmPersonWithCompany = CrmPerson & {
  company: Pick<CrmCompany, "id" | "name"> | null;
};

export type CrmDealWithRefs = CrmDeal & {
  company: Pick<CrmCompany, "id" | "name"> | null;
  contact: Pick<CrmPerson, "id" | "first_name" | "last_name"> | null;
};

export type CrmTaskWithTargets = CrmTask & { targets: CrmTaskTarget[] };
export type CrmNoteWithTargets = CrmNote & { targets: CrmNoteTarget[] };

export type CrmTaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export const CRM_TASK_STATUSES: {
  value: CrmTaskStatus;
  label: string;
  color: string;
}[] = [
  { value: "TODO", label: "To do", color: "#0284c7" },
  { value: "IN_PROGRESS", label: "In progress", color: "#9333ea" },
  { value: "DONE", label: "Done", color: "#16a34a" },
];

/**
 * The tones `SoftChip` (crm/_lib/ui) accepts, minus "custom". Restated here as
 * a literal union so the data layer never imports a client component; every
 * value is assignable to `SoftChipTone`.
 */
export type CrmChipTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "accent";

/**
 * How the LEAD itself is doing — deliberately separate from `stage_id`, which
 * is only where the card sits on the board. Fixed set, not user-configurable
 * (mirrors the `app_crm_deals_status_check` constraint).
 */
export type CrmLeadStatus =
  | "new"
  | "contacted"
  | "follow_up"
  | "qualified"
  | "not_interested"
  | "junk"
  | "converted";

export const CRM_LEAD_STATUSES: {
  value: CrmLeadStatus;
  label: string;
  tone: CrmChipTone;
}[] = [
  { value: "new", label: "New", tone: "accent" },
  { value: "contacted", label: "Contacted", tone: "neutral" },
  { value: "follow_up", label: "Follow up", tone: "warning" },
  { value: "qualified", label: "Qualified", tone: "accent" },
  { value: "not_interested", label: "Not interested", tone: "neutral" },
  { value: "junk", label: "Junk", tone: "danger" },
  { value: "converted", label: "Converted", tone: "success" },
];

export const CRM_LEAD_STATUS_DEFAULT: CrmLeadStatus = "new";

/** Meta for a stored status string, falling back to "new" for anything odd. */
export function crmLeadStatusMeta(value: string | null | undefined) {
  return (
    CRM_LEAD_STATUSES.find((s) => s.value === value) ?? CRM_LEAD_STATUSES[0]
  );
}

/**
 * How much a lead is WORTH — a third axis, alongside `stage_id` (where the card
 * sits) and `status` (how the lead is doing).
 *
 * Status moves constantly and tier barely moves at all, which is the point: a
 * Gold lead that went quiet is still Gold, and that is exactly the list someone
 * wants when they come back to re-plan. `null` means ungraded — nobody has
 * judged it yet, which is a different thing from judging it Bronze.
 *
 * Ordered lowest to highest; `CRM_LEAD_TIER_RANK` gives the sort key.
 */
export type CrmLeadTier = "bronze" | "silver" | "gold";

export const CRM_LEAD_TIERS: {
  value: CrmLeadTier;
  label: string;
  /** Entity colour — data, not theme, so it is a literal on purpose. */
  color: string;
  icon: string;
}[] = [
  { value: "bronze", label: "Bronze", color: "#a9714b", icon: "workspace_premium" },
  { value: "silver", label: "Silver", color: "#8a8d98", icon: "workspace_premium" },
  { value: "gold", label: "Gold", color: "#d0a02c", icon: "workspace_premium" },
];

/** Meta for a stored tier, or null when the lead has not been graded. */
export function crmLeadTierMeta(value: string | null | undefined) {
  return CRM_LEAD_TIERS.find((t) => t.value === value) ?? null;
}

/**
 * Sort key, highest tier first, ungraded last. Ungraded sorts BELOW bronze
 * rather than above it: a lead nobody has looked at should not outrank one
 * somebody judged, however low the judgement.
 */
export function crmLeadTierRank(value: string | null | undefined): number {
  const i = CRM_LEAD_TIERS.findIndex((t) => t.value === value);
  return i === -1 ? -1 : i;
}

/** Campaign `channel` is free text in the DB; these are what the UI offers. */
export const CRM_CAMPAIGN_CHANNELS = [
  "Meta",
  "Google",
  "LinkedIn",
  "WhatsApp",
  "Referral",
  "Offline",
  "Other",
] as const;

export type CrmCampaignChannel = (typeof CRM_CAMPAIGN_CHANNELS)[number];

export type CrmCampaignStatus = "draft" | "active" | "paused" | "ended";

export const CRM_CAMPAIGN_STATUSES: {
  value: CrmCampaignStatus;
  label: string;
  tone: CrmChipTone;
}[] = [
  { value: "draft", label: "Draft", tone: "neutral" },
  { value: "active", label: "Active", tone: "success" },
  { value: "paused", label: "Paused", tone: "warning" },
  { value: "ended", label: "Ended", tone: "neutral" },
];

/** Meta for a stored campaign status, falling back to "active". */
export function crmCampaignStatusMeta(value: string | null | undefined) {
  return (
    CRM_CAMPAIGN_STATUSES.find((s) => s.value === value) ??
    CRM_CAMPAIGN_STATUSES[1]
  );
}

export const CRM_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AED",
  "AUD",
  "CAD",
  "SGD",
] as const;

/** Palette offered in the stage editor. The first five are the seeded pipeline
 *  sequence, CVD-validated as adjacent board columns (dataviz six checks). */
export const CRM_STAGE_COLORS = [
  "#dc2626",
  "#ca8a04",
  "#9333ea",
  "#0284c7",
  "#16a34a",
  "#c2410c",
  "#0f766e",
  "#4f46e5",
  "#be185d",
  "#57534e",
] as const;

export function crmPersonName(
  p: Pick<CrmPerson, "first_name" | "last_name"> | null | undefined,
): string {
  if (!p) return "";
  return [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
}

export function crmMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toLocaleString()}`.trim();
  }
}
