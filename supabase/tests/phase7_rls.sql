-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 7 RLS test
--   (resource allocation + templates + recurring tasks)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 7 tables
-- (project_member_allocations / task_templates / project_templates /
-- task_recurring_schedules), the three RPCs (apply_task_template /
-- create_project_from_template / materialize_recurring_tasks) and the RLS
-- policies. Mirrors the proven Phase 1-6 pattern: it works WITH the
-- handle_new_user trigger rather than disabling it (postgres is not superuser
-- here and cannot disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase7_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- NOTE: pg_cron *scheduling* is time-based and is NOT exercised here; we call
-- public.materialize_recurring_tasks() directly (which is exactly what the cron
-- job runs) and assert it clones a due recurring task.
--
-- STRATEGY
--   Insert three auth.users (Alice, Bob, Dave). on_auth_user_created
--   auto-provisions for each: a profile + organization + team + roles + an owner
--   team_membership + active_team. Bob is added as a NON-admin (Member) of
--   Alice's team. Dave is a wholly separate tenant. The Phase 3 default project
--   status + the Phase 4 task categories / priorities lookups are seeded inline
--   (guarded so it coexists with seed.sql). Fixture writes run as postgres (OWNS
--   the public.* tables -> RLS bypassed). Assertions switch into the
--   `authenticated` role and set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) project_member_allocations gated by project team membership: a project
--       admin (Alice, the owner) writes one; a cross-team user (Dave) sees none
--       and is BLOCKED from inserting; a non-admin member (Bob) can READ it.
--   (b) task_templates / project_templates are team-scoped: a member reads/writes
--       them; a cross-team user (Dave) sees none and is blocked from inserting.
--   (c) apply_task_template creates N tasks in the project from the JSONB array.
--   (d) create_project_from_template creates a project with phases + tasks and
--       adds the creator as a project_member.
--   (e) task_recurring_schedules gated by is_task_member: a member writes/reads;
--       a cross-team user (Dave) sees none and is blocked from inserting.
--   (f) materialize_recurring_tasks() clones a DUE recurring task into a new task
--       (next_run_at set in the past) and advances next_run_at.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Lookup seed (idempotent). Runs as postgres (RLS bypassed). Coexists with
-- seed.sql / the migrations. Phase 3 default status (for create_project) + the
-- Phase 4 task categories + priorities (for create_task / templates).
-- -----------------------------------------------------------------------------
insert into public.sys_project_statuses (name, color_code, icon, sort_order, is_default)
select v.name, v.color_code, v.icon, v.sort_order, v.is_default
from (values
    ('Proposed', '#cbc8a1', 'clock-circle', 3, true)
) as v(name, color_code, icon, sort_order, is_default)
where not exists (select 1 from public.sys_project_statuses s where s.name = v.name);

insert into public.sys_task_status_categories (name, color_code, sort_order, is_todo, is_doing, is_done)
select v.name, v.color_code, v.sort_order, v.is_todo, v.is_doing, v.is_done
from (values
    ('To Do', '#a9a9a9', 0, true,  false, false),
    ('Doing', '#70a6f3', 1, false, true,  false),
    ('Done',  '#75c997', 2, false, false, true)
) as v(name, color_code, sort_order, is_todo, is_doing, is_done)
where not exists (select 1 from public.sys_task_status_categories c where c.name = v.name);

insert into public.task_priorities (name, value, color_code)
select v.name, v.value, v.color_code
from (values
    ('Low',    0, '#75c997'),
    ('Medium', 1, '#fbc84c'),
    ('High',   2, '#f37070')
) as v(name, value, color_code)
where not exists (select 1 from public.task_priorities p where p.name = v.name);

-- -----------------------------------------------------------------------------
-- Fixture (runs as postgres -> RLS bypassed). Trigger provisions each tenant.
-- Bob becomes a NON-admin (Member) of Alice's team. Alice creates a project
-- (auto-seeds statuses) and one task (reporter=Alice). Dave is a separate tenant.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _project_id uuid;
    _task1_id   uuid;
begin
    insert into auth.users (id, instance_id, aud, role, email)
    values
        ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'alice@example.com'),
        ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'bob@example.com'),
        ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'dave@example.com');

    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Bob becomes a NON-admin (Member, default_role=true) of Alice's team.
    insert into public.team_members (user_id, team_id, role_id, active)
    select 'b2222222-2222-2222-2222-222222222222', _alice_team, r.id, true
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true;

    -- Alice creates a project + one task (as Alice, via the RPCs).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _project_id := public.create_project('Apollo Launch', _alice_team);
    _task1_id   := public.create_task('Build the rocket', _project_id);
    execute 'reset role';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): project_member_allocations gated by project team membership. Alice
--   (project owner -> project team admin) inserts an allocation; Bob (member)
--   can read it; Dave (cross-team) sees none and is blocked from inserting.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id    uuid;
    _alice_tm      uuid;
    _alloc_id      uuid;
    _bob_reads     int;
    _dave_reads    int;
    _dave_blocked  boolean := false;
    _alice_team    uuid;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _alice_tm from public.team_members
        where team_id = _alice_team and user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Alice (project team admin via owner) inserts an allocation.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.project_member_allocations
        (project_id, team_member_id, allocated_from, allocated_to, seconds_per_day)
    values (_project_id, _alice_tm, current_date, current_date + 14, 14400)
    returning id into _alloc_id;
    execute 'reset role';

    if _alloc_id is null then
        raise exception 'TEST (a) FAILED: project admin could not insert an allocation';
    end if;

    -- Bob (non-admin member) can READ the allocation.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_reads from public.project_member_allocations
        where project_id = _project_id;
    execute 'reset role';

    if _bob_reads < 1 then
        raise exception 'TEST (a) FAILED: team member could not read the project allocation (got %)', _bob_reads;
    end if;

    -- Dave (cross-team) sees none and is blocked from inserting.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.project_member_allocations
        where project_id = _project_id;
    begin
        insert into public.project_member_allocations
            (project_id, team_member_id, allocated_from, allocated_to)
        values (_project_id, _alice_tm, current_date, current_date + 1);
    exception
        when insufficient_privilege then _dave_blocked := true;  -- RLS WITH CHECK violation
    end;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (a) FAILED: cross-team allocation leakage (got % rows)', _dave_reads;
    end if;
    if _dave_blocked is not true then
        raise exception 'TEST (a) FAILED: cross-team user was allowed to insert an allocation';
    end if;

    raise notice 'TEST (a) PASSED: project_member_allocations gated by project team membership (admin writes; cross-team blocked)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): task_templates / project_templates are team-scoped. Bob (a member)
--   inserts + reads them; Dave (cross-team) sees none and is blocked.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team    uuid;
    _tt_id         uuid;
    _pt_id         uuid;
    _bob_tt_reads  int;
    _bob_pt_reads  int;
    _dave_tt_reads int;
    _dave_pt_reads int;
    _dave_tt_blocked boolean := false;
    _dave_pt_blocked boolean := false;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Bob (a non-admin member) creates a task_template + a project_template.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';

    insert into public.task_templates (team_id, name, created_by, tasks)
    values (_alice_team, 'Sprint kickoff',
            'b2222222-2222-2222-2222-222222222222',
            '[{"name":"Plan sprint","priority":"High"},
              {"name":"Assign owners"},
              {"name":"Write notes","description":"capture decisions"}]'::jsonb)
    returning id into _tt_id;

    insert into public.project_templates (team_id, name, created_by, template)
    values (_alice_team, 'Standard web project',
            'b2222222-2222-2222-2222-222222222222',
            '{"phases":[{"name":"Design","color":"#70a6f3"},
                        {"name":"Build","color":"#75c997"}],
              "statuses":[{"name":"Blocked","category":"doing"}],
              "tasks":[{"name":"Kickoff","priority":"High"},
                       {"name":"Wireframes"}]}'::jsonb)
    returning id into _pt_id;

    select count(*) into _bob_tt_reads from public.task_templates where team_id = _alice_team;
    select count(*) into _bob_pt_reads from public.project_templates where team_id = _alice_team;
    execute 'reset role';

    if _tt_id is null or _pt_id is null then
        raise exception 'TEST (b) FAILED: member could not create templates';
    end if;
    if _bob_tt_reads < 1 or _bob_pt_reads < 1 then
        raise exception 'TEST (b) FAILED: member could not read team templates (tt=%, pt=%)', _bob_tt_reads, _bob_pt_reads;
    end if;

    -- Dave (cross-team) sees none and is blocked from inserting either.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_tt_reads from public.task_templates where team_id = _alice_team;
    select count(*) into _dave_pt_reads from public.project_templates where team_id = _alice_team;
    begin
        insert into public.task_templates (team_id, name) values (_alice_team, 'sneaky');
    exception when insufficient_privilege then _dave_tt_blocked := true;
    end;
    begin
        insert into public.project_templates (team_id, name) values (_alice_team, 'sneaky');
    exception when insufficient_privilege then _dave_pt_blocked := true;
    end;
    execute 'reset role';

    if _dave_tt_reads <> 0 or _dave_pt_reads <> 0 then
        raise exception 'TEST (b) FAILED: cross-team template leakage (tt=%, pt=%)', _dave_tt_reads, _dave_pt_reads;
    end if;
    if _dave_tt_blocked is not true or _dave_pt_blocked is not true then
        raise exception 'TEST (b) FAILED: cross-team user could insert a template (tt_blocked=%, pt_blocked=%)', _dave_tt_blocked, _dave_pt_blocked;
    end if;

    raise notice 'TEST (b) PASSED: task_templates / project_templates are team-scoped (member read/write; cross-team invisible + blocked)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): apply_task_template creates N tasks in the project from the JSONB.
--   The 'Sprint kickoff' template has 3 named entries -> 3 new tasks; one of them
--   ('Plan sprint') should pick up the High priority.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _project_id uuid;
    _tt_id      uuid;
    _before     int;
    _after      int;
    _created    int;
    _high_pri   int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _tt_id from public.task_templates
        where team_id = _alice_team and name = 'Sprint kickoff' limit 1;

    select count(*) into _before from public.tasks where project_id = _project_id;

    -- Alice (project team member) applies the template.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _created := public.apply_task_template(_project_id, _tt_id);
    execute 'reset role';

    select count(*) into _after from public.tasks where project_id = _project_id;
    select count(*) into _high_pri
    from public.tasks t
    join public.task_priorities p on p.id = t.priority_id
    where t.project_id = _project_id and t.name = 'Plan sprint' and p.name = 'High';

    if _created <> 3 then
        raise exception 'TEST (c) FAILED: apply_task_template returned % (expected 3)', _created;
    end if;
    if _after <> _before + 3 then
        raise exception 'TEST (c) FAILED: task count went % -> % (expected +3)', _before, _after;
    end if;
    if _high_pri <> 1 then
        raise exception 'TEST (c) FAILED: priority not resolved from the JSONB (Plan sprint @ High count = %)', _high_pri;
    end if;

    raise notice 'TEST (c) PASSED: apply_task_template creates N tasks from the JSONB array (and resolves priorities)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): create_project_from_template creates a project with phases + tasks
--   and adds the creator (Bob) as a project_member.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team   uuid;
    _pt_id        uuid;
    _new_project  uuid;
    _phase_count  int;
    _task_count   int;
    _bob_tm       uuid;
    _bob_is_member int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _pt_id from public.project_templates
        where team_id = _alice_team and name = 'Standard web project' limit 1;
    select id into _bob_tm from public.team_members
        where team_id = _alice_team and user_id = 'b2222222-2222-2222-2222-222222222222';

    -- Bob (a team member) creates a project from the blueprint.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _new_project := public.create_project_from_template(_alice_team, _pt_id, 'Acme Website');
    execute 'reset role';

    if _new_project is null then
        raise exception 'TEST (d) FAILED: create_project_from_template returned null';
    end if;

    select count(*) into _phase_count from public.project_phases where project_id = _new_project;
    select count(*) into _task_count  from public.tasks          where project_id = _new_project;
    select count(*) into _bob_is_member
    from public.project_members where project_id = _new_project and team_member_id = _bob_tm;

    -- Blueprint had 2 phases and 2 tasks.
    if _phase_count <> 2 then
        raise exception 'TEST (d) FAILED: expected 2 phases, got %', _phase_count;
    end if;
    if _task_count <> 2 then
        raise exception 'TEST (d) FAILED: expected 2 tasks, got %', _task_count;
    end if;
    if _bob_is_member <> 1 then
        raise exception 'TEST (d) FAILED: creator was not added as a project_member (got %)', _bob_is_member;
    end if;

    raise notice 'TEST (d) PASSED: create_project_from_template builds phases + tasks and adds the creator as a member';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): task_recurring_schedules gated by is_task_member. Alice (member)
--   inserts + reads a schedule on her task; Dave (cross-team) sees none and is
--   blocked from inserting.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id   uuid;
    _task_id      uuid;
    _sched_id     uuid;
    _alice_reads  int;
    _dave_reads   int;
    _dave_blocked boolean := false;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Alice (task member) creates a recurring schedule.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.task_recurring_schedules
        (task_id, schedule_type, interval_value, created_by, next_run_at)
    values (_task_id, 'weekly', 1, 'a1111111-1111-1111-1111-111111111111', now() + interval '7 days')
    returning id into _sched_id;
    select count(*) into _alice_reads from public.task_recurring_schedules where task_id = _task_id;
    execute 'reset role';

    if _sched_id is null then
        raise exception 'TEST (e) FAILED: task member could not insert a recurring schedule';
    end if;
    if _alice_reads < 1 then
        raise exception 'TEST (e) FAILED: task member could not read the schedule (got %)', _alice_reads;
    end if;

    -- Dave (cross-team) sees none and is blocked from inserting.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.task_recurring_schedules where task_id = _task_id;
    begin
        insert into public.task_recurring_schedules (task_id, schedule_type)
        values (_task_id, 'daily');
    exception when insufficient_privilege then _dave_blocked := true;
    end;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (e) FAILED: cross-team schedule leakage (got % rows)', _dave_reads;
    end if;
    if _dave_blocked is not true then
        raise exception 'TEST (e) FAILED: cross-team user was allowed to insert a recurring schedule';
    end if;

    raise notice 'TEST (e) PASSED: task_recurring_schedules gated by is_task_member (cross-team blocked)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): materialize_recurring_tasks() clones a DUE recurring task. We force
--   the schedule due (next_run_at in the past), call the function, and assert a
--   new clone of the source task appears and next_run_at advances.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id   uuid;
    _task_id      uuid;
    _sched_id     uuid;
    _src_name     text;
    _before       int;
    _after        int;
    _created      int;
    _clones       int;
    _next_after   timestamptz;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;
    select name into _src_name from public.tasks where id = _task_id;

    -- Force the schedule DUE (postgres -> RLS bypassed).
    update public.task_recurring_schedules
        set next_run_at = now() - interval '1 hour', active = true
        where task_id = _task_id
        returning id into _sched_id;

    select count(*) into _before from public.tasks
        where project_id = _project_id and name = _src_name;

    -- Run the cron entry point directly (postgres). It is SECURITY DEFINER and
    -- needs no auth.uid().
    _created := public.materialize_recurring_tasks();

    select count(*) into _after from public.tasks
        where project_id = _project_id and name = _src_name;
    select count(*) into _clones from public.tasks
        where project_id = _project_id and name = _src_name and id <> _task_id;
    select next_run_at into _next_after from public.task_recurring_schedules where id = _sched_id;

    if _created < 1 then
        raise exception 'TEST (f) FAILED: materialize_recurring_tasks returned % (expected >= 1)', _created;
    end if;
    if _after <> _before + 1 then
        raise exception 'TEST (f) FAILED: source-named task count went % -> % (expected +1)', _before, _after;
    end if;
    if _clones < 1 then
        raise exception 'TEST (f) FAILED: no clone of the source task was created';
    end if;
    if _next_after is null or _next_after <= now() then
        raise exception 'TEST (f) FAILED: next_run_at was not advanced into the future (got %)', _next_after;
    end if;

    raise notice 'TEST (f) PASSED: materialize_recurring_tasks clones a due task and advances next_run_at';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 7 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
