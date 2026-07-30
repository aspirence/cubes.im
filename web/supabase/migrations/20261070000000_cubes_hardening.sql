-- =============================================================================
-- Cubes engine — hardening (from adversarial review).
-- =============================================================================

-- 1. IDEMPOTENCY (high). The accrual trigger fires on every done false->true
--    transition, and reopening a task doesn't deduct — so reopen + re-close
--    minted a fresh award each cycle (unbounded cube farming). Make each task
--    award once per (task, user, rule) with a partial unique index, and have
--    the internal award insert ON CONFLICT DO NOTHING for task-sourced rows.
create unique index if not exists cube_events_task_award_uq
    on public.cube_events (source_id, user_id, rule_key)
    where source_type = 'task';

create or replace function public._cube_award(
    _team_id uuid, _user_id uuid, _points integer, _reason text,
    _rule_key text, _source_type text, _source_id uuid, _created_by uuid
)
    returns void language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if _points is null or _points = 0 or _user_id is null or _team_id is null then
        return;
    end if;
    -- Task awards are once-per (task,user,rule); manual awards (source_type
    -- <> 'task') aren't covered by the partial index, so they always insert.
    insert into public.cube_events (team_id, user_id, points, reason, rule_key, source_type, source_id, created_by)
    values (_team_id, _user_id, _points, _reason, _rule_key, _source_type, _source_id, _created_by)
    on conflict (source_id, user_id, rule_key) where source_type = 'task' do nothing;
end;
$$;
revoke all on function public._cube_award(uuid, uuid, integer, text, text, text, uuid, uuid) from public, anon, authenticated;

-- 2. LEDGER READ LEAK (high). cube_events reasons carry task names ("Completed:
--    <task>") for tasks in EVERY project, including private ones. A blanket
--    is_team_member SELECT let any member read them, bypassing the task/space
--    access boundary. Restrict rows to the member's own ledger; admins see all.
--    The leaderboard RPC is SECURITY DEFINER and computes aggregates, so it is
--    unaffected.
drop policy if exists cube_events_select on public.cube_events;
create policy cube_events_select on public.cube_events
    for select to authenticated
    using (user_id = auth.uid() or public.is_team_admin(team_id));

-- 3. LEADERBOARD ROBUSTNESS (low). Aggregate the ledger before joining members,
--    so a (hypothetical) duplicate team_members row can't fan out and multiply
--    a member's total.
create or replace function public.cube_leaderboard(p_team_id uuid)
    returns table (
        user_id uuid, name text, email text, avatar_url text,
        member_type text, cubes bigint, events_count bigint, last_event timestamptz
    )
    language plpgsql stable security definer set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'cube_leaderboard: not a member';
    end if;
    return query
    with totals as (
        select ce.user_id,
               sum(ce.points)::bigint as cubes,
               count(*)::bigint as cnt,
               max(ce.created_at) as last_at
        from public.cube_events ce
        where ce.team_id = p_team_id
        group by ce.user_id
    )
    select u.id, u.name, u.email::text, u.avatar_url, tm.member_type,
           coalesce(t.cubes, 0)::bigint,
           coalesce(t.cnt, 0)::bigint,
           t.last_at
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    left join totals t on t.user_id = u.id
    where tm.team_id = p_team_id and tm.active is true and tm.member_type <> 'guest'
    order by coalesce(t.cubes, 0) desc, u.name;
end;
$$;
revoke all on function public.cube_leaderboard(uuid) from public;
grant execute on function public.cube_leaderboard(uuid) to authenticated;
