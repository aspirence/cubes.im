import { NextResponse, type NextRequest } from "next/server";
import { adminClient, safeErrorText, secretMatches } from "@/lib/apps/auth";
import { processDriveChannels, type ChannelPassResult } from "@/lib/google/sheet-watch";
import { processDueSheetLinks } from "@/lib/sheets/google-sync";
import { tick, type TickResult } from "@/lib/workflows/runner";

/**
 * The runner's heartbeat. pg_cron (job app-runner-tick) POSTs here every five
 * minutes with the shared secret from app_runner_config; locally you can curl
 * it with RUNNER_SECRET. One pass starts due scheduled workflows, executes
 * parked app steps (Meta sync, CRM spend, Sheets sync), runs due Google Sheets
 * auto-syncs and keeps the Drive push channels alive. Never called by browsers.
 *
 * WHY THE DRIVE PASS IS NOT INSIDE tick(). A Drive channel on a FILES resource
 * expires within a day — some inside an hour — so a channel that misses its
 * renewal window is simply gone, and push silently stops working. That must not
 * depend on the workflow engine having had a good pass: the two are run side by
 * side here, each with its own failure, so one blowing up cannot take the other
 * with it. 20261143000000_drive_watch_cron.sql adds a second, independent cron
 * entry against /api/hooks/google/drive/renew as the backstop for this route
 * itself being down.
 */

export const runtime = "nodejs";
// A pass can include several Meta / Google syncs; the runner stops picking up
// new work after four minutes, so five leaves room to finish the last one.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get("x-runner-secret"), "RUNNER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  let result: TickResult | null = null;
  let tickError: string | null = null;
  try {
    result = await tick(admin, { processSheetLinks: (a) => processDueSheetLinks(a) });
  } catch (err) {
    // tick() collects its own step failures, so reaching here means the pass
    // itself broke. Recorded and carried on with: the channels below are on a
    // deadline the workflow engine knows nothing about.
    tickError = safeErrorText(err, "The runner pass failed.");
  }

  let driveChannels: ChannelPassResult | { error: string };
  try {
    driveChannels = await processDriveChannels(admin);
  } catch (err) {
    driveChannels = { error: safeErrorText(err, "The Drive channel pass failed.") };
  }

  return NextResponse.json({
    ...(result ?? {}),
    ...(tickError ? { errors: [...(result?.errors ?? []), tickError] } : {}),
    driveChannels,
  });
}
