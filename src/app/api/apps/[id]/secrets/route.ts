import { NextResponse } from "next/server";
import { authorizeConnectionAdmin, serviceClient } from "@/lib/apps/server";

/**
 * Upserts a connection's credentials (org admin only). Credentials live in the
 * service-role-only app_connection_secrets table and are write-only from the
 * UI: the client sends only the fields the user typed, and blank string values
 * are treated as "unchanged" (merged over the existing secret) so editing one
 * field never wipes the others.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const auth = await authorizeConnectionAdmin(id);
  if (!auth.ok) return auth.response;

  let body: { credentials?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const incoming = body.credentials;
  if (
    incoming === null ||
    typeof incoming !== "object" ||
    Array.isArray(incoming)
  ) {
    return NextResponse.json(
      { error: "A credentials object is required." },
      { status: 400 },
    );
  }

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Secrets storage is not configured." },
      { status: 500 },
    );
  }

  const { data: existingRow } = await admin
    .from("app_connection_secrets")
    .select("credentials")
    .eq("connection_id", id)
    .maybeSingle();
  const existing =
    (existingRow?.credentials as Record<string, unknown> | undefined) ?? {};

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(
    incoming as Record<string, unknown>,
  )) {
    // Blank strings mean "leave unchanged" (write-only placeholder UX). Store
    // the trimmed value so stray whitespace never corrupts a URL/token.
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") merged[key] = trimmed;
    } else if (value != null) {
      merged[key] = value;
    }
  }

  const { error } = await admin.from("app_connection_secrets").upsert(
    {
      connection_id: id,
      credentials: merged as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
