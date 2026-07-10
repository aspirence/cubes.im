-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 4 RLS test (tasks)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 4 tables, triggers,
-- create_task RPC and RLS policies behave: project create auto-seeds 3 default
-- task_statuses; create_task assigns incrementing per-project task_no and sets
-- reporter=caller; tasks are tenant-isolated; task-children (assignees / labels /
-- comments) are gated by is_task_member; moving a task to a Done-category status
-- sets done=true + completed_at; subtasks (parent_task_id) work. Mirrors the
-- proven Phase 1/2/3 pattern: it works WITH the handle_new_user trigger rather
-- than disabling it (postgres is not superuser here and cannot disable a trigger
-- it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase4_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY
--   Insert two auth.users (Alice, Bob). on_auth_user_created auto-provisions for
--   each: a profile + organization + team + Member/Admin/Owner roles + an owner
--   team_membership + active_team. Carol is added as a NON-admin (Member) of
--   Alice's team. The sys_project_statuses (Phase 3) + sys_task_status_categories
--   + task_priorities (Phase 4) lookups are seeded inline (the test db may be
--   migrate-only; guarded so it coexists with seed.sql). Fixture writes run as
--   postgres (OWNS the public.* tables -> RLS bypassed). Assertions switch into
--   the `authenticated` role and set request.jwt.claims.sub (auth.uid()).
--   Fixture projects are created via public.create_project (Phase 3).
--
-- COVERAGE
--   (a) creating a project auto-seeds exactly 3 task_statuses (To Do/Doing/Done).
--   (b) create_task assigns incrementing task_no (1,2,...) and reporter=caller.
--   (c) tasks visible to project team members (Carol), invisible cross-team (Bob).
--   (d) tasks_assignees / task_labels / task_comments are gated by is_task_member
--       (Carol can read/write; Bob, cross-team, is blocked and sees nothing).
--   (e) setting a task to a Done-category status sets done=true + completed_at;
--       moving it back to a To-Do status clears them.
--   (f) a subtask (parent_task_id) can be created and is visible to a team member.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Lookup seed (idempotent). Runs as postgres (RLS bypassed). Coexists with
-- seed.sql / the migrations. Phase 3 default status (for create_project) + the
-- Phase 4 task categories + priorities.
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
-- -----------------------------------------------------------------------------
do $$
begin
    insert into auth.users (id, instance_id, aud, role, email)
    values
        ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'alice@example.com'),
        ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'bob@example.com'),
        ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'carol@example.com');

    -- Carol becomes a NON-admin (Member, default_role=true) of Alice's team.
    insert into public.team_members (user_id, team_id, role_id, active)
    select 'c3333333-3333-3333-3333-333333333333', t.id, r.id, true
    from public.teams t
    join public.roles r on r.team_id = t.id and r.default_role = true
    where t.user_id = 'a1111111-1111-1111-1111-111111111111';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): creating a project auto-seeds exactly 3 task_statuses mapped to the
--   To Do / Doing / Done categories.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _project_id uuid;
    _status_cnt int;
    _todo_cnt   int;
    _done_cnt   int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _project_id := public.create_project('Apollo Launch', _alice_team);
    execute 'reset role';

    -- Verify (as postgres / RLS bypassed): 3 statuses, one per category bool.
    select count(*) into _status_cnt from public.task_statuses where project_id = _project_id;
    if _status_cnt <> 3 then
        raise exception 'TEST (a) FAILED: project did not auto-seed 3 task_statuses (got %)', _status_cnt;
    end if;

    select count(*) into _todo_cnt
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = _project_id and c.is_todo is true;
    select count(*) into _done_cnt
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = _project_id and c.is_done is true;
    if _todo_cnt <> 1 or _done_cnt <> 1 then
        raise exception 'TEST (a) FAILED: default statuses not mapped to categories (todo=%, done=%)',
            _todo_cnt, _done_cnt;
    end if;

    raise notice 'TEST (a) PASSED: create_project auto-seeds 3 default task_statuses';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): create_task assigns incrementing per-project task_no (1,2,...) and
--   sets reporter=caller.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _t1 uuid; _t2 uuid;
    _no1 int; _no2 int;
    _rep uuid;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _t1 := public.create_task('First task', _project_id);
    _t2 := public.create_task('Second task', _project_id);
    execute 'reset role';

    select task_no, reporter_id into _no1, _rep from public.tasks where id = _t1;
    select task_no into _no2 from public.tasks where id = _t2;

    if _no1 <> 1 or _no2 <> 2 then
        raise exception 'TEST (b) FAILED: task_no not incrementing (got %, %)', _no1, _no2;
    end if;
    if _rep <> 'a1111111-1111-1111-1111-111111111111' then
        raise exception 'TEST (b) FAILED: reporter is % (expected Alice)', _rep;
    end if;

    raise notice 'TEST (b) PASSED: create_task assigns incrementing task_no + reporter=caller';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): tasks visible to project team members (Carol), invisible cross-team
--   (Bob).
-- -----------------------------------------------------------------------------
do $$
declare _carol_sees int; _bob_sees int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _carol_sees from public.tasks;
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_sees from public.tasks;
    execute 'reset role';

    if _carol_sees <> 2 then
        raise exception 'TEST (c) FAILED: team member saw % tasks (expected 2)', _carol_sees;
    end if;
    if _bob_sees <> 0 then
        raise exception 'TEST (c) FAILED: cross-team task leakage (got % rows)', _bob_sees;
    end if;
    raise notice 'TEST (c) PASSED: tasks visible to team members, invisible cross-team';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): tasks_assignees / task_labels / task_comments gated by is_task_member.
--   Carol (member) can write+read; Bob (cross-team) is blocked and sees nothing.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id    uuid;
    _task_id       uuid;
    _carol_tm      uuid;
    _label_id      uuid;
    _alice_team    uuid;
    _carol_a int; _carol_l int; _carol_c int;
    _bob_a int;   _bob_l int;   _bob_c int;
    _bob_insert_err boolean := false;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Carol's team_member row + a team label (fixtures as postgres).
    select id into _carol_tm from public.team_members
        where user_id = 'c3333333-3333-3333-3333-333333333333' and team_id = _alice_team;
    insert into public.team_labels (name, color_code, team_id)
        values ('Urgent', '#f37070', _alice_team) returning id into _label_id;

    -- Carol (project team member) writes an assignee, a label, a comment.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.tasks_assignees (task_id, team_member_id, assigned_by)
        values (_task_id, _carol_tm, 'c3333333-3333-3333-3333-333333333333');
    insert into public.task_labels (task_id, label_id) values (_task_id, _label_id);
    insert into public.task_comments (task_id, content, created_by)
        values (_task_id, 'Looks good to me', 'c3333333-3333-3333-3333-333333333333');
    select count(*) into _carol_a from public.tasks_assignees where task_id = _task_id;
    select count(*) into _carol_l from public.task_labels    where task_id = _task_id;
    select count(*) into _carol_c from public.task_comments  where task_id = _task_id;
    execute 'reset role';

    if _carol_a <> 1 or _carol_l <> 1 or _carol_c <> 1 then
        raise exception 'TEST (d) FAILED: team member could not read own task-children (a=%, l=%, c=%)',
            _carol_a, _carol_l, _carol_c;
    end if;

    -- Bob (cross-team) must see NONE and be blocked from inserting a comment.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_a from public.tasks_assignees where task_id = _task_id;
    select count(*) into _bob_l from public.task_labels    where task_id = _task_id;
    select count(*) into _bob_c from public.task_comments  where task_id = _task_id;
    begin
        insert into public.task_comments (task_id, content, created_by)
            values (_task_id, 'I should not be here', 'b2222222-2222-2222-2222-222222222222');
    exception
        when insufficient_privilege then _bob_insert_err := true;  -- RLS WITH CHECK violation
    end;
    execute 'reset role';

    if _bob_a <> 0 or _bob_l <> 0 or _bob_c <> 0 then
        raise exception 'TEST (d) FAILED: cross-team task-children leakage (a=%, l=%, c=%)',
            _bob_a, _bob_l, _bob_c;
    end if;
    if _bob_insert_err is not true then
        raise exception 'TEST (d) FAILED: cross-team user was allowed to insert a task_comment';
    end if;

    raise notice 'TEST (d) PASSED: task-children gated by is_task_member (cross-team blocked)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): moving a task to a Done-category status sets done=true + completed_at;
--   moving it back to a To-Do status clears them.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _done_status uuid;
    _todo_status uuid;
    _done bool; _completed timestamptz;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    select s.id into _done_status
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = _project_id and c.is_done is true limit 1;
    select s.id into _todo_status
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = _project_id and c.is_todo is true limit 1;

    -- Alice (member) moves the task to the Done status.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    update public.tasks set status_id = _done_status where id = _task_id;
    execute 'reset role';

    select done, completed_at into _done, _completed from public.tasks where id = _task_id;
    if _done is not true or _completed is null then
        raise exception 'TEST (e) FAILED: Done status did not set done/completed_at (done=%, completed=%)',
            _done, _completed;
    end if;

    -- Move it back to To-Do -> done cleared, completed_at cleared.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    update public.tasks set status_id = _todo_status where id = _task_id;
    execute 'reset role';

    select done, completed_at into _done, _completed from public.tasks where id = _task_id;
    if _done is not false or _completed is not null then
        raise exception 'TEST (e) FAILED: To-Do status did not clear done/completed_at (done=%, completed=%)',
            _done, _completed;
    end if;

    raise notice 'TEST (e) PASSED: Done status sets done+completed_at; To-Do clears them';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): a subtask (parent_task_id) can be created and is visible to a member.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _parent_id  uuid;
    _sub_id     uuid;
    _seen_parent uuid;
    _carol_sees_sub int;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _parent_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Alice creates a subtask of task #1.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _sub_id := public.create_task('A subtask', _project_id, null, null, _parent_id);
    execute 'reset role';

    select parent_task_id into _seen_parent from public.tasks where id = _sub_id;
    if _seen_parent <> _parent_id then
        raise exception 'TEST (f) FAILED: subtask parent_task_id is % (expected %)', _seen_parent, _parent_id;
    end if;

    -- Carol (member) can see the subtask.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _carol_sees_sub from public.tasks where id = _sub_id;
    execute 'reset role';

    if _carol_sees_sub <> 1 then
        raise exception 'TEST (f) FAILED: team member cannot see the subtask (got %)', _carol_sees_sub;
    end if;

    raise notice 'TEST (f) PASSED: subtask created with parent_task_id and visible to team member';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 4 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
