-- =============================================================================
-- Cubes — MCP tokens hardening (from adversarial security review)
-- =============================================================================
-- The original UPDATE policy only checked `user_id = auth.uid()`, so a user
-- could PATCH their own token's `team_id` to ANY workspace and then drive the
-- MCP server against that workspace (the service-role route trusts the row's
-- team_id). Three layers close it:
--   1. Revoke Supabase's default table-wide grants; grant UPDATE on only the
--      user-mutable columns (name, revoked). last_used_at is written by the
--      service-role route, which bypasses grants.
--   2. UPDATE policy WITH CHECK also requires is_team_member(team_id).
--   3. A BEFORE UPDATE trigger hard-rejects any change to the immutable
--      columns (team_id / user_id / token_hash) — defense in depth even if a
--      future grant widens column access.

-- 1. Column-scoped write grants (Supabase auto-grants ALL to authenticated on
--    new tables — revoke and re-grant narrowly).
revoke all on public.mcp_tokens from anon, authenticated;
grant select on public.mcp_tokens to authenticated;
grant insert on public.mcp_tokens to authenticated;
grant update (name, revoked) on public.mcp_tokens to authenticated;
grant delete on public.mcp_tokens to authenticated;

-- 2. UPDATE policy: cannot move a token to a team you don't belong to.
drop policy if exists mcp_tokens_update on public.mcp_tokens;
create policy mcp_tokens_update on public.mcp_tokens
    for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid() and public.is_team_member(team_id));

-- 3. Immutable columns — reject rebind/hash-swap at the row level.
create or replace function public.mcp_tokens_guard_immutable()
returns trigger
language plpgsql
as $$
begin
    if new.team_id <> old.team_id
       or new.user_id <> old.user_id
       or new.token_hash <> old.token_hash then
        raise exception 'mcp_tokens: team_id, user_id and token_hash are immutable';
    end if;
    return new;
end;
$$;

drop trigger if exists mcp_tokens_immutable on public.mcp_tokens;
create trigger mcp_tokens_immutable
    before update on public.mcp_tokens
    for each row
    execute function public.mcp_tokens_guard_immutable();
