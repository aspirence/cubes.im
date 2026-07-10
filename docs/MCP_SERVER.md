# MCP Server — connect Claude directly to Cubes

Cubes exposes a **Model Context Protocol** server so external AI clients
(Claude Code, Claude Desktop, and eventually claude.ai) can read and act on a
workspace through natural language.

## How it works

- **Endpoint**: `POST /api/mcp` — stateless Streamable-HTTP JSON-RPC 2.0
  (`initialize` / `tools/list` / `tools/call` / `ping`). No SSE, no session id.
- **Auth**: `Authorization: Bearer cubes_mcp_…`. A user mints a token in
  the **App Center → MCP** app; only its SHA-256 hash is stored (raw shown once).
- **Scope**: every token is bound to ONE workspace. Each request rebuilds an
  `McpContext { teamId, userId }` and every tool query is scoped to it.

## Tools

`list_projects`, `list_tasks`, `my_tasks`, `get_task`, `create_task`,
`update_task`, `complete_task`, `add_comment`, `search`, `create_project`.
Friendly refs: project by name or id, status by name or `todo/doing/done`,
priority by `low/medium/high`, assignees by member email, dates `YYYY-MM-DD`.

## Security model

Handlers run on the **service-role client (RLS bypassed)**, so scoping is
enforced in code and hardened at the DB. Guarantees, all tested:

1. **Tenant isolation** — reads/writes filter by `ctx.teamId`; task ops call
   `assertTaskInTeam` (verifies the task's project belongs to the token's
   team) before touching anything. Foreign task/project access is rejected;
   `search` never returns foreign rows.
2. **Token binding is immutable** — `mcp_tokens.team_id / user_id /
   token_hash` cannot be changed after creation. Enforced by a `BEFORE UPDATE`
   trigger (blocks even service-role), column-scoped grants (`update (name,
   revoked)` only), and an `is_team_member` check in the UPDATE RLS policy.
   Closes a rebind-to-victim-workspace escape.
3. **Offboarding** — the route re-checks active `team_members` on every
   request; removing the owner from the workspace kills the token's access
   immediately (401), even though the token row still exists.
4. **Revocation** — `revoked` tokens 401.
5. **DoS bounds** — request body capped at 1 MB; JSON-RPC batches capped at 40
   messages and processed sequentially (no fan-out amplification).
6. **Errors** — tool failures return `isError` results (the model self-
   corrects); internals are never leaked (generic message + server-side log).

## Connect

**Claude Code**
```
claude mcp add --transport http cubes <origin>/api/mcp --header "Authorization: Bearer YOUR_TOKEN"
```

**Claude Desktop** (`claude_desktop_config.json` → `mcpServers`)
```
"cubes": { "command": "npx", "args": ["-y", "mcp-remote", "<origin>/api/mcp", "--header", "Authorization: Bearer YOUR_TOKEN"] }
```

claude.ai custom connectors require OAuth (not yet implemented) — use Code or
Desktop for now.

## Files

- `supabase/migrations/20261045000000_mcp_tokens.sql` — tokens table + RLS
- `supabase/migrations/20261046000000_mcp_tokens_hardening.sql` — immutability trigger, column grants, tightened UPDATE policy
- `src/app/api/mcp/route.ts` — JSON-RPC endpoint, bearer auth, membership/DoS guards
- `src/lib/mcp/tools.ts` — tool definitions + team-scoped handlers
- `src/features/mcp/use-mcp-tokens.ts` — client hooks (generate / revoke / delete)
- `src/app/(app)/apps/mcp/page.tsx` — App Center app: install gate → token management
- `src/features/mcp/mcp-manager.tsx` — token management + connect instructions UI

## Follow-ups

- OAuth 2.1 authorization-server endpoints → claude.ai custom-connector support.
- Per-token rate limiting (entropy makes brute force impractical; a cap would
  bound abuse from a leaked token before revocation).
- More tools: assignees management, labels, subtasks, project members.
