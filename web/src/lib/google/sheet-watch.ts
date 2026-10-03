import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { safeErrorText } from "@/lib/apps/auth";
import { publicSyncCounts, shouldEmitSheetChanged, syncSheetLink, type SyncOutcome } from "@/lib/sheets/google-sync";
import { DriveError, driveAuthForConnection, stopChannel, watchFile } from "./drive";
import {
  NOTIFY_COOLDOWN_SECONDS,
  RENEW_BEFORE_SECONDS,
  channelExpiry,
  driveWebhookAddress,
  hashChannelToken,
  newChannelId,
  newChannelToken,
  parseDriveNotification,
  requestedExpirationMs,
  retryAfter,
} from "./drive-watch";

/**
 * Push sync for linked Google Sheets: the database-aware half.
 *
 * WHAT THIS ADDS. Before push, a change made in Google was noticed only by the
 * poller — app_sheet_google_links.next_run_at, fifteen minutes by default. Now a
 * Drive files.watch channel POSTs to /api/hooks/google/drive the moment the file
 * changes and the same sync runs within seconds.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not sync anything itself. Every path
 * here ends in syncSheetLink() from src/lib/sheets/google-sync.ts, which already
 * owns the three-way merge, the conflict policy and the lease. Push only changes
 * WHEN that runs, never WHAT it does — so a bug in push can make the sync late,
 * never wrong.
 *
 * POLLING STAYS. Push is best-effort by construction:
 *   - a files channel lives at most 24 hours and has to be handed over;
 *   - Google drops notifications, and dev has no public URL at all;
 *   - a deploy to a new origin leaves every channel pointing at the old host.
 * So the timer is still the thing that guarantees eventual consistency, and push
 * is the thing that makes it feel live. They cannot collide: both go through
 * app_sheets_claim_link, and a push that finds the lease held records
 * pending_since instead of queueing a second run.
 */

/** How many links/channels one runner pass will touch, per kind of work. */
const PASS_LIMIT = 20;

/**
 * The workflow event a pushed change publishes. The key itself lives in
 * app_sheets_emit_changed (the emit is SQL, behind the same to_regprocedure
 * guards the Marketing funnels emit uses); this is exported so whoever adds the
 * trigger to src/lib/workflows/app-action-catalog.ts spells it the same way.
 */
const EMIT_KEY = "sheets.changed";

interface WorklistRow {
  kind: "watch" | "stop" | "flush";
  link_id: string | null;
  team_id: string;
  sheet_id: string;
  connection_id: string | null;
  spreadsheet_id: string;
  channel_row_id: string | null;
  channel_id: string | null;
  resource_id: string | null;
  expires_at: string | null;
  address: string | null;
  pending_since: string | null;
}

/**
 * driveAuthForConnection is typed against the generated Database, while every
 * engine function here takes the untyped service client the routes hand around
 * (the same cast adminClient() makes). The client is the same object either way.
 */
function credentialFor(admin: SupabaseClient, connectionId: string) {
  return driveAuthForConnection(admin as unknown as SupabaseClient<Database>, connectionId);
}

// -----------------------------------------------------------------------------
// Receiving a notification
// -----------------------------------------------------------------------------

export interface NotificationOutcome {
  /** True when the notification was recognised and accepted. */
  ok: boolean;
  /** Why it was not acted on: unknown, forbidden, duplicate, handshake, … */
  reason: string;
  /** What the channel row decided: sync, defer, handshake, gone, ignore. */
  action?: string;
  /**
   * The sync to run, present only for `action: "sync"`. It is handed back
   * rather than awaited so the route can answer Google first — a webhook that
   * holds the connection open for a whole sync invites a retry storm.
   */
  run?: () => Promise<void>;
}

/**
 * Turns one inbound Drive POST into a decision.
 *
 * Everything an attacker controls is a header, so the only thing trusted here is
 * the channel id we minted and the token we generated for it. The request is
 * never allowed to say which team, sheet or link it concerns: that mapping comes
 * out of app_sheet_drive_channels and nowhere else.
 *
 * The decision itself (duplicate? debounced? a state worth syncing?) is made in
 * one locked statement inside app_sheet_drive_channel_claim, because two
 * notifications can land on two instances at the same instant and exactly one of
 * them may run a sync.
 */
export async function receiveDriveNotification(
  admin: SupabaseClient,
  headers: Headers,
): Promise<NotificationOutcome> {
  const note = parseDriveNotification(headers);
  // Not a Drive notification at all: a crawler, a health check, a scanner.
  if (!note) return { ok: false, reason: "not_a_notification" };
  // We never register a channel without a token, so a notification without one
  // is either forged or a channel from some previous, unrecognisable scheme.
  if (!note.token) return { ok: false, reason: "forbidden" };

  const { data, error } = await admin.rpc("app_sheet_drive_channel_claim", {
    p_channel_id: note.channelId,
    p_token_hash: hashChannelToken(note.token),
    p_message_number: note.messageNumber,
    p_state: note.state,
    p_cooldown_seconds: NOTIFY_COOLDOWN_SECONDS,
  });
  if (error) return { ok: false, reason: "claim_failed" };

  const claim = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    action?: string;
    channel_row_id?: string;
    link_id?: string | null;
    team_id?: string;
    sheet_id?: string;
  };
  if (!claim.ok) return { ok: false, reason: claim.reason ?? "rejected" };

  const action = claim.action ?? "ignore";
  // "sync" is Drive's handshake, sent once the instant a channel is registered.
  // It carries no change and must never start one.
  if (action !== "sync") return { ok: true, reason: action, action };
  if (!claim.link_id || !claim.team_id || !claim.sheet_id || !claim.channel_row_id) {
    // The channel outlived its link. Nothing to sync; the next runner pass will
    // stop it at Google.
    return { ok: true, reason: "orphaned", action };
  }

  const ctx = {
    linkId: claim.link_id,
    teamId: claim.team_id,
    sheetId: claim.sheet_id,
    channelRowId: claim.channel_row_id,
    state: note.state,
    changed: note.changed,
    trigger: "google_push" as const,
  };
  return { ok: true, reason: "sync", action, run: () => syncForChannel(admin, ctx) };
}

interface SyncContext {
  linkId: string;
  teamId: string;
  sheetId: string;
  channelRowId: string;
  state: string;
  changed: string[];
  /** Goes into the event payload so a workflow can tell a live push from the
   *  tail of a burst the debounce window swallowed. */
  trigger: "google_push" | "google_push_deferred";
}

/**
 * Runs the real sync for a pushed change and, if anything came in from Google,
 * emits the workflow event.
 *
 * A "busy" result is the interesting case: the poller (or a manual Sync now) is
 * already inside this sheet, so the change is not lost, it is simply covered by
 * a run that started a moment ago — or, if it started BEFORE the edit, by the
 * pending_since flag, which the next runner pass flushes.
 */
async function syncForChannel(admin: SupabaseClient, ctx: SyncContext): Promise<void> {
  const out = await syncSheetLink(admin, {
    teamId: ctx.teamId,
    sheetId: ctx.sheetId,
    trigger: "auto",
    actorUserId: null,
  });

  if (out.status === "busy") {
    await admin
      .from("app_sheet_drive_channels")
      .update({ pending_since: new Date().toISOString() })
      .eq("id", ctx.channelRowId)
      .is("pending_since", null);
    return;
  }

  // Whatever the outcome, this notification has been dealt with. Leaving the
  // flag set on an error would retry a permanently broken sheet every tick; the
  // link's own next_run_at already decides when it is worth trying again.
  await admin
    .from("app_sheet_drive_channels")
    .update({ pending_since: null })
    .eq("id", ctx.channelRowId);

  // The same question the poller and "Sync now" ask, asked by calling the same
  // function rather than by writing the same sum again. The two used to be
  // spelled out separately and had already drifted: push counted `skipped`,
  // poll did not, so a sheet with one cell Google will not parse answered "yes"
  // here on every notification — and a debounced flush of an edit the poller
  // had already applied published a second, empty event for it.
  if (!shouldEmitSheetChanged(out)) return;

  await emitSheetChanged(admin, ctx, out);
}

/**
 * Publishes `sheets.changed` so an automation can react to somebody editing the
 * Google Sheet.
 *
 * The emit goes through app_sheets_emit_changed, which reaches wf_emit_event
 * behind to_regprocedure/to_regclass guards — the same defensiveness as
 * marketing_funnel_emit_target_misses. An install with no workflow tables, or
 * with nobody listening for the key, must not turn a good sync into a failure,
 * which is why nothing here is allowed to throw.
 */
async function emitSheetChanged(
  admin: SupabaseClient,
  ctx: SyncContext,
  counts: SyncOutcome,
): Promise<void> {
  try {
    const { data: sheet } = await admin
      .from("app_sheets")
      .select("id, name, project_id, source")
      .eq("id", ctx.sheetId)
      .maybeSingle();
    const { data: link } = await admin
      .from("app_sheet_google_links")
      .select("spreadsheet_id, spreadsheet_url, sheet_gid, sheet_title, last_synced_at")
      .eq("id", ctx.linkId)
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
      p_team_id: ctx.teamId,
      p_payload: {
        // Identity first: a following step needs to know which sheet moved and,
        // for a project sheet, where to post about it.
        sheet_id: ctx.sheetId,
        sheet_name: s.name ?? null,
        project_id: s.project_id ?? null,
        source: s.source ?? null,
        spreadsheet_id: l.spreadsheet_id ?? null,
        spreadsheet_url: l.spreadsheet_url ?? null,
        sheet_gid: l.sheet_gid ?? null,
        sheet_title: l.sheet_title ?? null,
        // What happened. `changed` is Drive's own X-Goog-Changed list
        // (content, properties, permissions …) and is the only hint Google
        // gives about the KIND of edit.
        trigger: ctx.trigger,
        resource_state: ctx.state,
        changed: ctx.changed,
        // Counts, flattened as well as nested: the workflow field picker offers
        // top-level keys, and "did anything actually come from Google" is the
        // condition most automations want.
        pushed: counts.pushed,
        pulled: counts.pulled,
        created: counts.created,
        deleted: counts.deleted,
        conflicts: counts.conflicts,
        skipped: counts.skipped,
        changed_rows: counts.pulled + counts.created + counts.deleted,
        // Same helper as the poll emitter: the six documented counts, not the
        // whole SyncOutcome (which carries fromGoogle, status and runId).
        counts: publicSyncCounts(counts),
        changed_at: l.last_synced_at ?? new Date().toISOString(),
      },
    });
  } catch {
    // The alarm is not the job. A sheet that synced correctly stays synced.
  }
}

// -----------------------------------------------------------------------------
// Keeping the channels alive
// -----------------------------------------------------------------------------

export interface ChannelPassResult {
  /** False when this deployment cannot receive push at all (see `reason`). */
  enabled: boolean;
  reason?: string;
  /** Channels registered or handed over. */
  watched: number;
  /** Channels cancelled at Google. */
  stopped: number;
  /** Deferred changes synced. */
  flushed: number;
  /** Rows retired because Google had already dropped them. */
  expired: number;
  /** Drive calls that failed; each one backs off before its next attempt. */
  failed: number;
}

/**
 * One maintenance pass over the push channels.
 *
 * Driven twice over, because a missed renewal is a dead channel: from the runner
 * tick (/api/runner/tick, every five minutes, next to processDueSheetLinks) and
 * from the pg_cron job app-drive-watch-renew against
 * /api/hooks/google/drive/renew every ten. Overlapping passes are safe — the
 * partial unique index on (link_id) where status = 'pending' lets exactly one
 * registration through and the other finds nothing to do.
 *
 * Registration is driven from here rather than from the route that creates a
 * link, so a link made while the address was unreachable — or before push
 * existed at all — picks up a channel by itself. ensureSheetWatch() below is the
 * fast path for the route that just made one; this is the safety net for
 * everything else.
 */
export async function processDriveChannels(
  admin: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<ChannelPassResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? PASS_LIMIT, 100));
  const result: ChannelPassResult = { enabled: true, watched: 0, stopped: 0, flushed: 0, expired: 0, failed: 0 };

  // Google has already forgotten these; retire them before the worklist runs so
  // their links come back round as "needs a channel" in this same pass.
  const { data: expired } = await admin
    .from("app_sheet_drive_channels")
    .update({ status: "expired" })
    .in("status", ["pending", "active"])
    .lt("expires_at", new Date().toISOString())
    .select("id");
  result.expired = (expired ?? []).length;

  const address = driveWebhookAddress();
  if (address.url === null) {
    // No public HTTPS endpoint: push is off, polling carries the feature. Still
    // worth flushing anything a previous, reachable deployment deferred.
    result.enabled = false;
    result.reason = address.reason;
  }

  const { data, error } = await admin.rpc("app_sheets_watch_worklist", {
    p_limit: limit,
    p_renew_before_seconds: RENEW_BEFORE_SECONDS,
    p_address: address.url,
  });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as WorklistRow[]) {
    if (row.kind === "flush") {
      if (await flushPending(admin, row)) result.flushed++;
      continue;
    }
    // Without an address there is nothing to register and no credential worth
    // spending on a stop for a channel that will expire within the day anyway.
    if (!address.url) continue;
    if (row.kind === "watch") {
      const { outcome } = await registerWatch(admin, row, address.url);
      if (outcome === "registered") result.watched++;
      // "skipped" is a concurrent pass winning the insert race, which is the
      // design working, not a failure worth counting.
      else if (outcome === "failed") result.failed++;
    } else if (row.kind === "stop") {
      const ok = await stopWatch(admin, row);
      if (ok) result.stopped++;
      else result.failed++;
    }
  }

  return result;
}

/** "skipped" is a race another pass won — the design working, not a failure. */
type RegisterOutcome = "registered" | "skipped" | "failed";

/**
 * What the attempt did, and — when Drive refused — the sentence that was
 * recorded on the channel row. The caller that a person is waiting on
 * (ensureSheetWatch, from the link routes) hands that sentence straight back so
 * the degradation to polling is reported rather than silent.
 */
interface RegisterResult {
  outcome: RegisterOutcome;
  error?: string;
}

/**
 * Registers one channel for one link.
 *
 * The row is written BEFORE the Drive call, as 'pending'. That is what makes
 * two overlapping runner ticks safe: the partial unique index on (link_id) where
 * status = 'pending' lets exactly one of them through, and the loser simply
 * finds nothing to do. It also means a crashed attempt leaves a trace to back
 * off from instead of being retried at full speed forever.
 */
async function registerWatch(
  admin: SupabaseClient,
  row: WorklistRow,
  address: string,
): Promise<RegisterResult> {
  if (!row.link_id || !row.connection_id) return { outcome: "skipped" };

  // Carry the backoff across attempts: each try writes its own row, so the
  // count has to be read from the last failure rather than kept on this one.
  const { data: prior } = await admin
    .from("app_sheet_drive_channels")
    .select("fail_count")
    .eq("link_id", row.link_id)
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorFails = Math.max(0, Number((prior as { fail_count?: number } | null)?.fail_count ?? 0));

  const channelId = newChannelId();
  const token = newChannelToken();
  const startedAt = Date.now();

  const { data: inserted, error: insertErr } = await admin
    .from("app_sheet_drive_channels")
    .insert({
      link_id: row.link_id,
      connection_id: row.connection_id,
      team_id: row.team_id,
      sheet_id: row.sheet_id,
      spreadsheet_id: row.spreadsheet_id,
      channel_id: channelId,
      token_hash: hashChannelToken(token),
      address,
      // A placeholder until Google says what it granted. Short on purpose: if
      // this process dies before the update, the row expires itself out of the
      // way instead of blocking the link for a day.
      expires_at: new Date(startedAt + 10 * 60_000).toISOString(),
      status: "pending",
      fail_count: priorFails,
    })
    .select("id")
    .single();
  // A unique violation means a concurrent pass is registering this link.
  if (insertErr || !inserted) return { outcome: "skipped" };
  const rowId = (inserted as { id: string }).id;

  try {
    const channel = await watchFile(credentialFor(admin, row.connection_id), {
      fileId: row.spreadsheet_id,
      channelId,
      address,
      token,
      expirationMs: requestedExpirationMs(startedAt),
    });
    await admin
      .from("app_sheet_drive_channels")
      .update({
        status: "active",
        resource_id: channel.resourceId,
        resource_uri: channel.resourceUri,
        expires_at: channelExpiry(channel.expirationMs, Date.now()).toISOString(),
        fail_count: 0,
        retry_after: null,
        last_error: null,
      })
      .eq("id", rowId);

    // Hand over. The old channel stayed live through the whole registration, so
    // there is no window in which nobody was watching the file.
    await admin
      .from("app_sheet_drive_channels")
      .update({ status: "stopping" })
      .eq("link_id", row.link_id)
      .eq("status", "active")
      .neq("id", rowId);
    // Anything left over from earlier failures is history now.
    await admin
      .from("app_sheet_drive_channels")
      .delete()
      .eq("link_id", row.link_id)
      .eq("status", "failed");
    return { outcome: "registered" };
  } catch (err) {
    const fails = priorFails + 1;
    const error = watchErrorText(err);
    await admin
      .from("app_sheet_drive_channels")
      .update({
        status: "failed",
        fail_count: fails,
        retry_after: retryAfter(fails, Date.now()).toISOString(),
        last_error: error,
      })
      .eq("id", rowId);
    // Only the newest failure is worth keeping; the backoff is already carried.
    await admin
      .from("app_sheet_drive_channels")
      .delete()
      .eq("link_id", row.link_id)
      .eq("status", "failed")
      .neq("id", rowId);
    return { outcome: "failed", error };
  }
}

/** Cancels a channel at Google so it stops POSTing at an endpoint we retired. */
async function stopWatch(admin: SupabaseClient, row: WorklistRow): Promise<boolean> {
  if (!row.channel_row_id) return false;
  if (!row.channel_id || !row.resource_id || !row.connection_id) {
    await admin.from("app_sheet_drive_channels").update({ status: "stopped" }).eq("id", row.channel_row_id);
    return true;
  }
  try {
    await stopChannel(credentialFor(admin, row.connection_id), {
      channelId: row.channel_id,
      resourceId: row.resource_id,
    });
    await admin
      .from("app_sheet_drive_channels")
      .update({ status: "stopped", pending_since: null, last_error: null })
      .eq("id", row.channel_row_id);
    return true;
  } catch (err) {
    // Keep it in 'stopping' so the next pass tries again; it drops out of the
    // worklist by itself once expires_at passes, because by then Google has
    // stopped calling anyway.
    await admin
      .from("app_sheet_drive_channels")
      .update({ status: "stopping", last_error: watchErrorText(err) })
      .eq("id", row.channel_row_id);
    return false;
  }
}

/** Runs the sync a debounced notification deferred. */
async function flushPending(admin: SupabaseClient, row: WorklistRow): Promise<boolean> {
  if (!row.link_id || !row.channel_row_id) return false;
  await syncForChannel(admin, {
    linkId: row.link_id,
    teamId: row.team_id,
    sheetId: row.sheet_id,
    channelRowId: row.channel_row_id,
    state: "update",
    changed: [],
    trigger: "google_push_deferred",
  });
  return true;
}

function watchErrorText(err: unknown): string {
  if (err instanceof DriveError) return err.message.slice(0, 900);
  return safeErrorText(err, "Google refused the notification channel.");
}

// -----------------------------------------------------------------------------
// Hooks for the routes that create and remove links
// -----------------------------------------------------------------------------
// Called from src/app/api/sheets/[id]/google/route.ts (POST, PATCH, DELETE) and
// .../google/provision/route.ts (POST) — the four places where a person decides
// whether Cubes should be reading this Google file at all.



export interface EnsureWatchResult {
  ok: boolean;
  /** already | registered | unreachable | ineligible | skipped | failed */
  reason: string;
  /**
   * The sentence to show a person when `ok` is false. Push failing is never
   * fatal — the link is made and the timer still syncs it — so the routes report
   * this instead of erroring, and a silent fallback to polling becomes a visible
   * one. It is already sanitised (see watchRefusalMessage in drive.ts).
   */
  detail?: string;
}

/**
 * Registers a channel for a freshly linked sheet, so the first edit in Google is
 * live instead of waiting for the next runner tick. Safe to call more than once
 * and safe to ignore the result — processDriveChannels() would get there anyway,
 * which is why nothing here throws.
 */
export async function ensureSheetWatch(admin: SupabaseClient, linkId: string): Promise<EnsureWatchResult> {
  const address = driveWebhookAddress();
  // `=== null`, not `!`: an empty-string url would not narrow the union.
  if (address.url === null) return { ok: false, reason: "unreachable", detail: address.reason };

  const { data: link } = await admin
    .from("app_sheet_google_links")
    .select("id, team_id, sheet_id, connection_id, spreadsheet_id, auto_sync, direction, provision_status")
    .eq("id", linkId)
    .maybeSingle();
  const l = link as
    | {
        id: string;
        team_id: string;
        sheet_id: string;
        // Nullable since 20261141000000: a link row is also the placeholder for
        // "this sheet is waiting for a Google Sheet".
        connection_id: string | null;
        spreadsheet_id: string | null;
        auto_sync: boolean;
        direction: string;
        provision_status: string | null;
      }
    | null;
  if (!l) return { ok: false, reason: "ineligible", detail: "That Google link no longer exists." };
  // A link that has not been provisioned yet has nothing to watch. It is not an
  // error: the provision route calls back here once Google has answered.
  if (!l.connection_id || !l.spreadsheet_id || (l.provision_status ?? "ready") !== "ready") {
    return { ok: false, reason: "ineligible", detail: "This sheet has no Google Sheet behind it yet." };
  }
  // Push only earns its keep when Cubes reads FROM Google.
  if (!l.auto_sync || (l.direction !== "both" && l.direction !== "pull")) {
    return {
      ok: false,
      reason: "ineligible",
      detail: l.auto_sync
        ? "Live sync only applies when Cubes reads from Google; this link only writes to it."
        : "Scheduled sync is off for this sheet, so there is nothing to watch for.",
    };
  }

  const cutoff = new Date(Date.now() + RENEW_BEFORE_SECONDS * 1000).toISOString();
  const { data: live } = await admin
    .from("app_sheet_drive_channels")
    .select("id")
    .eq("link_id", linkId)
    .eq("address", address.url)
    .in("status", ["pending", "active"])
    .gt("expires_at", cutoff)
    .limit(1);
  if ((live ?? []).length > 0) return { ok: true, reason: "already" };

  const { outcome, error } = await registerWatch(
    admin,
    {
      kind: "watch",
      link_id: l.id,
      team_id: l.team_id,
      sheet_id: l.sheet_id,
      connection_id: l.connection_id,
      spreadsheet_id: l.spreadsheet_id,
      channel_row_id: null,
      channel_id: null,
      resource_id: null,
      expires_at: null,
      address: null,
      pending_since: null,
    },
    address.url,
  );
  if (outcome === "registered") return { ok: true, reason: "registered" };
  // "skipped" is another pass holding the pending slot for this link — it is
  // already being registered, so there is nothing to tell anyone.
  return outcome === "skipped"
    ? { ok: false, reason: "skipped" }
    : { ok: false, reason: "failed", detail: error };
}

/**
 * Marks a link's channels for cancellation — call this when a sheet is unlinked,
 * before the link row goes away. The Drive call itself happens on the next
 * runner pass, because stopping is not worth making the person wait for.
 *
 * If the link is deleted without this, nothing breaks: link_id is ON DELETE SET
 * NULL, and an orphaned channel is picked up as 'stop' work by exactly the same
 * pass.
 */
export async function stopSheetWatches(admin: SupabaseClient, linkId: string): Promise<number> {
  const { data } = await admin
    .from("app_sheet_drive_channels")
    .update({ status: "stopping", pending_since: null })
    .eq("link_id", linkId)
    .in("status", ["pending", "active"])
    .select("id");
  return (data ?? []).length;
}

export { EMIT_KEY as SHEETS_CHANGED_EVENT_KEY };
