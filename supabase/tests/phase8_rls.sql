-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 8 RLS test
--   (admin center + activity logs + support)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 8 tables
-- (task_activity_logs / support_requests), the activity-log triggers, the
-- is_org_admin helper and the four admin RPCs (admin_org_overview /
-- admin_list_teams / admin_list_users / admin_list_projects), and the RLS
-- policies. Mirrors the proven Phase 1-7 pattern: it works WITH the
-- handle_new_user trigger rather than disabling it (postgres is not superuser
-- here and cannot disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase8_rls.sql
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
--   `authenticated` role and set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) creating a task writes a 'created' activity log; updating its status
--       writes a 'status_changed' row with the resolved status NAMES (old/new).
--   (b) activity logs are visible to a project team member (Bob), invisible
--       cross-team (Dave sees none); and a client cannot write the audit log.
--   (c) support_requests are user-private (Alice reads her own; Bob sees none;
--       Dave is blocked from inserting on Alice's behalf).
--   (d) admin_org_overview returns sane counts for the ORG OWNER (Alice) and
--       RAISES 'forbidden' for a non-member/non-admin (Dave).
--   (e) admin_list_teams / admin_list_users / admin_list_projects return rows
--       for the owner (Alice).
--   (f) is_org_admin is TRUE for the owner (Alice) and FALSE for an unrelated
--       user (Dave).
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
-- TEST (a): the 'created' log was written when the task was created; and an
--   UPDATE that changes the status writes a 'status_changed' row whose old/new
--   are the resolved STATUS NAMES. We run the status update as Alice (a member),
--   which also exercises the BEFORE/AFTER trigger ordering.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id   uuid;
    _task_id      uuid;
    _todo_status  uuid;
    _doing_status uuid;
    _todo_name    text;
    _doing_name   text;
    _created_logs int;
    _status_logs  int;
    _log_old      text;
    _log_new      text;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Resolve the project's To-Do and Doing statuses (seeded by create_project).
    select s.id, s.name into _todo_status, _todo_name
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = _project_id and c.is_todo is true
    order by s.sort_order limit 1;

    select s.id, s.name into _doing_status, _doing_name
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = _project_id and c.is_doing is true
    order by s.sort_order limit 1;

    -- The 'created' log must already exist (from the AFTER INSERT trigger).
    select count(*) into _created_logs from public.task_activity_logs
        where task_id = _task_id and action = 'created';
    if _created_logs <> 1 then
        raise exception 'TEST (a) FAILED: expected exactly 1 ''created'' log, got %', _created_logs;
    end if;

    -- Alice (a project team member) moves the task from To-Do to Doing.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    update public.tasks set status_id = _doing_status where id = _task_id;
    execute 'reset role';

    select count(*) into _status_logs from public.task_activity_logs
        where task_id = _task_id and action = 'status_changed';
    select old_value, new_value into _log_old, _log_new
    from public.task_activity_logs
        where task_id = _task_id and action = 'status_changed'
        order by created_at desc limit 1;

    if _status_logs <> 1 then
        raise exception 'TEST (a) FAILED: expected exactly 1 ''status_changed'' log, got %', _status_logs;
    end if;
    if _log_old is distinct from _todo_name or _log_new is distinct from _doing_name then
        raise exception 'TEST (a) FAILED: status names not resolved (old=%, new=%; expected %, %)',
            _log_old, _log_new, _todo_name, _doing_name;
    end if;

    raise notice 'TEST (a) PASSED: create writes a ''created'' log; status change writes ''status_changed'' with resolved names (% -> %)',
        _log_old, _log_new;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): activity logs are visible to a project team member (Bob), invisible
--   cross-team (Dave), and NOT writable by a client (no INSERT policy).
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id  uuid;
    _task_id     uuid;
    _bob_reads   int;
    _dave_reads  int;
    _client_blocked boolean := false;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Bob (non-admin member of Alice's team) can READ the task's logs.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_reads from public.task_activity_logs where task_id = _task_id;
    execute 'reset role';

    if _bob_reads < 2 then
        raise exception 'TEST (b) FAILED: team member could not read the task logs (got %, expected >= 2)', _bob_reads;
    end if;

    -- Dave (cross-team) sees none AND cannot insert an audit row (no INSERT policy
    -- + no table INSERT grant -> permission denied / insufficient_privilege).
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.task_activity_logs where task_id = _task_id;
    begin
        insert into public.task_activity_logs (task_id, project_id, action, new_value)
        values (_task_id, _project_id, 'created', 'sneaky');
    exception when insufficient_privilege then _client_blocked := true;
    end;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (b) FAILED: cross-team activity-log leakage (got % rows)', _dave_reads;
    end if;
    if _client_blocked is not true then
        raise exception 'TEST (b) FAILED: a client was allowed to write the append-only audit log';
    end if;

    raise notice 'TEST (b) PASSED: logs visible to a member, invisible cross-team, and not client-writable';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): support_requests are user-private. Alice inserts + reads her own;
--   Bob (a different user) sees none; Dave is blocked from inserting a row owned
--   by Alice (WITH CHECK on user_id = auth.uid()).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team   uuid;
    _sr_id        uuid;
    _alice_reads  int;
    _bob_reads    int;
    _dave_blocked boolean := false;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Alice files a support request and reads it back.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.support_requests (user_id, team_id, subject, message)
    values ('a1111111-1111-1111-1111-111111111111', _alice_team,
            'Cannot export', 'Export to CSV is failing on the reports page.')
    returning id into _sr_id;
    select count(*) into _alice_reads from public.support_requests
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    execute 'reset role';

    if _sr_id is null then
        raise exception 'TEST (c) FAILED: user could not file a support request';
    end if;
    if _alice_reads < 1 then
        raise exception 'TEST (c) FAILED: user could not read her own support request (got %)', _alice_reads;
    end if;

    -- Bob (a different user) sees none of Alice's requests.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_reads from public.support_requests;
    execute 'reset role';

    if _bob_reads <> 0 then
        raise exception 'TEST (c) FAILED: support_requests leaked to another user (got %)', _bob_reads;
    end if;

    -- Dave is blocked from inserting a request owned by Alice (WITH CHECK).
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        insert into public.support_requests (user_id, subject, message)
        values ('a1111111-1111-1111-1111-111111111111', 'spoof', 'not mine');
    exception when insufficient_privilege then _dave_blocked := true;
    end;
    execute 'reset role';

    if _dave_blocked is not true then
        raise exception 'TEST (c) FAILED: a user could file a support request owned by someone else';
    end if;

    raise notice 'TEST (c) PASSED: support_requests are user-private (own read/write; others invisible + spoof blocked)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): admin_org_overview returns sane counts for the ORG OWNER (Alice) and
--   RAISES 'forbidden' for a non-member/non-admin (Dave).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org    uuid;
    _ov           record;
    _dave_forbidden boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    -- Alice (org owner) gets an overview row.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select * into _ov from public.admin_org_overview(_alice_org);
    execute 'reset role';

    if _ov.org_name is null then
        raise exception 'TEST (d) FAILED: admin_org_overview returned no row for the owner';
    end if;
    -- Alice's org has at least one team, >=2 members (Alice + Bob), 1 project,
    -- and >=1 task (the one Alice created), 0 completed (it is in Doing now).
    if _ov.total_teams < 1 then
        raise exception 'TEST (d) FAILED: total_teams = % (expected >= 1)', _ov.total_teams;
    end if;
    if _ov.total_members < 2 then
        raise exception 'TEST (d) FAILED: total_members = % (expected >= 2: Alice + Bob)', _ov.total_members;
    end if;
    if _ov.total_projects < 1 then
        raise exception 'TEST (d) FAILED: total_projects = % (expected >= 1)', _ov.total_projects;
    end if;
    if _ov.total_tasks < 1 then
        raise exception 'TEST (d) FAILED: total_tasks = % (expected >= 1)', _ov.total_tasks;
    end if;
    if _ov.completed_tasks > _ov.total_tasks then
        raise exception 'TEST (d) FAILED: completed_tasks (%) > total_tasks (%)', _ov.completed_tasks, _ov.total_tasks;
    end if;

    -- Dave (unrelated tenant) is forbidden.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform * from public.admin_org_overview(_alice_org);
    exception when others then
        if sqlerrm = 'forbidden' then
            _dave_forbidden := true;
        else
            raise;
        end if;
    end;
    execute 'reset role';

    if _dave_forbidden is not true then
        raise exception 'TEST (d) FAILED: a non-admin was NOT forbidden from admin_org_overview';
    end if;

    raise notice 'TEST (d) PASSED: admin_org_overview returns sane counts for the owner (teams=%, members=%, projects=%, tasks=%, done=%) and forbids a non-admin',
        _ov.total_teams, _ov.total_members, _ov.total_projects, _ov.total_tasks, _ov.completed_tasks;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): admin_list_teams / admin_list_users / admin_list_projects return
--   rows for the owner (Alice).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org    uuid;
    _teams        int;
    _users        int;
    _projects     int;
    _has_apollo   int;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _teams    from public.admin_list_teams(_alice_org);
    select count(*) into _users    from public.admin_list_users(_alice_org);
    select count(*) into _projects from public.admin_list_projects(_alice_org);
    select count(*) into _has_apollo
        from public.admin_list_projects(_alice_org) where project_name = 'Apollo Launch';
    execute 'reset role';

    if _teams < 1 then
        raise exception 'TEST (e) FAILED: admin_list_teams returned % rows (expected >= 1)', _teams;
    end if;
    if _users < 2 then
        raise exception 'TEST (e) FAILED: admin_list_users returned % rows (expected >= 2: Alice + Bob)', _users;
    end if;
    if _projects < 1 then
        raise exception 'TEST (e) FAILED: admin_list_projects returned % rows (expected >= 1)', _projects;
    end if;
    if _has_apollo <> 1 then
        raise exception 'TEST (e) FAILED: admin_list_projects did not include Apollo Launch (got %)', _has_apollo;
    end if;

    raise notice 'TEST (e) PASSED: admin_list_teams/users/projects return rows for the owner (teams=%, users=%, projects=%)',
        _teams, _users, _projects;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): is_org_admin is TRUE for the owner (Alice) and FALSE for an
--   unrelated user (Dave).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org    uuid;
    _alice_admin  boolean;
    _dave_admin   boolean;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _alice_admin := public.is_org_admin(_alice_org);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _dave_admin := public.is_org_admin(_alice_org);
    execute 'reset role';

    if _alice_admin is not true then
        raise exception 'TEST (f) FAILED: is_org_admin was not TRUE for the org owner';
    end if;
    if _dave_admin is not false then
        raise exception 'TEST (f) FAILED: is_org_admin was not FALSE for an unrelated user (got %)', _dave_admin;
    end if;

    raise notice 'TEST (f) PASSED: is_org_admin TRUE for owner, FALSE for an unrelated user';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 8 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
