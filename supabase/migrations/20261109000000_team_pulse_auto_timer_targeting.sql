-- =============================================================================
-- Team Pulse — Auto-timer member-type targeting + "one timer at a time" guard
-- =============================================================================
-- Two refinements to the auto_timer rule (installed_apps.config on the
-- team_pulse row):
--
--   1. Targeting — a new config key `auto_timer_types` (a JSON array of member
--      tiers, e.g. ["limited","member"]) scopes WHO the auto-timer follows.
--      Absent / non-array = every tier (backward compatible with the original
--      "any assignee" behaviour). An explicit list = only those tiers.
--
--   2. One timer at a time — when the rule targets the actor and they're an
--      assignee, moving a task INTO the Active stage while they already have a
--      timer running on a DIFFERENT task is blocked with a clear message, so
--      the timer never silently jumps between tasks. Mirrors the single_active
--      rule's raise-to-abort pattern.
-- =============================================================================

-- ----- targeting helper ------------------------------------------------------
-- TRUE when auto_timer is on for the team AND the user's member tier is included
-- by the (optional) auto_timer_types list. Absent list = all tiers.
create or replace function public.team_pulse_auto_timer_applies(
    p_team_id uuid,
    p_user_id uuid
)
    returns boolean
    language plpgsql
    stable
    security definer
    set search_path = public
as
$$
declare
    _types jsonb;
    _mtype text;
begin
    if p_team_id is null or p_user_id is null then
        return false;
    end if;
    if not public.team_pulse_setting(p_team_id, 'auto_timer') then
        return false;
    end if;

    select tm.member_type into _mtype
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = p_user_id
      and coalesce(tm.active, true)
    order by tm.created_at asc
    limit 1;
    if _mtype is null then
        return false;
    end if;

    select ia.config -> 'auto_timer_types' into _types
    from public.installed_apps ia
    where ia.team_id = p_team_id
      and ia.app_key = 'team_pulse'
      and ia.enabled
    limit 1;

    -- Absent / non-array → the rule targets every tier (pre-targeting default).
    if _types is null or jsonb_typeof(_types) <> 'array' then
        return true;
    end if;

    -- Explicit list → the tier must be present (empty list = no one).
    return _types ? _mtype;
end;
$$;

revoke all on function public.team_pulse_auto_timer_applies(uuid, uuid) from public, anon;
grant execute on function public.team_pulse_auto_timer_applies(uuid, uuid) to authenticated;

-- ----- rule 2 (revised): the timer follows the Active stage, for targeted tiers
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
                perform public.start_timer(new.id);
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

-- (trigger tasks_team_pulse_auto_timer already exists from ...088; the
--  create-or-replace above swaps the body in place.)

-- ----- rule 3: one running timer at a time for auto-timer members ------------
-- BEFORE the move into the Active stage: if the auto-timer rule targets the
-- actor and they're an assignee (so this move would auto-start their timer),
-- but a timer is already running on another task, abort with a clear message
-- instead of silently switching the timer over.
create or replace function public.team_pulse_enforce_timer_focus()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _actor     uuid := auth.uid();
    _team      uuid;
    _new_doing boolean;
    _old_doing boolean;
begin
    if _actor is null or new.status_id is not distinct from old.status_id then
        return new;
    end if;

    select coalesce(c.is_doing, false) into _new_doing
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.id = new.status_id;
    if not coalesce(_new_doing, false) then
        return new;  -- not entering the Active stage
    end if;

    select coalesce(c.is_doing, false) into _old_doing
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.id = old.status_id;
    if coalesce(_old_doing, false) then
        return new;  -- was already Active (rename/move within the stage)
    end if;

    select p.team_id into _team from public.projects p where p.id = new.project_id;
    if _team is null then
        return new;
    end if;

    -- Only guards moves that would auto-start THIS actor's timer.
    if not public.team_pulse_auto_timer_applies(_team, _actor) then
        return new;
    end if;
    if not exists (
        select 1
        from public.tasks_assignees ta
        join public.team_members tm on tm.id = ta.team_member_id
        where ta.task_id = new.id and tm.user_id = _actor
    ) then
        return new;
    end if;

    if exists (
        select 1 from public.task_timers tt
        where tt.user_id = _actor and tt.task_id <> new.id
    ) then
        raise exception 'Team Pulse: a timer is already running on another task — stop it (or move that task out of In Progress) before starting a new one.';
    end if;

    return new;
end;
$$;

drop trigger if exists tasks_team_pulse_timer_focus on public.tasks;
create trigger tasks_team_pulse_timer_focus
    before update of status_id on public.tasks
    for each row
    execute function public.team_pulse_enforce_timer_focus();
