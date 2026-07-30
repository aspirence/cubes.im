-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 6: Time tracking + Reporting
-- =============================================================================
-- Builds on Phase 1 (identity/tenancy + is_team_member / is_team_admin /
-- is_org_member), Phase 3 (projects + project-granular helpers: team_id_of_project
-- / is_project_team_member / is_project_team_admin) and Phase 4 (tasks incl.
-- total_minutes / end_date / done, task_statuses + sys_task_status_categories,
-- tasks_assignees, is_task_member, create_task / create_project).
--
-- Adds:
--   * task_work_log  — manual + timer-derived time logs (time_spent in SECONDS).
--   * task_timers    — at most one running timer per (task, user).
--   * start_timer / stop_timer / log_time  — SECURITY DEFINER time-entry RPCs.
--   * report_team_overview / report_projects / report_members / report_time_logs
--     — STABLE SECURITY DEFINER reporting RPCs, each scoped to a team the caller
--     belongs to (is_team_member(p_team_id) gate).
--   * RLS enable + policies + grants for the two new public tables.
--
-- Ported faithfully from the legacy schema (cubes-backend/database/sql/
-- {1_tables,4_functions}.sql) with the SAME Supabase adaptations Phases 1-5 used:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() via the column DEFAULT
--     (never cast explicitly in a function body).
--   * any FUNCTION BODY touching gen_random_uuid()/citext pins
--     `set search_path = public, extensions` (Phase 1-5 lesson). The reporting
--     RPCs pin (public, extensions); the timer/log RPCs pin (public, extensions)
--     too so they resolve public.* deterministically and may insert with the UUID
--     default.
--   * RLS is enforced in the database; Phase 1's is_team_member, Phase 3's
--     is_project_team_admin and Phase 4's is_task_member are REUSED (NOT recreated).
--
-- TIME UNITS (important):
--   * task_work_log.time_spent is stored in SECONDS (integer, per the brief —
--     legacy used NUMERIC seconds; the brief narrows it to integer seconds).
--   * tasks.total_minutes (Phase 4, numeric) is the per-task rollup in MINUTES.
--     stop_timer / log_time bump it (ceil(seconds/60) and p_minutes respectively).
--   * The reporting RPCs surface logged time in MINUTES (round(sum(time_spent)/60)).
--
-- Faithfulness notes vs. legacy columns (per the Phase 6 brief):
--   * task_work_log: legacy time_spent NUMERIC -> integer SECONDS (NOT NULL).
--     Added is_billable boolean default true (legacy had no billable flag on the
--     log; the brief wants it). Added updated_at. task_id FK CASCADE, user_id FK
--     -> users (legacy CASCADE on user delete; kept). description CHECK <= 500.
--   * task_timers: legacy PK(task_id, user_id) -> here a surrogate id PK + a
--     UNIQUE(task_id, user_id) (so a user has at most one running timer per task,
--     and start_timer can UPSERT on that constraint and RETURN the id). start_time
--     NOT NULL default now(); added created_at. Both FKs CASCADE.
--
-- Re-runnable where practical (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS / ON CONFLICT). No lookup seed needed.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 task_work_log (legacy: task_work_log). Manual + timer-derived time logs.
--     time_spent is in SECONDS. logged_by_timer distinguishes timer-derived rows
--     (stop_timer) from manual entries (log_time). is_billable defaults true.
-- -----------------------------------------------------------------------------
create table if not exists public.task_work_log (
    id              uuid                     default gen_random_uuid() not null,
    task_id         uuid                                               not null,
    user_id         uuid                                               not null,
    time_spent      integer                                            not null,
    description     text,
    is_billable     boolean                  default true              not null,
    logged_by_timer boolean                  default false             not null,
    created_at      timestamp with time zone default current_timestamp not null,
    updated_at      timestamp with time zone default current_timestamp not null,
    constraint task_work_log_pk primary key (id),
    constraint task_work_log_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_work_log_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint task_work_log_time_spent_check check (time_spent >= 0),
    constraint task_work_log_description_check check (char_length(description) <= 500)
);

-- -----------------------------------------------------------------------------
-- 1.2 task_timers (legacy: task_timers). One running timer per (task, user).
--     UNIQUE(task_id, user_id) enforces "at most one running timer per task per
--     user"; start_timer UPSERTs on it. start_time default now() (NOT NULL).
-- -----------------------------------------------------------------------------
create table if not exists public.task_timers (
    id         uuid                     default gen_random_uuid() not null,
    task_id    uuid                                               not null,
    user_id    uuid                                               not null,
    start_time timestamp with time zone default current_timestamp not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint task_timers_pk primary key (id),
    constraint task_timers_task_user_unique unique (task_id, user_id),
    constraint task_timers_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_timers_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists task_work_log_task_id_index
    on public.task_work_log (task_id);
create index if not exists task_work_log_user_id_index
    on public.task_work_log (user_id);
create index if not exists task_work_log_created_at_index
    on public.task_work_log (created_at);

create index if not exists task_timers_user_id_index
    on public.task_timers (user_id);
-- (UNIQUE(task_id, user_id) supplies the (task_id, user_id) lookup index.)


-- =============================================================================
-- SECTION 3: Time-entry RPCs (SECURITY DEFINER, pinned search_path)
-- =============================================================================
-- All three verify the caller may act on the task (is_task_member) and write on
-- behalf of auth.uid(). They pin search_path = public, extensions so the
-- gen_random_uuid() column default resolves and public.* is deterministic.

-- -----------------------------------------------------------------------------
-- 3.1 start_timer(p_task_id) — start (or re-arm) the caller's timer for the task.
--     UPSERT on UNIQUE(task_id, user_id): a fresh start_time = now() each call.
--     Returns the timer id.
-- -----------------------------------------------------------------------------
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
begin
    if _user_id is null then
        raise exception 'start_timer: no authenticated user';
    end if;

    if not public.is_task_member(p_task_id) then
        raise exception 'start_timer: caller is not a member of task %', p_task_id;
    end if;

    insert into public.task_timers (task_id, user_id, start_time)
    values (p_task_id, _user_id, now())
    on conflict (task_id, user_id)
        do update set start_time = now()
    returning id into _timer_id;

    return _timer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3.2 stop_timer(p_task_id, p_description, p_is_billable) — stop the caller's
--     running timer for the task: compute elapsed seconds, write a task_work_log
--     row (logged_by_timer = true), delete the timer, and bump tasks.total_minutes
--     by ceil(seconds / 60). Returns the new work-log id. Raises if no timer.
-- -----------------------------------------------------------------------------
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

    -- Find (and lock) the caller's running timer for this task.
    select start_time into _start_time
    from public.task_timers
    where task_id = p_task_id and user_id = _user_id
    for update;

    if _start_time is null then
        raise exception 'stop_timer: no running timer for task % and current user', p_task_id;
    end if;

    -- Elapsed whole seconds (never negative).
    _seconds := greatest(0, floor(extract(epoch from (now() - _start_time)))::integer);

    insert into public.task_work_log
        (task_id, user_id, time_spent, description, is_billable, logged_by_timer)
    values (p_task_id, _user_id, _seconds, p_description, coalesce(p_is_billable, true), true)
    returning id into _log_id;

    delete from public.task_timers
    where task_id = p_task_id and user_id = _user_id;

    -- Roll up to the task in MINUTES (ceil so any partial minute counts).
    update public.tasks
        set total_minutes = total_minutes + ceil(_seconds::numeric / 60)
        where id = p_task_id;

    return _log_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3.3 log_time(p_task_id, p_minutes, p_description, p_is_billable) — a manual
--     time entry (minutes). Stores time_spent = p_minutes * 60 SECONDS,
--     logged_by_timer = false, and bumps tasks.total_minutes by p_minutes.
--     Returns the new work-log id.
-- -----------------------------------------------------------------------------
create or replace function public.log_time(
    p_task_id     uuid,
    p_minutes     integer,
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
    _user_id uuid := auth.uid();
    _log_id  uuid;
begin
    if _user_id is null then
        raise exception 'log_time: no authenticated user';
    end if;

    if not public.is_task_member(p_task_id) then
        raise exception 'log_time: caller is not a member of task %', p_task_id;
    end if;

    if p_minutes is null or p_minutes <= 0 then
        raise exception 'log_time: p_minutes must be a positive integer (got %)', p_minutes;
    end if;

    insert into public.task_work_log
        (task_id, user_id, time_spent, description, is_billable, logged_by_timer)
    values (p_task_id, _user_id, p_minutes * 60, p_description, coalesce(p_is_billable, true), false)
    returning id into _log_id;

    update public.tasks
        set total_minutes = total_minutes + p_minutes
        where id = p_task_id;

    return _log_id;
end;
$$;


-- =============================================================================
-- SECTION 4: Reporting RPCs (STABLE, SECURITY DEFINER, search_path public,extensions)
-- =============================================================================
-- Each is scoped to a team the caller belongs to: the first statement raises if
-- the caller is not is_team_member(p_team_id), so a non-member gets no data. They
-- run SECURITY DEFINER (RLS bypassed) but the membership gate makes that safe.
--
-- Conventions used by all four:
--   * "completed" task  := tasks.done = true.
--   * "overdue"  task   := end_date < now() AND done = false.
--   * logged minutes    := round(sum(task_work_log.time_spent) / 60) — time_spent
--                          is SECONDS; reports surface MINUTES.

-- -----------------------------------------------------------------------------
-- 4.1 report_team_overview(p_team_id) — a single summary row for the team.
-- -----------------------------------------------------------------------------
create or replace function public.report_team_overview(p_team_id uuid)
    returns table (
        total_projects        bigint,
        active_projects       bigint,
        total_tasks           bigint,
        completed_tasks       bigint,
        overdue_tasks         bigint,
        total_members         bigint,
        total_logged_minutes  bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_team_overview: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        (select count(*) from public.projects p where p.team_id = p_team_id),
        -- "active" := projects that have at least one not-done task (open work).
        (select count(distinct p.id)
           from public.projects p
           join public.tasks t on t.project_id = p.id
          where p.team_id = p_team_id and t.done is false),
        (select count(*)
           from public.tasks t
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id),
        (select count(*)
           from public.tasks t
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id and t.done is true),
        (select count(*)
           from public.tasks t
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id
            and t.done is false
            and t.end_date is not null
            and t.end_date < now()),
        (select count(*)
           from public.team_members tm
          where tm.team_id = p_team_id and tm.active is true),
        (select coalesce(round(sum(wl.time_spent)::numeric / 60), 0)::bigint
           from public.task_work_log wl
           join public.tasks t   on t.id = wl.task_id
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4.2 report_projects(p_team_id) — one row per project in the team.
-- -----------------------------------------------------------------------------
create or replace function public.report_projects(p_team_id uuid)
    returns table (
        project_id     uuid,
        project_name   text,
        total_tasks    bigint,
        completed_tasks bigint,
        completion_pct  numeric,
        logged_minutes  bigint,
        member_count    bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_projects: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        p.id,
        p.name,
        coalesce(tk.total_tasks, 0),
        coalesce(tk.completed_tasks, 0),
        case
            when coalesce(tk.total_tasks, 0) = 0 then 0::numeric
            else round(coalesce(tk.completed_tasks, 0)::numeric * 100
                       / tk.total_tasks, 2)
        end,
        coalesce(wl.logged_minutes, 0),
        coalesce(pm.member_count, 0)
    from public.projects p
    left join lateral (
        select count(*)                                   as total_tasks,
               count(*) filter (where t.done is true)     as completed_tasks
        from public.tasks t
        where t.project_id = p.id
    ) tk on true
    left join lateral (
        select round(sum(w.time_spent)::numeric / 60)::bigint as logged_minutes
        from public.task_work_log w
        join public.tasks t2 on t2.id = w.task_id
        where t2.project_id = p.id
    ) wl on true
    left join lateral (
        select count(*)::bigint as member_count
        from public.project_members m
        where m.project_id = p.id
    ) pm on true
    where p.team_id = p_team_id
    order by p.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4.3 report_members(p_team_id) — one row per active team member: how many tasks
--     they are assigned, how many of those are done, and minutes they have logged.
-- -----------------------------------------------------------------------------
create or replace function public.report_members(p_team_id uuid)
    returns table (
        team_member_id  uuid,
        user_name       text,
        assigned_tasks  bigint,
        completed_tasks bigint,
        logged_minutes  bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_members: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        tm.id,
        u.name,
        coalesce(asg.assigned_tasks, 0),
        coalesce(asg.completed_tasks, 0),
        coalesce(wl.logged_minutes, 0)
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    left join lateral (
        select count(*)                                as assigned_tasks,
               count(*) filter (where t.done is true)  as completed_tasks
        from public.tasks_assignees ta
        join public.tasks t on t.id = ta.task_id
        where ta.team_member_id = tm.id
    ) asg on true
    left join lateral (
        select round(sum(w.time_spent)::numeric / 60)::bigint as logged_minutes
        from public.task_work_log w
        where w.user_id = tm.user_id
          and exists (
              select 1
              from public.tasks t3
              join public.projects p3 on p3.id = t3.project_id
              where t3.id = w.task_id and p3.team_id = p_team_id
          )
    ) wl on true
    where tm.team_id = p_team_id
      and tm.active is true
    order by u.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4.4 report_time_logs(p_team_id, p_from, p_to) — the raw time-log feed for the
--     team, optionally bounded by [p_from, p_to] on created_at (date bounds; p_to
--     is inclusive of the whole day). minutes := round(time_spent / 60).
-- -----------------------------------------------------------------------------
create or replace function public.report_time_logs(
    p_team_id uuid,
    p_from    date default null,
    p_to      date default null
)
    returns table (
        log_id       uuid,
        task_name    text,
        project_name text,
        user_name    text,
        minutes      bigint,
        is_billable  boolean,
        logged_at    timestamp with time zone
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_time_logs: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        wl.id,
        t.name,
        p.name,
        u.name,
        round(wl.time_spent::numeric / 60)::bigint,
        wl.is_billable,
        wl.created_at
    from public.task_work_log wl
    join public.tasks    t on t.id = wl.task_id
    join public.projects p on p.id = t.project_id
    join public.users    u on u.id = wl.user_id
    where p.team_id = p_team_id
      and (p_from is null or wl.created_at >= p_from::timestamptz)
      and (p_to   is null or wl.created_at < (p_to + 1)::timestamptz)
    order by wl.created_at desc;
end;
$$;


-- =============================================================================
-- SECTION 5: Enable Row Level Security + policies
-- =============================================================================
alter table public.task_work_log enable row level security;
alter table public.task_timers   enable row level security;

-- Convention (matches Phases 1-5): drop-then-create so the migration is
-- re-runnable; policies target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 5.1 task_work_log — members of the task's project see + log time. UPDATE/DELETE
--     additionally require the log is the caller's own OR the caller is an admin
--     of the task's project (is_project_team_admin via the task's project).
-- -------------------------------------------------------------------
drop policy if exists task_work_log_select on public.task_work_log;
create policy task_work_log_select on public.task_work_log
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists task_work_log_insert on public.task_work_log;
create policy task_work_log_insert on public.task_work_log
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists task_work_log_update on public.task_work_log;
create policy task_work_log_update on public.task_work_log
    for update to authenticated
    using (
        public.is_task_member(task_id)
        and (
            user_id = auth.uid()
            or public.is_project_team_admin(
                (select t.project_id from public.tasks t where t.id = task_id))
        )
    )
    with check (
        public.is_task_member(task_id)
        and (
            user_id = auth.uid()
            or public.is_project_team_admin(
                (select t.project_id from public.tasks t where t.id = task_id))
        )
    );

drop policy if exists task_work_log_delete on public.task_work_log;
create policy task_work_log_delete on public.task_work_log
    for delete to authenticated
    using (
        public.is_task_member(task_id)
        and (
            user_id = auth.uid()
            or public.is_project_team_admin(
                (select t.project_id from public.tasks t where t.id = task_id))
        )
    );

-- -------------------------------------------------------------------
-- 5.2 task_timers — all ops gated by is_task_member(task_id) AND the timer is the
--     caller's own (user_id = auth.uid()). You only ever touch your own timers.
-- -------------------------------------------------------------------
drop policy if exists task_timers_select on public.task_timers;
create policy task_timers_select on public.task_timers
    for select to authenticated
    using (public.is_task_member(task_id) and user_id = auth.uid());

drop policy if exists task_timers_insert on public.task_timers;
create policy task_timers_insert on public.task_timers
    for insert to authenticated
    with check (public.is_task_member(task_id) and user_id = auth.uid());

drop policy if exists task_timers_update on public.task_timers;
create policy task_timers_update on public.task_timers
    for update to authenticated
    using (public.is_task_member(task_id) and user_id = auth.uid())
    with check (public.is_task_member(task_id) and user_id = auth.uid());

drop policy if exists task_timers_delete on public.task_timers;
create policy task_timers_delete on public.task_timers
    for delete to authenticated
    using (public.is_task_member(task_id) and user_id = auth.uid());


-- =============================================================================
-- SECTION 6: Function execute grants
-- =============================================================================
grant execute on function public.start_timer(uuid)                         to authenticated;
grant execute on function public.stop_timer(uuid, text, boolean)           to authenticated;
grant execute on function public.log_time(uuid, integer, text, boolean)    to authenticated;
grant execute on function public.report_team_overview(uuid)                to authenticated;
grant execute on function public.report_projects(uuid)                     to authenticated;
grant execute on function public.report_members(uuid)                      to authenticated;
grant execute on function public.report_time_logs(uuid, date, date)        to authenticated;


-- =============================================================================
-- SECTION 7: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.task_work_log to authenticated;
grant select, insert, update, delete on public.task_timers   to authenticated;

grant all on public.task_work_log to service_role;
grant all on public.task_timers   to service_role;

-- =============================================================================
-- END Phase 6
-- =============================================================================
