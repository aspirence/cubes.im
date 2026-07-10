-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 7: Resource allocation + Templates +
--                                          Recurring tasks
-- =============================================================================
-- Builds on Phase 1 (identity/tenancy + is_team_member / is_team_admin),
-- Phase 3 (projects + project_phases + project_members + the project-granular
-- helpers team_id_of_project / is_project_team_member / is_project_team_admin,
-- and the create_project RPC which auto-seeds the project's default statuses and
-- adds the creator as a project_member), and Phase 4 (tasks / task_statuses /
-- task_priorities / sys_task_status_categories, the task_no + done triggers,
-- is_task_member, and the create_task RPC).
--
-- Adds:
--   * project_member_allocations — per-member time windows on a project (for the
--     schedule / workload / gantt UI). seconds_per_day defaults to 28800 (8h).
--   * task_templates    — team-scoped reusable task lists. The task list lives in
--     a JSONB `tasks` column (array of {name, priority?, description?}) to stay
--     lean (legacy used a task_templates_tasks child table — DEFERRED).
--   * project_templates — team-scoped project blueprints. The blueprint lives in
--     a JSONB `template` column ({ phases:[{name,color}], statuses:[{name,
--     category}], tasks:[{name,status,priority}] }) (legacy used the cpt_* family
--     of tables — DEFERRED; we keep one JSONB doc instead).
--   * task_recurring_schedules — recurrence config attached to a "template" task.
--     materialize_recurring_tasks() (driven by pg_cron) clones each due source
--     task into a fresh task and advances next_run_at.
--   * Functions: apply_task_template / create_project_from_template /
--     materialize_recurring_tasks (all SECURITY DEFINER, pinned search_path).
--   * pg_cron schedule for materialize_recurring_tasks (guarded; the migration
--     still succeeds if pg_cron is unavailable).
--   * RLS enable + policies + grants for the four new public tables, and execute
--     grants for the new RPCs.
--
-- Ported faithfully from the legacy schema (cubes-backend/database/sql/
-- {1_tables,4_functions}.sql) with the SAME Supabase adaptations Phases 1-6 used:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() via the column DEFAULT
--     (never cast explicitly in a function body).
--   * any FUNCTION BODY touching gen_random_uuid()/citext pins
--     `set search_path = public, extensions` (Phase 1-6 lesson) so the UUID
--     column default resolves and public.* is deterministic.
--   * the legacy WL_HEX_COLOR domain -> plain text + an inline CHECK with the same
--     hex regex (keeps this migration self-contained; no cross-phase domain).
--   * RLS is enforced in the database; Phase 1's is_team_member, Phase 3's
--     is_project_team_member / is_project_team_admin and Phase 4's is_task_member
--     are REUSED (NOT recreated).
--
-- Faithfulness notes vs. legacy columns (per the Phase 7 brief):
--   * project_member_allocations: legacy allocated_from/allocated_to were TIMESTAMP
--     and seconds_per_day NULLABLE. The brief uses DATE windows and a NOT NULL
--     seconds_per_day default 28800 (8h). Added created_at + FKs CASCADE on both
--     project and team_member delete (legacy had no FKs declared inline).
--   * task_templates: legacy stored tasks in task_templates_tasks; here they live
--     in a JSONB `tasks` array on the template (lean). Added created_by -> users.
--   * project_templates: brand-new lean shape replacing the legacy cpt_* /
--     custom_project_templates family — one JSONB `template` doc per blueprint.
--   * task_recurring_schedules: legacy had a rich shape (days_of_week[],
--     week_of_month, interval_days/weeks/months, a separate task_recurring_templates
--     table). The brief narrows to one schedule per source task_id with a simple
--     schedule_type ('daily'/'weekly'/'monthly') + interval_value + day_of_week /
--     day_of_month + last_created_at / next_run_at + active flag + created_by.
--
-- Re-runnable where practical (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS). No lookup seed needed.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 project_member_allocations (legacy: project_member_allocations). A window
--     [allocated_from, allocated_to] in which a team_member is allocated to a
--     project for seconds_per_day seconds (default 28800 = 8h). Both FKs CASCADE
--     on parent delete. Scope is the project's team (RLS via is_project_team_*).
-- -----------------------------------------------------------------------------
create table if not exists public.project_member_allocations (
    id              uuid                     default gen_random_uuid() not null,
    project_id      uuid                                               not null,
    team_member_id  uuid                                               not null,
    allocated_from  date                                               not null,
    allocated_to    date                                               not null,
    seconds_per_day integer                  default 28800             not null,
    created_at      timestamp with time zone default current_timestamp not null,
    constraint project_member_allocations_pk primary key (id),
    constraint project_member_allocations_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint project_member_allocations_team_member_id_fk
        foreign key (team_member_id) references public.team_members (id) on delete cascade,
    constraint project_member_allocations_seconds_check
        check (seconds_per_day >= 0 and seconds_per_day <= 86400),
    constraint project_member_allocations_range_check
        check (allocated_to >= allocated_from)
);

-- -----------------------------------------------------------------------------
-- 1.2 task_templates (legacy: task_templates + task_templates_tasks). A team-
--     scoped reusable task list. The tasks live in the `tasks` JSONB array, each
--     element being {name, priority?, description?} (priority is a priority NAME,
--     e.g. 'High', resolved at apply time). team_id CASCADE on team delete;
--     created_by -> users (kept on user delete via SET NULL).
-- -----------------------------------------------------------------------------
create table if not exists public.task_templates (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    name       text                                               not null,
    created_by uuid,
    tasks      jsonb                    default '[]'::jsonb        not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint task_templates_pk primary key (id),
    constraint task_templates_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint task_templates_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint task_templates_name_check check (char_length(name) <= 100),
    constraint task_templates_tasks_is_array check (jsonb_typeof(tasks) = 'array')
);

-- -----------------------------------------------------------------------------
-- 1.3 project_templates (lean replacement for the legacy cpt_* family). A team-
--     scoped project blueprint stored as a single JSONB `template` document:
--       {
--         "phases":   [{ "name": "...", "color": "#hex" }, ...],
--         "statuses": [{ "name": "...", "category": "todo|doing|done" }, ...],
--         "tasks":    [{ "name": "...", "status": "...", "priority": "..." }, ...]
--       }
--     All keys are optional; create_project_from_template tolerates a missing key.
--     team_id CASCADE; created_by -> users SET NULL.
-- -----------------------------------------------------------------------------
create table if not exists public.project_templates (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    name       text                                               not null,
    created_by uuid,
    template   jsonb                    default '{}'::jsonb        not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint project_templates_pk primary key (id),
    constraint project_templates_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint project_templates_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint project_templates_name_check check (char_length(name) <= 100),
    constraint project_templates_is_object check (jsonb_typeof(template) = 'object')
);

-- -----------------------------------------------------------------------------
-- 1.4 task_recurring_schedules (legacy: task_recurring_schedules +
--     task_recurring_templates, narrowed). Recurrence config attached to a single
--     source "template" task. schedule_type drives how next_run_at advances:
--       daily   -> + interval_value days
--       weekly  -> + interval_value weeks   (day_of_week 0=Sun..6=Sat optional)
--       monthly -> + interval_value months  (day_of_month 1..31 optional)
--     materialize_recurring_tasks() clones the source task when next_run_at <= now()
--     (or is null), then advances next_run_at and stamps last_created_at. task_id
--     CASCADE on task delete; created_by -> users SET NULL. active gates the job.
-- -----------------------------------------------------------------------------
create table if not exists public.task_recurring_schedules (
    id              uuid                     default gen_random_uuid() not null,
    task_id         uuid                                               not null,
    schedule_type   text                                               not null,
    interval_value  integer                  default 1                 not null,
    day_of_week     integer,
    day_of_month    integer,
    last_created_at timestamp with time zone,
    next_run_at     timestamp with time zone,
    created_by      uuid,
    active          boolean                  default true              not null,
    created_at      timestamp with time zone default current_timestamp not null,
    constraint task_recurring_schedules_pk primary key (id),
    constraint task_recurring_schedules_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_recurring_schedules_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint task_recurring_schedules_type_check
        check (schedule_type in ('daily', 'weekly', 'monthly')),
    constraint task_recurring_schedules_interval_check
        check (interval_value >= 1),
    constraint task_recurring_schedules_day_of_week_check
        check (day_of_week is null or (day_of_week between 0 and 6)),
    constraint task_recurring_schedules_day_of_month_check
        check (day_of_month is null or (day_of_month between 1 and 31))
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists project_member_allocations_project_id_index
    on public.project_member_allocations (project_id);
create index if not exists project_member_allocations_team_member_id_index
    on public.project_member_allocations (team_member_id);

create index if not exists task_templates_team_id_index
    on public.task_templates (team_id);

create index if not exists project_templates_team_id_index
    on public.project_templates (team_id);

create index if not exists task_recurring_schedules_task_id_index
    on public.task_recurring_schedules (task_id);
-- partial index for the cron sweep: only active, due schedules.
create index if not exists task_recurring_schedules_due_index
    on public.task_recurring_schedules (next_run_at)
    where active is true;


-- =============================================================================
-- SECTION 3: Functions (SECURITY DEFINER, pinned search_path)
-- =============================================================================
-- All three pin search_path = public, extensions so the gen_random_uuid() column
-- defaults resolve and public.* is deterministic. apply_task_template and
-- create_project_from_template act on behalf of auth.uid(); materialize_recurring_
-- tasks runs without an auth.uid() (called by pg_cron as the table owner) and so
-- bypasses RLS by being SECURITY DEFINER.

-- -----------------------------------------------------------------------------
-- 3.1 apply_task_template(p_project_id, p_template_id) -> integer
--     Verifies the caller is a member of the project's team, then for each entry
--     in the template's `tasks` JSONB array inserts a task into the project
--     (reporter = auth.uid(); status = the project's first To-Do status; priority
--     resolved by NAME within the project's team when present). Returns the count
--     of tasks created. task_no + done/completed_at are filled by the Phase 4
--     BEFORE triggers.
-- -----------------------------------------------------------------------------
create or replace function public.apply_task_template(
    p_project_id  uuid,
    p_template_id uuid
)
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id    uuid := auth.uid();
    _team_id    uuid;
    _tasks      jsonb;
    _entry      jsonb;
    _name       text;
    _priority   text;
    _desc       text;
    _status_id  uuid;
    _priority_id uuid;
    _count      integer := 0;
    _next_sort  integer;
begin
    if _user_id is null then
        raise exception 'apply_task_template: no authenticated user';
    end if;

    -- Caller MUST be a member of the project's team.
    if not public.is_project_team_member(p_project_id) then
        raise exception 'apply_task_template: caller is not a member of project %', p_project_id;
    end if;

    _team_id := public.team_id_of_project(p_project_id);

    -- Load the template's tasks; the template must belong to the project's team.
    select t.tasks into _tasks
    from public.task_templates t
    where t.id = p_template_id and t.team_id = _team_id;

    if _tasks is null then
        raise exception 'apply_task_template: template % not found in this team', p_template_id;
    end if;

    -- The project's first To-Do-category status (default status for new tasks).
    select s.id into _status_id
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = p_project_id and c.is_todo is true
    order by s.sort_order
    limit 1;

    -- Append after the project's current max sort_order.
    _next_sort := coalesce(
        (select max(sort_order) + 1 from public.tasks where project_id = p_project_id), 0);

    for _entry in select * from jsonb_array_elements(coalesce(_tasks, '[]'::jsonb))
    loop
        _name := left(trim(coalesce(_entry ->> 'name', '')), 500);
        if _name = '' then
            continue;  -- skip nameless entries
        end if;

        _priority := _entry ->> 'priority';
        _desc     := left(coalesce(_entry ->> 'description', ''), 500000);
        if _desc = '' then
            _desc := null;
        end if;

        -- Resolve the priority by NAME (case-insensitive) when supplied.
        _priority_id := null;
        if _priority is not null and _priority <> '' then
            select p.id into _priority_id
            from public.task_priorities p
            where lower(p.name) = lower(_priority)
            limit 1;
        end if;

        insert into public.tasks (name, description, project_id, status_id,
                                  priority_id, reporter_id, sort_order)
        values (_name, _desc, p_project_id, _status_id, _priority_id,
                _user_id, _next_sort);

        _next_sort := _next_sort + 1;
        _count := _count + 1;
    end loop;

    return _count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3.2 create_project_from_template(p_team_id, p_template_id, p_name) -> uuid
--     Verifies is_team_member(p_team_id), then creates a project (via the Phase 3
--     create_project RPC, which seeds the default To Do/Doing/Done statuses AND
--     adds the creator as a project_member). It then layers the blueprint on top:
--       * phases   -> project_phases (name + color, sort_index by array order)
--       * statuses -> extra task_statuses (mapped to a sys category by `category`)
--       * tasks    -> tasks (name; status by NAME within the project; priority by
--                     NAME). reporter = auth.uid().
--     Returns the new project id. Re-uses create_project so the creator's
--     project_members row and default statuses come for free.
-- -----------------------------------------------------------------------------
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

    -- Caller MUST be a member of the target team.
    if not public.is_team_member(p_team_id) then
        raise exception 'create_project_from_template: caller is not a member of team %', p_team_id;
    end if;

    -- Load the blueprint; the template must belong to the target team.
    select t.template into _template
    from public.project_templates t
    where t.id = p_template_id and t.team_id = p_team_id;

    if _template is null then
        raise exception 'create_project_from_template: template % not found in this team', p_template_id;
    end if;

    -- Create the project (seeds default statuses + adds creator as a member).
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
        -- guard against a malformed color so the inline hex CHECK never aborts.
        if _color !~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then
            _color := '#70a6f3';
        end if;

        insert into public.project_phases (name, color_code, project_id, sort_index)
        values (_name, _color, _project_id, _sort);
        _sort := _sort + 1;
    end loop;

    -- ----- statuses -> task_statuses (in addition to the seeded defaults) -----
    -- The category string maps to a sys_task_status_categories row.
    select coalesce(max(sort_order) + 1, 0) into _sort
    from public.task_statuses where project_id = _project_id;
    for _entry in
        select * from jsonb_array_elements(coalesce(_template -> 'statuses', '[]'::jsonb))
    loop
        _status_name := left(trim(coalesce(_entry ->> 'name', '')), 50);
        _category    := lower(coalesce(_entry ->> 'category', 'todo'));
        if _status_name = '' then
            continue;
        end if;

        -- Resolve the category to a sys row (todo/doing/done -> the matching flag).
        select c.id into _category_id
        from public.sys_task_status_categories c
        where (_category = 'todo'  and c.is_todo  is true)
           or (_category = 'doing' and c.is_doing is true)
           or (_category = 'done'  and c.is_done  is true)
        order by c.sort_order
        limit 1;

        -- fall back to the first To-Do category if the string was unrecognised.
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

        -- Resolve the status by NAME within the project (else first To-Do status).
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

        -- Resolve the priority by NAME when present.
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

-- -----------------------------------------------------------------------------
-- 3.3 materialize_recurring_tasks() -> integer
--     The pg_cron entry point. For every ACTIVE schedule whose next_run_at is due
--     (<= now()) OR null (never run), it clones the source task (same project /
--     name / priority / status) into a NEW task, stamps last_created_at = now()
--     and advances next_run_at by the schedule's cadence. Returns the number of
--     tasks created. Runs with NO auth.uid() (cron) -> SECURITY DEFINER bypasses
--     RLS; the clone's reporter is inherited from the source task.
-- -----------------------------------------------------------------------------
create or replace function public.materialize_recurring_tasks()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _sched      record;
    _src        record;
    _next       timestamp with time zone;
    _count      integer := 0;
begin
    for _sched in
        select * from public.task_recurring_schedules
        where active is true
          and (next_run_at is null or next_run_at <= now())
    loop
        -- Load the source task; skip if it has been deleted out from under us
        -- (the FK is CASCADE so this is belt-and-braces).
        select id, name, project_id, status_id, priority_id, reporter_id
            into _src
        from public.tasks
        where id = _sched.task_id;

        if not found then
            continue;
        end if;

        -- Clone it. task_no + done/completed_at come from the Phase 4 BEFORE
        -- triggers; sort_order is appended.
        insert into public.tasks (name, project_id, status_id, priority_id,
                                  reporter_id, sort_order)
        values (_src.name, _src.project_id, _src.status_id, _src.priority_id,
                _src.reporter_id,
                coalesce((select max(sort_order) + 1 from public.tasks
                          where project_id = _src.project_id), 0));

        _count := _count + 1;

        -- Advance next_run_at from the LATER of (now, the current next_run_at) so a
        -- backlog of missed runs collapses to a single clone and the schedule
        -- moves forward rather than firing repeatedly.
        _next := greatest(coalesce(_sched.next_run_at, now()), now());
        _next := case _sched.schedule_type
                     when 'daily'   then _next + make_interval(days   => _sched.interval_value)
                     when 'weekly'  then _next + make_interval(weeks  => _sched.interval_value)
                     when 'monthly' then _next + make_interval(months => _sched.interval_value)
                     else _next + make_interval(days => _sched.interval_value)
                 end;

        update public.task_recurring_schedules
            set last_created_at = now(),
                next_run_at     = _next
            where id = _sched.id;
    end loop;

    return _count;
end;
$$;


-- =============================================================================
-- SECTION 4: pg_cron scheduling (guarded — never fails the migration)
-- =============================================================================
-- We try to (a) create the pg_cron extension, (b) schedule materialize_recurring_
-- tasks hourly, guarding against a duplicate job. If pg_cron is unavailable (or
-- cron.* objects are missing), we swallow the error with a NOTICE so a missing
-- extension does not abort the whole migration. The job can be (re)created later
-- by re-running this DO block once pg_cron is installed.
do $$
begin
    create extension if not exists pg_cron;

    -- Only schedule if there is no existing job by this name.
    if not exists (select 1 from cron.job where jobname = 'materialize-recurring-tasks') then
        perform cron.schedule(
            'materialize-recurring-tasks',
            '0 * * * *',
            $cron$ select public.materialize_recurring_tasks(); $cron$
        );
        raise notice 'Phase 7: scheduled pg_cron job "materialize-recurring-tasks" (hourly).';
    else
        raise notice 'Phase 7: pg_cron job "materialize-recurring-tasks" already exists; left as is.';
    end if;
exception
    when others then
        raise notice 'Phase 7: pg_cron setup skipped (% — %). Run materialize_recurring_tasks() manually or schedule it once pg_cron is available.',
            sqlstate, sqlerrm;
end
$$;


-- =============================================================================
-- SECTION 5: Enable Row Level Security + policies
-- =============================================================================
alter table public.project_member_allocations enable row level security;
alter table public.task_templates             enable row level security;
alter table public.project_templates          enable row level security;
alter table public.task_recurring_schedules   enable row level security;

-- Convention (matches Phases 1-6): drop-then-create so the migration is
-- re-runnable; policies target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 5.1 project_member_allocations — project team members read; project team
--     admins (or the project owner) write. Scope via is_project_team_*.
-- -------------------------------------------------------------------
drop policy if exists project_member_allocations_select on public.project_member_allocations;
create policy project_member_allocations_select on public.project_member_allocations
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists project_member_allocations_insert on public.project_member_allocations;
create policy project_member_allocations_insert on public.project_member_allocations
    for insert to authenticated
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_member_allocations_update on public.project_member_allocations;
create policy project_member_allocations_update on public.project_member_allocations
    for update to authenticated
    using (public.is_project_team_admin(project_id))
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_member_allocations_delete on public.project_member_allocations;
create policy project_member_allocations_delete on public.project_member_allocations
    for delete to authenticated
    using (public.is_project_team_admin(project_id));

-- -------------------------------------------------------------------
-- 5.2 task_templates — team members read AND write (any active member of the
--     team can manage the team's reusable task lists).
-- -------------------------------------------------------------------
drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists task_templates_insert on public.task_templates;
create policy task_templates_insert on public.task_templates
    for insert to authenticated
    with check (public.is_team_member(team_id));

drop policy if exists task_templates_update on public.task_templates;
create policy task_templates_update on public.task_templates
    for update to authenticated
    using (public.is_team_member(team_id))
    with check (public.is_team_member(team_id));

drop policy if exists task_templates_delete on public.task_templates;
create policy task_templates_delete on public.task_templates
    for delete to authenticated
    using (public.is_team_member(team_id));

-- -------------------------------------------------------------------
-- 5.3 project_templates — team members read AND write.
-- -------------------------------------------------------------------
drop policy if exists project_templates_select on public.project_templates;
create policy project_templates_select on public.project_templates
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists project_templates_insert on public.project_templates;
create policy project_templates_insert on public.project_templates
    for insert to authenticated
    with check (public.is_team_member(team_id));

drop policy if exists project_templates_update on public.project_templates;
create policy project_templates_update on public.project_templates
    for update to authenticated
    using (public.is_team_member(team_id))
    with check (public.is_team_member(team_id));

drop policy if exists project_templates_delete on public.project_templates;
create policy project_templates_delete on public.project_templates
    for delete to authenticated
    using (public.is_team_member(team_id));

-- -------------------------------------------------------------------
-- 5.4 task_recurring_schedules — all ops gated by is_task_member(task_id) (a
--     member of the source task's project's team).
-- -------------------------------------------------------------------
drop policy if exists task_recurring_schedules_select on public.task_recurring_schedules;
create policy task_recurring_schedules_select on public.task_recurring_schedules
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists task_recurring_schedules_insert on public.task_recurring_schedules;
create policy task_recurring_schedules_insert on public.task_recurring_schedules
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists task_recurring_schedules_update on public.task_recurring_schedules;
create policy task_recurring_schedules_update on public.task_recurring_schedules
    for update to authenticated
    using (public.is_task_member(task_id))
    with check (public.is_task_member(task_id));

drop policy if exists task_recurring_schedules_delete on public.task_recurring_schedules;
create policy task_recurring_schedules_delete on public.task_recurring_schedules
    for delete to authenticated
    using (public.is_task_member(task_id));


-- =============================================================================
-- SECTION 6: Function execute grants
-- =============================================================================
grant execute on function public.apply_task_template(uuid, uuid)                 to authenticated;
grant execute on function public.create_project_from_template(uuid, uuid, text)  to authenticated;
-- materialize_recurring_tasks is invoked by pg_cron (which runs as the function
-- owner); grant execute to authenticated as well so an admin can trigger it.
grant execute on function public.materialize_recurring_tasks()                   to authenticated;


-- =============================================================================
-- SECTION 7: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.project_member_allocations to authenticated;
grant select, insert, update, delete on public.task_templates             to authenticated;
grant select, insert, update, delete on public.project_templates          to authenticated;
grant select, insert, update, delete on public.task_recurring_schedules   to authenticated;

grant all on public.project_member_allocations to service_role;
grant all on public.task_templates             to service_role;
grant all on public.project_templates          to service_role;
grant all on public.task_recurring_schedules   to service_role;

-- =============================================================================
-- END Phase 7
-- =============================================================================
