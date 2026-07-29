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
