import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorText } from "@/lib/apps/auth";
import { GoogleSheetsError, SheetsClient, type CellValue, type SheetTabMeta } from "@/lib/google/sheets-api";
import { SOURCES } from "./sources";
import type { GoogleLinkRow, SheetColumn, SheetRecordRow, SyncCounts } from "./types";
import { columnLetter, fromGoogle, isValidTimeZone, toGoogle, type GoogleCell, type ValueContext } from "./values";
import { planSync, type CubesRecord, type SnapshotEntry, type SyncColumn } from "./sync-core";
import {
  HEADER_STATE_KEY,
  ID_HEADER,
  frozenColumnCount,
  matchHeaders,
  optionRuleRequests,
  optionRules,
  parseRows,
  quoteTitle,
  ruleMark,
  rulesFingerprint,
  type HeaderLayout,
  type HeaderState,
  type OptionRulesState,
} from "./google-layout";
import {
  applyRecordPatch,
  columnWritable,
  createRecord,
  deleteRecord,
  dynamicOf,
  loadRecords,
  loadSheet,
  makeCtx,
  resolveOptions,
  valueContext,
} from "./data";
import { AdapterError, chunks, userIsTeamAdmin } from "./adapters/types";
import { planRowNotes } from "./row-notes";

/**
 * Sheets ↔ Google Sheets — one sync run for one linked sheet: read both sides,
 * plan with the three-way merge (sync-core.ts), apply, save the new snapshot.
 *
 * Order of application, and why:
 *   1. Cubes writes first. Rows created from Google need their new keys before
 *      the Google writes can put those keys into the Cubes ID column.
 *   2. Google cell writes (headers, changed cells, created rows' ids) in one
 *      batch, using the row positions read at the start of the run.
 *   3. Row deletions, bottom-up, so the positions above stay valid.
 *   4. Appends last: Google places them after the table as it is by then.
 *   5. The snapshot, only once all of that succeeded. If anything throws, the
 *      old snapshot stays, and the next run sees the partial changes as edits
 *      that already match on both sides (so nothing is applied twice).
 *
 * A lease (app_sheets_claim_link) keeps a manual "Sync now", the runner tick
 * and a workflow step from running the same sheet at once.
 */

export type SyncTrigger = "manual" | "auto" | "workflow";

/** A link that has a Google Sheet behind it. Everything below the guard in
 *  syncSheetLink works on one of these; a 'pending' row never gets this far. */
type ReadyLink = GoogleLinkRow & { spreadsheet_id: string; connection_id: string };

/**
 * The counts a `sheets.changed` payload publishes: the six a person is shown,
 * and nothing else.
 *
 * Both emitters used to nest their whole SyncOutcome here, so fromGoogle,
 * status and runId rode into every workflow payload while the catalog's sample
 * promised six fields. They matched each other only by both leaking the same
 * way. Both call this now, so they still match — on the documented shape.
 */
export function publicSyncCounts(o: SyncCounts): SyncCounts {
  return {
    pushed: o.pushed,
    pulled: o.pulled,
    created: o.created,
    deleted: o.deleted,
    conflicts: o.conflicts,
    skipped: o.skipped,
  };
}

export interface SyncOutcome extends SyncCounts {
  /** "busy": another run holds the lease; nothing was done. */
  status: "ok" | "error" | "busy";
  error?: string;
  runId?: string;
  /**
   * How much of this run came FROM Google and STUCK: field values written into
   * a record, records created out of a Google row, records deleted because
   * their Google row was gone — each counted only after the write succeeded.
   *
   * None of the six counts answers that question on its own. `created` and
   * `deleted` each cover both directions (a record appended to the Google Sheet
   * counts as created too), `pushed` is ours by definition, and `conflicts` is
   * counted when the merge DECIDES, which is before the write is attempted and
   * therefore before it can be refused. This is the number the `sheets.changed`
   * gate needs — see shouldEmitSheetChanged.
   */
  fromGoogle: number;
}

/** Stop rather than delete more than this share of a sheet in one run: a
 *  cleared or filtered-then-pasted Google tab looks exactly like "delete all". */
const MASS_DELETE_MIN = 10;
const MASS_DELETE_SHARE = 0.5;

const LEASE_SECONDS = 600;

function zero(): SyncCounts {
  return { pushed: 0, pulled: 0, created: 0, deleted: 0, conflicts: 0, skipped: 0 };
}

/** The outcome of a run that never started, or that threw. */
function nothing(status: "error" | "busy", error: string): SyncOutcome {
  return { ...zero(), fromGoogle: 0, status, error };
}

function message(err: unknown): string {
  if (err instanceof AdapterError || err instanceof GoogleSheetsError) return err.message.slice(0, 900);
  return safeErrorText(err, "The sync failed.");
}

async function loadLink(admin: SupabaseClient, teamId: string, sheetId: string): Promise<GoogleLinkRow | null> {
  const { data, error } = await admin
    .from("app_sheet_google_links")
    .select("*")
    .eq("sheet_id", sheetId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as GoogleLinkRow | null) ?? null;
}

interface StateRow {
  record_key: string;
  values: Record<string, unknown> & { $deleted?: boolean };
}

async function loadState(admin: SupabaseClient, linkId: string) {
  const rows: StateRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("app_sheet_sync_state")
      .select("record_key, values")
      .eq("link_id", linkId)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as StateRow[]));
    if ((data ?? []).length < 1000) break;
  }
  let header: HeaderState | null = null;
  const snapshot = new Map<string, SnapshotEntry>();
  for (const r of rows) {
    if (r.record_key === HEADER_STATE_KEY) {
      header = r.values as unknown as HeaderState;
      continue;
    }
    const { $deleted, ...values } = r.values ?? {};
    snapshot.set(r.record_key, $deleted ? { values, deleted: true } : { values });
  }
  return { header, snapshot };
}

/** Writes the snapshot changes: upserts in chunks, then deletes. */
async function saveState(
  admin: SupabaseClient,
  linkId: string,
  upserts: Map<string, SnapshotEntry>,
  deletes: string[],
  header: HeaderState,
): Promise<void> {
  const now = new Date().toISOString();
  const rows = [...upserts.entries()].map(([key, s]) => ({
    link_id: linkId,
    record_key: key,
    values: s.deleted ? { ...s.values, $deleted: true } : s.values,
    synced_at: now,
  }));
  rows.push({ link_id: linkId, record_key: HEADER_STATE_KEY, values: header as unknown as Record<string, unknown>, synced_at: now });
  for (const part of chunks(rows, 500)) {
    const { error } = await admin.from("app_sheet_sync_state").upsert(part, { onConflict: "link_id,record_key" });
    if (error) throw new Error(error.message);
  }
  const drop = deletes.filter((k) => !upserts.has(k));
  for (const part of chunks(drop, 200)) {
    const { error } = await admin.from("app_sheet_sync_state").delete().eq("link_id", linkId).in("record_key", part);
    if (error) throw new Error(error.message);
  }
}

function findTab(tabs: SheetTabMeta[], link: GoogleLinkRow): SheetTabMeta | null {
  if (link.sheet_gid !== null && link.sheet_gid !== undefined) {
    const byGid = tabs.find((t) => t.gid === link.sheet_gid);
    if (byGid) return byGid;
  }
  if (link.sheet_title) {
    const byTitle = tabs.find((t) => t.title === link.sheet_title);
    if (byTitle) return byTitle;
  }
  return link.sheet_gid === null && tabs.length > 0 ? tabs[0] : null;
}

/**
 * Runs one sync for the sheet's Google link. Never throws for sync failures:
 * they are recorded on the link and the run log and returned as status
 * "error" (the workflow step and the routes both want a result, not a crash).
 */
export async function syncSheetLink(
  admin: SupabaseClient,
  opts: { teamId: string; sheetId: string; trigger: SyncTrigger; actorUserId: string | null },
): Promise<SyncOutcome> {
  const link = await loadLink(admin, opts.teamId, opts.sheetId);
  if (!link) return nothing("error", "This sheet is not linked to a Google Sheet.");
  // A pending or failed link is a placeholder holding the sheet's link slot
  // while it waits for a Google account (google-provision.ts). There is nothing
  // to sync, and claiming its lease would only mark it "running" forever.
  if (link.provision_status !== "ready" || !link.spreadsheet_id || !link.connection_id) {
    return nothing("error", link.provision_error ?? "This sheet doesn't have a Google Sheet yet.");
  }

  const { data: claimed, error: claimErr } = await admin.rpc("app_sheets_claim_link", {
    p_link_id: link.id,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimErr) return nothing("error", safeErrorText(claimErr.message));
  if (!claimed) return nothing("busy", "A sync of this sheet is already running.");

  const { data: run } = await admin
    .from("app_sheet_sync_runs")
    .insert({ link_id: link.id, team_id: link.team_id, trigger: opts.trigger, status: "running" })
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id;

  const finishedAt = () => new Date().toISOString();
  const nextRun = () => new Date(Date.now() + link.interval_minutes * 60_000).toISOString();

  try {
    // The guard above proved both ids are set; the cast is what carries that
    // fact across the call, since GoogleLinkRow has to allow a pending row.
    // `counts` stays the six the person is shown (the link's last_counts, the
    // run log); fromGoogle and initialImport are the gate's business and are
    // kept out of them.
    const { fromGoogle, initialImport, ...counts } = await runSync(admin, link as ReadyLink, opts);
    await admin
      .from("app_sheet_google_links")
      .update({
        last_status: "ok",
        last_error: null,
        last_counts: counts,
        last_synced_at: finishedAt(),
        next_run_at: nextRun(),
        lease_until: null,
      })
      .eq("id", link.id);
    if (runId) {
      await admin
        .from("app_sheet_sync_runs")
        .update({ status: "ok", finished_at: finishedAt(), counts })
        .eq("id", runId);
    }
    const out: SyncOutcome = { ...counts, fromGoogle, status: "ok", runId };
    // A "Sync now" is the third way a Google edit reaches Cubes, and until this
    // was here it was the way that LOST it: the run applies the edit and writes
    // the snapshot, so the next poll and the next push both see the two sides
    // agreeing and count nothing. Nobody would ever have announced it.
    //
    // Only "manual" emits from in here, and that is not an accident:
    //   - "auto" is the poller (processDueSheetLinks) and the push path
    //     (syncForChannel, sheet-watch.ts). Both emit for themselves, with the
    //     trigger that says which one it was, so emitting here as well would be
    //     the double fire this gate exists to prevent.
    //   - "workflow" is a sheet-sync STEP. `sheets.changed` is a trigger a
    //     workflow can be started by, so a step that published it could start
    //     the workflow it is running inside. A person pressing a button is not
    //     that, which is why the two are not treated the same.
    //
    // And not on the FIRST sync of a link. Linking a Google Sheet that already
    // holds rows imports them, which counts as fromGoogle — but nobody edited
    // anything; someone connected a file. The link and provision routes run
    // that first sync as "manual", so without this a person who has only just
    // linked a sheet would set off every "someone edited the sheet" workflow.
    if (opts.trigger === "manual" && !initialImport && shouldEmitSheetChanged(out)) {
      await emitSheetChange(admin, { teamId: link.team_id, sheetId: opts.sheetId, linkId: link.id }, out, "manual");
    }
    return out;
  } catch (err) {
    // Losing access to the file, or to Google itself, is not something the next
    // run can fix: retrying every interval only burns quota and fills the run
    // log with the same line. Park the schedule (next_run_at = null is "not
    // due", see app_sheets_due_links) without touching the person's auto-sync
    // switch — the next run that actually works sets next_run_at again, so
    // fixing the access and pressing "Sync now" is all it takes to resume.
    const halted = err instanceof GoogleSheetsError && (err.kind === "access_lost" || err.kind === "auth");
    const error = halted ? `${message(err)} Automatic syncing is paused until then.`.slice(0, 1000) : message(err);
    await admin
      .from("app_sheet_google_links")
      .update({
        last_status: "error",
        last_error: error,
        lease_until: null,
        next_run_at: halted ? null : nextRun(),
      })
      .eq("id", link.id);
    if (runId) {
      await admin
        .from("app_sheet_sync_runs")
        .update({ status: "error", finished_at: finishedAt(), error })
        .eq("id", runId);
    }
    return { ...nothing("error", error), runId };
  }
}

async function runSync(
  admin: SupabaseClient,
  link: ReadyLink,
  opts: { teamId: string; sheetId: string; actorUserId: string | null },
): Promise<SyncCounts & { fromGoogle: number; initialImport: boolean }> {
  const sheet = await loadSheet(admin, opts.teamId, opts.sheetId);
  if (!sheet) throw new AdapterError("The sheet no longer exists.");
  if (sheet.archived) throw new AdapterError("The sheet is archived. Restore it to sync again.");

  const { data: conn } = await admin
    .from("app_google_connections")
    .select("id, enabled, revoked_at")
    .eq("id", link.connection_id)
    .eq("team_id", link.team_id)
    .maybeSingle();
  const c = conn as { enabled: boolean; revoked_at: string | null } | null;
  if (!c || !c.enabled || c.revoked_at) {
    throw new AdapterError("The Google account for this sheet is disconnected. Reconnect Google to resume syncing.");
  }

  // Writes made by a sync are attributed to whoever ran it, or to whoever
  // linked the sheet when a schedule ran it.
  const actor = opts.actorUserId ?? link.created_by ?? null;
  const client = new SheetsClient(admin, link.connection_id);
  const meta = await client.getSheetMeta(link.spreadsheet_id);
  const tab = findTab(meta.sheets, link);
  if (!tab) {
    throw new AdapterError("The linked tab was deleted from the Google Sheet. Unlink and link the sheet again.");
  }
  if (tab.title !== link.sheet_title || tab.gid !== link.sheet_gid || (meta.spreadsheetUrl && meta.spreadsheetUrl !== link.spreadsheet_url)) {
    await admin
      .from("app_sheet_google_links")
      .update({ sheet_title: tab.title, sheet_gid: tab.gid, spreadsheet_url: meta.spreadsheetUrl ?? link.spreadsheet_url })
      .eq("id", link.id);
  }
  // Dates are the spreadsheet's days: the zone its owner set in Google.
  const timeZone = isValidTimeZone(meta.timeZone) ? meta.timeZone : "UTC";
  const ctx = makeCtx({
    admin,
    sheet,
    actorUserId: actor,
    timeZone,
    actorIsTeamAdmin: await userIsTeamAdmin(admin, sheet.team_id, actor),
  });

  const columns: SheetColumn[] = sheet.columns.filter((col) => !col.hidden);
  const byId = new Map(columns.map((col) => [col.id, col]));
  const direction = link.direction;
  const pushes = direction !== "pull";
  const q = quoteTitle(tab.title);

  const googleModifiedAt = await client.getModifiedTime(link.spreadsheet_id);
  let values = (await client.readValues(link.spreadsheet_id, q)) as GoogleCell[][];
  const { header: headerState, snapshot } = await loadState(admin, link.id);
  const neverSynced = snapshot.size === 0 && !headerState;

  let layout: HeaderLayout = matchHeaders(values[0] ?? [], columns, headerState);
  const headerWrites: { index: number; label: string }[] = [];

  if (layout.emptyHeader && snapshot.size > 0) {
    // The tab was cleared. Start over rather than read that as "every row was
    // deleted in Google" — with delete policy "delete" that would empty Cubes.
    for (const k of [...snapshot.keys()]) snapshot.delete(k);
  }

  if (layout.idIndex === null) {
    if (layout.emptyHeader) {
      layout = { ...layout, idIndex: 0, width: 1 };
      headerWrites.push({ index: 0, label: ID_HEADER });
    } else if (neverSynced) {
      // A sheet that already had data: slot the Cubes ID column in front, so
      // every existing row reads as a new row to import.
      await client.insertColumn(link.spreadsheet_id, tab.gid, 0);
      values = (await client.readValues(link.spreadsheet_id, q)) as GoogleCell[][];
      layout = matchHeaders(values[0] ?? [], columns, headerState);
      layout = { ...layout, idIndex: 0, width: Math.max(layout.width, 1) };
      headerWrites.push({ index: 0, label: ID_HEADER });
    } else {
      throw new AdapterError(
        `The “${ID_HEADER}” column was removed from the Google Sheet, so rows can't be matched any more. Undo the change in Google Sheets (or add the column back with its values), then sync again.`,
      );
    }
  }
  const idIndex = layout.idIndex as number;

  // Where every column is written: matched ones where they are, missing ones
  // (new in Cubes, or deleted in Google) appended to the right.
  const writeIndex = new Map(layout.colIndex);
  if (pushes) {
    for (const r of layout.renames) headerWrites.push({ index: r.index, label: r.label });
    let next = Math.max(layout.width, idIndex + 1);
    for (const id of layout.missing) {
      writeIndex.set(id, next);
      headerWrites.push({ index: next, label: byId.get(id)!.label });
      next++;
    }
    await client.ensureColumns(link.spreadsheet_id, tab.gid, tab.columnCount, next);
  }

  const options = await resolveOptions(ctx, columns);
  const vctx = new Map(columns.map((col) => [col.id, valueContext(sheet.source, col, options, timeZone)]));
  const googleRows = parseRows(values, { idIndex, colIndex: layout.colIndex }, (colId, cell) =>
    fromGoogle(byId.get(colId)!.type, cell, vctx.get(colId)),
  );

  const records = await loadRecords(ctx, columns);
  const cubes = new Map<string, CubesRecord>(
    records.map((r) => [r.key, { values: r.values, updatedAt: r.updatedAt, readonly: r.readonly }]),
  );
  const syncColumns: SyncColumn[] = columns.map((col) => ({
    id: col.id,
    type: col.type,
    writable: columnWritable(sheet.source, col),
  }));
  const src = SOURCES[sheet.source];
  const plan = planSync({
    columns: syncColumns,
    googleColumns: new Set(layout.colIndex.keys()),
    cubes,
    google: googleRows,
    snapshot,
    direction,
    conflictPolicy: link.conflict_policy,
    deletePolicy: link.delete_policy,
    canCreate: src.canCreate,
    canDelete: src.canDelete,
    googleModifiedAt,
  });
  const counts = plan.counts;

  if (plan.cubes.deletes.length >= MASS_DELETE_MIN && plan.cubes.deletes.length > cubes.size * MASS_DELETE_SHARE) {
    throw new AdapterError(
      `Sync stopped: ${plan.cubes.deletes.length} rows are missing from the Google Sheet, and deleting that many records at once looks like a mistake. Restore the rows in Google, or switch the delete setting to “keep” and sync again.`,
    );
  }

  // ---- 1. Cubes -------------------------------------------------------------
  for (const u of plan.cubes.updates) {
    try {
      await applyRecordPatch(ctx, u.key, u.patch);
    } catch (err) {
      if (!(err instanceof AdapterError)) throw err;
      // Rejected (a required field blanked, an unknown status…): count it and
      // keep the old snapshot for those fields, so the Google value is neither
      // lost nor treated as agreed — it is retried after the person fixes it.
      const n = Object.keys(u.patch).length;
      counts.pulled -= n;
      counts.skipped += n;
      const next = plan.snapshot.upserts.get(u.key);
      const old = snapshot.get(u.key);
      if (next) {
        for (const colId of Object.keys(u.patch)) {
          next.values[colId] = old && !old.deleted ? old.values[colId] : cubes.get(u.key)?.values[colId];
        }
      }
    }
  }

  const created: { row: number; key: string }[] = [];
  // Rows the source refused, with its reason — written back onto the row in
  // step 2b, because a skipped row used to be dropped without a word.
  const refused = new Map<number, string>();
  for (const cr of plan.cubes.creates) {
    try {
      created.push({ row: cr.row, key: await createRecord(ctx, cr.values) });
      counts.created++;
    } catch (err) {
      if (!(err instanceof AdapterError)) throw err;
      counts.skipped++;
      refused.set(cr.row, err.message);
    }
  }

  let deletedFromGoogle = 0;
  for (const key of plan.cubes.deletes) {
    try {
      await deleteRecord(ctx, key);
      deletedFromGoogle++;
    } catch (err) {
      if (!(err instanceof AdapterError)) throw err;
      counts.deleted--;
      counts.skipped++;
      // Keep the snapshot row so the delete is retried; splice(-1) would drop
      // somebody else's entry if this key were ever missing from the list.
      const at = plan.snapshot.deletes.indexOf(key);
      if (at >= 0) plan.snapshot.deletes.splice(at, 1);
    }
  }

  // Created records as the source now has them (defaults, task numbers…), so
  // their Google rows show the real record and the snapshot starts true.
  const fresh = created.length
    ? new Map((await loadRecords(ctx, columns, { keys: created.map((c) => c.key) })).map((r) => [r.key, r]))
    : new Map();

  // ---- 2. Google cell writes -------------------------------------------------
  const cell = (colId: string, value: unknown): CellValue => {
    const col = byId.get(colId)!;
    return toGoogle(col.type, value, vctx.get(colId));
  };
  const a1 = (index: number, sheetRow: number) => `${q}!${columnLetter(index)}${sheetRow}`;
  const data: { range: string; values: CellValue[][] }[] = [];

  for (const h of headerWrites) data.push({ range: a1(h.index, 1), values: [["'" + h.label]] });
  for (const u of plan.google.updates) {
    for (const [colId, value] of Object.entries(u.cells)) {
      const idx = writeIndex.get(colId);
      if (idx === undefined) continue;
      data.push({ range: a1(idx, u.row + 2), values: [[cell(colId, value)]] });
    }
  }
  for (const c of created) {
    data.push({ range: a1(idIndex, c.row + 2), values: [["'" + c.key]] });
    const rec = fresh.get(c.key);
    if (rec && pushes) {
      for (const col of columns) {
        const idx = writeIndex.get(col.id);
        if (idx !== undefined) data.push({ range: a1(idx, c.row + 2), values: [[cell(col.id, rec.values[col.id])]] });
      }
    }
    plan.snapshot.upserts.set(c.key, { values: rec ? { ...rec.values } : {} });
  }
  for (const row of plan.google.clearKeys) data.push({ range: a1(idIndex, row + 2), values: [[""]] });
  if (data.length > 0) await client.writeValues(link.spreadsheet_id, data);

  // ---- 2b. Why a row got no Cubes ID ------------------------------------------
  // Before the deletions below: those shift rows up, and `refused` holds the
  // row indexes as they were read.
  const refusals = await noteRefusedRows(client, link.spreadsheet_id, tab.gid, q, idIndex, values.length - 1, refused, headerState?.refusals ?? 0);

  // ---- 3. Deletions ------------------------------------------------------------
  if (plan.google.deletes.length > 0) {
    await client.deleteRows(link.spreadsheet_id, tab.gid, plan.google.deletes.map((r) => r + 1));
  }

  // ---- 4. Appends -----------------------------------------------------------
  if (plan.google.appends.length > 0) {
    const width = Math.max(idIndex, ...writeIndex.values()) + 1;
    const rows = plan.google.appends.map((a) => {
      const line: CellValue[] = new Array(width).fill("");
      line[idIndex] = "'" + a.key;
      for (const [colId, value] of Object.entries(a.values)) {
        const idx = writeIndex.get(colId);
        if (idx !== undefined) line[idx] = cell(colId, value);
      }
      return line;
    });
    await client.appendRows(link.spreadsheet_id, `${q}!A1:${columnLetter(width - 1)}1`, rows);
  }

  // ---- 5. Header look, option rules, snapshot --------------------------------
  const formatted = headerState?.formatted === true;
  if (pushes && !formatted) {
    await client.formatHeader(
      link.spreadsheet_id,
      tab.gid,
      idIndex,
      Math.max(idIndex, ...writeIndex.values()) + 1,
      frozenColumnCount(columns, idIndex, writeIndex),
    );
  }
  // Unlike the header look (once per link), dropdowns and colours follow the
  // columns: they are re-checked on every pushing run, and written only when
  // what Google should show has changed. A pull-only link leaves Google's
  // formatting to Google, as it does the header.
  const rules = pushes
    ? await applyOptionRules(client, link.spreadsheet_id, tab, columns, writeIndex, sheet.source, vctx, headerState?.rules)
    : headerState?.rules;
  // Remember the header text each column now has in Google: after a push
  // that is the Cubes label; on a pull-only link Google keeps its own text, and
  // that is what the next run must recognise.
  const labels: Record<string, string> = { ...(headerState?.labels ?? {}) };
  for (const col of columns) {
    if (pushes && writeIndex.has(col.id)) labels[col.id] = col.label;
    else if (!pushes && layout.colIndex.has(col.id)) {
      labels[col.id] = String((values[0] ?? [])[layout.colIndex.get(col.id)!] ?? col.label).trim();
    }
  }
  await saveState(admin, link.id, plan.snapshot.upserts, plan.snapshot.deletes, {
    labels,
    formatted: formatted || pushes,
    ...(rules ? { rules } : {}),
    ...(refusals > 0 ? { refusals } : {}),
  });

  // What Google put into Cubes, once the writes are known to have landed:
  // `counts.pulled` is already net of the patches the adapter refused (the
  // catch above puts them back as `skipped`), `created` here is only the rows
  // that became records, and `deletedFromGoogle` only the records whose Google
  // row was gone. Anything this run sent the other way is deliberately absent.
  return {
    ...counts,
    fromGoogle: counts.pulled + created.length + deletedFromGoogle,
    // Rows that were already in the Google Sheet before it was linked arrive
    // here as fromGoogle too, and they are not an edit. See the emit below.
    initialImport: neverSynced,
  };
}

/**
 * Leaves the reason on every Google row the source refused to create, as a
 * note on its Cubes ID cell, and takes the notes of rows that got in (or went
 * away) back off — row-notes.ts has the rules. Returns how many rows carry
 * one of our notes now, for the next run's state.
 *
 * Costs nothing on a sheet with no refusals now and none noted last time: no
 * read, no write. Otherwise one read of the ID column's notes, and a write
 * only for the cells whose note must change — a note rewritten on every run
 * would reach Drive's change feed every time, and the sync would never rest.
 *
 * A note Google turns down ("bad_request") does not fail the sync: the rows
 * have already synced, and the note is an explanation on top of them. The
 * count is kept, so the next run tries again. Anything else throws, like
 * every other call in this file.
 */
async function noteRefusedRows(
  client: SheetsClient,
  spreadsheetId: string,
  gid: number,
  quotedTitle: string,
  idIndex: number,
  dataRows: number,
  refused: Map<number, string>,
  notedBefore: number,
): Promise<number> {
  if (refused.size === 0 && notedBefore === 0) return 0;
  if (dataRows <= 0) return 0;
  const col = columnLetter(idIndex);
  try {
    const bySheetRow = await client.readNotes(spreadsheetId, `${quotedTitle}!${col}2:${col}${dataRows + 1}`);
    // Sheet row index (header = 0) → data-row index, the planner's numbering.
    const existing = new Map([...bySheetRow].filter(([r]) => r >= 1).map(([r, n]) => [r - 1, n] as [number, string]));
    const writes = planRowNotes(existing, refused);
    if (writes.length > 0) {
      await client.writeNotes(spreadsheetId, gid, idIndex, writes.map((w) => ({ row: w.row + 1, note: w.note })));
    }
    return refused.size;
  } catch (err) {
    if (!(err instanceof GoogleSheetsError && err.kind === "bad_request")) throw err;
    return Math.max(notedBefore, refused.size);
  }
}

/**
 * Puts the dropdowns and colours of the option columns on the tab (the rules
 * are google-layout optionRules; the requests optionRuleRequests) and returns
 * what to remember. Writes nothing when neither the rules nor the tab's row
 * count moved since `previous`, so a quiet sheet costs no Google call here.
 *
 * Only FIXED lists: a column whose options are resolved at sync time
 * (dynamicOf) is left without a dropdown — optionRules says why.
 *
 * A request Google refuses ("bad_request") does not fail the sync: the data
 * has already landed and the dropdowns are a convenience on top of it. The old
 * state is kept, so the next run tries again — which is also what recovers
 * from a person editing the rules between our read and our write. Anything
 * else (auth, lost access, quota, network) throws, like every other call here.
 */
async function applyOptionRules(
  client: SheetsClient,
  spreadsheetId: string,
  tab: SheetTabMeta,
  columns: SheetColumn[],
  writeIndex: ReadonlyMap<string, number>,
  source: SheetRecordRow["source"],
  vctx: ReadonlyMap<string, ValueContext>,
  previous: OptionRulesState | undefined,
): Promise<OptionRulesState | undefined> {
  const rules = optionRules(
    columns.flatMap((col) => {
      const index = writeIndex.get(col.id);
      if (index === undefined) return [];
      const options = dynamicOf(source, col) ? null : (vctx.get(col.id)?.options ?? []);
      return [{ id: col.id, type: col.type, index, options }];
    }),
  );
  const fp = rulesFingerprint(rules);
  const moved = fp !== previous?.fp;
  if (!moved && tab.rowCount === previous?.rows) return previous;

  const validated = rules.filter((r) => r.list).map((r) => r.columnId);
  // A column we gave a dropdown and that no longer gets one (turned into free
  // text, list emptied, made dynamic). One that left the sheet is not in
  // writeIndex and keeps its dropdown: its Google column is the person's now.
  const clear = (previous?.validated ?? [])
    .filter((id) => !validated.includes(id))
    .flatMap((id) => (writeIndex.has(id) ? [writeIndex.get(id)!] : []));
  try {
    // Colours only move with the rules; a grown tab needs the dropdowns only.
    const existing = moved ? await client.readConditionalFormats(spreadsheetId, tab.gid) : null;
    await client.batchUpdate(
      spreadsheetId,
      optionRuleRequests(tab.gid, rules, { existing, forget: previous?.marks ?? [], clear }),
    );
  } catch (err) {
    if (!(err instanceof GoogleSheetsError && err.kind === "bad_request")) throw err;
    // GoogleSheetsError messages carry no token or URL (sheets-api.ts).
    console.warn(`[sheets] option dropdowns/colours not applied: ${err.message}`);
    return previous;
  }
  return { fp, rows: tab.rowCount, marks: rules.flatMap((r) => r.colors.map(ruleMark)), validated };
}

/**
 * Runs the auto-syncs that are due (called by the workflows runner tick). One
 * at a time: a run is a handful of Google calls and Google's per-user quota is
 * the constraint, not our CPU. Returns how many ran.
 *
 * This is the schedule, and what it guarantees is eventual consistency, not
 * latency: a change made IN Google reaches the same syncSheetLink sooner,
 * through the Drive push channel (src/lib/google/sheet-watch.ts).
 *
 * ALL THREE PATHS EMIT `sheets.changed`. Push needs a public HTTPS origin and a
 * Google-verified domain, so on a dev box — and on any deployment before that
 * verification lands — this timer and "Sync now" are the only paths that run. A
 * workflow built on "someone edited the Google Sheet" would then never fire, and
 * the feature would look broken when in fact only one third of it was wired. So
 * a poll that brought rows in publishes the same event, with the same payload
 * shape, as syncForChannel() does for a pushed change and as syncSheetLink()
 * does for a manual one — and all three ask the same question first
 * (shouldEmitSheetChanged).
 */
export async function processDueSheetLinks(admin: SupabaseClient, limit = 10): Promise<number> {
  const { data, error } = await admin.rpc("app_sheets_due_links", { p_limit: limit });
  if (error) throw new Error(error.message);
  let ran = 0;
  for (const row of (data ?? []) as { link_id: string; team_id: string; sheet_id: string }[]) {
    const out = await syncSheetLink(admin, { teamId: row.team_id, sheetId: row.sheet_id, trigger: "auto", actorUserId: null });
    if (out.status !== "busy") ran++;
    if (shouldEmitSheetChanged(out)) {
      await emitSheetChange(admin, { teamId: row.team_id, sheetId: row.sheet_id, linkId: row.link_id }, out, "poll");
    }
  }
  return ran;
}

/**
 * THE gate on `sheets.changed`. Every path asks this and only this: the poller
 * above, the manual "Sync now" in syncSheetLink, and the push path in
 * src/lib/google/sheet-watch.ts, which imports it. One rule, in one place,
 * because two copies of it drifted apart once already and the drift was worth
 * two events for one edit.
 *
 * The rule: a run announces itself when something that was in Google ARRIVED in
 * Cubes and stayed there. That is `fromGoogle` — pulled field values, records
 * created out of a Google row, records deleted because their Google row was
 * gone, each counted only once the write succeeded.
 *
 * Everything else is left out, and each exclusion is a bug somebody has already
 * had to live with:
 *
 *   `skipped` is an edit we could NOT apply — a required field blanked in
 *   Google, a cell whose value will not parse, a row typed into a sheet whose
 *   source cannot create records. The old snapshot is kept for exactly those
 *   fields, on purpose, so the next run retries once somebody fixes them, which
 *   means a skip is counted AGAIN on every single run for as long as the sheet
 *   stays that way. Counting it turns one bad cell into an event every fifteen
 *   minutes for ever.
 *
 *   `conflicts` is counted by planSync when the merge DECIDES, before the
 *   winning value is written and therefore before the adapter can refuse it. If
 *   it is refused, runSync corrects `pulled` and `skipped` — the conflict count
 *   stays. So a conflict the source will never accept (blank a required cell in
 *   Google while a colleague edits the same field here, which the default
 *   "newest" policy is enough to produce) is counted for ever, exactly like a
 *   skip, and applies nothing. Same metronome, different door.
 *
 *   `pushed` is Cubes writing to Google. This event says somebody edited the
 *   GOOGLE Sheet; our own writes are not news, and they are already announced
 *   as sheets.row_created and friends.
 *
 *   `created` and `deleted` are each counted in BOTH directions — a record
 *   appended to the Google Sheet is `created` too — which is why the gate reads
 *   `fromGoogle` rather than adding those up. Otherwise the first sync after
 *   linking a sheet, which pushes every existing record into Google, would fire
 *   "someone edited the Google Sheet" at a person who has only just linked it.
 *
 * What is left converges by construction: every mutation counted in
 * `fromGoogle` was applied AND written into the snapshot (saveState, at the end
 * of runSync), so the next run — poll, push or manual — sees both sides
 * agreeing, counts nothing, and stays quiet. One edit, one event.
 */
export function shouldEmitSheetChanged(out: SyncOutcome): boolean {
  // "busy" did nothing and "error" moved nothing worth announcing.
  return out.status === "ok" && out.fromGoogle > 0;
}

/**
 * Publishes `sheets.changed` for a change the POLLER or a manual "Sync now"
 * found. `trigger` is which of the two, and is the only thing that differs.
 *
 * The payload is the one emitSheetChanged() builds in
 * src/lib/google/sheet-watch.ts — same keys, same nesting, same flattening of
 * the counts — because a workflow author must not be able to tell which path
 * fired the trigger. A step that maps {{trigger.spreadsheet_url}} or tests
 * {{trigger.changed_rows}} has to keep working when a deployment has no public
 * URL and push never runs at all. It is spelled out twice rather than shared
 * because the two emitters live in files with different owners; folding them
 * into one helper is a clean follow-up, not something to do behind an owner's
 * back. The GATE they share is not optional in the same way, and is imported.
 *
 * The emit itself goes through app_sheets_emit_changed, which reaches
 * wf_emit_event behind to_regprocedure/to_regclass guards, and nothing here is
 * allowed to throw: an install with no workflow tables, or with nobody
 * listening, must not turn a good sync into a failed one, and must not stop the
 * loop from syncing the rest of the due links.
 */
async function emitSheetChange(
  admin: SupabaseClient,
  ref: { teamId: string; sheetId: string; linkId: string },
  out: SyncOutcome,
  trigger: "poll" | "manual",
): Promise<void> {
  try {
    const { data: sheet } = await admin
      .from("app_sheets")
      .select("id, name, project_id, source")
      .eq("id", ref.sheetId)
      .maybeSingle();
    const { data: link } = await admin
      .from("app_sheet_google_links")
      .select("spreadsheet_id, spreadsheet_url, sheet_gid, sheet_title, last_synced_at")
      .eq("id", ref.linkId)
      .maybeSingle();

    const s = (sheet ?? {}) as { name?: string; project_id?: string | null; source?: string };
    const l = (link ?? {}) as {
      spreadsheet_id?: string;
      spreadsheet_url?: string | null;
      sheet_gid?: number | null;
      sheet_title?: string | null;
      last_synced_at?: string | null;
    };
    await admin.rpc("app_sheets_emit_changed", {
      p_team_id: ref.teamId,
      p_payload: {
        sheet_id: ref.sheetId,
        sheet_name: s.name ?? null,
        project_id: s.project_id ?? null,
        source: s.source ?? null,
        spreadsheet_id: l.spreadsheet_id ?? null,
        spreadsheet_url: l.spreadsheet_url ?? null,
        sheet_gid: l.sheet_gid ?? null,
        sheet_title: l.sheet_title ?? null,
        // How the change was NOTICED: "poll" (the timer) or "manual" (somebody
        // pressed Sync now), alongside google_push and google_push_deferred
        // from the push path. A workflow that wants only live edits can test
        // it; one that just wants "the sheet moved" ignores it.
        trigger,
        // Drive's X-Goog-Resource-State, which nobody sent us here. "update" is
        // the state Drive uses for a content change, and this only runs when
        // rows came in, so a condition on resource_state behaves the same on
        // every path instead of failing on a value only polling can produce.
        resource_state: "update",
        // X-Goog-Changed is Google's hint about the KIND of edit. Neither a
        // poll nor a Sync now has a hint at all, so the list is empty rather
        // than a guess — the same thing a deferred push flush sends.
        changed: [],
        // Counts flattened for conditions ({{trigger.pulled}}) and nested for
        // the field picker — both, because that is what the payload carries.
        pushed: out.pushed,
        pulled: out.pulled,
        created: out.created,
        deleted: out.deleted,
        conflicts: out.conflicts,
        skipped: out.skipped,
        changed_rows: out.pulled + out.created + out.deleted,
        // The six counts, through the same helper the push emitter uses, so a
        // workflow sees one shape whichever path noticed the change.
        counts: publicSyncCounts(out),
        changed_at: l.last_synced_at ?? new Date().toISOString(),
      },
    });
  } catch {
    // The alarm is not the job. A sheet that synced correctly stays synced.
  }
}
