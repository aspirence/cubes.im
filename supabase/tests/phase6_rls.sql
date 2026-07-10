-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 6 RLS test (time tracking + reporting)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 6 tables
-- (task_work_log / task_timers), the timer/log RPCs (start_timer / stop_timer /
-- log_time), the four reporting RPCs (report_team_overview / report_projects /
-- report_members / report_time_logs) and the RLS policies. Mirrors the proven
-- Phase 1-5 pattern: it works WITH the handle_new_user trigger rather than
-- disabling it (postgres is not superuser here and cannot disable a trigger it
-- does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase6_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY
--   Insert three auth.users (Alice, Bob, Dave). on_auth_user_created
--   auto-provisions for each: a profile + organization + team + roles + an owner
--   team_membership + active_team. Bob is added as a NON-admin (Member) of
--   Alice's team. Dave is a wholly separate tenant. The Phase 3 default project
--   status + the Phase 4 task categories / priorities lookups are seeded inline
--   (guarded so it coexists with seed.sql). Fixture writes run as postgres (OWNS
--   the public.* tables -> RLS bypassed). Assertions switch into the
--   `authenticated` role and set request.jwt.claims.sub (auth.uid()). Fixture
--   projects/tasks are created via public.create_project + public.create_task.
--
-- COVERAGE
--   (a) start_timer then stop_timer: creates a logged_by_timer task_work_log row,
--       clears the running timer, and bumps tasks.total_minutes.
--   (b) log_time inserts a manual (logged_by_timer=false) work log + bumps
--       total_minutes by the given minutes.
--   (c) work logs are gated by is_task_member: a cross-team user (Dave) sees none
--       and is blocked from inserting a task_work_log row.
--   (d) task_timers are private to the owner: Bob (a team member) cannot see
--       Alice's running timer.
--   (e) report_team_overview returns sane counts for the caller's team and
--       REJECTS a non-member (Dave) with an exception.
--   (f) report_projects / report_members run for a member and return rows scoped
--       to the team.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Lookup seed (idempotent). Runs as postgres (RLS bypassed). Coexists with
-- seed.sql / the migrations. Phase 3 default status (for create_project) + the
-- Phase 4 task categories + priorities (for create_task).
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
-- (auto-seeds statuses) and two tasks (reporter=Alice). Dave is a separate tenant.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _project_id uuid;
    _task1_id   uuid;
    _task2_id   uuid;
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

    -- Alice creates a project + two tasks (as Alice, via the RPCs).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _project_id := public.create_project('Apollo Launch', _alice_team);
    _task1_id   := public.create_task('Build the rocket', _project_id);
    _task2_id   := public.create_task('Fuel the rocket', _project_id);
    execute 'reset role';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): start_timer then stop_timer creates a logged_by_timer task_work_log,
--   clears the running timer, and bumps tasks.total_minutes.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _timer_id   uuid;
    _log_id     uuid;
    _timers_after int;
    _logs_after   int;
    _logged_by_timer boolean;
    _total_minutes_after numeric;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Alice starts a timer on task 1, then (after a backdate) stops it.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _timer_id := public.start_timer(_task_id);
    execute 'reset role';

    if _timer_id is null then
        raise exception 'TEST (a) FAILED: start_timer returned null';
    end if;

    -- Backdate the running timer 5 minutes (as postgres) so stop_timer logs ~300s.
    update public.task_timers set start_time = now() - interval '5 minutes'
        where id = _timer_id;

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _log_id := public.stop_timer(_task_id, 'timed work', true);
    execute 'reset role';

    if _log_id is null then
        raise exception 'TEST (a) FAILED: stop_timer returned null';
    end if;

    -- Verify (as postgres): timer gone, one timer-derived log, total_minutes bumped.
    select count(*) into _timers_after from public.task_timers
        where task_id = _task_id and user_id = 'a1111111-1111-1111-1111-111111111111';
    select count(*) into _logs_after from public.task_work_log where id = _log_id;
    select logged_by_timer into _logged_by_timer from public.task_work_log where id = _log_id;
    select total_minutes into _total_minutes_after from public.tasks where id = _task_id;

    if _timers_after <> 0 then
        raise exception 'TEST (a) FAILED: stop_timer did not clear the running timer (got %)', _timers_after;
    end if;
    if _logs_after <> 1 then
        raise exception 'TEST (a) FAILED: stop_timer did not create a work log (got %)', _logs_after;
    end if;
    if _logged_by_timer is not true then
        raise exception 'TEST (a) FAILED: timer-derived log not flagged logged_by_timer';
    end if;
    -- ~5 minutes -> total_minutes should be >= 5 (ceil of ~300s).
    if _total_minutes_after < 5 then
        raise exception 'TEST (a) FAILED: total_minutes not bumped (got %)', _total_minutes_after;
    end if;

    raise notice 'TEST (a) PASSED: start_timer/stop_timer logs time, clears the timer, bumps total_minutes';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): log_time inserts a manual (logged_by_timer=false) work log and bumps
--   tasks.total_minutes by the given minutes.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _log_id     uuid;
    _time_spent integer;
    _logged_by_timer boolean;
    _minutes_before numeric;
    _minutes_after  numeric;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 2;

    select total_minutes into _minutes_before from public.tasks where id = _task_id;

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _log_id := public.log_time(_task_id, 30, 'manual entry', true);
    execute 'reset role';

    select time_spent, logged_by_timer into _time_spent, _logged_by_timer
        from public.task_work_log where id = _log_id;
    select total_minutes into _minutes_after from public.tasks where id = _task_id;

    if _log_id is null then
        raise exception 'TEST (b) FAILED: log_time returned null';
    end if;
    if _time_spent <> 30 * 60 then
        raise exception 'TEST (b) FAILED: log_time stored % seconds (expected %)', _time_spent, 30 * 60;
    end if;
    if _logged_by_timer is not false then
        raise exception 'TEST (b) FAILED: manual log wrongly flagged logged_by_timer';
    end if;
    if _minutes_after <> _minutes_before + 30 then
        raise exception 'TEST (b) FAILED: total_minutes went % -> % (expected +30)', _minutes_before, _minutes_after;
    end if;

    raise notice 'TEST (b) PASSED: log_time inserts a manual log and bumps total_minutes by the minutes';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): work logs are gated by is_task_member. Bob (a team member) reads the
--   logs; Dave (cross-team, separate tenant) sees none and is blocked from
--   inserting a task_work_log row.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _bob_reads  int;
    _dave_reads int;
    _dave_blocked boolean := false;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Bob (team member) can read the task's work logs (>= the timer log from (a)).
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_reads from public.task_work_log where task_id = _task_id;
    execute 'reset role';

    if _bob_reads < 1 then
        raise exception 'TEST (c) FAILED: team member could not read the task work logs (got %)', _bob_reads;
    end if;

    -- Dave (cross-team) must see none and be blocked from inserting.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.task_work_log where task_id = _task_id;
    begin
        insert into public.task_work_log (task_id, user_id, time_spent)
        values (_task_id, 'd4444444-4444-4444-4444-444444444444', 600);
    exception
        when insufficient_privilege then _dave_blocked := true;  -- RLS WITH CHECK violation
    end;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (c) FAILED: cross-team work-log leakage (got % rows)', _dave_reads;
    end if;
    if _dave_blocked is not true then
        raise exception 'TEST (c) FAILED: cross-team user was allowed to insert a task_work_log';
    end if;

    raise notice 'TEST (c) PASSED: task_work_log gated by is_task_member (cross-team blocked)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): task_timers are private to the owner. Alice starts a timer; Bob (a
--   team member of the same team) cannot see Alice's running timer.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _alice_sees int;
    _bob_sees   int;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 2;

    -- Alice starts a timer on task 2.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    perform public.start_timer(_task_id);
    select count(*) into _alice_sees from public.task_timers where task_id = _task_id;
    execute 'reset role';

    -- Bob (same team, NOT the owner) must not see Alice's timer.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_sees from public.task_timers where task_id = _task_id;
    execute 'reset role';

    if _alice_sees <> 1 then
        raise exception 'TEST (d) FAILED: owner cannot see her own timer (saw %)', _alice_sees;
    end if;
    if _bob_sees <> 0 then
        raise exception 'TEST (d) FAILED: a non-owner team member could see another user''s timer (saw %)', _bob_sees;
    end if;

    raise notice 'TEST (d) PASSED: task_timers are private to the owner (other members cannot see them)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): report_team_overview returns sane counts for the caller's team and
--   rejects a non-member (Dave) with an exception.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _total_projects bigint;
    _total_tasks    bigint;
    _total_members  bigint;
    _total_logged   bigint;
    _dave_rejected boolean := false;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Alice (member) calls report_team_overview.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select total_projects, total_tasks, total_members, total_logged_minutes
        into _total_projects, _total_tasks, _total_members, _total_logged
        from public.report_team_overview(_alice_team);
    execute 'reset role';

    if _total_projects < 1 then
        raise exception 'TEST (e) FAILED: overview total_projects = % (expected >= 1)', _total_projects;
    end if;
    if _total_tasks < 2 then
        raise exception 'TEST (e) FAILED: overview total_tasks = % (expected >= 2)', _total_tasks;
    end if;
    -- Alice (owner) + Bob (member) -> at least 2 active members.
    if _total_members < 2 then
        raise exception 'TEST (e) FAILED: overview total_members = % (expected >= 2)', _total_members;
    end if;
    -- (a) timer ~5min + (b) manual 30min -> >= 35 logged minutes.
    if _total_logged < 35 then
        raise exception 'TEST (e) FAILED: overview total_logged_minutes = % (expected >= 35)', _total_logged;
    end if;

    -- Dave (non-member) must be rejected.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform * from public.report_team_overview(_alice_team);
    exception
        when others then _dave_rejected := true;
    end;
    execute 'reset role';

    if _dave_rejected is not true then
        raise exception 'TEST (e) FAILED: report_team_overview did not reject a non-member';
    end if;

    raise notice 'TEST (e) PASSED: report_team_overview returns sane counts and rejects non-members';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): report_projects / report_members run for a member and return rows
--   scoped to the team. report_time_logs also returns the logged rows.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _proj_rows  int;
    _proj_logged bigint;
    _member_rows int;
    _logs_rows   int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';

    select count(*) into _proj_rows from public.report_projects(_alice_team);
    select logged_minutes into _proj_logged
        from public.report_projects(_alice_team) where project_name = 'Apollo Launch';
    select count(*) into _member_rows from public.report_members(_alice_team);
    select count(*) into _logs_rows from public.report_time_logs(_alice_team);

    execute 'reset role';

    if _proj_rows < 1 then
        raise exception 'TEST (f) FAILED: report_projects returned % rows (expected >= 1)', _proj_rows;
    end if;
    -- Apollo Launch accumulated the (a) timer + (b) manual logs -> >= 35 minutes.
    if _proj_logged < 35 then
        raise exception 'TEST (f) FAILED: report_projects logged_minutes = % (expected >= 35)', _proj_logged;
    end if;
    -- Alice + Bob are active team members -> >= 2 member rows.
    if _member_rows < 2 then
        raise exception 'TEST (f) FAILED: report_members returned % rows (expected >= 2)', _member_rows;
    end if;
    -- The (a) timer log + (b) manual log -> >= 2 time-log rows.
    if _logs_rows < 2 then
        raise exception 'TEST (f) FAILED: report_time_logs returned % rows (expected >= 2)', _logs_rows;
    end if;

    raise notice 'TEST (f) PASSED: report_projects / report_members / report_time_logs return team-scoped rows';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 6 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
