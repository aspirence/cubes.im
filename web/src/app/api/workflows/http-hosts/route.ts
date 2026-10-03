import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeTeamRequest } from "@/lib/apps/auth";
import { normalizeHost, normalizeNote, type HttpHostRow } from "./host-rules";

/**
 * The team's HTTP allowlist: the hosts a workflow's http step is permitted to
 * call (src/lib/workflows/http-step.ts, guard 2). Without a row here every
 * http step fails, so this route is the only thing that makes that step — and
 * with it every integration we will never write a connector for — usable.
 *
 *   GET    ?team_id=…            list the hosts           (team member)
 *   POST   { team_id, host, note } add one                (team ADMIN)
 *   DELETE ?team_id=…&host=…     remove one               (team ADMIN)
 *
 * Authority is deliberately the same shape as the table's own policies
 * (migration 20261132000000:1254-1258): select for members, writes for admins.
 * The session is checked first and then every query runs through the caller's
 * OWN RLS-scoped client, never service_role — so this route cannot widen the
 * policy even by accident, and the database has the last word.
 *
 * This is an SSRF control, so what goes in is normalised and narrowed by
 * ./host-rules rather than trusted: see the reasoning there.
 */

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres unique_violation — the host is already on this team's list. */
const UNIQUE_VIOLATION = "23505";

function badTeam(): NextResponse {
  return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
}

/**
 * Names for the "added by" column. A failure here is cosmetic — the list is
 * what matters — so it degrades to no names rather than failing the request.
 */
async function namesFor(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("users").select("id, name").in("id", ids);
  return new Map(((data ?? []) as { id: string; name: string | null }[]).map((u) => [u.id, u.name ?? ""]));
}

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("team_id") ?? "";
  if (!UUID.test(teamId)) return badTeam();

  const auth = await authorizeTeamRequest(teamId, "member");
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("team_http_allowlist")
    .select("host, note, created_at, created_by")
    .eq("team_id", teamId)
    .order("host", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Omit<HttpHostRow, "created_by_name">[];
  const names = await namesFor(auth.supabase, [
    ...new Set(rows.map((r) => r.created_by).filter((id): id is string => Boolean(id))),
  ]);

  return NextResponse.json({
    hosts: rows.map<HttpHostRow>((row) => ({
      ...row,
      created_by_name: (row.created_by && names.get(row.created_by)) || null,
    })),
  });
}

export async function POST(request: NextRequest) {
  let body: { team_id?: unknown; host?: unknown; note?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const teamId = typeof body.team_id === "string" ? body.team_id : "";
  if (!UUID.test(teamId)) return badTeam();

  const auth = await authorizeTeamRequest(
    teamId,
    "admin",
    "Only workspace admins can change the allowed hosts.",
  );
  if (!auth.ok) return auth.response;

  const host = normalizeHost(typeof body.host === "string" ? body.host : "");
  if (!host.ok) return NextResponse.json({ error: host.error }, { status: 400 });
  const note = normalizeNote(body.note);
  if (!note.ok) return NextResponse.json({ error: note.error }, { status: 400 });

  const { error } = await auth.supabase.from("team_http_allowlist").insert({
    team_id: teamId,
    host: host.host,
    note: note.note,
    created_by: auth.userId,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        { error: `${host.host} is already on the allowed hosts.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The normalised host goes back so the caller can show what was really
  // stored — "acme.com" when they typed "https://API.Acme.com:443/v1".
  return NextResponse.json({ host: host.host }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const teamId = params.get("team_id") ?? "";
  if (!UUID.test(teamId)) return badTeam();

  const auth = await authorizeTeamRequest(
    teamId,
    "admin",
    "Only workspace admins can change the allowed hosts.",
  );
  if (!auth.ok) return auth.response;

  // Matched as stored, not re-normalised: a row written before a rule changed
  // must still be removable.
  const host = (params.get("host") ?? "").trim().toLowerCase();
  if (!host) return NextResponse.json({ error: "Which host?" }, { status: 400 });

  const { error } = await auth.supabase
    .from("team_http_allowlist")
    .delete()
    .eq("team_id", teamId)
    .eq("host", host);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ removed: host });
}
