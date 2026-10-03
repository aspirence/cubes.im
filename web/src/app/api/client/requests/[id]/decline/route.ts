import { NextResponse } from "next/server";
import { adminClient, authorizeTeamRequest } from "@/lib/apps/auth";
import { UUID_RE, readJson } from "@/lib/client-portal/http";

/**
 * Decline a client request, with a reason.
 *
 * The reason is required: "no" without one is exactly what sends the client
 * back to WhatsApp to ask why, which is the loop this app exists to close.
 */

export const runtime = "nodejs";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const body = await readJson<{ note?: unknown }>(request);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!note) {
    return NextResponse.json(
      { error: "Say why — the client sees this." },
      { status: 400 },
    );
  }

  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "Not configured." }, { status: 500 });

  const { data: req } = await admin
    .from("app_client_requests")
    .select("id, team_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Request not found." }, { status: 404 });

  const auth = await authorizeTeamRequest(req.team_id as string, "member");
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase.rpc("client_decline_request", {
    p_request_id: id,
    p_note: note,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const result = data as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) {
    return NextResponse.json(
      { error: result?.reason ?? "Could not decline." },
      { status: result?.reason === "already_decided" ? 409 : 404 },
    );
  }
  return NextResponse.json({ ok: true, requestId: id, status: "declined" });
}
