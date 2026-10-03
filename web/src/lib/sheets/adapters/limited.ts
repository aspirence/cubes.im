import { chunks, fetchAll, type AdapterCtx } from "./types";

/**
 * LIMITED MEMBERS, PER SOURCE — one rule, written down once.
 *
 * WHY THIS EXISTS
 * A limited member is deliberately refused the sheet's Google file, and the
 * reason we give them in the UI is physical: Drive shares a FILE, never a row,
 * so handing it over would show them the whole team's rows. Cubes' own grid is
 * what they get instead, precisely because it *can* honour row-level access.
 *
 * That justification is only honest if the grid actually narrows the rows. It
 * did for `tasks` and for nothing else: on a custom, Content Studio or Meta Ads
 * sheet the same person was refused the file for showing everything, and then
 * shown everything in our grid. This module closes that.
 *
 * THE RULE
 *   A limited member sees a row only when the row is demonstrably THEIRS.
 *   Where a source holds no per-row, per-person fact, the answer is NO ROWS —
 *   never "all rows". Uncertainty excludes.
 *
 * WHAT "THEIRS" MEANS, PER SOURCE
 *   tasks                 assigned to them — the same test can_view_task()
 *                         applies in the database (adapters/tasks.ts).
 *   content_studio_items  they created it, OR it is attached to a task
 *                         assigned to them (adapters/content-studio.ts).
 *   custom                they created the row. app_sheet_rows.created_by is
 *                         null for rows pulled in from Google with no actor;
 *                         a row nobody claims is not theirs, so it is excluded
 *                         (adapters/custom.ts).
 *
 * WRITES FOLLOW READS. Every adapter re-applies the same test before it writes,
 * so a key guessed or kept from an older view cannot edit a row its owner may
 * not even see. The refusal reuses the source's "no longer exists" 404 rather
 * than a 403, so a limited member cannot probe for rows by watching the status.
 *
 * Only a request made by a person can be limited: `ctx.limitToUserId` is set in
 * route-auth.ts and is always null for a scheduled Google sync, which reads and
 * writes the whole team's rows on purpose.
 */

/** What a limited member is told on a source that has no notion of "yours". */
export const LIMITED_NO_OWNER_NOTICE =
  "Your access is limited to rows that are yours. Meta Ads figures belong to an ad account rather than to a person, " +
  "so there is no version of this sheet that keeps to your access — it stays empty for you. " +
  "Ask a workspace admin for the numbers you need.";

/**
 * Sources with no per-row owner: say it once, plainly, and return no rows.
 * Call it FIRST in `list`, before any other notice — "no ad accounts are
 * connected" would be a second, misleading explanation for the same empty grid.
 */
export function limitedSeesNothing(ctx: AdapterCtx, notice = LIMITED_NO_OWNER_NOTICE): boolean {
  if (!ctx.limitToUserId) return false;
  if (!ctx.out.notices.includes(notice)) ctx.out.notices.push(notice);
  return true;
}

/** The team_member rows the limited viewer holds in this sheet's team. Empty
 *  when they hold none, which means they may see nothing. */
export async function limitedMemberIds(ctx: AdapterCtx): Promise<string[]> {
  if (!ctx.limitToUserId) return [];
  const { data, error } = await ctx.admin
    .from("team_members")
    .select("id")
    .eq("team_id", ctx.teamId)
    .eq("user_id", ctx.limitToUserId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((m: { id: string }) => m.id);
}

/**
 * Which of `taskIds` are assigned to the limited viewer — the same join
 * can_view_task() makes (tasks_assignees → team_members → auth.uid()).
 *
 * Only the ids asked about are returned, so a caller can decide row by row.
 */
export async function assignedTaskIds(ctx: AdapterCtx, taskIds: string[]): Promise<Set<string>> {
  const wanted = [...new Set(taskIds.filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const memberIds = await limitedMemberIds(ctx);
  if (memberIds.length === 0) return new Set();
  const out = new Set<string>();
  for (const part of chunks(wanted)) {
    const rows = await fetchAll<{ task_id: string }>((from, to) =>
      ctx.admin
        .from("tasks_assignees")
        .select("task_id")
        .in("team_member_id", memberIds)
        .in("task_id", part)
        .range(from, to),
    );
    for (const r of rows) out.add(r.task_id);
  }
  return out;
}
