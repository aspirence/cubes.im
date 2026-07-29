/**
 * Pure presentation helpers for the CRM module.
 *
 * No data logic lives here — only string/colour formatting used by the shared
 * primitives in `./ui`. Everything is re-exported from `./ui`, so pages should
 * import from there and never reach into this file directly.
 */

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

/**
 * Solid avatar fills (white text on top). Every entry clears 4.5:1 against
 * #fff and the set stays separable under deuteranopia/protanopia — the same
 * bar the stage palette in `@/features/app-crm/types` is held to.
 */
export const CRM_AVATAR_PALETTE = [
  "#4f46e5", // indigo
  "#0f766e", // teal
  "#b45309", // amber
  "#be185d", // pink
  "#0369a1", // sky
  "#4d7c0f", // lime
  "#7c3aed", // violet
  "#c2410c", // orange
  "#0e7490", // cyan
  "#475569", // slate
] as const;

/** Uppercase initials (max 2) from a display name. Falls back to "?". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Deterministic avatar fill for any key (a name, an id). The same key always
 * gets the same colour, so a person keeps their colour across every page.
 */
export function avatarColor(key: string | null | undefined): string {
  const s = (key ?? "").trim();
  if (!s) return CRM_AVATAR_PALETTE[CRM_AVATAR_PALETTE.length - 1];
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return CRM_AVATAR_PALETTE[Math.abs(hash) % CRM_AVATAR_PALETTE.length];
}

/**
 * Tint a hex colour by appending an 8-digit alpha channel (`#rrggbbaa`).
 * Non-hex inputs (rgb(), css vars, named colours) are returned untouched so a
 * caller never ends up with an invalid colour string.
 */
export function tint(color: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  const value = color.trim();
  const six = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (six) return `#${six[1]}${a}`;
  const three = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(value);
  if (three) {
    return `#${three[1]}${three[1]}${three[2]}${three[2]}${three[3]}${three[3]}${a}`;
  }
  return color;
}

/** "12 Mar 2025" — the CRM's default date rendering. */
export function crmDate(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format("DD MMM YYYY") : fallback;
}

/** "12 Mar" — compact form for dense rows and chips. */
export function crmDateShort(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format("DD MMM") : fallback;
}

/** "12 Mar 2025, 14:05" — timestamps in drawers and timelines. */
export function crmDateTime(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.format("DD MMM YYYY, HH:mm") : fallback;
}

/** "3 days ago" — activity feeds. */
export function crmFromNow(
  value: string | number | Date | null | undefined,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = dayjs(value);
  return d.isValid() ? d.fromNow() : fallback;
}

/**
 * A deal's title when the user left the name blank. Deal name is optional in
 * the forms, but every board card, table row and search result needs SOMETHING
 * to show — so the deal borrows its identity from whatever it does have, in
 * descending order of usefulness, and falls back to the day it was captured.
 */
export function fallbackDealName(from: {
  company?: string | null;
  contact?: string | null;
  phone?: string | null;
}): string {
  const company = from.company?.trim();
  if (company) return `${company} deal`;
  const contact = from.contact?.trim();
  if (contact) return `${contact} deal`;
  const phone = from.phone?.trim();
  if (phone) return `Lead ${phone}`;
  return `New deal · ${dayjs().format("D MMM")}`;
}
