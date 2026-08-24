-- =============================================================================
-- Timer hardening — make the running-timer machinery bulletproof
-- =============================================================================
-- Production data exposed four weaknesses beyond the stale-timer sweep
-- (20261121):
--
--   1. "One running timer per member" was enforced only procedurally (the
--      close-out loop in start_timer). Two concurrent start_timer calls could
--      both pass the loop and leave TWO timers running. Now a unique index on
--      task_timers(user_id) makes the invariant a database fact.
--   2. start_timer re-armed an ALREADY-RUNNING same-task timer with
--      start_time = now() (on conflict do update), silently discarding the
--      elapsed time. The activity log shows real doubled timer_started entries
--      seconds apart (UI + team_pulse_auto_timer racing). Now a same-task start
--      is a no-op that returns the existing timer id, keeping the clock.
--   3. stop_timer raised when no timer existed — so a second tab, a teammate's
--      status move, or the stale sweep closing it first turned the user's own
--      stop click into "Couldn't stop the timer." Now stop is idempotent:
--      nothing to stop returns null and the client says so calmly.
--   4. No audit of WHY a timer existed. task_timers.started_by ('manual' |
--      'auto') records whether the member pressed play or team_pulse_auto_timer
--      started it from a status move — the first question in every "why was my
--      timer running?" report.
--
-- Also: start_timer/stop_timer carried Postgres' default PUBLIC EXECUTE;
-- revoked here (authenticated keeps access; auth.uid() gates were already in
-- place, this just closes the surface).
--
-- Re-runnable: guarded DDL / create or replace.
-- =============================================================================


-- ----- 1. started_by audit column ---------------------------------------------

alter table public.task_timers
    add column if not exists started_by text default 'manual' not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'task_timers_started_by_chk') then
        alter table public.task_timers
            add constraint task_timers_started_by_chk
            check (started_by in ('manual', 'auto'));
    end if;
end $$;


-- ----- 2. one running timer per member, as a database invariant ---------------
-- Close out any environment's existing duplicates first (newest survives) so
-- the unique index always applies. Production has none today; local/dev may.
do $$
declare
    _dup record;
    _secs integer;
begin
    for _dup in
        select tt.id, tt.task_id, tt.user_id, tt.start_time, k.project_id
        from public.task_timers tt
        join public.tasks k on k.id = tt.task_id
        where exists (
            select 1 from public.task_timers newer
            where newer.user_id = tt.user_id
              and (newer.start_time > tt.start_time
                   or (newer.start_time = tt.start_time and newer.id > tt.id))
        )
    loop
        -- Same closing shape as stop_timer, capped at 8h like the stale sweep.
        _secs := least(greatest(0, floor(extract(epoch from (now() - _dup.start_time)))::integer),
                       8 * 3600);

        insert into public.task_work_log
            (task_id, user_id, time_spent, description, is_billable, logged_by_timer)
        values (_dup.task_id, _dup.user_id, _secs,
                'Closed by timer hardening migration (duplicate running timer).',
                true, true);

        insert into public.task_activity_logs
            (task_id, project_id, user_id, action, field, new_value)
        values (_dup.task_id, _dup.project_id, _dup.user_id,
                'timer_stopped', 'timer', _secs::text);

        update public.tasks
            set total_minutes = total_minutes + ceil(_secs::numeric / 60)
            where id = _dup.task_id;

        delete from public.task_timers where id = _dup.id;
    end loop;
end $$;

create unique index if not exists task_timers_one_per_user_uindex
    on public.task_timers (user_id);


-- ----- 3. start_timer v3 — idempotent re-arm + start source -------------------
-- Signature change (new optional p_source), so the old single-arg overload must
-- go first or PostgREST would see an ambiguous pair. plpgsql callers
-- (team_pulse_auto_timer) resolve at call time and keep working; the client's
-- rpc('start_timer', {p_task_id}) fills the default.
drop function if exists public.start_timer(uuid);

create or replace function public.start_timer(
    p_task_id uuid,
    p_source  text default 'manual'
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id  uuid := auth.uid();
    _source   text := case when p_source in ('manual', 'auto') then p_source else 'manual' end;
    _timer_id uuid;
    _other    record;
    _seconds  integer;
begin
    if _user_id is null then
        raise exception 'start_timer: no authenticated user';
    end if;

    if not public.is_task_member(p_task_id) then
        raise exception 'start_timer: caller is not a member of task %', p_task_id;
    end if;

    -- Lock ALL the caller's timer rows: serializes concurrent start/stop per
    -- member. Same task -> keep the running clock (re-arm must never reset a
    -- timer that is already counting); other task -> close out with the
    -- elapsed time logged, never silently lost.
    for _other in
        select t.id, t.task_id, t.start_time
        from public.task_timers t
        where t.user_id = _user_id
        for update
    loop
        if _other.task_id = p_task_id then
            _timer_id := _other.id;
            continue;
        end if;

        _seconds := greatest(0, floor(extract(epoch from (now() - _other.start_time)))::integer);

        insert into public.task_work_log
            (task_id, user_id, time_spent, description, is_billable, logged_by_timer)
        values (_other.task_id, _user_id, _seconds, null, true, true);

        insert into public.task_activity_logs
            (task_id, project_id, user_id, action, field, new_value)
        select _other.task_id, k.project_id, _user_id, 'timer_stopped', 'timer', _seconds::text
        from public.tasks k where k.id = _other.task_id;

        update public.tasks
            set total_minutes = total_minutes + ceil(_seconds::numeric / 60)
            where id = _other.task_id;

        delete from public.task_timers where id = _other.id;
    end loop;

    -- Already running on this task: done. No clock reset, no duplicate
    -- timer_started noise in the activity feed.
    if _timer_id is not null then
        return _timer_id;
    end if;

    begin
        insert into public.task_timers (task_id, user_id, start_time, started_by)
        values (p_task_id, _user_id, now(), _source)
        returning id into _timer_id;
    exception
        when unique_violation then
            -- A concurrent start slipped in between our lock scan and insert.
            raise exception 'start_timer: another timer just started for this user — retry';
    end;

    insert into public.task_activity_logs
        (task_id, project_id, user_id, action, field, new_value)
    select p_task_id, k.project_id, _user_id, 'timer_started', 'timer', null
    from public.tasks k where k.id = p_task_id;

    return _timer_id;
end;
$$;

revoke all on function public.start_timer(uuid, text) from public, anon;
grant execute on function public.start_timer(uuid, text) to authenticated, service_role;


-- ----- 4. stop_timer v3 — idempotent ------------------------------------------
-- Nothing running (second tab, teammate's status move, stale sweep got there
-- first) returns null instead of raising: stopping a stopped timer is success,
-- not an error. Same signature; body swapped in place.
create or replace function public.stop_timer(
    p_task_id     uuid,
    p_description text    default null,
    p_is_billable boolean default true
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id    uuid := auth.uid();
    _start_time timestamp with time zone;
    _seconds    integer;
    _log_id     uuid;
begin
    if _user_id is null then
        raise exception 'stop_timer: no authenticated user';
    end if;

    if not public.is_task_member(p_task_id) then
        raise exception 'stop_timer: caller is not a member of task %', p_task_id;
    end if;

    select start_time into _start_time
    from public.task_timers
    where task_id = p_task_id and user_id = _user_id
    for update;

    if _start_time is null then
        return null;  -- already stopped — idempotent, not an error
    end if;

    _seconds := greatest(0, floor(extract(epoch from (now() - _start_time)))::integer);

    insert into public.task_work_log
        (task_id, user_id, time_spent, description, is_billable, logged_by_timer)
    values (p_task_id, _user_id, _seconds, p_description, coalesce(p_is_billable, true), true)
    returning id into _log_id;

    delete from public.task_timers
    where task_id = p_task_id and user_id = _user_id;

    update public.tasks
        set total_minutes = total_minutes + ceil(_seconds::numeric / 60)
        where id = p_task_id;

    insert into public.task_activity_logs
        (task_id, project_id, user_id, action, field, new_value)
    select p_task_id, k.project_id, _user_id, 'timer_stopped', 'timer', _seconds::text
    from public.tasks k where k.id = p_task_id;

    return _log_id;
end;
$$;

revoke all on function public.stop_timer(uuid, text, boolean) from public, anon;
grant execute on function public.stop_timer(uuid, text, boolean) to authenticated, service_role;


-- ----- 5. team_pulse_auto_timer — stamp its starts as 'auto' -------------------
-- Body identical to 20261109 except start_timer(new.id, 'auto'), so auto-started
-- timers are distinguishable from play-button ones in task_timers.started_by.
create or replace function public.team_pulse_auto_timer()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _actor     uuid := auth.uid();
    _team      uuid;
    _new_doing boolean;
    _old_doing boolean;
    _t         record;
    _secs      integer;
begin
    if new.status_id is not distinct from old.status_id then
        return new;
    end if;

    select p.team_id into _team from public.projects p where p.id = new.project_id;
    if _team is null or not public.team_pulse_setting(_team, 'auto_timer') then
        return new;
    end if;

    select coalesce(c.is_doing, false) into _new_doing
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.id = new.status_id;
    _new_doing := coalesce(_new_doing, false);

    select coalesce(c.is_doing, false) into _old_doing
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.id = old.status_id;
    _old_doing := coalesce(_old_doing, false);

    if _new_doing and not _old_doing then
        -- Entering Active: start the actor's timer when the rule targets their
        -- tier and they're an assignee. Best-effort — a timer hiccup must never
        -- block the status move.
        if _actor is not null
           and public.team_pulse_auto_timer_applies(_team, _actor)
           and exists (
               select 1
               from public.tasks_assignees ta
               join public.team_members tm on tm.id = ta.team_member_id
               where ta.task_id = new.id and tm.user_id = _actor
           ) then
            begin
                perform public.start_timer(new.id, 'auto');
            exception when others then
                null;
            end;
        end if;
    elsif _old_doing and not _new_doing then
        -- Leaving Active: close EVERY running timer on the task (any user),
        -- logging the tracked time exactly like stop_timer does.
        for _t in
            select * from public.task_timers where task_id = new.id for update
        loop
            _secs := greatest(0, floor(extract(epoch from (now() - _t.start_time)))::integer);

            insert into public.task_work_log
                (task_id, user_id, time_spent, description, is_billable, logged_by_timer)
            values (new.id, _t.user_id, _secs, null, true, true);

            insert into public.task_activity_logs
                (task_id, project_id, user_id, action, field, new_value)
            values (new.id, new.project_id, _t.user_id, 'timer_stopped', 'timer', _secs::text);

            update public.tasks
                set total_minutes = total_minutes + ceil(_secs::numeric / 60)
                where id = new.id;

            delete from public.task_timers where id = _t.id;
        end loop;
    end if;

    return new;
end;
$$;

-- (trigger tasks_team_pulse_auto_timer already exists; create-or-replace above
--  swaps the body in place.)
