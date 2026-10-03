import { NextResponse, type NextRequest } from "next/server";
import { loadShareTargets, planShares, reshareTeamSheets, syncSheetShares } from "@/lib/sheets/google-share";
import type { GoogleLinkRow } from "@/lib/sheets/types";
import { authorizeSheet, errorResponse, readJson, type SheetAccess } from "@/lib/sheets/route-auth";

export const runtime = "nodejs";

/**
 * Who can open this sheet's Google Sheet.
 *
 *   GET  → { plan: { grants: [{ name, role }], skipped: [{ who, reason }] },
 *            ownerEmail, ownedByUs, shareStatus, shareError, sharedAt }
 *   POST → { status, counts, error }  — re-runs the Drive permissions pass.
 *   POST { scope: "team" } → { scope, sheets, shared }  — the same pass over
 *          every Cubes-owned sheet in the workspace. Admin only.
 *
 * GET deliberately returns NAMES and roles, not the email addresses Drive was
 * given. The panel's job is to answer "will my colleague see this, and if not
 * why not" — it does not need to publish everyone's address to every member to
 * do that, and app_sheet_google_links is read by the whole workspace.
 *
 * POST is the "re-share" control, and is what a member joining the workspace
 * eventually runs through. It is safe to press repeatedly: the pass diffs
 * against Drive's current permissions and does nothing when they already match.
 */

function linkOf(access: SheetAccess) {
  return access.admin
    .from("app_sheet_google_links")
    .select("*")
    .eq("sheet_id", access.sheet.id)
    .eq("team_id", access.sheet.team_id)
    .maybeSingle();
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const { access } = auth;

  const { data } = await linkOf(access);
  const link = (data as GoogleLinkRow | null) ?? null;
  if (!link || link.provision_status !== "ready") {
    return NextResponse.json({ plan: null, ownedByUs: false, ownerEmail: null });
  }

  try {
    const targets = await loadShareTargets(access.admin, access.sheet.id);
    const plan = planShares(targets, { direction: link.direction, ownerEmail: link.owner_email });
    return NextResponse.json({
      plan: {
        grants: plan.grants.map((g) => ({ name: g.name ?? "A workspace member", role: g.role })),
        skipped: plan.skipped,
      },
      ownedByUs: link.owned_by_us,
      ownerEmail: link.owner_email,
      shareStatus: link.share_status,
      shareError: link.share_error,
      sharedAt: link.shared_at,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeSheet(id);
  if (!auth.ok) return auth.response;
  const { access } = auth;
  if (access.isLimited) {
    return NextResponse.json({ error: "Limited members can't change who a Google Sheet is shared with." }, { status: 403 });
  }

  // scope "team": every Cubes-owned sheet in this workspace, which is what
  // someone wants right after adding a person — they joined once, not once per
  // sheet. Bounded server-side so one click cannot become hundreds of Drive
  // calls, and admin-only because it touches sheets the caller may not have
  // opened.
  const body = (await readJson(request)) ?? {};
  if (body.scope === "team") {
    if (!access.isTeamAdmin) {
      return NextResponse.json({ error: "Only a workspace admin can re-share every sheet." }, { status: 403 });
    }
    try {
      const out = await reshareTeamSheets(access.admin, access.sheet.team_id);
      return NextResponse.json({ scope: "team", ...out });
    } catch (err) {
      return errorResponse(err);
    }
  }

  const { data } = await linkOf(access);
  const link = (data as GoogleLinkRow | null) ?? null;
  if (!link || link.provision_status !== "ready") {
    return NextResponse.json({ error: "This sheet doesn't have a Google Sheet yet." }, { status: 409 });
  }
  if (!link.owned_by_us) {
    return NextResponse.json(
      {
        error:
          "This Google Sheet belongs to someone's own Drive, not to Cubes, so Cubes can't share it. Its owner can share it from Google Drive.",
      },
      { status: 409 },
    );
  }

  try {
    const out = await syncSheetShares(access.admin, link);
    return NextResponse.json({ status: out.status, counts: out.counts, error: out.error });
  } catch (err) {
    return errorResponse(err);
  }
}
