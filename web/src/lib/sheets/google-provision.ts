import type { SupabaseClient } from "@supabase/supabase-js";
import { safeErrorText } from "@/lib/apps/auth";
import { GoogleSheetsError, SheetsClient } from "@/lib/google/sheets-api";
import { defaultGoogleSettings } from "./google-embed";
import { ID_HEADER } from "./google-layout";
import { syncSheetShares } from "./google-share";
import { syncSheetLink } from "./google-sync";
import type { GoogleLinkRow, SheetRecordRow } from "./types";
import { isValidTimeZone } from "./values";

/**
 * Sheets — giving a sheet its Google Sheet.
 *
 * Every Cubes sheet is meant to BE a Google Sheet now, which turns what used to
 * be an optional setup step into part of creating a sheet. That changes what
 * failure has to look like. Before, a failed link left a perfectly usable grid;
 * now it would leave a page with nothing on it. So provisioning always leaves a
 * link row behind, even when it could not do the job:
 *
 *   pending  no Google account is connected to this workspace yet. The sheet is
 *            real, its rows are real, and the sheet view says so and offers the
 *            connect button. Nothing is lost — provisioning is one click away.
 *   failed   Google was asked and refused. Same card, the reason, and a retry.
 *   ready    there is a spreadsheet, the first sync has run and the team has
 *            been shared in.
 *
 * Sharing is deliberately non-fatal. A sheet whose share pass half-worked is
 * still a working sheet for the people it did reach; downgrading it to "failed"
 * would be a lie about what the person in front of it is looking at.
 *
 * Drive push channels are NOT started here. 20261142000000_drive_watch_channels
 * owns them, and its pass watches every ready link in app_sheet_google_links —
 * including the ones provisioned here — so a second registration would only
 * mean two notifications and two syncs per edit.
 */

export type ProvisionOutcome =
  | { status: "ready"; link: GoogleLinkRow; shareError: string | null }
  | { status: "pending"; link: GoogleLinkRow | null; reason: string }
  | { status: "failed"; link: GoogleLinkRow | null; reason: string };

/** A connection is usable when Google will still mint tokens for it. */
const USABLE_CONNECTION = "id, google_account_email, enabled, revoked_at, has_refresh_token";

interface ConnectionRow {
  id: string;
  google_account_email: string | null;
  enabled: boolean;
  revoked_at: string | null;
  has_refresh_token: boolean;
}

/**
 * The Google account a sheet should be provisioned into: the one asked for, or
 * the workspace's newest usable one.
 *
 * Auto-provisioning gets no chooser — nobody wants a dialog in the way of
 * "create sheet" — so when a team has several accounts connected, the newest is
 * the one that was most deliberately added. A sheet can be moved afterwards by
 * unlinking and linking it in the Google panel.
 */
export async function pickProvisionConnection(
  admin: SupabaseClient,
  teamId: string,
  preferredId?: string | null,
): Promise<ConnectionRow | null> {
  const { data } = await admin
    .from("app_google_connections")
    .select(USABLE_CONNECTION)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  const usable = ((data ?? []) as ConnectionRow[]).filter((c) => c.enabled && !c.revoked_at && c.has_refresh_token);
  if (preferredId) {
    const wanted = usable.find((c) => c.id === preferredId);
    if (wanted) return wanted;
  }
  return usable[0] ?? null;
}

async function currentLink(admin: SupabaseClient, sheetId: string): Promise<GoogleLinkRow | null> {
  const { data } = await admin.from("app_sheet_google_links").select("*").eq("sheet_id", sheetId).maybeSingle();
  return (data as GoogleLinkRow | null) ?? null;
}

/**
 * Writes (or refreshes) the "no Google Sheet yet" row. Upsert on sheet_id
 * because the sheet has exactly one link slot and this state has to occupy it —
 * otherwise "not provisioned" and "not linked" would be indistinguishable, and
 * the sheet view could not tell the reader which of the two it is looking at.
 */
export async function markPending(
  admin: SupabaseClient,
  sheet: Pick<SheetRecordRow, "id" | "team_id" | "source">,
  reason: string,
  createdBy: string | null,
  status: "pending" | "failed" = "pending",
): Promise<GoogleLinkRow | null> {
  const existing = await currentLink(admin, sheet.id);
  // Never demote a working link. A provision retry that fails on a sheet that
  // already has a spreadsheet must leave the spreadsheet exactly where it was.
  if (existing?.provision_status === "ready") return existing;

  const defaults = defaultGoogleSettings(sheet.source);
  const row = {
    sheet_id: sheet.id,
    team_id: sheet.team_id,
    connection_id: null,
    spreadsheet_id: null,
    direction: defaults.direction,
    conflict_policy: defaults.conflictPolicy,
    delete_policy: defaults.deletePolicy,
    auto_sync: defaults.autoSync,
    interval_minutes: defaults.intervalMinutes,
    next_run_at: null,
    provision_status: status,
    provision_error: reason.slice(0, 1000),
    created_by: createdBy,
  };
  const { data, error } = await admin
    .from("app_sheet_google_links")
    .upsert(row, { onConflict: "sheet_id" })
    .select("*")
    .maybeSingle();
  if (error) return existing;
  return (data as GoogleLinkRow | null) ?? existing;
}

/**
 * Creates the Google Sheet for a Cubes sheet and wires everything to it.
 *
 * Order matters and is not arbitrary:
 *   1. the spreadsheet, with the header row already laid out (google-layout);
 *   2. the link row — before the first sync, because the sync engine loads the
 *      link to know what it is syncing;
 *   3. the first sync, so the person's data is in the file by the time they
 *      look at the embed rather than a header row and nothing;
 *   4. sharing last, so the rest of the team can see what they just made.
 */
export async function provisionSheetGoogle(
  admin: SupabaseClient,
  opts: {
    sheet: SheetRecordRow;
    userId: string | null;
    connectionId?: string | null;
    timeZone?: string | null;
  },
): Promise<ProvisionOutcome> {
  const { sheet, userId } = opts;

  const existing = await currentLink(admin, sheet.id);
  if (existing?.provision_status === "ready") {
    return { status: "ready", link: existing, shareError: existing.share_error };
  }

  const conn = await pickProvisionConnection(admin, sheet.team_id, opts.connectionId);
  if (!conn) {
    const reason = "No Google account is connected to this workspace yet, so this sheet has no Google Sheet behind it.";
    return { status: "pending", link: await markPending(admin, sheet, reason, userId), reason };
  }

  const defaults = defaultGoogleSettings(sheet.source);
  const client = new SheetsClient(admin, conn.id);
  let created: { spreadsheetId: string; spreadsheetUrl: string | null; sheetGid: number; sheetTitle: string };
  try {
    // The same header layout the sync engine matches on: "Cubes ID" in column A
    // followed by every visible column, so the very first sync recognises its
    // own tab instead of treating it as somebody else's spreadsheet.
    const headers = [ID_HEADER, ...sheet.columns.filter((c) => !c.hidden).map((c) => c.label)];
    const tz = isValidTimeZone(opts.timeZone) ? opts.timeZone : null;
    created = await client.createSpreadsheet(sheet.name, sheet.name.slice(0, 90) || "Sheet1", headers, tz);
  } catch (err) {
    const reason = (err instanceof GoogleSheetsError ? err.message : safeErrorText(err, "Google would not create the spreadsheet.")).slice(0, 1000);
    return { status: "failed", link: await markPending(admin, sheet, reason, userId, "failed"), reason };
  }

  const linkRow = {
    sheet_id: sheet.id,
    team_id: sheet.team_id,
    connection_id: conn.id,
    spreadsheet_id: created.spreadsheetId,
    spreadsheet_url: created.spreadsheetUrl,
    sheet_gid: created.sheetGid,
    sheet_title: created.sheetTitle,
    direction: existing?.direction ?? defaults.direction,
    conflict_policy: existing?.conflict_policy ?? defaults.conflictPolicy,
    delete_policy: existing?.delete_policy ?? defaults.deletePolicy,
    auto_sync: existing?.auto_sync ?? defaults.autoSync,
    interval_minutes: existing?.interval_minutes ?? defaults.intervalMinutes,
    next_run_at: new Date(Date.now() + (existing?.interval_minutes ?? defaults.intervalMinutes) * 60_000).toISOString(),
    provision_status: "ready",
    provision_error: null,
    provisioned_at: new Date().toISOString(),
    owned_by_us: true,
    owner_email: conn.google_account_email,
    created_by: existing?.created_by ?? userId,
  };
  const { data: saved, error } = await admin
    .from("app_sheet_google_links")
    // The sheet has exactly one link slot (unique sheet_id); a pending row
    // occupying it is upgraded in place rather than duplicated.
    .upsert(linkRow, { onConflict: "sheet_id" })
    .select("*")
    .single();
  if (error) {
    // The spreadsheet exists in Drive and we have just failed to record where.
    // A retry makes a NEW one, so the orphan's URL goes into the reason the
    // person reads — it is their data in their Drive, and nothing else will
    // ever mention it again.
    const orphan = created.spreadsheetUrl ? ` The spreadsheet that was created is at ${created.spreadsheetUrl} — trying again makes a new one.` : "";
    const reason = (
      error.code === "23505"
        ? "That Google Sheet tab is already linked to another Cubes sheet."
        : safeErrorText(error.message, "The Google Sheet was created but could not be linked.") + orphan
    ).slice(0, 1000);
    return { status: "failed", link: await markPending(admin, sheet, reason, userId, "failed"), reason };
  }
  let link = saved as GoogleLinkRow;

  // Fill the file. A failure here is recorded on the link by the sync engine
  // itself (last_status / last_error) and shown in the Google panel — the sheet
  // is provisioned either way, and "Sync now" is right there.
  await syncSheetLink(admin, { teamId: sheet.team_id, sheetId: sheet.id, trigger: "manual", actorUserId: userId });

  const share = await syncSheetShares(admin, link);

  link = (await currentLink(admin, sheet.id)) ?? link;
  return { status: "ready", link, shareError: share.error };
}
