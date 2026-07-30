-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 9 RLS test
--   (project comments/updates + task dependencies + @mentions + account-deletion
--    FK cascade)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 9 tables
-- (project_comments / task_dependencies), the task_comments.mentions column, the
-- two mention-notification triggers, the RLS policies, and the account-deletion
-- FK fix (teams_user_id_fk now ON DELETE CASCADE). Mirrors the proven Phase 1-8
-- pattern: it works WITH the handle_new_user trigger rather than disabling it
-- (postgres is not superuser here and cannot disable a trigger it does not own
-- on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase9_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY
--   Insert four auth.users (Alice, Bob, Dave, Carol). on_auth_user_created
--   auto-provisions for each: a profile + organization + team + roles + an owner
--   team_membership + active_team. Bob is added as a NON-admin (Member) of
--   Alice's team. Dave is a wholly separate tenant. Carol is a throwaway tenant
--   used ONLY by the FK-cascade test (TEST e). The Phase 3 default project status
--   + the Phase 4 task categories / priorities lookups are seeded inline (guarded
--   so it coexists with seed.sql). Fixture writes run as postgres (OWNS the
--   public.* tables -> RLS bypassed). Assertions switch into the `authenticated`
--   role and set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) project_comments are gated by project-team membership: a member (Alice)
--       can write + read; a non-admin member (Bob) can read; a cross-team user
--       (Dave) is BLOCKED from inserting and sees NONE (invisible).
--   (b) a project comment that @mentions another team member (Bob) creates a
--       'mention' notification for Bob and NOT for the author (Alice).
--   (c) task_dependencies are gated by is_task_member: Alice (member) can create
--       one; Dave (cross-team) is BLOCKED and sees none; a self-dependency is
--       rejected by the CHECK constraint.
--   (d) a task_comments row whose `mentions` includes Bob notifies Bob (and not
--       the author Alice).
--   (e) teams_user_id_fk is ON DELETE CASCADE: deleting a public.users row (as
--       postgres) removes that user's team(s) too. Verified two ways: the
--       pg_constraint.confdeltype is 'c', AND an actual delete inside a savepoint
--       (rolled back) cascades the team away.
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
-- (auto-seeds statuses) and two tasks (reporter=Alice). Dave + Carol are
-- separate tenants.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
begin
    insert into auth.users (id, instance_id, aud, role, email)
    values
        ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'alice@example.com'),
        ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'bob@example.com'),
        ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'dave@example.com'),
        ('c5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'carol@example.com');

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
    perform public.create_task('Build the rocket', public.create_project('Apollo Launch', _alice_team));
    execute 'reset role';

    -- A second task in the same project (for the dependency test).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    perform public.create_task('Test the rocket',
        (select id from public.projects where name = 'Apollo Launch' limit 1));
    execute 'reset role';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): project_comments are gated by project-team membership. Alice (member)
--   writes + reads; Bob (non-admin member) reads; Dave (cross-team) is blocked on
--   insert and sees nothing.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id  uuid;
    _alice_reads int;
    _bob_reads   int;
    _dave_reads  int;
    _dave_blocked boolean := false;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;

    -- Alice posts a project update and reads it back.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.project_comments (project_id, content, created_by)
    values (_project_id, 'Kickoff is on Monday.', 'a1111111-1111-1111-1111-111111111111');
    select count(*) into _alice_reads from public.project_comments where project_id = _project_id;
    execute 'reset role';

    if _alice_reads < 1 then
        raise exception 'TEST (a) FAILED: project team member could not write/read a project comment (got %)', _alice_reads;
    end if;

    -- Bob (non-admin member) can read it.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_reads from public.project_comments where project_id = _project_id;
    execute 'reset role';

    if _bob_reads < 1 then
        raise exception 'TEST (a) FAILED: a team member could not read project comments (got %)', _bob_reads;
    end if;

    -- Dave (cross-team) sees none AND cannot insert.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.project_comments where project_id = _project_id;
    begin
        insert into public.project_comments (project_id, content, created_by)
        values (_project_id, 'sneaky update', 'd4444444-4444-4444-4444-444444444444');
    exception when insufficient_privilege then _dave_blocked := true;
    end;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (a) FAILED: cross-team project-comment leakage (got % rows)', _dave_reads;
    end if;
    if _dave_blocked is not true then
        raise exception 'TEST (a) FAILED: a cross-team user was allowed to insert a project comment';
    end if;

    raise notice 'TEST (a) PASSED: project_comments gated by project-team membership (member read/write; cross-team blocked + invisible)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): a project comment that @mentions Bob creates a 'mention' notification
--   for Bob and NOT for the author (Alice).
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id    uuid;
    _bob_notifs    int;
    _alice_notifs  int;
    _bob_msg       text;
begin
    select id into _project_id from public.projects where name = 'Apollo Launch' limit 1;

    -- Baseline: Bob's existing mention notifications for this project (should be 0).
    select count(*) into _bob_notifs from public.user_notifications
        where user_id = 'b2222222-2222-2222-2222-222222222222'
          and project_id = _project_id and type = 'mention';
    if _bob_notifs <> 0 then
        raise exception 'TEST (b) FAILED: unexpected pre-existing mention notifications for Bob (got %)', _bob_notifs;
    end if;

    -- Alice posts an update mentioning BOTH Bob and herself. The trigger must
    -- notify Bob but skip Alice (the author).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.project_comments (project_id, content, created_by, mentions)
    values (_project_id, 'Heads up @bob and @alice', 'a1111111-1111-1111-1111-111111111111',
            array['b2222222-2222-2222-2222-222222222222',
                  'a1111111-1111-1111-1111-111111111111']::uuid[]);
    execute 'reset role';

    -- Bob got exactly one 'mention' notification for this project.
    select count(*) into _bob_notifs from public.user_notifications
        where user_id = 'b2222222-2222-2222-2222-222222222222'
          and project_id = _project_id and type = 'mention';
    select message into _bob_msg from public.user_notifications
        where user_id = 'b2222222-2222-2222-2222-222222222222'
          and project_id = _project_id and type = 'mention'
        order by created_at desc limit 1;

    -- Alice (the author) got NONE.
    select count(*) into _alice_notifs from public.user_notifications
        where user_id = 'a1111111-1111-1111-1111-111111111111'
          and project_id = _project_id and type = 'mention';

    if _bob_notifs <> 1 then
        raise exception 'TEST (b) FAILED: expected exactly 1 mention notification for Bob, got %', _bob_notifs;
    end if;
    if _alice_notifs <> 0 then
        raise exception 'TEST (b) FAILED: the author was self-notified (got % mention notifications)', _alice_notifs;
    end if;
    if _bob_msg is null or _bob_msg not like '%mentioned you in a project update' then
        raise exception 'TEST (b) FAILED: unexpected mention message for Bob: %', _bob_msg;
    end if;

    raise notice 'TEST (b) PASSED: project-update @mention notifies the mentioned member (msg: "%") and not the author', _bob_msg;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): task_dependencies are gated by is_task_member; cross-team blocked;
--   self-dependency rejected by the CHECK.
-- -----------------------------------------------------------------------------
do $$
declare
    _task1_id     uuid;
    _task2_id     uuid;
    _alice_reads  int;
    _dave_reads   int;
    _dave_blocked boolean := false;
    _self_blocked boolean := false;
begin
    select id into _task1_id from public.tasks where name = 'Build the rocket' limit 1;
    select id into _task2_id from public.tasks where name = 'Test the rocket'  limit 1;

    -- Alice (project team member) creates a dependency: task2 blocked_by task1.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.task_dependencies (task_id, depends_on_task_id, relation_type)
    values (_task2_id, _task1_id, 'blocked_by');
    select count(*) into _alice_reads from public.task_dependencies where task_id = _task2_id;

    -- A self-dependency must be rejected by the CHECK constraint.
    begin
        insert into public.task_dependencies (task_id, depends_on_task_id)
        values (_task1_id, _task1_id);
    exception when check_violation then _self_blocked := true;
    end;
    execute 'reset role';

    if _alice_reads <> 1 then
        raise exception 'TEST (c) FAILED: member could not create/read a task dependency (got %)', _alice_reads;
    end if;
    if _self_blocked is not true then
        raise exception 'TEST (c) FAILED: a self-dependency was NOT rejected by the CHECK';
    end if;

    -- Dave (cross-team) sees none and cannot insert.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.task_dependencies where task_id = _task2_id;
    begin
        insert into public.task_dependencies (task_id, depends_on_task_id, relation_type)
        values (_task2_id, _task1_id, 'blocks');
    exception when insufficient_privilege then _dave_blocked := true;
    end;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (c) FAILED: cross-team task-dependency leakage (got % rows)', _dave_reads;
    end if;
    if _dave_blocked is not true then
        raise exception 'TEST (c) FAILED: a cross-team user was allowed to insert a task dependency';
    end if;

    raise notice 'TEST (c) PASSED: task_dependencies gated by is_task_member (member read/write; cross-team blocked; self-dependency rejected)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): task_comments.mentions notifies the mentioned user (Bob) but not the
--   author (Alice). Exercises the new mentions column + the notify trigger.
-- -----------------------------------------------------------------------------
do $$
declare
    _task_id      uuid;
    _project_id   uuid;
    _bob_notifs   int;
    _alice_notifs int;
begin
    select id, project_id into _task_id, _project_id
        from public.tasks where name = 'Build the rocket' limit 1;

    -- Baseline: Bob's existing mention notifications for this TASK (should be 0).
    select count(*) into _bob_notifs from public.user_notifications
        where user_id = 'b2222222-2222-2222-2222-222222222222'
          and task_id = _task_id and type = 'mention';
    if _bob_notifs <> 0 then
        raise exception 'TEST (d) FAILED: unexpected pre-existing task-mention notifications for Bob (got %)', _bob_notifs;
    end if;

    -- Alice comments on the task, mentioning Bob and herself.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.task_comments (task_id, content, created_by, mentions)
    values (_task_id, 'Can you take a look @bob?', 'a1111111-1111-1111-1111-111111111111',
            array['b2222222-2222-2222-2222-222222222222',
                  'a1111111-1111-1111-1111-111111111111']::uuid[]);
    execute 'reset role';

    select count(*) into _bob_notifs from public.user_notifications
        where user_id = 'b2222222-2222-2222-2222-222222222222'
          and task_id = _task_id and type = 'mention';
    select count(*) into _alice_notifs from public.user_notifications
        where user_id = 'a1111111-1111-1111-1111-111111111111'
          and task_id = _task_id and type = 'mention';

    if _bob_notifs <> 1 then
        raise exception 'TEST (d) FAILED: expected exactly 1 task-mention notification for Bob, got %', _bob_notifs;
    end if;
    if _alice_notifs <> 0 then
        raise exception 'TEST (d) FAILED: the author was self-notified on a task comment (got %)', _alice_notifs;
    end if;

    raise notice 'TEST (d) PASSED: task_comments.mentions notifies the mentioned user and not the author';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): teams_user_id_fk is now ON DELETE CASCADE. Two checks:
--   1. pg_constraint.confdeltype for teams_user_id_fk is 'c' (CASCADE);
--   2. an actual delete (inside a SAVEPOINT we roll back) of Carol's public.users
--      row removes Carol's team. We also confirm users_active_team_fk is 'n'
--      (SET NULL) so it cannot block a team delete.
-- -----------------------------------------------------------------------------
do $$
declare
    _confdeltype     "char";
    _active_deltype  "char";
    _carol_team      uuid;
    _team_after      int;
begin
    -- 1. Constraint metadata.
    select confdeltype into _confdeltype
        from pg_constraint where conname = 'teams_user_id_fk';
    if _confdeltype is distinct from 'c' then
        raise exception 'TEST (e) FAILED: teams_user_id_fk confdeltype = % (expected ''c'' = CASCADE)', _confdeltype;
    end if;

    select confdeltype into _active_deltype
        from pg_constraint where conname = 'users_active_team_fk';
    if _active_deltype is distinct from 'n' then
        raise exception 'TEST (e) FAILED: users_active_team_fk confdeltype = % (expected ''n'' = SET NULL)', _active_deltype;
    end if;

    -- 2. Live cascade: delete Carol (the throwaway tenant) and confirm her team is
    --    gone. Done in a savepoint so the rest of the transaction is unaffected;
    --    we roll the savepoint back afterwards regardless.
    select id into _carol_team from public.teams
        where user_id = 'c5555555-5555-5555-5555-555555555555';
    if _carol_team is null then
        raise exception 'TEST (e) FAILED: fixture error — Carol has no team';
    end if;

    begin
        -- runs as postgres (RLS bypassed); deleting the public.users row should
        -- cascade into teams (and from there into the team's children).
        delete from public.users where id = 'c5555555-5555-5555-5555-555555555555';
        select count(*) into _team_after from public.teams where id = _carol_team;
        if _team_after <> 0 then
            raise exception 'TEST (e) FAILED: deleting the user did NOT cascade to the team (% row(s) remain)', _team_after;
        end if;
        -- Undo the destructive delete (keep the outer transaction clean).
        raise exception 'rollback_savepoint_marker';
    exception
        when others then
            if sqlerrm <> 'rollback_savepoint_marker' then
                raise;  -- a real failure: re-raise.
            end if;
            -- else: intended unwind of the sub-block; the delete is discarded
            -- because the sub-block's effects are rolled back by the exception.
    end;

    raise notice 'TEST (e) PASSED: teams_user_id_fk is ON DELETE CASCADE (confdeltype=c; live delete cascaded the team away) and users_active_team_fk is SET NULL';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 9 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
