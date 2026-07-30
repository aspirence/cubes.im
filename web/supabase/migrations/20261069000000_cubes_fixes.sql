-- =============================================================================
-- Cubes engine — two fixes found in testing.
-- =============================================================================

-- 1. Tasks are completed by moving them to a Done-category STATUS; a BEFORE
--    trigger derives tasks.done from the status. `AFTER UPDATE OF done` only
--    fires when `done` is literally in the UPDATE's SET list, so it missed the
--    real completion path (SET status_id = <done status>). Fire on ANY row
--    update and gate with WHEN on the final (post-BEFORE-trigger) values.
drop trigger if exists tasks_award_cubes on public.tasks;
create trigger tasks_award_cubes
    after update on public.tasks
    for each row
    when (old.done is distinct from new.done and new.done is true)
    execute function public.award_cubes_on_task_done();

-- 2. cube_leaderboard declared email as text, but users.email is citext →
--    "structure of query does not match function result type". Cast to text.
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
    select u.id, u.name, u.email::text, u.avatar_url, tm.member_type,
           coalesce(sum(ce.points), 0)::bigint,
           count(ce.id)::bigint,
           max(ce.created_at)
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    left join public.cube_events ce on ce.team_id = p_team_id and ce.user_id = u.id
    where tm.team_id = p_team_id and tm.active is true
      and tm.member_type <> 'guest'
    group by u.id, u.name, u.email, u.avatar_url, tm.member_type
    order by coalesce(sum(ce.points), 0) desc, u.name;
end;
$$;
revoke all on function public.cube_leaderboard(uuid) from public;
grant execute on function public.cube_leaderboard(uuid) to authenticated;
