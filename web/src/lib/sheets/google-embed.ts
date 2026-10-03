/**
 * Sheets — the Google side of a sheet as URLs and defaults. Pure: no imports
 * beyond types, so the client component that renders the iframe, the server
 * that provisions the file and the node tests all agree on one spelling.
 *
 * WHY THE SHEET IS AN IFRAME NOW
 * The sheet view used to render our own grid over the sheet's rows. It is the
 * live Google Sheet instead: formulas, filters, freeze panes, conditional
 * formatting, comments and everyone's cursors — all of it, without us
 * reimplementing any of it. The embed is Google's own editor chrome-stripped
 * (`rm=embedded&widget=true&headers=false`), and Google does not send
 * X-Frame-Options or frame-ancestors on docs.google.com, so it frames.
 *
 * THE CONSEQUENCE, STATED PLAINLY
 * The frame loads with the VIEWER'S own Google session, not with our OAuth
 * token. A member whose Google account has not been granted the file sees
 * Google's "You need access" page inside our layout, and we cannot detect that
 * from outside the frame — it is cross-origin, so no load event, no readable
 * document, nothing. That is why nothing here pretends to probe the frame, why
 * every embed carries a visible line of prose saying what it is, and why
 * provisioning shares the file with the team (google-share.ts).
 */

import type { ConflictPolicy, DeletePolicy, SheetSource, SyncDirection } from "./types";

/** Google file ids are unpadded base64url; anything else never came from Google. */
const SPREADSHEET_ID_RE = /^[A-Za-z0-9_-]{20,200}$/;

const DOCS_BASE = "https://docs.google.com/spreadsheets/d";

/** The part of a link row any URL here needs. */
export interface EmbedTarget {
  spreadsheet_id: string | null;
  spreadsheet_url?: string | null;
  sheet_gid?: number | null;
}

function gidFragment(gid: number | null | undefined): string {
  return typeof gid === "number" && Number.isInteger(gid) && gid >= 0 ? `#gid=${gid}` : "";
}

/**
 * The full Google Sheets URL — the "Open in Google Sheets" escape hatch, and
 * what a person should paste to a colleague.
 *
 * Google's own `spreadsheetUrl` is preferred when we have it (it is whatever
 * Google considers canonical today), but it carries no tab, so the gid is
 * appended unless it already has one.
 */
export function spreadsheetHref(link: EmbedTarget): string | null {
  const gid = gidFragment(link.sheet_gid);
  const url = link.spreadsheet_url?.trim();
  if (url && url.startsWith(`${DOCS_BASE}/`)) return url.includes("#gid=") ? url : url + gid;
  if (!link.spreadsheet_id || !SPREADSHEET_ID_RE.test(link.spreadsheet_id)) return null;
  return `${DOCS_BASE}/${link.spreadsheet_id}/edit${gid}`;
}

/**
 * The src of the embedded editor.
 *
 *   rm=embedded    drop the Docs app bar and the file menu strip
 *   widget=true    keep the sheet-tab strip at the bottom (people expect it)
 *   headers=false  no title bar inside the frame — ours is right above it
 *
 * Built from the id rather than from spreadsheet_url, because that URL may
 * already carry query parameters of Google's own and appending to it is how you
 * get `?usp=drivesdk&rm=embedded` and a frame that ignores half of them. Returns
 * null for a link with no (or a malformed) id: the caller must then show the
 * "not provisioned yet" state rather than an iframe pointed at nothing.
 */
export function sheetEmbedUrl(link: EmbedTarget): string | null {
  if (!link.spreadsheet_id || !SPREADSHEET_ID_RE.test(link.spreadsheet_id)) return null;
  return `${DOCS_BASE}/${link.spreadsheet_id}/edit?rm=embedded&widget=true&headers=false${gidFragment(link.sheet_gid)}`;
}

/**
 * The line that sits under the frame on every sheet, always visible.
 *
 * It is not an error state and it is not conditional — we genuinely cannot tell
 * whether the reader is looking at their spreadsheet or at Google's access
 * wall, so the honest thing is to describe both and name who can fix the second
 * one. `owner` is the Google account that owns the file; when the file was
 * picked from someone's Drive rather than created by us, we may not know it.
 */
export function embedAccessNote(owner: string | null | undefined): string {
  const who = owner?.trim() ? owner.trim() : "whoever owns the file in Google Drive";
  return `This is the live Google Sheet. If Google asks for access, ask ${who} to share it with your Google account.`;
}

export interface GoogleDefaults {
  direction: SyncDirection;
  conflictPolicy: ConflictPolicy;
  deletePolicy: DeletePolicy;
  autoSync: boolean;
  intervalMinutes: number;
}

/**
 * How a newly provisioned sheet syncs, per source.
 *
 * Every source is TWO-WAY, including the ones backed by Cubes data. That is
 * deliberate and it is not the same as "Google is the truth": on a bound sheet
 * the user's OWN columns (a note, a target, an owner) live next to the app's
 * fields, and those columns are exactly what someone opens the Google Sheet to
 * fill in. A push-only link would drop them on the floor every run.
 *
 * What makes a Cubes-backed sheet push-DOMINANT is the pair below it:
 *   - conflict 'cubes' — when the same cell moved on both sides since the last
 *     sync, the record wins. A task's status is the task's status.
 *   - the engine's own column rule (columnWritable, sources.ts writable:false).
 *     Meta metrics and derived fields reject a Google edit outright and count
 *     it as skipped, whatever the direction says.
 * 'custom' has no record behind it, so neither applies: newest edit wins.
 *
 * Deletes stay 'keep' everywhere. Provisioning happens without anyone asking
 * for it, and a setting that can delete records must be chosen, not defaulted.
 */
export function defaultGoogleSettings(source: SheetSource): GoogleDefaults {
  const cubesBacked = source !== "custom";
  return {
    direction: "both",
    conflictPolicy: cubesBacked ? "cubes" : "newest",
    deletePolicy: "keep",
    autoSync: true,
    // Drive push notifications (20261142000000_drive_watch_channels) make this
    // the backstop rather than the mechanism, so it can be generous.
    intervalMinutes: 15,
  };
}
