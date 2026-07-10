-- =============================================================================
-- Cubes — MCP personal access tokens
-- =============================================================================
-- Backs the MCP server endpoint (/api/mcp): external AI clients (Claude Code,
-- Claude Desktop, claude.ai) authenticate with a bearer token the user mints
-- in Settings → MCP. Only a SHA-256 hash is stored — the raw token is shown
-- once at creation and never persisted.
--
-- Each token is bound to ONE workspace (team): every MCP tool call is scoped
-- to that team server-side. Users manage only their own tokens (RLS); the
-- API route verifies tokens with the service-role client (bypasses RLS).

create table if not exists public.mcp_tokens (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.users (id) on delete cascade,
    team_id      uuid not null references public.teams (id) on delete cascade,
    name         text not null,
    token_hash   text not null unique,
    revoked      boolean not null default false,
    last_used_at timestamptz,
    created_at   timestamptz not null default now()
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens (user_id);

alter table public.mcp_tokens enable row level security;

drop policy if exists mcp_tokens_select on public.mcp_tokens;
create policy mcp_tokens_select on public.mcp_tokens
    for select using (user_id = auth.uid());

drop policy if exists mcp_tokens_insert on public.mcp_tokens;
create policy mcp_tokens_insert on public.mcp_tokens
    for insert with check (
        user_id = auth.uid()
        and public.is_team_member(team_id)
    );

drop policy if exists mcp_tokens_update on public.mcp_tokens;
create policy mcp_tokens_update on public.mcp_tokens
    for update using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists mcp_tokens_delete on public.mcp_tokens;
create policy mcp_tokens_delete on public.mcp_tokens
    for delete using (user_id = auth.uid());
