import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  TOOL_DEFINITIONS,
  callTool,
  McpToolError,
  type McpContext,
} from "@/lib/mcp/tools";

/**
 * Cubes MCP server — Streamable HTTP transport (stateless).
 *
 * External AI clients (Claude Code, Claude Desktop, claude.ai via mcp-remote)
 * connect with `Authorization: Bearer cubes_mcp_…` — a personal access token
 * minted in the App Center → MCP app, bound to one workspace. Every request:
 *   1. hashes the bearer token and looks it up in mcp_tokens (service role);
 *   2. builds an McpContext { teamId, userId } that scopes every tool call;
 *   3. answers the JSON-RPC message (initialize / tools/list / tools/call).
 *
 * Stateless by design: no session ids, no SSE stream — each POST returns a
 * single JSON response, which the Streamable HTTP spec permits.
 */

export const runtime = "nodejs";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "cubes", version: "1.0.0" };
const INSTRUCTIONS =
  "Cubes project-management workspace. Tools are scoped to the single workspace the token was created for. Use list_projects/list_tasks to orient, create_task/update_task/complete_task to act, and add_comment to leave updates. Dates are YYYY-MM-DD.";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
};

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

interface AuthOk {
  ctx: McpContext;
  tokenId: string;
}

/** Verifies the bearer token; returns a scoped context or an error response. */
async function authenticate(req: NextRequest): Promise<AuthOk | NextResponse> {
  const unauthorized = (detail: string) =>
    new NextResponse(JSON.stringify({ error: detail }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="cubes-mcp"',
      },
    });

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized("Missing bearer token. Install the MCP app in Cubes and create a token.");
  const token = match[1].trim();
  if (!token.startsWith("cubes_mcp_")) return unauthorized("Invalid token format.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRoleKey) {
    return new NextResponse(
      JSON.stringify({ error: "MCP server is not configured." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  const admin = createSupabaseAdmin<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const hash = createHash("sha256").update(token).digest("hex");
  const { data: row, error } = await admin
    .from("mcp_tokens")
    .select("id, user_id, team_id, revoked")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) {
    return new NextResponse(JSON.stringify({ error: "Token lookup failed." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (!row || row.revoked) return unauthorized("Unknown or revoked token.");

  // Offboarding gate: a token stays bound to its team, but access must end
  // when the owner is removed from that workspace. RLS is bypassed here (service
  // role), so re-check active membership explicitly on every request.
  const { data: membership, error: memberError } = await admin
    .from("team_members")
    .select("id")
    .eq("team_id", row.team_id)
    .eq("user_id", row.user_id)
    .eq("active", true)
    .maybeSingle();
  if (memberError) {
    return new NextResponse(JSON.stringify({ error: "Membership check failed." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (!membership)
    return unauthorized("The token owner is no longer a member of this workspace.");

  // Fire-and-forget usage stamp (never blocks the request).
  void admin
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined);

  return {
    tokenId: row.id,
    ctx: { admin, teamId: row.team_id, userId: row.user_id },
  };
}

async function handleMessage(
  ctx: McpContext,
  msg: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const id = (msg.id ?? null) as JsonRpcId;
  const method = typeof msg.method === "string" ? msg.method : "";

  // Notifications (no id) get no response body.
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      const params = (msg.params ?? {}) as { protocolVersion?: string };
      const requested = params.protocolVersion ?? "";
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : PROTOCOL_VERSIONS[1];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const params = (msg.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };
      const name = params.name ?? "";
      try {
        const result = await callTool(ctx, name, params.arguments ?? {});
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (err) {
        // Tool-level failures are results (isError), not protocol errors —
        // the model can read them and self-correct. Never leak internals.
        const message =
          err instanceof McpToolError
            ? err.message
            : "The tool call failed. Check the arguments and try again.";
        if (!(err instanceof McpToolError)) console.error("MCP tool error:", err);
        return rpcResult(id, {
          content: [{ type: "text", text: message }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method || "(missing)"}`);
  }
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH = 40;

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;

  // Reject oversized bodies before reading them (memory-exhaustion guard).
  // Content-Length can be absent (chunked) or spoofed, so also cap the raw
  // text length after reading.
  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_BODY_BYTES) {
    return json(rpcError(null, -32600, "Request body too large."), 413);
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json(rpcError(null, -32600, "Request body too large."), 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "Parse error: body must be JSON."), 400);
  }

  // Single message or (legacy) batch.
  if (Array.isArray(body)) {
    if (body.length > MAX_BATCH) {
      return json(rpcError(null, -32600, `Batch too large (max ${MAX_BATCH} messages).`), 400);
    }
    const messages = body.filter(
      (m): m is Record<string, unknown> => typeof m === "object" && m !== null,
    );
    // Process sequentially — each message can hit the DB, so an unbounded
    // Promise.all would let one request amplify into a burst of concurrent work.
    const responses: Record<string, unknown>[] = [];
    for (const m of messages) {
      const r = await handleMessage(auth.ctx, m);
      if (r !== null) responses.push(r);
    }
    if (responses.length === 0) return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
    return json(responses);
  }

  if (typeof body !== "object" || body === null) {
    return json(rpcError(null, -32600, "Invalid request."), 400);
  }

  const response = await handleMessage(auth.ctx, body as Record<string, unknown>);
  if (response === null) return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  return json(response);
}

// Stateless server: no SSE stream to resume, no session to delete.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
