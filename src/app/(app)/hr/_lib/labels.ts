/**
 * Shared display helpers for the HR area (labels, tag colors, option lists).
 *
 * These mirror the DB string enums on `hr_employees` (status / employment_type)
 * without importing from src/features/** — they are presentational only.
 */

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "intern",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYEE_STATUSES = [
  "active",
  "probation",
  "on_notice",
  "resigned",
  "terminated",
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const GENDERS = ["male", "female", "other", "prefer_not_to_say"] as const;

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  intern: "Intern",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  probation: "Probation",
  on_notice: "On notice",
  resigned: "Resigned",
  terminated: "Terminated",
};

const STATUS_COLORS: Record<string, string> = {
  active: "green",
  probation: "gold",
  on_notice: "orange",
  resigned: "default",
  terminated: "red",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function employmentTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return EMPLOYMENT_TYPE_LABELS[value] ?? titleCase(value);
}

export function statusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return STATUS_LABELS[value] ?? titleCase(value);
}

export function statusColor(value: string | null | undefined): string {
  if (!value) return "default";
  return STATUS_COLORS[value] ?? "default";
}

export function genderLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return GENDER_LABELS[value] ?? titleCase(value);
}

export const EMPLOYMENT_TYPE_OPTIONS = EMPLOYMENT_TYPES.map((value) => ({
  value,
  label: employmentTypeLabel(value),
}));

export const STATUS_OPTIONS = EMPLOYEE_STATUSES.map((value) => ({
  value,
  label: statusLabel(value),
}));

export const GENDER_OPTIONS = GENDERS.map((value) => ({
  value,
  label: genderLabel(value),
}));

/** Initials for an avatar fallback. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
