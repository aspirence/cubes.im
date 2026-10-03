import { NextResponse, type NextRequest } from "next/server";
import { adminClient, secretMatches } from "@/lib/apps/auth";
import { processDriveChannels } from "@/lib/google/sheet-watch";

/**
 * Channel maintenance: register the watches that are missing, hand over the ones
 * about to expire, cancel the ones nobody wants, and flush any change the
 * debounce window deferred.
 *
 * A Drive channel on a FILES resource lives at most 24 hours, so this HAS to run
 * regularly or push quietly stops working after a day.
 *
 * WHO CALLS IT. pg_cron job `app-drive-watch-renew` every ten minutes, through
 * app_drive_watch_dispatch() (20261143000000_drive_watch_cron.sql). The runner
 * tick runs the same pass in-process every five minutes, so this endpoint is the
 * independent backstop — if /api/runner/tick is failing or mid-deploy, channel
 * renewal still happens — and it doubles as the escape hatch an operator can
 * curl after connecting Google, rather than waiting a tick to find out whether
 * registration works.
 *
 * Authorised exactly like the runner tick: the shared RUNNER_SECRET header. Not
 * a browser endpoint.
 */

export const runtime = "nodejs";
// Twenty registrations, each one Drive round trip, plus any deferred syncs.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get("x-runner-secret"), "RUNNER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const result = await processDriveChannels(admin);
  return NextResponse.json(result);
}
