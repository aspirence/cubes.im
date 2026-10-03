-- =============================================================================
-- Content Studio routines — the user's day, and the whole task
-- =============================================================================
-- A routine (20261119000000) is a blueprint: every cycle it builds a parent
-- task and one subtask per step. Two problems, fixed together because both
-- live in the one function that builds the tasks.
--
-- 1. WHOSE DAY. Routine tasks were due at `_occurrence::timestamptz`, which is
--    UTC midnight. West of Greenwich that instant is still the evening BEFORE,
--    so every routine task showed a day early on their calendar; and "today"
--    was UTC's today, so the tasks appeared at 05:30 in India but at 17:00 the
--    previous day in California. The routine now carries its author's IANA
--    zone (the same rule as recurring tasks, 20261126000000 "WHOSE DAY"): tasks
--    are due at LOCAL midnight in it, "today" is the author's today, and an
--    occurrence is built on the first hourly tick after the author's midnight.
--    An unknown or missing zone reads as UTC — the old behaviour — rather than
--    taking the routine down. next_run_at keeps meaning "a calendar date,
--    stored at UTC midnight" (the list screen reads its date part); it is
--    compared as a date against the author's today.
--
-- 1b. THE PHASE. Every save clears last_run_at so the schedule re-derives from
--    starts_on — but the re-derivation started from TODAY, so an
--    every-other-day routine renamed on an off day built an extra task that
--    day and moved every later date by one. It now counts from starts_on and
--    walks forward, and the form's preview does the same.
--
-- 2. THE WHOLE TASK. A routine could not say what a one-off task can:
--      * a brief — routines.description existed but never reached the task;
--      * who owns the whole occurrence, and how it is labelled — only steps
--        had an assignee, the parent had nobody and no labels;
--      * a step that takes more than a day — steps had a due offset only, so
--        every subtask started and was due on the same day;
--      * a step's own instructions, and the link it works from.
--    New columns: routines.assignee_team_member_ids / label_ids (the parent's
--    people and labels), routine_steps.start_offset_days (null = same day as
--    due), description and reference_url. All optional; an existing routine
--    builds exactly what it built before, apart from the dates now being in
--    its author's day.
--
-- The arrays have no foreign keys (PostgreSQL cannot enforce one per element),
-- so the builder only uses ids that still exist: a member removed from the
-- team or a deleted label is skipped, not an error. An error would abort the
-- whole occurrence for everyone else in it.
--
-- Time of day is deliberately NOT a routine setting: every date surface in the
-- product (drawer, board, list, calendars) shows days, not times, so a start
-- time would be stored and never seen.
--
-- Re-runnable: add column if not exists, guarded constraints, create or
-- replace function.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Columns
-- =============================================================================

alter table public.app_content_studio_routines
    add column if not exists timezone                 text,
    add column if not exists assignee_team_member_ids uuid[] default '{}' not null,
    add column if not exists label_ids                uuid[] default '{}' not null;

alter table public.app_content_studio_routine_steps
    add column if not exists start_offset_days integer,
    add column if not exists description       text,
    add column if not exists reference_url     text;

do $$
begin
    -- A step starts on or before the day it is due, inside the same 60-day
    -- window due_offset_days already allows.
    alter table public.app_content_studio_routine_steps
        add constraint app_content_studio_routine_steps_start_offset_check
        check (start_offset_days is null
               or (start_offset_days between 0 and 60 and start_offset_days <= due_offset_days));
exception
    when duplicate_object then null;
end $$;

do $$
begin
    alter table public.app_content_studio_routine_steps
        add constraint app_content_studio_routine_steps_description_check
        check (description is null or char_length(description) <= 4000);
exception
    when duplicate_object then null;
end $$;

do $$
begin
    -- Same bounds as task_reference_links.url, where it ends up.
    alter table public.app_content_studio_routine_steps
        add constraint app_content_studio_routine_steps_reference_url_check
        check (reference_url is null or char_length(reference_url) between 1 and 2000);
exception
    when duplicate_object then null;
end $$;


-- =============================================================================
-- SECTION 2: The builder
-- =============================================================================
-- 20261119000000's body with: the author's zone for dates, "today" and when an
-- occurrence is due; the phase counted from starts_on (1b); the routine's
-- description, people and labels on the parent; the routine's author as
-- reporter; per-step start offset, description and link. Idempotency, booking
-- and end-date handling are unchanged.

create or replace function public.content_studio_materialize_routines()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _r          record;
    _step       record;
    _tz         text;
    _today      date;
    _occurrence date;
    _reporter   uuid;
    _parent_id  uuid;
    _task_id    uuid;
    _dep_task   uuid;
    _status_id  uuid;
    -- step_id -> the task just created for it, so dependencies land on THIS
    -- occurrence's tasks and not on last cycle's.
    _made       jsonb;
    _count      integer := 0;
    -- Weekly with no weekday, or monthly with no day, anchor to the start date's
    -- own weekday / day-of-month (see 20261119000000).
    _dow        smallint;
    _dom        smallint;
begin
    -- A series whose end date has passed is finished.
    update public.app_content_studio_routines
       set active = false, updated_at = now()
     where active is true
       and ends_on is not null
       and ends_on < current_date;

    for _r in
        select * from public.app_content_studio_routines
        where active is true
          and (ends_on is null or ends_on >= current_date)
          -- next_run_at holds a calendar date (stored at UTC midnight); it is due
          -- once that date has begun in the routine's own zone. Comparing the
          -- instant with now() built India's tasks at 05:30, not after midnight.
          and (next_run_at is null
               or (next_run_at at time zone 'UTC')::date
                  <= (now() at time zone public.recurrence_timezone(timezone))::date)
        order by created_at
        for update skip locked
    loop
    -- Each routine is its own sub-transaction: one bad routine must not take
    -- every other one down with it for another hour.
    begin
        _tz    := public.recurrence_timezone(_r.timezone);
        _today := (now() at time zone _tz)::date;

        -- Not started yet, in the author's calendar.
        if _r.starts_on > _today then
            continue;
        end if;

        _dow := coalesce(_r.day_of_week,  extract(dow from _r.starts_on)::smallint);
        _dom := coalesce(_r.day_of_month, extract(day from _r.starts_on)::smallint);
        -- Never run (or just edited — the client clears last_run_at): the first
        -- on-schedule date counted FROM starts_on. Already run: the date already
        -- booked. Either way, walk forward past days already gone WITHOUT
        -- building them. Counting from starts_on is what keeps the phase:
        -- 20261119000000 restarted from today, so renaming an every-other-day
        -- routine on an off day built an extra task and shifted every date
        -- after it by one.
        if _r.last_run_at is null then
            _occurrence := public.content_studio_first_occurrence(
                _r.schedule_type, _dow, _dom, _r.starts_on);
        else
            _occurrence := coalesce((_r.next_run_at at time zone 'UTC')::date, _today);
        end if;
        while _occurrence < _today loop
            _occurrence := public.content_studio_next_occurrence(
                _r.schedule_type, _r.interval_value, _dow, _dom, _occurrence);
        end loop;

        -- Past the end date in the author's own calendar. The sweep's up-front
        -- deactivation compares ends_on with UTC's today, so east of UTC there
        -- is a window where a finished routine is still selected.
        if _r.ends_on is not null and _occurrence > _r.ends_on then
            update public.app_content_studio_routines
               set active = false, next_run_at = null, updated_at = now()
             where id = _r.id;
            continue;
        end if;

        -- An occurrence still ahead is BOOKED, not built.
        if _occurrence > _today then
            update public.app_content_studio_routines
               set next_run_at = _occurrence::timestamp at time zone 'UTC'
             where id = _r.id;
            continue;
        end if;
        _made := '{}'::jsonb;

        -- Already made this one? Book the next date without building anything.
        if exists (
            select 1 from public.app_content_studio_routine_tasks
            where routine_id = _r.id
              and occurrence_date = _occurrence
              and role = 'parent'
        ) then
            update public.app_content_studio_routines
                set next_run_at = public.content_studio_next_occurrence(
                        _r.schedule_type, _r.interval_value, _dow, _dom, _occurrence)::timestamp
                        at time zone 'UTC'
                where id = _r.id;
            continue;
        end if;

        -- The task modal's rule: a status named "To Do" if the project has one,
        -- else the first column.
        select id into _status_id
        from public.task_statuses
        where project_id = _r.project_id
        order by (regexp_replace(lower(name), '[^a-z]', '', 'g') = 'todo') desc, sort_order
        limit 1;

        -- routines.created_by has no foreign key; tasks.reporter_id does. Only
        -- a user who still exists can be the reporter.
        select id into _reporter from public.users where id = _r.created_by;

        -- The parent: due at local midnight of the occurrence day.
        insert into public.tasks
            (name, description, project_id, status_id, reporter_id, start_date, end_date, sort_order)
        values (
            _r.name,
            _r.description,
            _r.project_id,
            _status_id,
            _reporter,
            _occurrence::timestamp at time zone _tz,
            _occurrence::timestamp at time zone _tz,
            coalesce((select max(sort_order) + 1 from public.tasks
                      where project_id = _r.project_id), 0)
        )
        returning id into _parent_id;

        insert into public.app_content_studio_routine_tasks
            (routine_id, step_id, task_id, team_id, occurrence_date, role)
        values (_r.id, null, _parent_id, _r.team_id, _occurrence, 'parent');

        -- The parent's people and labels — only ids that still exist in the
        -- routine's team (see the header).
        insert into public.tasks_assignees (task_id, team_member_id, assigned_by)
        select _parent_id, tm.id, _reporter
          from public.team_members tm
         where tm.id = any(_r.assignee_team_member_ids)
           and tm.team_id = _r.team_id
           and tm.active is true
        on conflict do nothing;

        insert into public.task_labels (task_id, label_id)
        select _parent_id, l.id
          from public.team_labels l
         where l.id = any(_r.label_ids)
           and l.team_id = _r.team_id
        on conflict do nothing;

        -- Steps, in order, so a dependency can only point at something already
        -- made this pass.
        for _step in
            select * from public.app_content_studio_routine_steps
            where routine_id = _r.id
            order by position, title
        loop
            insert into public.tasks
                (name, description, project_id, status_id, reporter_id, parent_task_id,
                 start_date, end_date, sort_order)
            values (
                _step.title,
                _step.description,
                _r.project_id,
                _status_id,
                _reporter,
                _parent_id,
                (_occurrence + coalesce(_step.start_offset_days, _step.due_offset_days))::timestamp
                    at time zone _tz,
                (_occurrence + _step.due_offset_days)::timestamp at time zone _tz,
                _step.position
            )
            returning id into _task_id;

            if _step.assignee_team_member_id is not null then
                -- Same filter as the parent's assignees: a step must not put
                -- someone from another workspace (or a removed member) on the
                -- task. The steps policy only checks the step's own team.
                insert into public.tasks_assignees (task_id, team_member_id, assigned_by)
                select _task_id, tm.id, _reporter
                  from public.team_members tm
                 where tm.id = _step.assignee_team_member_id
                   and tm.team_id = _r.team_id
                   and tm.active is true
                on conflict do nothing;
            end if;

            if _step.reference_url is not null then
                insert into public.task_reference_links (task_id, url, sort_order, created_by)
                values (_task_id, _step.reference_url, 0, _reporter);
            end if;

            if _step.depends_on_step_id is not null then
                _dep_task := (_made ->> _step.depends_on_step_id::text)::uuid;
                if _dep_task is not null then
                    insert into public.task_dependencies (task_id, depends_on_task_id)
                    values (_task_id, _dep_task)
                    on conflict do nothing;
                end if;
            end if;

            insert into public.app_content_studio_routine_tasks
                (routine_id, step_id, task_id, team_id, occurrence_date, role)
            values (_r.id, _step.id, _task_id, _r.team_id, _occurrence, 'step')
            on conflict do nothing;

            _made := _made || jsonb_build_object(_step.id::text, _task_id);
        end loop;

        _count := _count + 1;

        update public.app_content_studio_routines
            set last_run_at = now(),
                next_run_at = public.content_studio_next_occurrence(
                        _r.schedule_type, _r.interval_value, _dow, _dom, _occurrence)::timestamp
                        at time zone 'UTC',
                updated_at  = now()
            where id = _r.id;

        -- Past its end date now? Stop it, so the job stops looking at it.
        update public.app_content_studio_routines
            set active = false
            where id = _r.id
              and ends_on is not null
              and (next_run_at at time zone 'UTC')::date > ends_on;
    exception when others then
        raise notice 'Content Studio: routine % skipped this sweep — % (%)', _r.id, sqlerrm, sqlstate;
    end;
    end loop;

    return _count;
end;
$$;

-- The sweep is infrastructure, not an app call (as in 20261119000000).
revoke all on function public.content_studio_materialize_routines() from public, anon, authenticated;
grant execute on function public.content_studio_materialize_routines() to service_role;
