import { randomUUID } from "node:crypto";
import { AdapterError, fetchAll, type AdapterCtx, type AdapterRecord, type ListOptions, type SheetAdapter } from "./types";

/**
 * Custom sheets: the rows ARE app_sheet_rows. There are no source fields, so
 * `fields` here is the row's data keyed by COLUMN id — the data layer reads it
 * as the custom-column values directly instead of fetching the rows twice.
 *
 * A LIMITED member sees only the rows they created, and may edit or delete only
 * those. A free-form grid has one per-row, per-person fact and that is it;
 * `created_by` is null on a row pulled in from Google with no actor behind it,
 * and a row nobody claims is not theirs. ./limited.ts states the rule and why.
 *
 * The filter lives in the ADAPTER, not in readSheetRows(), because the same
 * helper fetches the side-car rows that hold a person's own columns on a tasks
 * or Content Studio sheet. Those cells belong to a row the adapter has already
 * decided they may see, whoever happened to type them.
 */

interface SheetRowRecord {
  record_key: string;
  position: number;
  data: Record<string, unknown> | null;
  created_by: string | null;
  updated_at: string;
}

export async function readSheetRows(
  ctx: Pick<AdapterCtx, "admin" | "sheet" | "teamId">,
  keys?: string[],
): Promise<SheetRowRecord[]> {
  if (keys && keys.length === 0) return [];
  return fetchAll<SheetRowRecord>((from, to) => {
    let q = ctx.admin
      .from("app_sheet_rows")
      .select("record_key, position, data, created_by, updated_at")
      .eq("sheet_id", ctx.sheet.id)
      .eq("team_id", ctx.teamId);
    if (keys) q = q.in("record_key", keys);
    return q.order("position", { ascending: true }).order("created_at", { ascending: true }).range(from, to);
  });
}

/** Merges custom-column values into a row, creating it when needed (one SQL
 *  statement — see app_sheet_rows_patch). */
export async function patchSheetRow(
  ctx: Pick<AdapterCtx, "admin" | "sheet" | "actorUserId">,
  key: string,
  patch: Record<string, unknown>,
  position?: number,
): Promise<void> {
  const { error } = await ctx.admin.rpc("app_sheet_rows_patch", {
    p_sheet_id: ctx.sheet.id,
    p_record_key: key,
    p_patch: patch,
    p_actor: ctx.actorUserId,
    p_position: position ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Loads one row of THIS sheet, or throws "not found" — every write starts
 *  here. A limited member gets the same 404 on a row that is not theirs as on
 *  one that does not exist, so keys can't be probed. */
async function ownRow(ctx: AdapterCtx, key: string): Promise<{ id: string }> {
  const { data, error } = await ctx.admin
    .from("app_sheet_rows")
    .select("id, created_by")
    .eq("sheet_id", ctx.sheet.id)
    .eq("team_id", ctx.teamId)
    .eq("record_key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { id: string; created_by: string | null } | null;
  if (!row) throw new AdapterError("That row no longer exists.", 404);
  if (ctx.limitToUserId && row.created_by !== ctx.limitToUserId) {
    throw new AdapterError("That row no longer exists.", 404);
  }
  return { id: row.id };
}

export const customAdapter: SheetAdapter = {
  async list(ctx: AdapterCtx, opts?: ListOptions): Promise<AdapterRecord[]> {
    let rows = await readSheetRows(ctx, opts?.keys);
    if (ctx.limitToUserId) rows = rows.filter((r) => r.created_by === ctx.limitToUserId);
    return rows.map((r) => ({
      key: r.record_key,
      fields: r.data ?? {},
      updatedAt: r.updated_at,
      position: r.position,
    }));
  },

  async update(ctx, key, patch) {
    await ownRow(ctx, key);
    await patchSheetRow(ctx, key, patch);
  },

  async create(ctx, values) {
    // New rows go to the bottom, after whatever is there now.
    const { data: last } = await ctx.admin
      .from("app_sheet_rows")
      .select("position")
      .eq("sheet_id", ctx.sheet.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (typeof last?.position === "number" ? last.position : 0) + 1;
    const key = randomUUID();
    await patchSheetRow(ctx, key, values, position);
    return key;
  },

  async remove(ctx, key) {
    await ownRow(ctx, key);
    const { error } = await ctx.admin
      .from("app_sheet_rows")
      .delete()
      .eq("sheet_id", ctx.sheet.id)
      .eq("team_id", ctx.teamId)
      .eq("record_key", key);
    if (error) throw new Error(error.message);
  },
};
