-- =============================================================================
-- Content Studio — recurring posting routines
-- =============================================================================
-- "Alternate day posting: someone makes the Instagram post, someone else
-- publishes it, publish can't start until creation is done." Set that up once
-- and it should keep producing itself.
--
-- Everything it produces already exists in this product: tasks, subtasks
-- (tasks.parent_task_id), assignees (tasks_assignees) and dependencies
-- (task_dependencies). What is missing is something that says what to make and
-- a job that makes it. That is these three tables plus one function.
--
--   * app_content_studio_routines       — the series: what it is called, which
--     project its tasks land in, and how often it fires.
--   * app_content_studio_routine_steps  — the blueprint: one row per subtask,
--     with its assignee, its day offset, and which step it waits on.
--   * app_content_studio_routine_tasks  — the receipt: which task came from
--     which step on which date. Also the idempotency key (see below).
--
-- WHY A BLUEPRINT AND NOT A CLONED TASK
-- The existing global recurrence (task_recurring_schedules, migration
-- 20260701000000) copies a live task each cycle. That model cannot express this
-- one: it copies a single flat task — no subtasks, no assignees, no
-- dependencies, and no dates, which is why its clones never appear on any
-- calendar. It also leaves the source sitting on the board as a real task, so
-- editing "the template" silently rewrites work someone may already be doing.
-- A blueprint keeps "change this week's task" and "change the series" as two
-- different acts. That global machinery is left untouched and dormant here.
--
-- IDEMPOTENCY
-- The materializer is driven by pg_cron and may run twice, overlap, or be
-- called by hand while the cron job is mid-flight. Duplicate tasks would be
-- indistinguishable from real ones and a nightmare to unpick, so the receipt
-- table carries unique indexes on (routine_id, step_id, occurrence_date) and a
-- partial one for the parent row. A second run inserts nothing rather than a
-- second copy.
--
-- Re-runnable: create table if not exists / drop policy if exists /
-- create or replace function / drop trigger if exists.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables
-- =============================================================================

-- 1.1 app_content_studio_routines — one recurring series.
create table if not exists public.app_content_studio_routines (
    id             uuid                     default gen_random_uuid() not null,
    team_id        uuid                                               not null,
    -- Tasks are created here. NOT NULL because tasks.project_id is NOT NULL —
    -- a routine with nowhere to put its work is not a routine.
    project_id     uuid                                               not null,
    campaign_id    uuid,
    name           text                                               not null,
    description    text,
    schedule_type  text                     default 'daily'           not null,
    -- "Alternate day" is daily with interval 2. Weekly/monthly use the
    -- day_of_week / day_of_month columns below.
    interval_value integer                  default 1                 not null,
    day_of_week    smallint,
    day_of_month   smallint,
    starts_on      date                     default current_date      not null,
    ends_on        date,
    active         boolean                  default true              not null,
    next_run_at    timestamp with time zone,
    last_run_at    timestamp with time zone,
    created_by     uuid,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint app_content_studio_routines_pk primary key (id),
    constraint app_content_studio_routines_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_content_studio_routines_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_content_studio_routines_campaign_fk
        foreign key (campaign_id) references public.app_content_studio_campaigns (id)
        on delete set null,
    constraint app_content_studio_routines_name_check
        check (char_length(name) between 1 and 160),
    constraint app_content_studio_routines_type_check
        check (schedule_type in ('daily', 'weekly', 'monthly')),
    constraint app_content_studio_routines_interval_check
        check (interval_value between 1 and 365),
    constraint app_content_studio_routines_dow_check
        check (day_of_week is null or day_of_week between 0 and 6),
    constraint app_content_studio_routines_dom_check
        check (day_of_month is null or day_of_month between 1 and 31),
    constraint app_content_studio_routines_range_check
        check (ends_on is null or ends_on >= starts_on)
);

-- The materializer's only scan: active routines that are due.
create index if not exists app_content_studio_routines_due_idx
    on public.app_content_studio_routines (next_run_at)
    where active is true;

create index if not exists app_content_studio_routines_team_idx
    on public.app_content_studio_routines (team_id, project_id);

-- 1.2 app_content_studio_routine_steps — one subtask per row, per occurrence.
create table if not exists public.app_content_studio_routine_steps (
    id                     uuid                     default gen_random_uuid() not null,
    routine_id             uuid                                               not null,
    team_id                uuid                                               not null,
    position               integer                  default 0                 not null,
    title                  text                                               not null,
    -- Free text. The client's picker offers SOCIAL_PLATFORMS, which covers the
    -- social platforms only; other destination kinds (blog, newsletter, video
    -- channel, podcast) are named here just as freely. No constraint, so a new
    -- platform never needs a migration to be usable.
    platform               text,
    -- team_members.id, matching tasks_assignees.team_member_id.
    assignee_team_member_id uuid,
    -- Days after the occurrence date this step is due. 0 = the day itself;
    -- creation on day 0 and publish on day 1 is the whole point of the column.
    due_offset_days        integer                  default 0                 not null,
    -- Becomes a real task_dependencies row between the two generated tasks.
    depends_on_step_id     uuid,
    kind                   text                     default 'generic'         not null,
    constraint app_content_studio_routine_steps_pk primary key (id),
    constraint app_content_studio_routine_steps_routine_fk
        foreign key (routine_id) references public.app_content_studio_routines (id)
        on delete cascade,
    constraint app_content_studio_routine_steps_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_content_studio_routine_steps_member_fk
        foreign key (assignee_team_member_id) references public.team_members (id)
        on delete set null,
    -- Deleting a step clears anything waiting on it rather than cascading the
    -- delete: the waiting step is still real work, it just no longer waits.
    constraint app_content_studio_routine_steps_depends_fk
        foreign key (depends_on_step_id) references public.app_content_studio_routine_steps (id)
        on delete set null,
    constraint app_content_studio_routine_steps_title_check
        check (char_length(title) between 1 and 200),
    constraint app_content_studio_routine_steps_offset_check
        check (due_offset_days between 0 and 60),
    constraint app_content_studio_routine_steps_kind_check
        check (kind in ('creation', 'publish', 'generic')),
    -- A step waiting on itself would deadlock the dependency graph.
    constraint app_content_studio_routine_steps_self_check
        check (depends_on_step_id is null or depends_on_step_id <> id)
);

create index if not exists app_content_studio_routine_steps_routine_idx
    on public.app_content_studio_routine_steps (routine_id, position);

-- 1.3 app_content_studio_routine_tasks — what was generated, and when.
create table if not exists public.app_content_studio_routine_tasks (
    id              uuid                     default gen_random_uuid() not null,
    routine_id      uuid                                               not null,
    -- NULL marks the occurrence's PARENT task; a value marks that step's subtask.
    step_id         uuid,
    task_id         uuid                                               not null,
    team_id         uuid                                               not null,
    occurrence_date date                                               not null,
    -- 'parent' for the occurrence's parent task, 'step' for a subtask. The
    -- idempotency index keys on THIS, not on step_id: step_id is nullable and
    -- goes null when its step is deleted (editing a routine replaces the whole
    -- step set), and a child receipt with a nulled step_id must never be taken
    -- for the parent — that collision made every routine un-editable after its
    -- first run.
    role            text                     default 'step'            not null,
    created_at      timestamp with time zone default current_timestamp not null,
    constraint app_content_studio_routine_tasks_pk primary key (id),
    constraint app_content_studio_routine_tasks_role_check
        check (role in ('parent', 'step')),
    constraint app_content_studio_routine_tasks_routine_fk
        foreign key (routine_id) references public.app_content_studio_routines (id)
        on delete cascade,
    -- Deleting a step keeps the tasks it already produced: they are real work
    -- that was really done. The receipt just loses its pointer.
    constraint app_content_studio_routine_tasks_step_fk
        foreign key (step_id) references public.app_content_studio_routine_steps (id)
        on delete set null,
    constraint app_content_studio_routine_tasks_task_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint app_content_studio_routine_tasks_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade
);

-- The idempotency pair. Postgres treats NULLs in a unique index as distinct, so
-- the parent row needs its own partial index or a re-run would happily insert a
-- second parent for the same day. It is keyed on role, deliberately not on
-- "step_id is null": deleting a step (which editing a routine does for every
-- step) nulls step_id on that step's old receipts, and under a step_id-is-null
-- predicate those orphans collided with the parent row and aborted the edit.
create unique index if not exists app_content_studio_routine_tasks_step_uindex
    on public.app_content_studio_routine_tasks (routine_id, step_id, occurrence_date)
    where step_id is not null;

create unique index if not exists app_content_studio_routine_tasks_parent_uindex
    on public.app_content_studio_routine_tasks (routine_id, occurrence_date)
    where role = 'parent';

create index if not exists app_content_studio_routine_tasks_task_idx
    on public.app_content_studio_routine_tasks (task_id);


-- =============================================================================
-- SECTION 2: RLS — the same gate the rest of Content Studio uses
-- =============================================================================

alter table public.app_content_studio_routines      enable row level security;
alter table public.app_content_studio_routine_steps enable row level security;
alter table public.app_content_studio_routine_tasks enable row level security;

drop policy if exists app_content_studio_routines_all on public.app_content_studio_routines;
create policy app_content_studio_routines_all on public.app_content_studio_routines
    for all to authenticated
    using (
        public.is_team_member(team_id)
        and public.is_project_team_member(project_id)
    )
    with check (
        public.is_team_member(team_id)
        and public.is_project_team_member(project_id)
    );

drop policy if exists app_content_studio_routine_steps_all on public.app_content_studio_routine_steps;
create policy app_content_studio_routine_steps_all on public.app_content_studio_routine_steps
    for all to authenticated
    using (public.is_team_member(team_id))
    with check (public.is_team_member(team_id));

-- Read-only to the app: these rows are written by the materializer, which runs
-- SECURITY DEFINER. A client inserting here would claim a task came from a
-- routine that never made it, and would poison the idempotency check.
drop policy if exists app_content_studio_routine_tasks_read on public.app_content_studio_routine_tasks;
create policy app_content_studio_routine_tasks_read on public.app_content_studio_routine_tasks
    for select to authenticated
    using (public.is_team_member(team_id));


-- =============================================================================
-- SECTION 3: The occurrence date helper
-- =============================================================================

-- Given a routine and a starting point, the next date it should fire on.
-- Weekly/monthly walk forward to the requested day rather than adding a flat
-- interval, so "every 2 weeks on Tuesday" lands on a Tuesday.
create or replace function public.content_studio_next_occurrence(
    _schedule_type  text,
    _interval       integer,
    _day_of_week    smallint,
    _day_of_month   smallint,
    _after          date
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
            -- extract(dow) is 0=Sunday, matching day_of_week's check constraint.
            _d := _d + (((_day_of_week - extract(dow from _d)::int) + 7) % 7);
        end if;
        return _d;

    elsif _schedule_type = 'monthly' then
        _d := _d + make_interval(months => greatest(_interval, 1));
        if _day_of_month is not null then
            -- Clamp to the month's length so day 31 still fires in February
            -- (on the 28th/29th) instead of skipping the month entirely.
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


-- =============================================================================
-- SECTION 4: The materializer
-- =============================================================================

-- Where a series BEGINS. next_occurrence() answers "given the last one, when is
-- the next?"; this answers "given a start date, which is the first day actually
-- ON the schedule?" Daily: the start itself. Weekly with a day set: the first
-- such weekday on or after the start. Monthly with a day set: that day this
-- month if it has not passed (clamped to the month's length), else next month's.
create or replace function public.content_studio_first_occurrence(
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
    _occurrence date;
    _parent_id  uuid;
    _task_id    uuid;
    _dep_task   uuid;
    _status_id  uuid;
    -- step_id -> the task just created for it, so dependencies land on THIS
    -- occurrence's tasks and not on last cycle's.
    _made       jsonb;
    _count      integer := 0;
    -- Weekly with no weekday, or monthly with no day, anchor to the start date's
    -- own weekday / day-of-month. Without an anchor a monthly series adding one
    -- month at a time from Jan 31 lands on Feb 28 and then stays on the 28th for
    -- good; anchoring re-finds the 31st in March.
    _dow        smallint;
    _dom        smallint;
begin
    -- A series whose end date has passed is finished. The selection below never
    -- picks it (ends_on >= current_date fails), so without this it would sit at
    -- active = true forever and read as live in the UI.
    update public.app_content_studio_routines
       set active = false, updated_at = now()
     where active is true
       and ends_on is not null
       and ends_on < current_date;

    for _r in
        select * from public.app_content_studio_routines
        where active is true
          and starts_on <= current_date
          and (ends_on is null or ends_on >= current_date)
          and (next_run_at is null or next_run_at <= now())
        order by created_at
        for update skip locked
    loop
    -- Each routine is its own sub-transaction. One bad routine (project with no
    -- statuses, a deleted assignee, lock trouble) must not take every other
    -- routine down with it for another hour.
    begin
        _dow := coalesce(_r.day_of_week,  extract(dow from _r.starts_on)::smallint);
        _dom := coalesce(_r.day_of_month, extract(day from _r.starts_on)::smallint);
        -- Never run: derive the first date from starts_on — a DATE, so immune to
        -- how the client seeded next_run_at. (A browser east of UTC seeds its
        -- local midnight, which is the previous day once cast to a date here,
        -- and that shifted a whole series a day early.) Clamp to today so a
        -- start date in the past does not burst out one back-dated task per
        -- hourly tick until it catches up, and snap onto the schedule so a
        -- weekly-on-Monday routine created on a Saturday makes its first task
        -- on the Monday rather than the Saturday.
        -- Already run: the date already booked.
        if _r.last_run_at is null then
            _occurrence := public.content_studio_first_occurrence(
                _r.schedule_type, _dow, _dom, greatest(_r.starts_on, current_date));
        else
            _occurrence := coalesce(_r.next_run_at::date, current_date);
            -- A booking left in the past — the routine was paused and resumed,
            -- or the cron was down — is walked forward to today or later
            -- WITHOUT building anything. Replaying every missed date would put
            -- weeks of back-dated tasks on the board one per hourly tick; the
            -- missed occurrences are simply gone, as they are for the global
            -- recurring-tasks feature.
            while _occurrence < current_date loop
                _occurrence := public.content_studio_next_occurrence(
                    _r.schedule_type, _r.interval_value, _dow, _dom, _occurrence);
            end loop;
        end if;

        -- An occurrence still ahead is BOOKED, not built. Tasks are made on
        -- their own day — a weekly-on-Monday routine created on a Saturday must
        -- not put Monday's task on the board early, and neither must a resume.
        if _occurrence > current_date then
            update public.app_content_studio_routines
               set next_run_at = _occurrence::timestamptz
             where id = _r.id;
            continue;
        end if;
        _made := '{}'::jsonb;

        -- Already made this one? Skip to booking the next date. Checked BEFORE
        -- creating anything: making a task and deleting it again would fire the
        -- task triggers and burn a task_no on work that never existed. The
        -- unique indexes still backstop a genuine race.
        if exists (
            select 1 from public.app_content_studio_routine_tasks
            where routine_id = _r.id
              and occurrence_date = _occurrence
              and role = 'parent'
        ) then
            update public.app_content_studio_routines
                set next_run_at = public.content_studio_next_occurrence(
                        _r.schedule_type, _r.interval_value, _dow, _dom, _occurrence)
                where id = _r.id;
            continue;
        end if;

        -- The project's first column, so generated tasks land somewhere a board
        -- can show them instead of in a statusless limbo.
        -- Same rule the task modal uses: a status named "To Do" (Todo, To-Do…)
        -- if the project has one, otherwise the first column. "First by
        -- sort_order" alone put new work in whatever column happened to be
        -- leftmost, which in some projects is Done.
        select id into _status_id
        from public.task_statuses
        where project_id = _r.project_id
        order by (regexp_replace(lower(name), '[^a-z]', '', 'g') = 'todo') desc, sort_order
        limit 1;

        -- The parent task. end_date is what every calendar in the product reads
        -- a task's day from — without it these would exist and be invisible,
        -- which is exactly the bug the global recurrence has.
        insert into public.tasks (name, project_id, status_id, start_date, end_date, sort_order)
        values (
            _r.name,
            _r.project_id,
            _status_id,
            _occurrence,
            _occurrence,
            coalesce((select max(sort_order) + 1 from public.tasks
                      where project_id = _r.project_id), 0)
        )
        returning id into _parent_id;

        insert into public.app_content_studio_routine_tasks
            (routine_id, step_id, task_id, team_id, occurrence_date, role)
        values (_r.id, null, _parent_id, _r.team_id, _occurrence, 'parent');

        -- Steps, in order, so a dependency can only point at something already
        -- made this pass.
        for _step in
            select * from public.app_content_studio_routine_steps
            where routine_id = _r.id
            order by position, title
        loop
            insert into public.tasks
                (name, project_id, status_id, parent_task_id, start_date, end_date, sort_order)
            values (
                _step.title,
                _r.project_id,
                _status_id,
                _parent_id,
                _occurrence + _step.due_offset_days,
                _occurrence + _step.due_offset_days,
                _step.position
            )
            returning id into _task_id;

            if _step.assignee_team_member_id is not null then
                insert into public.tasks_assignees (task_id, team_member_id)
                values (_task_id, _step.assignee_team_member_id)
                on conflict do nothing;
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
                        _r.schedule_type, _r.interval_value, _dow, _dom, _occurrence),
                updated_at  = now()
            where id = _r.id;

        -- Past its end date now? Stop it, so the job stops looking at it.
        update public.app_content_studio_routines
            set active = false
            where id = _r.id
              and ends_on is not null
              and next_run_at::date > ends_on;
    exception when others then
        raise notice 'Content Studio: routine % skipped this sweep — % (%)', _r.id, sqlerrm, sqlstate;
    end;
    end loop;

    return _count;
end;
$$;


-- =============================================================================
-- SECTION 5: Schedule it
-- =============================================================================

-- Hourly, matching the existing materialize-recurring-tasks job. Guarded so the
-- migration still succeeds where pg_cron is unavailable.
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('content-studio-materialize-routines');
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'content-studio-materialize-routines',
            '5 * * * *',
            $cron$ select public.content_studio_materialize_routines(); $cron$
        );
        raise notice 'Content Studio: scheduled pg_cron job "content-studio-materialize-routines" (hourly).';
    else
        raise notice 'Content Studio: pg_cron unavailable — call content_studio_materialize_routines() manually.';
    end if;
exception
    when others then
        raise notice 'Content Studio: pg_cron setup skipped (% — %).', sqlstate, sqlerrm;
end $$;


-- =============================================================================
-- SECTION 6: Grants
-- =============================================================================

grant select, insert, update, delete on public.app_content_studio_routines      to authenticated;
grant select, insert, update, delete on public.app_content_studio_routine_steps to authenticated;
grant select                         on public.app_content_studio_routine_tasks to authenticated;

grant all on public.app_content_studio_routines      to service_role;
grant all on public.app_content_studio_routine_steps to service_role;
grant all on public.app_content_studio_routine_tasks to service_role;

revoke all on public.app_content_studio_routines      from anon;
revoke all on public.app_content_studio_routine_steps from anon;
revoke all on public.app_content_studio_routine_tasks from anon;

-- The sweep is infrastructure, not an app call.
revoke all on function public.content_studio_materialize_routines() from public, anon;
grant execute on function public.content_studio_materialize_routines() to service_role;
