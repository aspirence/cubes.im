-- =============================================================================
-- Recurring tasks — a task that repeats
-- =============================================================================
-- Migration 20260701000000 built task_recurring_schedules and an hourly
-- materialize_recurring_tasks() job, but nothing in the product ever wrote a
-- schedule: no screen offered "repeat", so the table stayed empty and the job
-- had nothing to do. It also would not have helped if it had — the clone it
-- made carried only name / project / status / priority, so each copy had no
-- dates (invisible on every calendar), no assignees (nobody told), no
-- description and no subtasks.
--
-- This turns the feature on. The model stays what the table already says: the
-- task the user makes recurring is the SOURCE — it is both the first occurrence
-- and the template for the rest. On each due date the job makes a full copy:
--   * the task itself — name, description, priority, reporter, deliverable,
--     track, phase, reference links — with its dates shifted so the copy is
--     starting on the occurrence day, keeping its start→due span;
--   * its assignees (whose insert trigger notifies them) and labels;
--   * its subtasks, each with their own assignees, labels, phase, links and
--     dates (shifted by the same amount, so a subtask that starts the day
--     after its parent still does), and the dependencies between them
--     re-pointed at the copies.
-- Comments, attachments, timers and time logs are the source's own and are
-- not copied. Copies start in the project's To Do column whatever state the
-- source is in — a finished source must not spawn finished copies.
--
-- WHICH DAYS
-- Content Studio routines (20261119000000) already worked out the calendar
-- arithmetic — "every 2 weeks on Tuesday" lands on a Tuesday, "monthly on the
-- 31st" clamps to February and finds the 31st again in March. That math is
-- promoted here to generic recurrence_first_occurrence() /
-- recurrence_next_occurrence(); the content_studio_* pair become thin wrappers
-- so there is one copy of it, not two drifting apart.
--
-- The one difference from a routine: a routine's start date is its first
-- occurrence, whereas here the source task already covers the anchor day. So
-- the first COPY is the occurrence after the anchor when the anchor sits on
-- the schedule (a Monday task repeating weekly → next Monday), and the first
-- on-schedule day after it when it does not (a Saturday task set to "weekly
-- on Monday" → this coming Monday). The client shows the same dates before
-- saving, from the TypeScript twin in src/features/recurring/recurrence.ts.
--
-- next_run_at IS NULL means "work it out from starts_on". The client sets it
-- to null on every save, so editing a cadence restarts the arithmetic from the
-- anchor instead of firing a copy on the spot (the old hook seeded next_run_at
-- = now(), which would have made a copy within the hour of saving).
--
-- WHOSE DAY
-- Task dates are instants. A due date picked as "28 July" from India is
-- stored as 27 July 18:30 UTC, and the modal's default start date is simply
-- "now" — so the UTC calendar day of a stored date is not the day the user
-- sees, and shifting copies by UTC days would put a "weekly on Monday" task on
-- Tuesday for everyone east of Greenwich. So the client saves starts_on as the
-- LOCAL day of the task's own date, plus the browser's IANA time zone. With
-- the zone the job reads every stored instant as local wall-clock time, shifts
-- it by whole days, and converts back — which keeps the time of day, keeps the
-- local day, and is right across a DST change (a fixed offset would not be).
-- "Today" is the user's today in that zone too, so a copy appears on the first
-- hourly tick after the user's midnight, not after UTC's. A dateless source
-- has no day to shift from, so its copies are due at the occurrence's local
-- midnight. Either way the copy lands on the day the preview promised, in
-- the user's own calendar. An unknown zone name reads as UTC rather than
-- taking the series down.
--
-- Missed occurrences (cron down, series paused) are skipped, not replayed —
-- the same choice routines make; weeks of back-dated tasks help nobody.
--
-- IDEMPOTENCY
-- task_recurring_occurrences records which copy was made for which date and
-- is unique per (schedule, date): an overlapping sweep inserts nothing rather
-- than a twin. It also lets a copy point back at its series in the UI.
--
-- Content Studio routines get the same WHOSE DAY treatment in the next
-- migration (20261127000000), which also widens what a routine can carry.
--
-- Re-runnable: add column / create table / create index if not exists, drop
-- policy if exists, create or replace function.
-- =============================================================================


-- =============================================================================
-- SECTION 1: task_recurring_schedules — the dates a series lives between
-- =============================================================================

alter table public.task_recurring_schedules
    add column if not exists starts_on date,
    add column if not exists ends_on   date,
    -- The IANA zone of the browser that saved the schedule (see WHOSE DAY).
    -- Null (rows saved before this column) reads as UTC.
    add column if not exists timezone  text;

-- Existing rows (none are expected — see the header) anchor on whatever they
-- had, so the NOT NULL below can go on.
update public.task_recurring_schedules
   set starts_on = coalesce(next_run_at::date, created_at::date)
 where starts_on is null;

alter table public.task_recurring_schedules
    alter column starts_on set default current_date,
    alter column starts_on set not null,
    -- Whoever saves the schedule; the client never has to send it.
    alter column created_by set default auth.uid();

do $$
begin
    alter table public.task_recurring_schedules
        add constraint task_recurring_schedules_range_check
        check (ends_on is null or ends_on >= starts_on);
exception
    when duplicate_object then null;
end $$;

-- One schedule per task. The hook used to read-then-write around the absence
-- of this; with it, a plain upsert on task_id is the whole write.
create unique index if not exists task_recurring_schedules_task_id_uidx
    on public.task_recurring_schedules (task_id);

-- 20260701000000 let anyone who could SEE a task make it repeat. The sweep then
-- creates tasks in that project as SECURITY DEFINER, with no permission check of
-- its own — so a member whose role cannot create tasks could have the job create
-- them every week. Writing a schedule IS creating tasks; gate it as such.
drop policy if exists task_recurring_schedules_insert on public.task_recurring_schedules;
create policy task_recurring_schedules_insert on public.task_recurring_schedules
    for insert to authenticated
    with check (
        public.is_task_member(task_id)
        and public.can_create_tasks((select t.project_id from public.tasks t where t.id = task_id))
    );

drop policy if exists task_recurring_schedules_update on public.task_recurring_schedules;
create policy task_recurring_schedules_update on public.task_recurring_schedules
    for update to authenticated
    using (
        public.is_task_member(task_id)
        and public.can_create_tasks((select t.project_id from public.tasks t where t.id = task_id))
    )
    with check (
        public.is_task_member(task_id)
        and public.can_create_tasks((select t.project_id from public.tasks t where t.id = task_id))
    );

-- Moving the source task's dates moves the series with it. The anchor lives in
-- starts_on, but a task's dates can be changed from the drawer, the board, a
-- sheet or an import — anywhere but the Repeat popover. Without this the stored
-- anchor and the task drift apart, and the preview promises days the job will
-- not use. next_run_at goes null so the next sweep re-derives from the new
-- anchor; an end date now behind the anchor is cleared rather than leaving a
-- series that can never fire.
create or replace function public.task_recurring_reanchor()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s public.task_recurring_schedules;
    _d date;
begin
    select * into _s from public.task_recurring_schedules where task_id = new.id;
    if not found then
        return new;
    end if;

    _d := (coalesce(new.start_date, new.end_date)
           at time zone public.recurrence_timezone(_s.timezone))::date;
    if _d is null or _d = _s.starts_on then
        return new;
    end if;

    update public.task_recurring_schedules
       set starts_on   = _d,
           next_run_at = null,
           ends_on     = case when ends_on is not null and ends_on < _d then null else ends_on end
     where id = _s.id;

    return new;
end;
$$;

drop trigger if exists tasks_recurring_reanchor on public.tasks;
create trigger tasks_recurring_reanchor
    after update of start_date, end_date on public.tasks
    for each row
    when (new.start_date is distinct from old.start_date
          or new.end_date is distinct from old.end_date)
    execute function public.task_recurring_reanchor();

-- 20260701000000 granted the table to anon along with everyone else. There is
-- no anon policy so RLS already returned nothing; this just stops pretending.
revoke all on public.task_recurring_schedules from anon;


-- =============================================================================
-- SECTION 2: task_recurring_occurrences — which copy was made for which day
-- =============================================================================

create table if not exists public.task_recurring_occurrences (
    id              uuid                     default gen_random_uuid() not null,
    schedule_id     uuid                                               not null,
    task_id         uuid                                               not null,
    occurrence_date date                                               not null,
    created_at      timestamp with time zone default current_timestamp not null,
    constraint task_recurring_occurrences_pk primary key (id),
    constraint task_recurring_occurrences_schedule_id_fk
        foreign key (schedule_id) references public.task_recurring_schedules (id) on delete cascade,
    constraint task_recurring_occurrences_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_recurring_occurrences_unique unique (schedule_id, occurrence_date)
);

create index if not exists task_recurring_occurrences_task_id_idx
    on public.task_recurring_occurrences (task_id);

alter table public.task_recurring_occurrences enable row level security;

-- Read-only to the app: only the materializer (SECURITY DEFINER) writes here.
-- A client row would claim a copy the job never made and break the idempotency
-- check above.
drop policy if exists task_recurring_occurrences_select on public.task_recurring_occurrences;
create policy task_recurring_occurrences_select on public.task_recurring_occurrences
    for select to authenticated
    using (public.is_task_member(task_id));

grant select on public.task_recurring_occurrences to authenticated;
grant all    on public.task_recurring_occurrences to service_role;
revoke all   on public.task_recurring_occurrences from anon;


-- =============================================================================
-- SECTION 3: The calendar arithmetic, now shared
-- =============================================================================

-- A zone name the job can trust: the one given if PostgreSQL knows it, else
-- UTC. A typo in a stored zone must not raise inside the sweep.
create or replace function public.recurrence_timezone(_tz text)
    returns text
    language plpgsql
    stable
    set search_path = public, extensions
as
$$
begin
    if _tz is null or _tz = '' then
        return 'UTC';
    end if;
    perform now() at time zone _tz;
    return _tz;
exception
    when others then
        return 'UTC';
end;
$$;

-- Given a schedule and a starting point, the first day that is actually ON the
-- schedule, on or after it. Daily: the start itself. Weekly with a weekday: the
-- first such weekday on or after the start. Monthly with a day: that day this
-- month if it has not passed (clamped to the month's length), else next month's.
create or replace function public.recurrence_first_occurrence(
    _schedule_type text,
    _day_of_week   smallint,
    _day_of_month  smallint,
    _from          date
)
    returns date
    language plpgsql
    stable
    set search_path = public, extensions
as
$$
declare
    _d    date := _from;
    _last integer;
begin
    if _schedule_type = 'weekly' and _day_of_week is not null then
        -- extract(dow) is 0=Sunday, matching the day_of_week check constraints.
        return _d + (((_day_of_week - extract(dow from _d)::int) + 7) % 7);
    end if;

    if _schedule_type = 'monthly' and _day_of_month is not null then
        _last := extract(day from (date_trunc('month', _d) + interval '1 month - 1 day'))::int;
        if extract(day from _d)::int <= least(_day_of_month, _last) then
            return date_trunc('month', _d)::date + least(_day_of_month, _last) - 1;
        end if;
        _d    := (date_trunc('month', _d) + interval '1 month')::date;
        _last := extract(day from (date_trunc('month', _d) + interval '1 month - 1 day'))::int;
        return date_trunc('month', _d)::date + least(_day_of_month, _last) - 1;
    end if;

    return _d;
end;
$$;

-- Given the last occurrence, the next one. Weekly/monthly walk forward to the
-- requested day rather than adding a flat interval, so "every 2 weeks on
-- Tuesday" lands on a Tuesday and day 31 still fires in February (on the
-- 28th/29th) instead of skipping the month.
create or replace function public.recurrence_next_occurrence(
    _schedule_type text,
    _interval      integer,
    _day_of_week   smallint,
    _day_of_month  smallint,
    _after         date
)
    returns date
    language plpgsql
    stable
    set search_path = public, extensions
as
$$
declare
    _d date := _after;
begin
    if _schedule_type = 'daily' then
        return _d + make_interval(days => greatest(_interval, 1));

    elsif _schedule_type = 'weekly' then
        _d := _d + make_interval(weeks => greatest(_interval, 1));
        if _day_of_week is not null then
            _d := _d + (((_day_of_week - extract(dow from _d)::int) + 7) % 7);
        end if;
        return _d;

    elsif _schedule_type = 'monthly' then
        _d := _d + make_interval(months => greatest(_interval, 1));
        if _day_of_month is not null then
            _d := date_trunc('month', _d)::date
                  + least(
                        _day_of_month,
                        extract(day from (date_trunc('month', _d) + interval '1 month - 1 day'))::int
                    ) - 1;
        end if;
        return _d;
    end if;

    return _d + make_interval(days => greatest(_interval, 1));
end;
$$;

-- Content Studio keeps its names; the bodies now live above. Same signatures,
-- same results — nothing that calls these can tell.
create or replace function public.content_studio_first_occurrence(
    _schedule_type text,
    _day_of_week   smallint,
    _day_of_month  smallint,
    _from          date
)
    returns date
    language sql
    stable
    set search_path = public, extensions
as
$$
    select public.recurrence_first_occurrence(_schedule_type, _day_of_week, _day_of_month, _from);
$$;

create or replace function public.content_studio_next_occurrence(
    _schedule_type  text,
    _interval       integer,
    _day_of_week    smallint,
    _day_of_month   smallint,
    _after          date
)
    returns date
    language sql
    stable
    set search_path = public, extensions
as
$$
    select public.recurrence_next_occurrence(_schedule_type, _interval, _day_of_week, _day_of_month, _after);
$$;


-- =============================================================================
-- SECTION 4: The materializer
-- =============================================================================

create or replace function public.materialize_recurring_tasks()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s          record;   -- the schedule
    _src        record;   -- its source task
    _sub        record;   -- one of the source's subtasks
    _tz         text;
    _today      date;     -- in the schedule's zone
    _dow        smallint;
    _dom        smallint;
    _occurrence date;
    _anchor     date;     -- the source's own day, as the user sees it
    _shift      interval; -- whole days from the source's day to the occurrence
    _start      timestamp with time zone;
    _due        timestamp with time zone;
    _status_id  uuid;
    _copy_id    uuid;
    _sub_copy   uuid;
    -- source subtask id -> its copy, so dependencies land on THIS occurrence's
    -- subtasks and not on the source's.
    _made       jsonb;
    _count      integer := 0;
begin
    -- A series whose end date has passed is finished. The selection below never
    -- picks it (ends_on >= current_date fails), so without this it would sit at
    -- active = true forever and read as live in the UI.
    update public.task_recurring_schedules
       set active = false
     where active is true
       and ends_on is not null
       and ends_on < current_date;

    for _s in
        select * from public.task_recurring_schedules
        where active is true
          and (ends_on is null or ends_on >= current_date)
          -- next_run_at holds a calendar date (stored at UTC midnight); it is due
          -- once that date has begun in the schedule's own zone, so a copy is
          -- made on the first hourly tick after the user's midnight.
          and (next_run_at is null
               or (next_run_at at time zone 'UTC')::date
                  <= (now() at time zone public.recurrence_timezone(timezone))::date)
        order by created_at
        for update skip locked
    loop
    -- Each schedule is its own sub-transaction. One bad series (a project with
    -- no statuses, a deleted track) must not take every other one down with it
    -- for another hour.
    begin
        select id, name, description, project_id, priority_id, reporter_id,
               start_date, end_date, deliverable_type, track_id, archived
          into _src
          from public.tasks
         where id = _s.task_id;

        -- Nothing to copy from. The FK cascades a delete, so this is the
        -- archived case: an archived source is a stopped series.
        if not found or _src.archived then
            update public.task_recurring_schedules set active = false where id = _s.id;
            continue;
        end if;

        _tz    := public.recurrence_timezone(_s.timezone);
        _today := (now() at time zone _tz)::date;

        -- Weekly with no weekday, or monthly with no day, anchor to the start
        -- date's own weekday / day-of-month. Without an anchor a monthly series
        -- adding one month at a time from Jan 31 lands on Feb 28 and then stays
        -- on the 28th for good; anchoring re-finds the 31st in March.
        _dow := coalesce(_s.day_of_week,  extract(dow from _s.starts_on)::int)::smallint;
        _dom := coalesce(_s.day_of_month, extract(day from _s.starts_on)::int)::smallint;

        if _s.next_run_at is null then
            -- (Re)start from the anchor — see the header for why the first copy
            -- is the occurrence AFTER an on-schedule anchor.
            _occurrence := public.recurrence_first_occurrence(
                _s.schedule_type, _dow, _dom, _s.starts_on);
            if _occurrence <= _s.starts_on then
                _occurrence := public.recurrence_next_occurrence(
                    _s.schedule_type, _s.interval_value, _dow, _dom, _s.starts_on);
            end if;
        else
            _occurrence := (_s.next_run_at at time zone 'UTC')::date;
        end if;

        -- A date left in the past is walked forward to today or later WITHOUT
        -- building anything: the missed occurrences are simply gone.
        while _occurrence < _today loop
            _occurrence := public.recurrence_next_occurrence(
                _s.schedule_type, _s.interval_value, _dow, _dom, _occurrence);
        end loop;

        -- The next date falls after the end: the series is over.
        if _s.ends_on is not null and _occurrence > _s.ends_on then
            update public.task_recurring_schedules
               set active = false, next_run_at = null
             where id = _s.id;
            continue;
        end if;

        -- An occurrence still ahead is BOOKED, not built. Copies are made on
        -- their own day — a weekly-on-Monday task must not put Monday's copy on
        -- the board on Saturday, and neither must a resume. The booking is a
        -- plain date: the sweep is hourly, so "some time that day" is enough.
        if _occurrence > _today then
            update public.task_recurring_schedules
               set next_run_at = _occurrence::timestamp at time zone 'UTC'
             where id = _s.id;
            continue;
        end if;

        -- Already made this one (an overlapping sweep)? Book the next date.
        -- Checked BEFORE creating anything: making a task and deleting it again
        -- would fire the task triggers and burn a task_no on work that never
        -- existed. The unique constraint still backstops a genuine race.
        if exists (
            select 1 from public.task_recurring_occurrences
             where schedule_id = _s.id and occurrence_date = _occurrence
        ) then
            update public.task_recurring_schedules
               set next_run_at = public.recurrence_next_occurrence(
                       _s.schedule_type, _s.interval_value, _dow, _dom, _occurrence)::timestamp
                       at time zone 'UTC'
             where id = _s.id;
            continue;
        end if;

        -- Where the copy lands: the same rule the task modal uses — a status
        -- named "To Do" (Todo, To-Do…) if the project has one, otherwise the
        -- first column. The source's own status is deliberately NOT used: a
        -- finished source must not spawn finished copies.
        select id into _status_id
          from public.task_statuses
         where project_id = _src.project_id
         order by (regexp_replace(lower(name), '[^a-z]', '', 'g') = 'todo') desc, sort_order
         limit 1;

        -- Dates: the copy LANDS on the occurrence day — the user's day, see
        -- WHOSE DAY in the header — and keeps the source's start→due span and
        -- time of day. Every date goes through local wall-clock time
        -- (`at time zone` twice) so the shift is in the user's days, not UTC's.
        -- The anchor is the source's START day when it has one: a task that
        -- starts Monday and is due Friday repeats as Monday→Friday, not
        -- Friday→the following Tuesday. A source with a start but no due gets
        -- its due set to the start's day: a dateless copy is invisible on every
        -- calendar, which is the bug this migration exists to fix. The same
        -- coalesce order is what the drawer and the create modal anchor on, and
        -- what task_recurring_reanchor() writes back into starts_on.
        if coalesce(_src.start_date, _src.end_date) is null then
            -- No day to shift from: due at the occurrence's local midnight.
            _shift := (_occurrence - _s.starts_on) * interval '1 day';
            _due   := _occurrence::timestamp at time zone _tz;
            _start := _due;
        else
            _anchor := (coalesce(_src.start_date, _src.end_date) at time zone _tz)::date;
            _shift  := (_occurrence - _anchor) * interval '1 day';
            _start  := ((_src.start_date at time zone _tz) + _shift) at time zone _tz;   -- null stays null
            _due    := ((coalesce(_src.end_date, _src.start_date) at time zone _tz) + _shift) at time zone _tz;
        end if;

        insert into public.tasks
            (name, description, project_id, status_id, priority_id, reporter_id,
             start_date, end_date, deliverable_type, track_id, sort_order)
        values (
            _src.name,
            _src.description,
            _src.project_id,
            _status_id,
            _src.priority_id,
            _src.reporter_id,
            _start,
            _due,
            _src.deliverable_type,
            _src.track_id,
            coalesce((select max(sort_order) + 1 from public.tasks
                      where project_id = _src.project_id), 0)
        )
        returning id into _copy_id;

        insert into public.task_recurring_occurrences (schedule_id, task_id, occurrence_date)
        values (_s.id, _copy_id, _occurrence);

        -- People, labels, phase, links. The assignee insert trigger notifies
        -- each assignee of the new copy, which is exactly the "your weekly
        -- task is here" moment.
        insert into public.tasks_assignees (task_id, team_member_id, project_member_id, assigned_by)
        select _copy_id, team_member_id, project_member_id, assigned_by
          from public.tasks_assignees
         where task_id = _src.id
        on conflict do nothing;

        insert into public.task_labels (task_id, label_id)
        select _copy_id, label_id
          from public.task_labels
         where task_id = _src.id
        on conflict do nothing;

        insert into public.task_phase (task_id, phase_id)
        select _copy_id, phase_id
          from public.task_phase
         where task_id = _src.id
        on conflict do nothing;

        insert into public.task_reference_links
            (task_id, url, title, preview_image, domain, sort_order, created_by)
        select _copy_id, url, title, preview_image, domain, sort_order, created_by
          from public.task_reference_links
         where task_id = _src.id;

        -- Subtasks, in order, each with its own people, labels, phase and
        -- links. Their dates shift by the same amount as the parent's, so the
        -- gaps between them survive; a dateless subtask stays dateless
        -- (null + interval is null).
        _made := '{}'::jsonb;
        for _sub in
            select id, name, description, priority_id, reporter_id, start_date,
                   end_date, deliverable_type, track_id, sort_order
              from public.tasks
             where parent_task_id = _src.id
               and archived is false
             order by sort_order, created_at
        loop
            insert into public.tasks
                (name, description, project_id, status_id, priority_id, reporter_id,
                 parent_task_id, start_date, end_date, deliverable_type, track_id, sort_order)
            values (
                _sub.name, _sub.description, _src.project_id, _status_id,
                _sub.priority_id, _sub.reporter_id, _copy_id,
                ((_sub.start_date at time zone _tz) + _shift) at time zone _tz,
                ((_sub.end_date   at time zone _tz) + _shift) at time zone _tz,
                _sub.deliverable_type, _sub.track_id, _sub.sort_order
            )
            returning id into _sub_copy;

            insert into public.tasks_assignees (task_id, team_member_id, project_member_id, assigned_by)
            select _sub_copy, team_member_id, project_member_id, assigned_by
              from public.tasks_assignees
             where task_id = _sub.id
            on conflict do nothing;

            insert into public.task_labels (task_id, label_id)
            select _sub_copy, label_id
              from public.task_labels
             where task_id = _sub.id
            on conflict do nothing;

            insert into public.task_phase (task_id, phase_id)
            select _sub_copy, phase_id
              from public.task_phase
             where task_id = _sub.id
            on conflict do nothing;

            insert into public.task_reference_links
                (task_id, url, title, preview_image, domain, sort_order, created_by)
            select _sub_copy, url, title, preview_image, domain, sort_order, created_by
              from public.task_reference_links
             where task_id = _sub.id;

            _made := _made || jsonb_build_object(_sub.id::text, _sub_copy);
        end loop;

        -- Dependencies BETWEEN the source's subtasks, re-pointed at the copies.
        -- Links to tasks outside the source are its own business and are not
        -- copied.
        insert into public.task_dependencies (task_id, depends_on_task_id, relation_type)
        select (_made ->> d.task_id::text)::uuid,
               (_made ->> d.depends_on_task_id::text)::uuid,
               d.relation_type
          from public.task_dependencies d
         where _made ? d.task_id::text
           and _made ? d.depends_on_task_id::text
        on conflict do nothing;

        _count := _count + 1;

        update public.task_recurring_schedules
           set last_created_at = now(),
               next_run_at     = public.recurrence_next_occurrence(
                                     _s.schedule_type, _s.interval_value, _dow, _dom, _occurrence)::timestamp
                                     at time zone 'UTC'
         where id = _s.id;

        -- Past its end date now? Stop it, so the job stops looking at it.
        update public.task_recurring_schedules
           set active = false
         where id = _s.id
           and ends_on is not null
           and (next_run_at at time zone 'UTC')::date > ends_on;
    exception when others then
        raise notice 'Recurring tasks: schedule % skipped this sweep — % (%)', _s.id, sqlerrm, sqlstate;
    end;
    end loop;

    return _count;
end;
$$;

-- The sweep is infrastructure (pg_cron runs it as postgres), not an app call.
-- 20260701000000 left it executable by everyone.
revoke all on function public.materialize_recurring_tasks() from public, anon, authenticated;
grant execute on function public.materialize_recurring_tasks() to service_role;

-- The hourly job from 20260701000000 ('materialize-recurring-tasks', 0 * * * *)
-- keeps running this function by name; nothing to reschedule.
