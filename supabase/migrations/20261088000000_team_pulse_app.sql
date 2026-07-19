-- =============================================================================
-- Team Pulse app — live "who's doing what" tracking with focus rules
-- =============================================================================
-- An installable first-party app (installed_apps.app_key = 'team_pulse').
-- While installed + enabled for a team, two toggleable behaviors activate
-- (config JSONB keys, both DEFAULT ON; set "false" to disable):
--
--   * single_active — a LIMITED member can keep only ONE of their assigned
--     tasks in an Active-stage status at a time; moving a second one raises.
--   * auto_timer   — moving a task INTO an Active-stage status auto-starts the
--     timer for the actor (when they're an assignee); moving it OUT closes
--     every running timer on the task, logging the tracked time.
--
-- Plus team_pulse(p_team_id): one row per active member powering the app's
-- live dashboard — running timer, current active task, next queued task,
-- today's tracked seconds.
-- =============================================================================

-- ----- setting helper --------------------------------------------------------
-- TRUE only when the app is installed+enabled for the team AND the config key
-- is not explicitly "false" (absent = default ON).
create or replace function public.team_pulse_setting(p_team_id uuid, p_key text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select coalesce((
        select coalesce(lower(ia.config ->> p_key), 'true') <> 'false'
        from public.installed_apps ia
        where ia.team_id = p_team_id
          and ia.app_key = 'team_pulse'
          and ia.enabled
        limit 1
    ), false);
$$;

revoke all on function public.team_pulse_setting(uuid, text) from public, anon;
grant execute on function public.team_pulse_setting(uuid, text) to authenticated;

-- ----- rule 1: one Active task at a time for limited members -----------------
create or replace function public.team_pulse_enforce_single_active()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _actor     uuid := auth.uid();
    _team      uuid;
    _tm        uuid;
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
    if _team is null or not public.team_pulse_setting(_team, 'single_active') then
        return new;
    end if;

    -- The rule bites only for LIMITED members acting on their own assignment.
    select tm.id into _tm
    from public.team_members tm
    where tm.team_id = _team
      and tm.user_id = _actor
      and tm.member_type = 'limited'
      and coalesce(tm.active, true);
    if _tm is null then
        return new;
    end if;
    if not exists (
        select 1 from public.tasks_assignees ta
        where ta.task_id = new.id and ta.team_member_id = _tm
    ) then
        return new;
    end if;

    if exists (
        select 1
        from public.tasks_assignees ta
        join public.tasks t2 on t2.id = ta.task_id
        join public.task_statuses s2 on s2.id = t2.status_id
        join public.sys_task_status_categories c2 on c2.id = s2.category_id
        where ta.team_member_id = _tm
          and t2.id <> new.id
          and t2.archived = false
          and c2.is_doing
    ) then
        raise exception 'Team Pulse: only one task can be In Progress at a time — finish or move your current task first.';
    end if;

    return new;
end;
$$;

drop trigger if exists tasks_team_pulse_single_active on public.tasks;
create trigger tasks_team_pulse_single_active
    before update of status_id on public.tasks
    for each row
    execute function public.team_pulse_enforce_single_active();

-- ----- rule 2: the timer follows the Active stage ----------------------------
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
        -- Entering Active: start the actor's timer when they're assigned.
        -- Best-effort — a timer hiccup must never block the status move.
        if _actor is not null and exists (
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

drop trigger if exists tasks_team_pulse_auto_timer on public.tasks;
create trigger tasks_team_pulse_auto_timer
    after update of status_id on public.tasks
    for each row
    execute function public.team_pulse_auto_timer();

-- ----- the dashboard: one row per active member ------------------------------
create or replace function public.team_pulse(p_team_id uuid)
    returns table (
        team_member_id       uuid,
        user_id              uuid,
        name                 text,
        avatar_url           text,
        member_type          text,
        running_task_id      uuid,
        running_task_name    text,
        running_project_id   uuid,
        running_project_name text,
        running_started_at   timestamp with time zone,
        active_task_id       uuid,
        active_task_name     text,
        active_status_name   text,
        active_project_name  text,
        active_count         bigint,
        next_task_id         uuid,
        next_task_name       text,
        next_project_name    text,
        next_due             timestamp with time zone,
        todo_count           bigint,
        today_seconds        bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'team_pulse: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        tm.id,
        u.id,
        u.name,
        u.avatar_url,
        tm.member_type,
        rt.task_id, rt.task_name, rt.project_id, rt.project_name, rt.started_at,
        ac.task_id, ac.task_name, ac.status_name, ac.project_name,
        coalesce(ac.cnt, 0),
        nx.task_id, nx.task_name, nx.project_name, nx.due,
        coalesce(nx.cnt, 0),
        coalesce(td.secs, 0)
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    -- running timer (at most one per user, in THIS team's projects)
    left join lateral (
        select t.id as task_id, t.name as task_name, p.id as project_id,
               p.name as project_name, tt.start_time as started_at
        from public.task_timers tt
        join public.tasks t on t.id = tt.task_id
        join public.projects p on p.id = t.project_id
        where tt.user_id = u.id and p.team_id = p_team_id
        order by tt.start_time desc
        limit 1
    ) rt on true
    -- assigned tasks currently in an Active-stage status
    left join lateral (
        select t.id as task_id, t.name as task_name, s.name as status_name,
               p.name as project_name, count(*) over () as cnt
        from public.tasks_assignees ta
        join public.tasks t on t.id = ta.task_id
        join public.projects p on p.id = t.project_id
        join public.task_statuses s on s.id = t.status_id
        join public.sys_task_status_categories c on c.id = s.category_id
        where ta.team_member_id = tm.id
          and p.team_id = p_team_id
          and t.archived = false
          and c.is_doing
        order by t.updated_at desc nulls last
        limit 1
    ) ac on true
    -- next queued: first assigned Not-started-stage task by due date
    left join lateral (
        select t.id as task_id, t.name as task_name, p.name as project_name,
               t.end_date::timestamp with time zone as due, count(*) over () as cnt
        from public.tasks_assignees ta
        join public.tasks t on t.id = ta.task_id
        join public.projects p on p.id = t.project_id
        join public.task_statuses s on s.id = t.status_id
        join public.sys_task_status_categories c on c.id = s.category_id
        where ta.team_member_id = tm.id
          and p.team_id = p_team_id
          and t.archived = false
          and c.is_todo
        order by t.end_date asc nulls last, t.sort_order asc
        limit 1
    ) nx on true
    -- time tracked today (this team's tasks)
    left join lateral (
        select sum(wl.time_spent)::bigint as secs
        from public.task_work_log wl
        join public.tasks t on t.id = wl.task_id
        join public.projects p on p.id = t.project_id
        where wl.user_id = u.id
          and p.team_id = p_team_id
          and wl.created_at >= date_trunc('day', now())
    ) td on true
    where tm.team_id = p_team_id
      and coalesce(tm.active, true)
      and tm.user_id is not null
    order by u.name;
end;
$$;

revoke all on function public.team_pulse(uuid) from public, anon;
grant execute on function public.team_pulse(uuid) to authenticated;
