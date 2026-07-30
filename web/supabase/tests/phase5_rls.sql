-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 5 RLS test (home / notifications / storage)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 5 tables, the
-- create_notification RPC, the assignment/comment notification triggers,
-- get_my_tasks, and the RLS policies on user_notifications / personal_todo_list /
-- task_attachments. Mirrors the proven Phase 1-4 pattern: it works WITH the
-- handle_new_user trigger rather than disabling it (postgres is not superuser
-- here and cannot disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase5_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- NOTE: storage.objects policies (avatars / attachments path-segment scoping) are
-- NOT exercised here — they are validated via the app upload E2E. This file
-- covers the public-schema tables, RPCs and triggers only.
--
-- STRATEGY
--   Insert three auth.users (Alice, Bob, Carol). on_auth_user_created
--   auto-provisions for each: a profile + organization + team + roles + an owner
--   team_membership + active_team. Carol is added as a NON-admin (Member) of
--   Alice's team. The Phase 3 default project status + the Phase 4 task categories
--   / priorities lookups are seeded inline (the test db may be migrate-only;
--   guarded so it coexists with seed.sql). Fixture writes run as postgres (OWNS
--   the public.* tables -> RLS bypassed). Assertions switch into the
--   `authenticated` role and set request.jwt.claims.sub (auth.uid()). Fixture
--   projects/tasks are created via public.create_project + public.create_task.
--
-- COVERAGE
--   (a) create_notification inserts a row; Alice reads her own notifications and
--       cannot read Bob's (RLS user-private).
--   (b) assigning Carol to a task auto-creates an 'assignment' notification for
--       Carol (notify_on_task_assignment trigger); the assigner/reporter (Alice)
--       gets none.
--   (c) Bob commenting on the task notifies the task's other participants (Alice
--       the reporter + Carol the assignee) but NOT Bob the commenter
--       (notify_on_task_comment trigger).
--   (d) personal_todo_list is strictly user-private (Carol cannot see Alice's).
--   (e) task_attachments gated by is_task_member: a team member can insert+read;
--       a cross-team user sees none and is blocked from inserting.
--   (f) get_my_tasks returns the caller's assigned, not-done tasks.
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
-- Carol becomes a NON-admin (Member) of Alice's team. Alice creates a project
-- (auto-seeds statuses) and a task (reporter=Alice).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _project_id uuid;
    _task_id    uuid;
begin
    insert into auth.users (id, instance_id, aud, role, email)
    values
        ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'alice@example.com'),
        ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'bob@example.com'),
        ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'carol@example.com');

    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Carol becomes a NON-admin (Member, default_role=true) of Alice's team.
    insert into public.team_members (user_id, team_id, role_id, active)
    select 'c3333333-3333-3333-3333-333333333333', _alice_team, r.id, true
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true;

    -- Alice creates a project + a task (as Alice, via the RPCs).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _project_id := public.create_project('Apollo Launch', _alice_team);
    _task_id    := public.create_task('Build the rocket', _project_id);
    execute 'reset role';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): create_notification inserts a row; user_notifications is user-private
--   (Alice reads her own; cannot read Bob's).
-- -----------------------------------------------------------------------------
do $$
declare
    _nid_alice uuid;
    _nid_bob   uuid;
    _alice_team uuid;
    _alice_sees int;
    _alice_sees_bob int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Insert one notification for Alice and one for Bob (as postgres via the RPC).
    _nid_alice := public.create_notification(
        p_user_id => 'a1111111-1111-1111-1111-111111111111',
        p_message => 'Welcome to Cubes',
        p_team_id => _alice_team);
    _nid_bob := public.create_notification(
        p_user_id => 'b2222222-2222-2222-2222-222222222222',
        p_message => 'Bob-only notification');

    if _nid_alice is null then
        raise exception 'TEST (a) FAILED: create_notification returned null for a valid insert';
    end if;

    -- Alice reads: should see her own row, and exactly zero of Bob's.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _alice_sees from public.user_notifications;
    select count(*) into _alice_sees_bob from public.user_notifications
        where id = _nid_bob;
    execute 'reset role';

    if _alice_sees < 1 then
        raise exception 'TEST (a) FAILED: Alice cannot read her own notification (saw %)', _alice_sees;
    end if;
    if _alice_sees_bob <> 0 then
        raise exception 'TEST (a) FAILED: Alice could read Bob''s notification (RLS leak)';
    end if;

    raise notice 'TEST (a) PASSED: create_notification inserts; notifications are user-private';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): assigning Carol to the task auto-creates an 'assignment' notification
--   for Carol (trigger); Alice (assigner + reporter) gets none from this.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _carol_tm   uuid;
    _alice_team uuid;
    _carol_notifs int;
    _alice_assign_notifs int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;
    select id into _carol_tm from public.team_members
        where user_id = 'c3333333-3333-3333-3333-333333333333' and team_id = _alice_team;

    -- Alice assigns Carol (assigned_by = Alice). Trigger should notify Carol only.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.tasks_assignees (task_id, team_member_id, assigned_by)
        values (_task_id, _carol_tm, 'a1111111-1111-1111-1111-111111111111');
    execute 'reset role';

    -- Verify (as postgres / RLS bypassed).
    select count(*) into _carol_notifs from public.user_notifications
        where user_id = 'c3333333-3333-3333-3333-333333333333'
          and type = 'assignment' and task_id = _task_id;
    select count(*) into _alice_assign_notifs from public.user_notifications
        where user_id = 'a1111111-1111-1111-1111-111111111111'
          and type = 'assignment' and task_id = _task_id;

    if _carol_notifs <> 1 then
        raise exception 'TEST (b) FAILED: assignment did not notify the assignee (got % for Carol)', _carol_notifs;
    end if;
    if _alice_assign_notifs <> 0 then
        raise exception 'TEST (b) FAILED: assigner/reporter wrongly notified (got % for Alice)', _alice_assign_notifs;
    end if;

    raise notice 'TEST (b) PASSED: task assignment notifies the assignee (not the assigner/reporter)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): Bob comments on the task -> the OTHER participants (Alice the reporter
--   + Carol the assignee) are notified, but Bob the commenter is not.
--   (Bob is added to Alice's team first so is_task_member lets him insert.)
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _alice_team uuid;
    _alice_comment_notifs int;
    _carol_comment_notifs int;
    _bob_comment_notifs   int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Add Bob to Alice's team (Member) so he can comment (is_task_member).
    insert into public.team_members (user_id, team_id, role_id, active)
    select 'b2222222-2222-2222-2222-222222222222', _alice_team, r.id, true
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true
    on conflict do nothing;

    -- Bob comments (created_by = Bob).
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.task_comments (task_id, content, created_by)
        values (_task_id, 'Looking great', 'b2222222-2222-2222-2222-222222222222');
    execute 'reset role';

    -- Verify (as postgres). Reporter (Alice) + assignee (Carol) notified; Bob not.
    select count(*) into _alice_comment_notifs from public.user_notifications
        where user_id = 'a1111111-1111-1111-1111-111111111111'
          and type = 'comment' and task_id = _task_id;
    select count(*) into _carol_comment_notifs from public.user_notifications
        where user_id = 'c3333333-3333-3333-3333-333333333333'
          and type = 'comment' and task_id = _task_id;
    select count(*) into _bob_comment_notifs from public.user_notifications
        where user_id = 'b2222222-2222-2222-2222-222222222222'
          and type = 'comment' and task_id = _task_id;

    if _alice_comment_notifs <> 1 then
        raise exception 'TEST (c) FAILED: reporter not notified of comment (got %)', _alice_comment_notifs;
    end if;
    if _carol_comment_notifs <> 1 then
        raise exception 'TEST (c) FAILED: assignee not notified of comment (got %)', _carol_comment_notifs;
    end if;
    if _bob_comment_notifs <> 0 then
        raise exception 'TEST (c) FAILED: commenter was notified of own comment (got %)', _bob_comment_notifs;
    end if;

    raise notice 'TEST (c) PASSED: comment notifies other participants, not the commenter';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): personal_todo_list is strictly user-private. Alice creates a to-do;
--   Carol cannot see it; Carol's own is visible only to Carol.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_sees int;
    _carol_sees_alice int;
    _carol_sees_own int;
begin
    -- Alice creates a personal to-do (as Alice; RLS WITH CHECK user_id=auth.uid()).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.personal_todo_list (user_id, name)
        values ('a1111111-1111-1111-1111-111111111111', 'Alice private todo');
    select count(*) into _alice_sees from public.personal_todo_list;
    execute 'reset role';

    -- Carol creates her own + tries to read Alice's.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.personal_todo_list (user_id, name)
        values ('c3333333-3333-3333-3333-333333333333', 'Carol private todo');
    select count(*) into _carol_sees_own from public.personal_todo_list;
    select count(*) into _carol_sees_alice from public.personal_todo_list
        where name = 'Alice private todo';
    execute 'reset role';

    if _alice_sees <> 1 then
        raise exception 'TEST (d) FAILED: Alice cannot read her own to-do (saw %)', _alice_sees;
    end if;
    if _carol_sees_own <> 1 then
        raise exception 'TEST (d) FAILED: Carol sees % to-dos (expected only her own)', _carol_sees_own;
    end if;
    if _carol_sees_alice <> 0 then
        raise exception 'TEST (d) FAILED: Carol could read Alice''s private to-do (RLS leak)';
    end if;

    raise notice 'TEST (d) PASSED: personal_todo_list is user-private';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): task_attachments gated by is_task_member. Carol (member) inserts +
--   reads; Dave (cross-team, separate tenant) sees none and is blocked from
--   inserting.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _task_id    uuid;
    _alice_team uuid;
    _carol_reads int;
    _dave_reads  int;
    _dave_blocked boolean := false;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Dave is a wholly separate tenant (his own team via the trigger).
    insert into auth.users (id, instance_id, aud, role, email)
    values ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'dave@example.com');

    -- Carol (project team member) inserts an attachment + reads it.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.task_attachments
        (task_id, project_id, team_id, name, size, type, storage_path, uploaded_by)
    values (_task_id, _project_id, _alice_team, 'spec.pdf', 1024, 'application/pdf',
            _alice_team || '/' || _project_id || '/' || _task_id || '/spec.pdf',
            'c3333333-3333-3333-3333-333333333333');
    select count(*) into _carol_reads from public.task_attachments where task_id = _task_id;
    execute 'reset role';

    if _carol_reads <> 1 then
        raise exception 'TEST (e) FAILED: team member could not read the attachment (got %)', _carol_reads;
    end if;

    -- Dave (cross-team) must see none and be blocked from inserting.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.task_attachments where task_id = _task_id;
    begin
        insert into public.task_attachments
            (task_id, project_id, team_id, storage_path, uploaded_by)
        values (_task_id, _project_id, _alice_team, 'x/y/z/evil.pdf',
                'd4444444-4444-4444-4444-444444444444');
    exception
        when insufficient_privilege then _dave_blocked := true;  -- RLS WITH CHECK violation
    end;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (e) FAILED: cross-team attachment leakage (got % rows)', _dave_reads;
    end if;
    if _dave_blocked is not true then
        raise exception 'TEST (e) FAILED: cross-team user was allowed to insert a task_attachment';
    end if;

    raise notice 'TEST (e) PASSED: task_attachments gated by is_task_member (cross-team blocked)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): get_my_tasks returns the caller's assigned, not-done tasks. Carol is
--   assigned to the task (TEST b); she should see exactly that task. Bob, who is
--   a team member but NOT assigned, should see none.
-- -----------------------------------------------------------------------------
do $$
declare
    _task_id    uuid;
    _project_id uuid;
    _carol_cnt  int;
    _carol_name text;
    _carol_proj text;
    _bob_cnt    int;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;
    select id into _task_id from public.tasks where project_id = _project_id and task_no = 1;

    -- Carol (assigned) calls get_my_tasks.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _carol_cnt from public.get_my_tasks();
    select name, project_name into _carol_name, _carol_proj
        from public.get_my_tasks() where task_id = _task_id;
    execute 'reset role';

    -- Bob (team member, NOT assigned) calls get_my_tasks.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_cnt from public.get_my_tasks();
    execute 'reset role';

    if _carol_cnt <> 1 then
        raise exception 'TEST (f) FAILED: assignee saw % tasks via get_my_tasks (expected 1)', _carol_cnt;
    end if;
    if _carol_name is distinct from 'Build the rocket' or _carol_proj is distinct from 'Apollo Launch' then
        raise exception 'TEST (f) FAILED: get_my_tasks returned wrong task/project (name=%, project=%)',
            _carol_name, _carol_proj;
    end if;
    if _bob_cnt <> 0 then
        raise exception 'TEST (f) FAILED: non-assigned member saw % tasks via get_my_tasks (expected 0)', _bob_cnt;
    end if;

    raise notice 'TEST (f) PASSED: get_my_tasks returns the caller''s assigned, not-done tasks';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 5 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
