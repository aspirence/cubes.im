import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleSheetsError } from "@/lib/google/sheets-api";
import { DriveClient, type DrivePermission } from "./drive-client";
import type { GoogleLinkRow, ShareCountsRow, SyncDirection } from "./types";

/**
 * Sheets — sharing a provisioned Google Sheet with the team.
 *
 * THIS IS WHAT MAKES REMOVING OUR GRID SURVIVABLE. The embedded sheet renders
 * with the viewer's own Google session, so a member who has not been granted
 * the file gets Google's "request access" page where their data should be. When
 * WE created the file the connected account owns it, and Drive will let us hand
 * it out — so we do, to every member who can already open the sheet in Cubes.
 *
 * Three rules this module will not bend:
 *
 *   1. NEVER "anyone with the link". These files carry client ad spend, task
 *      assignments and campaign notes. Every grant is to a named address.
 *   2. A member we cannot share with is REPORTED, not skipped. No Google
 *      address on file, or an address Google will not accept, is a thing the
 *      person looking at a blank frame needs told — silently omitting them is
 *      exactly the failure this whole feature exists to prevent.
 *   3. Limited members are excluded on purpose. A limited member sees only
 *      their own tasks in Cubes; the Google file has everybody's rows in it, so
 *      granting them the file would widen their access. They are listed as
 *      excluded with that reason rather than quietly dropped.
 *
 * We never revoke. A file the team has been using may have been shared by hand
 * with a client or an accountant, and a sync pass that tidies permissions would
 * cut them off with no warning. Members who leave are handled by the person who
 * owns the file, in Drive.
 */

/** One row of app_sheets_share_targets. The name/email columns are spelled
 *  member_* there so the function's output parameters cannot collide with
 *  users.name / users.email — see the migration's note. */
export interface ShareTarget {
  user_id: string;
  member_name: string | null;
  member_email: string | null;
  is_limited: boolean;
}

export type ShareRole = "writer" | "reader";

export interface ShareGrant {
  /** The member this address belongs to. The pass records what Drive did per
   *  member (app_sheet_share_grants), and the card's Access row reads that
   *  record — so the grant has to remember whose it is. */
  userId: string;
  email: string;
  role: ShareRole;
  name: string | null;
}

export type ShareSkipReason = "no_email" | "limited" | "owner";

export interface ShareSkip {
  /** Display name, or the user id when even that is missing. Never an email:
   *  this ends up in a member-readable column. */
  who: string;
  reason: ShareSkipReason;
}

export interface SharePlan {
  grants: ShareGrant[];
  skipped: ShareSkip[];
}

/** Very loose on purpose — Drive is the real judge of an address. This only
 *  keeps obvious non-addresses out of a request that would 400 anyway. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * Who should be able to open this sheet's Google file, and as what. Pure, so
 * the rule can be tested without Drive, a database or a Google account.
 *
 * Role follows the sync direction rather than the Cubes permission, because on
 * a Google file "can edit" has to mean "your edit reaches Cubes":
 *   - 'both' / 'pull' — a Google edit comes back, so members get writer.
 *   - 'push' — Cubes is the only source of change and anything typed in Google
 *     is overwritten on the next run. Writer there is a trap, so: reader.
 */
export function planShares(
  targets: ShareTarget[],
  opts: { direction: SyncDirection; ownerEmail: string | null },
): SharePlan {
  const role: ShareRole = opts.direction === "push" ? "reader" : "writer";
  const owner = opts.ownerEmail?.trim().toLowerCase() ?? null;
  const grants: ShareGrant[] = [];
  const skipped: ShareSkip[] = [];
  const seen = new Set<string>();

  for (const t of targets) {
    const who = t.member_name?.trim() || "A workspace member";
    if (t.is_limited) {
      skipped.push({ who, reason: "limited" });
      continue;
    }
    const email = t.member_email?.trim().toLowerCase() ?? "";
    if (!email || !looksLikeEmail(email)) {
      skipped.push({ who, reason: "no_email" });
      continue;
    }
    // The account that owns the file already has everything, and Drive rejects
    // a permission that would change the owner's own role.
    if (owner && email === owner) {
      skipped.push({ who, reason: "owner" });
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    grants.push({ userId: t.user_id, email, role, name: t.member_name?.trim() || null });
  }
  return { grants, skipped };
}

/** What a plan turns into once Drive's current permissions are known. */
export interface ShareAction {
  email: string;
  role: ShareRole;
  /** "grant" — no permission yet. "promote" — has one, wrong role. */
  kind: "grant" | "promote";
  permissionId?: string;
}

/**
 * The plan minus what Drive already has. Pure and separate from the calls, so
 * the "nothing to do" case — by far the common one, since sharing runs again
 * on every provision and whenever a member joins — costs no writes at all.
 *
 * A grant that is already WIDER than planned is left alone: someone gave that
 * person writer by hand, and this pass is not the place to take it away.
 */
export function shareActions(plan: SharePlan, existing: DrivePermission[]): ShareAction[] {
  const byEmail = new Map<string, DrivePermission>();
  for (const p of existing) {
    if (p.type !== "user" || !p.emailAddress) continue;
    byEmail.set(p.emailAddress.trim().toLowerCase(), p);
  }
  const out: ShareAction[] = [];
  for (const g of plan.grants) {
    const have = byEmail.get(g.email);
    if (!have) {
      out.push({ email: g.email, role: g.role, kind: "grant" });
      continue;
    }
    const isOwnerOrWider = have.role === "owner" || have.role === "organizer" || have.role === "fileOrganizer";
    if (isOwnerOrWider) continue;
    if (g.role === "writer" && have.role !== "writer") {
      out.push({ email: g.email, role: "writer", kind: "promote", permissionId: have.id });
    }
    // g.role === "reader" and they hold writer: leave it. See the note above.
  }
  return out;
}

/** Exactly what lands in app_sheet_google_links.share_counts — names only, no
 *  email addresses, because that column is workspace-member readable. */
export type ShareCounts = ShareCountsRow;

/**
 * What Drive did for one member in a pass (app_sheet_share_grants.outcome).
 *   held      Drive already listed them with at least the planned role
 *   granted   this pass created their permission
 *   promoted  this pass raised reader to writer
 *   refused   Drive refused the grant or the promotion
 */
export type ShareRecordOutcome = "held" | "granted" | "promoted" | "refused";

export interface SharePerson {
  userId: string;
  /** The address Drive was given. Only its fingerprint is stored. */
  email: string;
  outcome: ShareRecordOutcome;
}

export interface ShareOutcome {
  status: "ok" | "partial" | "failed";
  counts: ShareCounts;
  /** Sanitised, <= 1000 chars, safe for app_sheet_google_links.share_error. */
  error: string | null;
}

/** The team members a sheet's file should reach, straight from the database's
 *  own copy of the sheet's access rule. */
export async function loadShareTargets(admin: SupabaseClient, sheetId: string): Promise<ShareTarget[]> {
  const { data, error } = await admin.rpc("app_sheets_share_targets", { p_sheet_id: sheetId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ShareTarget[];
}

function summarise(counts: ShareCounts, failures: string[]): ShareOutcome {
  const status: ShareOutcome["status"] =
    counts.failed > 0 || counts.left_out.length > 0 ? (counts.granted + counts.promoted + counts.unchanged > 0 ? "partial" : "failed") : "ok";
  const parts: string[] = [];
  if (counts.left_out.length > 0) {
    parts.push(
      `No Google address on file for ${counts.left_out.slice(0, 5).join(", ")}${counts.left_out.length > 5 ? ` and ${counts.left_out.length - 5} more` : ""} — they will see Google's access screen.`,
    );
  }
  if (failures.length > 0) parts.push(`Google refused ${failures.length} of the invitations: ${failures[0]}`);
  return { status, counts, error: parts.length ? parts.join(" ").slice(0, 1000) : null };
}

/**
 * Brings the file's Drive permissions up to date with the team, and records the
 * outcome on the link row.
 *
 * Only ever called for a file Cubes created (`owned_by_us`). On a file the user
 * picked from their own Drive we are a guest, Drive answers 403 to every
 * permission write, and the right answer is the one the UI already gives: that
 * sheet's owner shares it themselves.
 *
 * Never throws for a sharing failure. Sharing runs inside provisioning and
 * inside "a member joined"; neither of those should fail because one address
 * was not a Google account.
 */
export async function syncSheetShares(
  admin: SupabaseClient,
  link: Pick<GoogleLinkRow, "id" | "sheet_id" | "team_id" | "connection_id" | "spreadsheet_id" | "direction"> & {
    owned_by_us?: boolean;
    owner_email?: string | null;
  },
): Promise<ShareOutcome> {
  const counts: ShareCounts = { granted: 0, promoted: 0, unchanged: 0, failed: 0, left_out: [], limited: 0 };

  if (!link.owned_by_us || !link.spreadsheet_id || !link.connection_id) {
    const outcome: ShareOutcome = {
      status: "failed",
      counts,
      error: "This Google Sheet was not created by Cubes, so Cubes cannot share it. Its owner can share it from Google Drive.",
    };
    // No per-person record: nothing was attempted, and the access list shows
    // only the owner of a file Cubes did not create anyway.
    await recordShare(admin, link.id, outcome, null);
    return outcome;
  }

  let outcome: ShareOutcome;
  // Who this pass can vouch for, person by person. Anyone missing from it —
  // limited, addressless, the owner, or skipped because the pass was cut
  // short — is someone the access list must not call a holder.
  const people: SharePerson[] = [];
  try {
    const targets = await loadShareTargets(admin, link.sheet_id);
    const plan = planShares(targets, { direction: link.direction, ownerEmail: link.owner_email ?? null });
    counts.limited = plan.skipped.filter((s) => s.reason === "limited").length;
    counts.left_out = plan.skipped.filter((s) => s.reason === "no_email").map((s) => s.who);

    const drive = new DriveClient(admin, link.connection_id);
    const existing = await drive.listPermissions(link.spreadsheet_id);
    const actions = shareActions(plan, existing);
    counts.unchanged = plan.grants.length - actions.length;

    // A planned grant with no action is one Drive already satisfies — it was
    // in the permission list we just read.
    const acting = new Set(actions.map((a) => a.email));
    const grantFor = new Map(plan.grants.map((g) => [g.email, g]));
    for (const g of plan.grants) {
      if (!acting.has(g.email)) people.push({ userId: g.userId, email: g.email, outcome: "held" });
    }

    const failures: string[] = [];
    for (const action of actions) {
      const grant = grantFor.get(action.email);
      try {
        if (action.kind === "grant") {
          await drive.grant(link.spreadsheet_id, action.email, action.role);
          counts.granted++;
          if (grant) people.push({ userId: grant.userId, email: grant.email, outcome: "granted" });
        } else if (action.permissionId) {
          await drive.setRole(link.spreadsheet_id, action.permissionId, action.role);
          counts.promoted++;
          if (grant) people.push({ userId: grant.userId, email: grant.email, outcome: "promoted" });
        }
      } catch (err) {
        // One bad address must not cost the rest of the team their access. The
        // commonest cause by far is an address that is not a Google account,
        // which Drive rejects outright when we suppress the invitation email.
        counts.failed++;
        if (failures.length < 3) failures.push(reasonFor(err));
        // Losing access to the file itself, or to Google, is not per-address —
        // every remaining call would fail the same way. It is not a refusal of
        // THIS person either, so they are left unrecorded (not yet shared)
        // rather than told Google refused their address.
        if (err instanceof GoogleSheetsError && (err.kind === "access_lost" || err.kind === "auth")) {
          failures.push(err.message);
          break;
        }
        if (grant) people.push({ userId: grant.userId, email: grant.email, outcome: "refused" });
      }
    }
    outcome = summarise(counts, failures);
  } catch (err) {
    // Drive's permission list could not be read, so this pass confirms nobody:
    // an empty record, which the access list reads as "nobody has it yet".
    people.length = 0;
    outcome = {
      status: "failed",
      counts,
      error: (err instanceof GoogleSheetsError ? err.message : "Could not read who this Google Sheet is shared with.").slice(0, 1000),
    };
  }

  await recordShare(admin, link.id, outcome, people);
  return outcome;
}

/** A per-address failure, reduced to something a member can act on. */
function reasonFor(err: unknown): string {
  if (!(err instanceof GoogleSheetsError)) return "Google refused the invitation.";
  if (/invalidSharingRequest|cannotShareToNonGoogleAccount|notFound/i.test(err.message)) {
    return "that address is not a Google account";
  }
  return err.message.slice(0, 200);
}

/**
 * Fingerprint of the address Drive was given, for app_sheet_share_grants.
 * Must match the access list's encode(sha256(convert_to(email, 'UTF8')), 'hex')
 * over the same lower-cased address; any drift between the two can only make
 * a person look unshared, never shared.
 */
function addressFingerprint(email: string): string {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

/**
 * Records the pass on the link, and — when `people` is given — who it gave the
 * file to (app_sheet_share_grants), which is what the sheet list's Access row
 * reads. `null` means "no per-person pass happened" (a file Cubes did not
 * create).
 *
 * Both writes carry the SAME instant: the access list trusts a grant row only
 * when its shared_at equals the link's. The rows go first and the link's
 * share_counts gets `per_person: true` only if they landed, so every partial
 * failure — the rows fail, the link update fails, two passes interleave, the
 * table is not deployed yet — leaves people looking unshared rather than
 * shared.
 */
async function recordShare(admin: SupabaseClient, linkId: string, outcome: ShareOutcome, people: SharePerson[] | null): Promise<void> {
  const at = new Date().toISOString();
  const perPerson = people ? await recordPeople(admin, linkId, people, at) : false;
  await admin
    .from("app_sheet_google_links")
    .update({
      share_status: outcome.status,
      share_error: outcome.error,
      share_counts: perPerson ? { ...outcome.counts, per_person: true } : outcome.counts,
      shared_at: at,
    })
    .eq("id", linkId);
}

/** Writes this pass's per-person outcome. True only when the record is whole. */
async function recordPeople(admin: SupabaseClient, linkId: string, people: SharePerson[], at: string): Promise<boolean> {
  if (people.length > 0) {
    const rows = people.map((p) => ({
      link_id: linkId,
      user_id: p.userId,
      outcome: p.outcome,
      address_sha256: addressFingerprint(p.email),
      shared_at: at,
    }));
    const { error } = await admin.from("app_sheet_share_grants").upsert(rows, { onConflict: "link_id,user_id" });
    if (error) return false;
  }
  // Rows from earlier passes are already ignored (their shared_at differs);
  // clearing them keeps the table at one pass per link. It also has to
  // succeed when this pass recorded nobody, because that is what proves the
  // table exists before the link is marked per_person.
  const { error } = await admin.from("app_sheet_share_grants").delete().eq("link_id", linkId).neq("shared_at", at);
  return !error;
}

/**
 * Re-shares every provisioned sheet a person can now see — what "re-share when
 * a member joins" means in practice.
 *
 * Scoped by team and bounded, because it is reachable from a route: a big
 * workspace should not be able to turn one click into hundreds of Drive calls.
 * Sheets whose file we do not own are skipped without a Drive call at all.
 */
export async function reshareTeamSheets(admin: SupabaseClient, teamId: string, limit = 25): Promise<{ sheets: number; shared: number }> {
  const { data, error } = await admin
    .from("app_sheet_google_links")
    .select("id, sheet_id, team_id, connection_id, spreadsheet_id, direction, owned_by_us, owner_email")
    .eq("team_id", teamId)
    .eq("provision_status", "ready")
    .eq("owned_by_us", true)
    .limit(limit);
  if (error) throw new Error(error.message);
  const links = (data ?? []) as Parameters<typeof syncSheetShares>[1][];
  let shared = 0;
  for (const link of links) {
    const out = await syncSheetShares(admin, link);
    if (out.status !== "failed") shared++;
  }
  return { sheets: links.length, shared };
}
