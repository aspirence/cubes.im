"use client";

/**
 * `?m=<record id>` — the deep link that opens one record's drawer on a list page.
 *
 * This is the other half of `crm_fire_due_reminders()`: the sweep writes
 * `/crm/deals?m=<id>` (and the people / companies equivalents) into the
 * notification, so the bell, the inbox and a web push all have to land on the
 * lead itself rather than on the list with the record closed. The campaign
 * drawer's "Leads" list pushes the same URL.
 *
 * The param is stripped on close, so hitting back doesn't silently re-open the
 * drawer and a reload of the tidied URL shows the plain list.
 */

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CrmTargetRef, CrmTargetType } from "@/features/app-crm/types";

/** Query key carrying the record id. Kept here so the pages never spell it. */
export const CRM_RECORD_PARAM = "m";

export function useRecordDeepLink(type: CrmTargetType) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linked = searchParams.get(CRM_RECORD_PARAM);

  // Seeded from the URL so a deep link opens on the very first paint, with no
  // window where the page renders the list and then jumps.
  const [target, setTarget] = useState<CrmTargetRef | null>(
    linked ? { type, id: linked } : null,
  );

  // A second notification for a different record arrives as a new ?m= on a page
  // that is already mounted, so the drawer has to re-point at it. Adjusted
  // during render (React's "changing state when a prop changes" pattern) rather
  // than in an effect — an effect here would render the stale record first.
  // `seen` tracks null too, so closing and later re-following the SAME link
  // still counts as a change and re-opens the drawer.
  const [seen, setSeen] = useState<string | null>(linked);
  if (linked !== seen) {
    setSeen(linked);
    if (linked) setTarget({ type, id: linked });
  }

  const close = useCallback(() => {
    setTarget(null);
    if (linked) router.replace(pathname, { scroll: false });
  }, [linked, pathname, router]);

  return [target, setTarget, close] as const;
}
