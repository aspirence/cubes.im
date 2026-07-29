/**
 * Deal metrics shared by the board, the dashboard and the reports page.
 *
 * These are counts, not money — deals carry no amount. One implementation per
 * number so two tiles on two pages can never quietly disagree about what
 * "closing soon" means.
 */

import dayjs, { type Dayjs } from "dayjs";

/**
 * How many deals close inside a forward window of `days` days, today included.
 * Forward-looking on purpose: a calendar-month count would shrink as the month
 * runs out while the deals themselves have not moved.
 */
export function closingWithin(
  deals: { close_date: string | null }[],
  days: number,
  now: Dayjs = dayjs(),
): number {
  const from = now.subtract(1, "day");
  const cutoff = now.add(days, "day");
  return deals.filter(
    (d) =>
      d.close_date &&
      dayjs(d.close_date).isAfter(from) &&
      dayjs(d.close_date).isBefore(cutoff),
  ).length;
}
