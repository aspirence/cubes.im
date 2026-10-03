import { NextResponse, after, type NextRequest } from "next/server";
import { adminClient } from "@/lib/apps/auth";
import { receiveDriveNotification } from "@/lib/google/sheet-watch";

/**
 * Google Drive push notifications for linked Google Sheets.
 *
 * This is the address every files.watch channel is registered with, so it is
 * PUBLIC and unauthenticated by nature — that is what a Google push channel is.
 * There is no session, no team header, and no body: Drive puts everything in
 * headers.
 *
 *   X-Goog-Channel-ID        the id WE minted when registering
 *   X-Goog-Channel-Token     the secret WE generated for that channel
 *   X-Goog-Resource-ID       Google's opaque id for the watched file
 *   X-Goog-Resource-State    sync | add | update | remove | trash | untrash
 *   X-Goog-Message-Number    per-channel, increasing; 1 for the sync handshake
 *   X-Goog-Changed           on `update`: content, properties, permissions, …
 *
 * WHAT MAKES IT SAFE. The channel id is a lookup key and the token is the proof.
 * A request never gets to say which workspace, sheet or link it concerns — that
 * mapping lives in app_sheet_drive_channels and is reachable only through
 * app_sheet_drive_channel_claim, which also verifies the token, rejects
 * redelivered message numbers and applies the debounce, all under one row lock.
 *
 * WHY EVERYTHING ANSWERS 200, AND SAYS NOTHING. Google retries a non-2xx with
 * backoff and will eventually drop the channel. A scanner POSTing garbage must
 * not be able to provoke that. And anything that distinguished "no such channel"
 * from "wrong token" would confirm to whoever asked that a channel id was real,
 * so every rejection is the same bare `{received: true}`. Only a caller that
 * already proved it holds the token learns anything more.
 *
 * WHY THE SYNC RUNS AFTER THE RESPONSE. A sheet sync is a handful of Google
 * round trips. Holding the connection open for it would push past Google's
 * notification timeout and earn a duplicate delivery for work already underway,
 * so the response goes first and `after()` does the work.
 */

export const runtime = "nodejs";
// A pushed change runs one full sheet sync — the same budget the runner gives
// one link.
export const maxDuration = 300;
// A notification is never cacheable and never prerendered.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = adminClient();
  if (!admin) {
    // Nothing is configured, so nothing can be verified. Still 200: a 500 here
    // would make Google retry a request we can never handle.
    return NextResponse.json({ received: true });
  }

  let outcome;
  try {
    outcome = await receiveDriveNotification(admin, request.headers);
  } catch {
    // Never leak an error body to an unauthenticated caller, and never hand
    // Google a status that starts a retry ladder.
    return NextResponse.json({ received: true });
  }

  if (outcome.run) after(outcome.run);

  // `action` is returned only once the token has been verified, so it tells a
  // stranger nothing. It is what makes a real channel debuggable with curl.
  return NextResponse.json(outcome.ok ? { received: true, action: outcome.action } : { received: true });
}
