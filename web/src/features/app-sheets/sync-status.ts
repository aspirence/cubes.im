/**
 * Sheets — what the PUSH (live) sync is doing, in words.
 *
 * Two things describe the same mechanism from different angles, and both land
 * here so no call site has to interpret either one:
 *
 *   - `watch` on the Google routes' answers ({ ok, reason, detail? }) — what
 *     happened to the Drive channel during THIS request: it was registered,
 *     it was already there, it was cancelled, or it could not be. Transient.
 *   - app_sheet_drive_channels — what the channel is doing right now. Durable,
 *     and readable by any member of the sheet (its SELECT policy is
 *     app_sheets_can_access), so the sheet can show a live badge without a
 *     round trip through a route.
 *
 * THE RULE THAT DECIDES THE TONE: reason 'unreachable' is NOT an error. It
 * means this deployment has no public address for Google to call back — every
 * localhost dev box, and any preview without one. Nothing is broken and
 * nothing is lost: the sheet syncs on its timer instead. Painting that red
 * would teach people to ignore the one badge that is supposed to mean
 * something, so it reads as information and says what happens instead.
 *
 * Pure — no React, no antd, no dayjs — so the node suites can hold it to its
 * word without rendering anything.
 */

/** The `watch` field POST/PATCH /google and POST /google/provision return. */
export interface WatchReport {
  ok: boolean;
  /** already | registered | unreachable | ineligible | skipped | stopping | failed */
  reason: string;
  /** Already sanitised and written for a person (watchRefusalMessage in drive.ts). */
  detail?: string | null;
}

export type SyncTone = "success" | "info" | "warning";

export interface WatchNotice {
  tone: SyncTone;
  title: string;
  /** The second sentence: the detail the server wrote, plus what happens instead. */
  body: string | null;
}

/** How the sheet syncs when nothing is watching it — the sentence's tail. */
export interface TimerFallback {
  autoSync?: boolean | null;
  intervalMinutes?: number | null;
}

/**
 * "every 15 minutes" / "every hour" / "every day" — the interval as a person
 * would say it, so the fallback sentence never reads "every 1440 minutes".
 */
export function intervalPhrase(minutes: number | null | undefined): string {
  const m = typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 15;
  if (m % 1440 === 0) {
    const d = m / 1440;
    return d === 1 ? "every day" : `every ${d} days`;
  }
  if (m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? "every hour" : `every ${h} hours`;
  }
  return `every ${m} minutes`;
}

/** What still happens when the live channel is not running. Never "nothing". */
export function timerFallbackSentence(fallback: TimerFallback = {}): string {
  return fallback.autoSync === false
    ? "Automatic sync is off for this sheet, so it syncs when someone presses Sync now or a workflow step runs."
    : `This sheet syncs on its timer instead — ${intervalPhrase(fallback.intervalMinutes)}.`;
}

function join(detail: string | null | undefined, tail: string): string {
  const d = detail?.trim();
  return d ? `${d.replace(/\s+$/, "")} ${tail}` : tail;
}

/**
 * The `watch` field as a sentence to show after linking, provisioning or
 * saving sync settings. Returns null when there is nothing to report — an
 * older route answer with no `watch`, so the caller says nothing rather than
 * inventing a state.
 */
export function describeWatch(watch: WatchReport | null | undefined, fallback: TimerFallback = {}): WatchNotice | null {
  if (!watch || typeof watch.ok !== "boolean") return null;
  if (watch.ok) {
    return {
      tone: "success",
      title:
        watch.reason === "already"
          ? "Live sync is already on"
          : "Live sync is on — an edit in Google comes back within seconds",
      body: null,
    };
  }
  switch (watch.reason) {
    case "unreachable":
      // The normal case on a dev box and on any deployment without a public
      // webhook URL. Information, not a failure.
      return {
        tone: "info",
        title: "Live sync is off on this deployment",
        body: join(watch.detail ?? "Google has no public address to call back here.", timerFallbackSentence(fallback)),
      };
    case "ineligible":
      return {
        tone: "info",
        title: "Live sync doesn't apply to this sheet",
        body: join(watch.detail, timerFallbackSentence(fallback)),
      };
    case "stopping":
      return {
        tone: "info",
        title: "Live sync has been switched off for this sheet",
        body: join(watch.detail, timerFallbackSentence(fallback)),
      };
    case "skipped":
      return {
        tone: "info",
        title: "Live sync wasn't started this time",
        body: join(watch.detail, timerFallbackSentence(fallback)),
      };
    default:
      // "failed", and anything a later version of the route invents: Google was
      // asked and would not, which is worth a warning — but still not fatal.
      return {
        tone: "warning",
        title: "Live sync couldn't be started",
        body: join(watch.detail ?? "Google refused the watch channel.", timerFallbackSentence(fallback)),
      };
  }
}

/** What to say the moment a sheet has been created. */
export interface CreatedSheetNotice {
  tone: SyncTone;
  /** One line, ready for antd's `message[tone]` — title and body already joined. */
  text: string;
}

const CREATED = "Sheet created — its Google Sheet is ready.";

/**
 * The sentence for the end of the New sheet wizard.
 *
 * Creating a sheet is where MOST watches are born — POST /google registers the
 * Drive channel on the way — and it was the one place that threw the answer
 * away: the wizard said "its Google Sheet is ready" and nothing about whether
 * an edit made in Google would ever come back. That silence is exactly when
 * someone decides for themselves that the sync is live, and is then wrong for
 * a week.
 *
 * So the same `watch` the Google panel explains is said here, in the same
 * words (describeWatch), with the creation line in front of it. 'unreachable'
 * stays INFORMATION — a dev box or a deployment with no public URL is not a
 * failure, and painting it red would teach people to ignore the line.
 */
export function describeSheetCreated(args: {
  googleError?: string | null;
  watch?: WatchReport | null;
  fallback?: TimerFallback;
}): CreatedSheetNotice {
  if (args.googleError) {
    return {
      tone: "warning",
      text: `Sheet created, but its Google Sheet failed: ${args.googleError} Retry from the sheet's Google panel.`,
    };
  }
  const notice = describeWatch(args.watch, args.fallback);
  // No `watch` at all: an older route, or one that did not touch the channel.
  // Say what we know and invent nothing.
  if (!notice) return { tone: "success", text: CREATED };
  return {
    tone: notice.tone,
    text: notice.body ? `${CREATED} ${notice.title}. ${notice.body}` : `${CREATED} ${notice.title}.`,
  };
}

/** The columns of app_sheet_drive_channels a member needs to read the badge. */
export interface DriveChannelState {
  /** pending | active | failed | stopping | stopped | expired */
  status: string;
  last_error: string | null;
  expires_at?: string | null;
  last_notified_at?: string | null;
}

export interface LiveBadge {
  tone: SyncTone;
  /** Two words at most — it sits next to the sync status tag. */
  label: string;
  hint: string;
}

/**
 * The durable answer to "is this sheet live?", from the channel row itself.
 * No channel at all is the ordinary state on a deployment Google cannot reach,
 * so it is described by what DOES happen rather than by what is missing.
 */
export function describeLiveChannel(
  channel: DriveChannelState | null | undefined,
  fallback: TimerFallback = {},
): LiveBadge {
  if (!channel) {
    return {
      tone: "info",
      label: "Timer only",
      hint: `Nothing is watching the Google file, so an edit made there arrives on the next sync. ${timerFallbackSentence(fallback)}`,
    };
  }
  switch (channel.status) {
    case "active":
      return {
        tone: "success",
        label: "Live",
        hint: "Google tells Cubes the moment someone edits this file, and the sync runs straight away.",
      };
    case "pending":
      return {
        tone: "info",
        label: "Starting",
        hint: "The watch channel is registered with Google and is waiting for its first callback.",
      };
    case "failed":
      return {
        tone: "warning",
        label: "Not live",
        hint: join(channel.last_error ?? "Google refused the watch channel.", timerFallbackSentence(fallback)),
      };
    case "expired":
      return {
        tone: "info",
        label: "Renewing",
        hint: `The watch channel expired — Google's channels are short-lived — and the next scheduled pass registers a new one. ${timerFallbackSentence(fallback)}`,
      };
    case "stopping":
    case "stopped":
      return {
        tone: "info",
        label: "Switched off",
        hint: `Cubes has stopped watching this file. ${timerFallbackSentence(fallback)}`,
      };
    default:
      return {
        tone: "info",
        label: "Timer only",
        hint: timerFallbackSentence(fallback),
      };
  }
}
