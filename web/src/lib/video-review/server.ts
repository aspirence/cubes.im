import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

/**
 * Authorisation for the Video Review server routes.
 *
 * Every check here runs through the caller's COOKIE session, never the service
 * role, so the answer is whatever RLS already says: a revision belongs to a
 * video, a video is visible to its team (and, for a project-scoped video, only
 * to members who can see that private project — video_review_can_access,
 * 20261021000000). Re-deriving that logic in TypeScript would mean two places to
 * get "who may watch this" right, and one of them would drift.
 *
 * Not found and not allowed answer the same 404 on purpose: a 403 would confirm
 * that a video with that id exists in someone else's workspace.
 */

/** A revision row plus the parent video's team, which the Drive paths need. */
export interface AuthorizedRevision {
  userId: string;
  teamId: string;
  videoId: string;
  revision: number;
  row: Record<string, unknown>;
}

export type RevisionAuth =
  | { ok: true; value: AuthorizedRevision }
  | { ok: false; response: NextResponse };

/**
 * Resolves `videoId` + an optional `?rev=` to one revision the caller may see.
 *
 * With no `rev`, the video's latest is used — the same default the share route
 * has always applied, so a bare stream URL keeps meaning "the current cut".
 */
export async function authorizeRevision(
  videoId: string,
  revParam: string | null,
): Promise<RevisionAuth> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // The Drive columns are newer than the generated database types, so this one
  // query is made through a loosely typed client.
  const db = supabase as unknown as SupabaseClient;

  const { data: video } = await db
    .from("app_video_review_videos")
    .select("id, team_id, latest_revision, deleted")
    .eq("id", videoId)
    .maybeSingle();
  if (!video || video.deleted) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const parsed = revParam === null ? NaN : Number(revParam);
  const revision = Number.isFinite(parsed) ? parsed : (video.latest_revision as number);

  const { data: row } = await db
    .from("app_video_review_revisions")
    .select("*")
    .eq("video_id", videoId)
    .eq("revision", revision)
    .maybeSingle();
  if (!row) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  return {
    ok: true,
    value: {
      userId: user.id,
      teamId: video.team_id as string,
      videoId,
      revision,
      row: row as Record<string, unknown>,
    },
  };
}

export type ConnectionAuth =
  | { ok: true; connectionId: string; teamId: string }
  | { ok: false; response: NextResponse };

/**
 * Authorises the caller against a Google connection they named by id.
 *
 * The browse routes take a connection id straight from the query string, so the
 * team is derived FROM the connection and the caller is then checked against
 * that team. Taking a teamId from the caller as well would let the two disagree,
 * and the check would be verifying a claim rather than a fact.
 *
 * Member-level, not admin: connecting Google is an admin act, but browsing the
 * folders it can already see is ordinary review work, and the editor who pastes
 * the folder link is usually not an admin.
 */
export async function authorizeConnection(connectionId: string): Promise<ConnectionAuth> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // RLS on app_google_connections is already team-scoped for select, so a
  // connection belonging to another workspace simply is not there.
  const { data: connection } = await supabase
    .from("app_google_connections")
    .select("id, team_id, enabled, revoked_at")
    .eq("id", connectionId)
    .maybeSingle();

  if (!connection) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  if (connection.revoked_at || !connection.enabled) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Google access was revoked for this workspace. Reconnect it to browse Drive.",
          reconnect: true,
        },
        { status: 409 },
      ),
    };
  }

  return { ok: true, connectionId: connection.id, teamId: connection.team_id };
}
