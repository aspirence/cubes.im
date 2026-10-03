import { NextResponse, type NextRequest } from "next/server";
import { SheetsClient } from "@/lib/google/sheets-api";
import { ensureSheetWatch, stopSheetWatches, type EnsureWatchResult } from "@/lib/google/sheet-watch";
import { syncSheetLink } from "@/lib/sheets/google-sync";
import { defaultGoogleSettings } from "@/lib/sheets/google-embed";
import { syncSheetShares } from "@/lib/sheets/google-share";
import { ID_HEADER } from "@/lib/sheets/google-layout";
import { isValidTimeZone } from "@/lib/sheets/values";
import type { ConflictPolicy, DeletePolicy, GoogleLinkRow, SyncDirection } from "@/lib/sheets/types";
import { archivedResponse, authorizeSheet, errorResponse, readJson, type SheetAccess } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

/**
 * The sheet's Google Sheets link.
 *
 *   POST   { connectionId, mode: "create" | "existing", spreadsheetId?, sheetGid?,
 *            direction, conflictPolicy, deletePolicy, autoSync, intervalMinutes, timeZone? }
 *          → { link, sync, watch }  — "create" makes a new spreadsheet in the connected
 *          account's Drive with the headers laid out; "existing" needs a file
 *          picked with the Google Picker (drive.file can only open those). Both
 *          run the first sync straight away.
 *   PATCH  { direction?, conflictPolicy?, deletePolicy?, autoSync?, intervalMinutes? } → { link, watch }
 *   DELETE → { ok, stopping } — unlinks; the Google file stays where it is.
 *
 * Links are written here as service_role only: the route checks the Google
 * account belongs to the sheet's workspace and is still connected, which RLS
 * alone could not.
 *
 * PUSH. Every call that changes whether Cubes should be watching the Google file
 * says so to src/lib/google/sheet-watch.ts before it answers: POST and a PATCH
 * that leaves the link eligible register a Drive channel, a PATCH that makes it
 * ineligible and DELETE mark the channels for cancellation. Registration is
 * ALLOWED TO FAIL — without a channel the sheet still syncs on its timer — so
 * the outcome is returned as `watch` rather than thrown, and the caller can say
 * "live sync is off, and here is why" instead of pretending it is on.
 */

const DIRECTIONS: SyncDirection[] = ["both", "push", "pull"];
const CONFLICTS: ConflictPolicy[] = ["newest", "cubes", "google"];
const DELETES: DeletePolicy[] = ["keep", "delete"];
const SPREADSHEET_ID_RE = /^[A-Za-z0-9_-]{20,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Settings = Partial<Pick<GoogleLinkRow, "direction" | "conflict_policy" | "delete_policy" | "auto_sync" | "interval_minutes">>;

/** Validates the settings fields present in a body; unknown values are errors
 *  rather than silently defaulted, so a typo can't flip a link to "delete". */
function readSettings(body: Record<string, unknown>): { ok: true; settings: Settings } | { ok: false; error: string } {
  const s: Settings = {};
  if (body.direction !== undefined) {
    if (!DIRECTIONS.includes(body.direction as SyncDirection)) return { ok: false, error: "direction must be both, push or pull." };
    s.direction = body.direction as SyncDirection;
  }
  if (body.conflictPolicy !== undefined) {
    if (!CONFLICTS.includes(body.conflictPolicy as ConflictPolicy)) return { ok: false, error: "conflictPolicy must be newest, cubes or google." };
    s.conflict_policy = body.conflictPolicy as ConflictPolicy;
  }
  if (body.deletePolicy !== undefined) {
    if (!DELETES.includes(body.deletePolicy as DeletePolicy)) return { ok: false, error: "deletePolicy must be keep or delete." };
    s.delete_policy = body.deletePolicy as DeletePolicy;
  }
  if (body.autoSync !== undefined) {
    if (typeof body.autoSync !== "boolean") return { ok: false, error: "autoSync must be true or false." };
    s.auto_sync = body.autoSync;
  }
  if (body.intervalMinutes !== undefined) {
    const n = Number(body.intervalMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 1440) return { ok: false, error: "intervalMinutes must be a whole number from 5 to 1440." };
    s.interval_minutes = n;
  }
  return { ok: true, settings: s };
}

function denyLimited(access: SheetAccess): NextResponse | null {
  // A limited member only sees their own tasks here; linking would copy the
  // whole sheet into a Google file outside anyone's project permissions.
  return access.isLimited
    ? NextResponse.json({ error: "Limited members can't link sheets to Google Sheets." }, { status: 403 })
    : null;
}

async function currentLink(access: SheetAccess): Promise<GoogleLinkRow | null> {
  const { data } = await access.admin
    .from("app_sheet_google_links")
    .select("*")
    .eq("sheet_id", access.sheet.id)
    .eq("team_id", access.sheet.team_id)
    .maybeSingle();
  return (data as GoogleLinkRow | null) ?? null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const access = auth.access;
  const { sheet, admin } = access;
  if (sheet.archived) return archivedResponse();
  const limited = denyLimited(access);
  if (limited) return limited;

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "Send the link settings as JSON." }, { status: 400 });
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
  const mode = body.mode === "create" || body.mode === "existing" ? body.mode : null;
  if (!UUID_RE.test(connectionId) || !mode) {
    return NextResponse.json({ error: "Send { connectionId, mode: 'create' | 'existing' }." }, { status: 400 });
  }
  const parsed = readSettings(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // A 'pending' or 'failed' row is a placeholder for "this sheet has no Google
  // Sheet yet" (google-provision.ts) and is exactly what this call is here to
  // replace — only a ready link is in the way.
  const existing = await currentLink(access);
  if (existing && existing.provision_status === "ready") {
    return NextResponse.json({ error: "This sheet is already linked. Unlink it first to pick another Google Sheet." }, { status: 409 });
  }

  const { data: conn } = await admin
    .from("app_google_connections")
    .select("id, google_account_email, enabled, revoked_at, has_refresh_token")
    .eq("id", connectionId)
    .eq("team_id", sheet.team_id)
    .maybeSingle();
  if (!conn) return NextResponse.json({ error: "Google account not found." }, { status: 404 });
  const c = conn as { google_account_email: string | null; enabled: boolean; revoked_at: string | null; has_refresh_token: boolean };
  if (!c.enabled || c.revoked_at || !c.has_refresh_token) {
    return NextResponse.json({ error: "Reconnect this Google account first.", reconnect: true }, { status: 409 });
  }
  // Named in the embed's "if Google asks for access, ask …" line, so a member
  // looking at Google's access wall knows who to go to.
  const ownerEmail = c.google_account_email;

  const client = new SheetsClient(admin, connectionId);
  let target: { spreadsheetId: string; spreadsheetUrl: string | null; sheetGid: number; sheetTitle: string };
  try {
    if (mode === "create") {
      const headers = [ID_HEADER, ...sheet.columns.filter((col) => !col.hidden).map((col) => col.label)];
      const tz = typeof body.timeZone === "string" && isValidTimeZone(body.timeZone) ? body.timeZone : null;
      target = await client.createSpreadsheet(sheet.name, sheet.name.slice(0, 90) || "Sheet1", headers, tz);
    } else {
      const spreadsheetId = typeof body.spreadsheetId === "string" ? body.spreadsheetId.trim() : "";
      if (!SPREADSHEET_ID_RE.test(spreadsheetId)) {
        return NextResponse.json({ error: "Pick a Google Sheet (spreadsheetId is missing or malformed)." }, { status: 400 });
      }
      const meta = await client.getSheetMeta(spreadsheetId);
      const wantedGid = typeof body.sheetGid === "number" ? body.sheetGid : null;
      const tab = (wantedGid !== null ? meta.sheets.find((t) => t.gid === wantedGid) : null) ?? meta.sheets[0];
      if (!tab) return NextResponse.json({ error: "That spreadsheet has no tabs." }, { status: 400 });
      target = { spreadsheetId, spreadsheetUrl: meta.spreadsheetUrl, sheetGid: tab.gid, sheetTitle: tab.title };
    }
  } catch (err) {
    return errorResponse(err);
  }

  const settings = parsed.settings;
  const defaults = defaultGoogleSettings(sheet.source);
  const interval = settings.interval_minutes ?? defaults.intervalMinutes;
  const row = {
    sheet_id: sheet.id,
    team_id: sheet.team_id,
    connection_id: connectionId,
    spreadsheet_id: target.spreadsheetId,
    spreadsheet_url: target.spreadsheetUrl,
    sheet_gid: target.sheetGid,
    sheet_title: target.sheetTitle,
    direction: settings.direction ?? defaults.direction,
    conflict_policy: settings.conflict_policy ?? defaults.conflictPolicy,
    delete_policy: settings.delete_policy ?? defaults.deletePolicy,
    auto_sync: settings.auto_sync ?? defaults.autoSync,
    interval_minutes: interval,
    next_run_at: new Date(Date.now() + interval * 60_000).toISOString(),
    provision_status: "ready",
    provision_error: null,
    provisioned_at: new Date().toISOString(),
    // Only a file WE made is ours to share. One picked from the user's Drive
    // belongs to them, and every Drive permission write on it would 403.
    owned_by_us: mode === "create",
    owner_email: mode === "create" ? ownerEmail : null,
    created_by: access.userId,
  };
  const { data: link, error } = await admin
    .from("app_sheet_google_links")
    // onConflict sheet_id: a pending row already holds this sheet's one link
    // slot, and its id is kept by the update — nothing else points at it.
    .upsert(row, { onConflict: "sheet_id" })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That Google Sheet tab is already linked to another sheet." }, { status: 409 });
    }
    return errorResponse(new Error(error.message));
  }

  // First sync now, so the person sees their data land in Google (or the
  // Google rows land here) instead of waiting for the schedule.
  const sync = await syncSheetLink(admin, {
    teamId: sheet.team_id,
    sheetId: sheet.id,
    trigger: "manual",
    actorUserId: access.userId,
  });

  // The sheet view shows this file to everyone who can open the sheet, and the
  // frame runs on the VIEWER's Google session — so a file we own has to be
  // handed to the team or they get Google's access wall instead of their data.
  // Recorded on the link and reported in the Google panel; it may not fail the
  // link, which is already made and already synced.
  const shared = (link as GoogleLinkRow).owned_by_us ? await syncSheetShares(admin, link as GoogleLinkRow) : null;

  // Live sync. Registering here rather than waiting for the runner tick is what
  // makes the first edit in Google land in seconds; the tick is the safety net
  // for everything this misses. It may not fail the link, which is already made
  // and already synced — see the PUSH note at the top.
  const watch = await ensureSheetWatch(admin, (link as GoogleLinkRow).id);

  const fresh = (await currentLink(access)) ?? (link as GoogleLinkRow);
  return NextResponse.json({ link: fresh, sync, shareError: shared?.error ?? null, watch }, { status: 201 });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const limited = denyLimited(auth.access);
  if (limited) return limited;
  const link = await currentLink(auth.access);
  if (!link) return NextResponse.json({ error: "This sheet is not linked to a Google Sheet." }, { status: 404 });

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: "Send the settings to change as JSON." }, { status: 400 });
  const parsed = readSettings(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...parsed.settings };
  if (Object.keys(patch).length === 0) return NextResponse.json({ link });
  // A new interval or a re-enabled schedule takes effect from now.
  if (patch.interval_minutes !== undefined || (patch.auto_sync === true && !link.auto_sync)) {
    const minutes = (patch.interval_minutes as number | undefined) ?? link.interval_minutes;
    patch.next_run_at = new Date(Date.now() + minutes * 60_000).toISOString();
  }
  const { data, error } = await auth.access.admin
    .from("app_sheet_google_links")
    .update(patch)
    .eq("id", link.id)
    .eq("team_id", link.team_id)
    .select("*")
    .single();
  if (error) return errorResponse(new Error(error.message));

  // The Drive role follows the direction (google-share.ts): turning a two-way
  // link into "Cubes → Google" means nothing typed in Google survives, so the
  // team should hold reader, not writer. Only ever widens or matches — the
  // share pass never revokes.
  const updated = data as GoogleLinkRow;
  if (patch.direction !== undefined && patch.direction !== link.direction && updated.owned_by_us) {
    await syncSheetShares(auth.access.admin, updated);
  }

  // Follow the settings with the watch. Turning auto-sync off, or turning a
  // two-way link into "Cubes → Google", means nothing coming FROM Google
  // matters any more — and a channel nobody stops keeps Google POSTing at us
  // for up to a day. Both calls are idempotent, so this runs unconditionally
  // rather than trying to guess which way the settings moved.
  const wantsPush = updated.auto_sync && (updated.direction === "both" || updated.direction === "pull");
  let watch: EnsureWatchResult;
  if (wantsPush) {
    watch = await ensureSheetWatch(auth.access.admin, updated.id);
  } else {
    const stopped = await stopSheetWatches(auth.access.admin, updated.id);
    watch = { ok: false, reason: stopped > 0 ? "stopping" : "ineligible" };
  }
  return NextResponse.json({ link: updated, watch });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const limited = denyLimited(auth.access);
  if (limited) return limited;
  const link = await currentLink(auth.access);
  if (!link) return NextResponse.json({ ok: true });

  // BEFORE the delete, while link_id still points at them: mark this link's
  // channels for cancellation. The Drive call itself is the next runner pass's
  // job — nobody should wait on it to unlink — and app_sheet_drive_channels.
  // link_id is ON DELETE SET NULL, so a channel missed here is still picked up
  // as orphaned 'stop' work. Doing it here just means Google stops calling us
  // about a file we no longer care about minutes sooner instead of a day later.
  const stopping = await stopSheetWatches(auth.access.admin, link.id);

  // The snapshot and the run history go with the link (cascade). The Google
  // file is the person's; it stays untouched.
  const { error } = await auth.access.admin
    .from("app_sheet_google_links")
    .delete()
    .eq("id", link.id)
    .eq("team_id", link.team_id);
  if (error) return errorResponse(new Error(error.message));
  return NextResponse.json({ ok: true, stopping });
}
