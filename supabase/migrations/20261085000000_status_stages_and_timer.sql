-- =============================================================================
-- Status stages (ClickUp-style) + task timer wiring
-- =============================================================================
-- 1) sys_task_status_categories becomes the FOUR fixed stages every status
--    lives under:
--        Not started (is_todo)   — gray   — work not begun
--        Active      (is_doing)  — blue   — in progress (timers live here)
--        Done        (no flags)  — green  — finished, pending review/acceptance
--        Closed      (is_done)   — dark green — complete; counts as done
--    The three existing rows are RENAMED IN PLACE (To Do -> Not started,
--    Doing -> Active, Done -> Closed) so every existing task_statuses.category_id
--    keeps pointing at a row whose flags — and therefore every is_done-driven
--    behavior (tasks.done sync, cubes accrual, reports, video-review approve) —
--    are unchanged. "Done" is a brand-new flagless row between Active and Closed.
--
-- 2) New projects seed SIX defaults instead of three:
--        Backlog, To Do            -> Not started
--        Planning, Doing           -> Active
--        In Review                 -> Done
--        Completed                 -> Closed
--
-- 3) Status-template JSONB category strings move to the stage keys
--    not_started / active / done / closed. Existing documents are migrated
--    (todo -> not_started, doing -> active, done -> closed — legacy 'done'
--    always meant "counts as complete", which is now Closed).
--    create_project_from_template understands both generations.
--
-- 4) start_timer / stop_timer now write task_activity_logs entries
--    (timer_started / timer_stopped with elapsed seconds), and start_timer
--    first stops the caller's timers on OTHER tasks (work is logged, never
--    lost) so a member has at most ONE running timer platform-wide.
--    my_running_timer() feeds the sidebar timer widget.
-- =============================================================================


-- =============================================================================
-- SECTION 1: The four stages
-- =============================================================================
update public.sys_task_status_categories
   set name = 'Not started', sort_order = 0
 where is_todo is true and name <> 'Not started';

update public.sys_task_status_categories
   set name = 'Active', sort_order = 1
 where is_doing is true and name <> 'Active';

update public.sys_task_status_categories
   set name = 'Closed', sort_order = 3, color_code = '#16a34a'
 where is_done is true and name <> 'Closed';

insert into public.sys_task_status_categories
    (name, color_code, sort_order, is_todo, is_doing, is_done)
select 'Done', '#75c997', 2, false, false, false
 where not exists (
    select 1 from public.sys_task_status_categories
     where is_todo is false and is_doing is false and is_done is false
 );


-- =============================================================================
-- SECTION 2: New-project defaults (six statuses across the four stages)
-- =============================================================================
create or replace function public.seed_default_task_statuses()
    returns trigger
    language plpgsql
    set search_path = public
as
$$
begin
    if exists (select 1 from public.task_statuses where project_id = new.id) then
        return new;
    end if;

    insert into public.task_statuses (name, project_id, team_id, category_id, sort_order)
    select v.name, new.id, new.team_id, cat.id, v.sort_order
    from (values
            ('Backlog',   'Not started', 0),
            ('To Do',     'Not started', 1),
            ('Planning',  'Active',      2),
            ('Doing',     'Active',      3),
            ('In Review', 'Done',        4),
            ('Completed', 'Closed',      5)
         ) as v(name, category_name, sort_order)
    join public.sys_task_status_categories cat on cat.name = v.category_name;

    return new;
end;
$$;


-- =============================================================================
-- SECTION 3: Status-template category strings -> stage keys
-- =============================================================================
-- 3.1 Migrate stored status_templates documents.
update public.status_templates st
   set statuses = (
        select jsonb_agg(
            jsonb_set(e, '{category}', to_jsonb(
                case e ->> 'category'
                    when 'todo'  then 'not_started'
                    when 'doing' then 'active'
                    when 'done'  then 'closed'
                    else coalesce(e ->> 'category', 'not_started')
                end))
            order by ord)
        from jsonb_array_elements(st.statuses) with ordinality as t(e, ord)
   )
 where jsonb_typeof(st.statuses) = 'array'
   and exists (
        select 1 from jsonb_array_elements(st.statuses) x
        where x ->> 'category' in ('todo', 'doing', 'done')
   );

-- 3.2 Migrate project_templates' statuses sections the same way.
update public.project_templates pt
   set template = jsonb_set(pt.template, '{statuses}', (
        select jsonb_agg(
            jsonb_set(e, '{category}', to_jsonb(
                case e ->> 'category'
                    when 'todo'  then 'not_started'
                    when 'doing' then 'active'
                    when 'done'  then 'closed'
                    else coalesce(e ->> 'category', 'not_started')
                end))
            order by ord)
        from jsonb_array_elements(pt.template -> 'statuses') with ordinality as t(e, ord)
   ))
 where jsonb_typeof(pt.template -> 'statuses') = 'array'
   and exists (
        select 1 from jsonb_array_elements(pt.template -> 'statuses') x
        where x ->> 'category' in ('todo', 'doing', 'done')
   );

-- 3.3 create_project_from_template — same body as 20260701, with the category
--     resolution extended to the stage keys (legacy strings stay as aliases;
--     post-migration a plain 'done' can only come from the new UI = Done stage).
create or replace function public.create_project_from_template(
    p_team_id     uuid,
    p_template_id uuid,
    p_name        text
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id     uuid := auth.uid();
    _project_id  uuid;
    _template    jsonb;
    _entry       jsonb;
    _name        text;
    _color       text;
    _category    text;
    _status_name text;
    _priority    text;
    _status_id   uuid;
    _priority_id uuid;
    _category_id uuid;
    _sort        integer;
    _next_sort   integer;
begin
    if _user_id is null then
        raise exception 'create_project_from_template: no authenticated user';
    end if;

    if not public.is_team_member(p_team_id) then
        raise exception 'create_project_from_template: caller is not a member of team %', p_team_id;
    end if;

    select t.template into _template
    from public.project_templates t
    where t.id = p_template_id and t.team_id = p_team_id;

    if _template is null then
        raise exception 'create_project_from_template: template % not found in this team', p_template_id;
    end if;

    _project_id := public.create_project(p_name, p_team_id);

    -- ----- phases -> project_phases -----
    _sort := 0;
    for _entry in
        select * from jsonb_array_elements(coalesce(_template -> 'phases', '[]'::jsonb))
    loop
        _name  := left(trim(coalesce(_entry ->> 'name', '')), 100);
        _color := coalesce(nullif(_entry ->> 'color', ''), '#70a6f3');
        if _name = '' then
            continue;
        end if;
        if _color !~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then
            _color := '#70a6f3';
        end if;

        insert into public.project_phases (name, color_code, project_id, sort_index)
        values (_name, _color, _project_id, _sort);
        _sort := _sort + 1;
    end loop;

    -- ----- statuses -> task_statuses (in addition to the seeded defaults) -----
    select coalesce(max(sort_order) + 1, 0) into _sort
    from public.task_statuses where project_id = _project_id;
    for _entry in
        select * from jsonb_array_elements(coalesce(_template -> 'statuses', '[]'::jsonb))
    loop
        _status_name := left(trim(coalesce(_entry ->> 'name', '')), 50);
        _category    := lower(coalesce(_entry ->> 'category', 'not_started'));
        if _status_name = '' then
            continue;
        end if;

        -- Stage keys (not_started/active/done/closed), with the legacy
        -- todo/doing aliases still accepted.
        select c.id into _category_id
        from public.sys_task_status_categories c
        where (_category in ('not_started', 'todo') and c.is_todo  is true)
           or (_category in ('active', 'doing')     and c.is_doing is true)
           or (_category = 'closed'                 and c.is_done  is true)
           or (_category = 'done'
               and c.is_todo is false and c.is_doing is false and c.is_done is false)
        order by c.sort_order
        limit 1;

        if _category_id is null then
            select c.id into _category_id
            from public.sys_task_status_categories c
            where c.is_todo is true
            order by c.sort_order
            limit 1;
        end if;

        if _category_id is not null then
            insert into public.task_statuses (name, project_id, team_id, category_id, sort_order)
            values (_status_name, _project_id, p_team_id, _category_id, _sort);
            _sort := _sort + 1;
        end if;
    end loop;

    -- ----- tasks -> tasks -----
    _next_sort := coalesce(
        (select max(sort_order) + 1 from public.tasks where project_id = _project_id), 0);
    for _entry in
        select * from jsonb_array_elements(coalesce(_template -> 'tasks', '[]'::jsonb))
    loop
        _name        := left(trim(coalesce(_entry ->> 'name', '')), 500);
        _status_name := _entry ->> 'status';
        _priority    := _entry ->> 'priority';
        if _name = '' then
            continue;
        end if;

        _status_id := null;
        if _status_name is not null and _status_name <> '' then
            select s.id into _status_id
            from public.task_statuses s
            where s.project_id = _project_id and lower(s.name) = lower(_status_name)
            limit 1;
        end if;
        if _status_id is null then
            select s.id into _status_id
            from public.task_statuses s
            join public.sys_task_status_categories c on c.id = s.category_id
            where s.project_id = _project_id and c.is_todo is true
            order by s.sort_order
            limit 1;
        end if;

        _priority_id := null;
        if _priority is not null and _priority <> '' then
            select p.id into _priority_id
            from public.task_priorities p
            where lower(p.name) = lower(_priority)
            limit 1;
        end if;

        insert into public.tasks (name, project_id, status_id, priority_id,
                                  reporter_id, sort_order)
        values (_name, _project_id, _status_id, _priority_id, _user_id, _next_sort);
        _next_sort := _next_sort + 1;
    end loop;

    return _project_id;
end;
$$;


-- =============================================================================
-- SECTION 4: Timer RPCs — activity logging + single running timer per member
-- =============================================================================

-- 4.1 start_timer — stop the caller's timers on OTHER tasks first (logging the
--     elapsed work), then start/re-arm on this task. Logs 'timer_started'.
create or replace function public.start_timer(p_task_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id  uuid := auth.uid();
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

    -- One running timer per member: close out any other task's timer, keeping
    -- the elapsed time as a work log + activity entry (never silently lost).
    for _other in
        select t.id, t.task_id, t.start_time
        from public.task_timers t
        where t.user_id = _user_id and t.task_id <> p_task_id
        for update
    loop
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

    insert into public.task_timers (task_id, user_id, start_time)
    values (p_task_id, _user_id, now())
    on conflict (task_id, user_id)
        do update set start_time = now()
    returning id into _timer_id;

    insert into public.task_activity_logs
        (task_id, project_id, user_id, action, field, new_value)
    select p_task_id, k.project_id, _user_id, 'timer_started', 'timer', null
    from public.tasks k where k.id = p_task_id;

    return _timer_id;
end;
$$;

-- 4.2 stop_timer — as before, plus a 'timer_stopped' activity entry carrying
--     the elapsed seconds.
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
        raise exception 'stop_timer: no running timer for task % and current user', p_task_id;
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

-- 4.3 my_running_timer — the caller's running timer (if any) with enough task
--     context for the sidebar widget. SECURITY DEFINER but strictly scoped to
--     auth.uid()'s own timer rows.
create or replace function public.my_running_timer()
    returns table (
        timer_id     uuid,
        task_id      uuid,
        task_name    text,
        project_id   uuid,
        project_name text,
        started_at   timestamp with time zone
    )
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select t.id, t.task_id, k.name, k.project_id, p.name, t.start_time
    from public.task_timers t
    join public.tasks k on k.id = t.task_id
    join public.projects p on p.id = k.project_id
    where t.user_id = auth.uid()
    order by t.start_time desc;
$$;

revoke all on function public.my_running_timer() from public, anon;
grant execute on function public.my_running_timer() to authenticated;
