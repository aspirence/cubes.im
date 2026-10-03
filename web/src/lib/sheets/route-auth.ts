import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { adminClient, authorizeTeamRequest, safeErrorText } from "@/lib/apps/auth";
import { GoogleSheetsError } from "@/lib/google/sheets-api";
import type { SheetRecordRow } from "./types";
import { loadSheet, makeCtx } from "./data";
import { AdapterError, type AdapterCtx } from "./adapters/types";

/**
 * Route plumbing for /api/sheets/[id]/**. The house order: the caller's cookie
 * session first (they must be able to see the sheet under RLS, be a member of
 * its team, and pass app_sheets_can_access as themselves), and only then the
 * service-role client — always scoped by the sheet's team as well as its id.
 * A sheet outside the caller's reach answers 404, never 403, so ids can't be
 * probed.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SheetAccess {
  userId: string;
  /** The caller's own RLS client. */
  supabase: SupabaseClient;
  admin: SupabaseClient;
  sheet: SheetRecordRow;
  isTeamAdmin: boolean;
  /**
   * A limited member: they see only the rows that are theirs, on every source,
   * and may not link, share or sync Google. What "theirs" means per source —
   * and which sources have no such notion and so show them nothing — is
   * adapters/limited.ts.
   */
  isLimited: boolean;
}

const notFound = () => NextResponse.json({ error: "Sheet not found." }, { status: 404 });

export async function authorizeSheet(
  sheetId: string,
): Promise<{ ok: true; access: SheetAccess } | { ok: false; response: NextResponse }> {
  if (!UUID_RE.test(sheetId)) return { ok: false, response: notFound() };

  const session = await createServerSupabase();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  // Read as the caller: RLS decides whether they can see the sheet at all.
  const { data: visible } = await (session as unknown as SupabaseClient)
    .from("app_sheets")
    .select("id, team_id")
    .eq("id", sheetId)
    .maybeSingle();
  const teamId = (visible as { team_id?: string } | null)?.team_id;
  if (!teamId) return { ok: false, response: notFound() };

  const auth = await authorizeTeamRequest(teamId, "member");
  if (!auth.ok) return { ok: false, response: auth.response };

  const { data: canAccess } = await auth.supabase.rpc("app_sheets_can_access", { p_sheet_id: sheetId });
  if (!canAccess) return { ok: false, response: notFound() };

  const admin = adminClient();
  if (!admin) {
    return { ok: false, response: NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 }) };
  }
  const sheet = await loadSheet(admin, teamId, sheetId);
  if (!sheet) return { ok: false, response: notFound() };

  const [{ data: isAdmin }, { data: isLimited }] = await Promise.all([
    auth.supabase.rpc("is_team_admin", { _team_id: teamId }),
    auth.supabase.rpc("is_limited_member", { _team_id: teamId }),
  ]);

  return {
    ok: true,
    access: {
      userId: auth.userId,
      supabase: auth.supabase,
      admin,
      sheet,
      isTeamAdmin: Boolean(isAdmin),
      isLimited: Boolean(isLimited),
    },
  };
}

/**
 * The adapter context for a person acting through a route.
 *
 * `limitToUserId` is set for a limited member on EVERY source, and every
 * adapter honours it — narrowing the rows where the source knows whose a row
 * is, and returning none where it cannot (adapters/limited.ts). It is the read
 * and the write rule both: the same test runs before an edit.
 */
export function ctxFor(access: SheetAccess, timeZone?: string | null): AdapterCtx {
  return makeCtx({
    admin: access.admin,
    sheet: access.sheet,
    actorUserId: access.userId,
    timeZone,
    limitToUserId: access.isLimited ? access.userId : null,
    actorIsTeamAdmin: access.isTeamAdmin,
    userClient: access.supabase,
  });
}

/** Errors → responses: a person's fixable mistake is a 4xx with its message;
 *  anything else is a 500 with sanitised text. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AdapterError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof GoogleSheetsError) {
    const status = err.kind === "access_lost" ? 409 : err.kind === "auth" ? 409 : err.kind === "bad_request" ? 400 : 502;
    return NextResponse.json({ error: err.message, reconnect: err.kind === "auth" }, { status });
  }
  return NextResponse.json({ error: safeErrorText(err, "Something went wrong.") }, { status: 500 });
}

/** Reads a JSON body, or null when there is none / it isn't JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function archivedResponse(): NextResponse {
  return NextResponse.json({ error: "This sheet is archived. Restore it to make changes." }, { status: 409 });
}
