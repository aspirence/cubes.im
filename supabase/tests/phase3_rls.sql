-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 3 RLS test
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 3 RLS policies
-- isolate tenants for projects and the project-scoped tables, that
-- create_project works for a team member and registers the creator as a
-- project_member, and that user-private project tables (favorite_projects /
-- archived_projects) and project_phases admin/owner writes behave. Mirrors the
-- proven Phase 1/2 pattern: it works WITH the handle_new_user trigger rather
-- than disabling it (postgres is not superuser here and cannot disable a trigger
-- it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase3_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it
-- leaves no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY
--   Insert two auth.users (Alice, Bob). on_auth_user_created auto-provisions for
--   each: a profile + organization + team + Member/Admin/Owner roles + an owner
--   team_membership + active_team. Carol is added as a NON-admin (Member) of
--   Alice's team for the privilege tests. The sys_project_statuses /
--   sys_project_healths lookups are seeded inline (the test db may be migrate-
--   only; guarded so it coexists with seed.sql). Fixture writes run as postgres
--   (OWNS the public.* tables -> RLS bypassed). Assertions switch into the
--   `authenticated` role and set request.jwt.claims.sub (what auth.uid() reads).
--
-- COVERAGE
--   (a) create_project as a team member (Alice) works and adds the creator as a
--       project_member; a NON-member (Bob) is rejected.
--   (b) a team member can SELECT the team's projects.
--   (c) a user from another team CANNOT see them.
--   (d) a non-admin non-owner team member (Carol) cannot UPDATE/DELETE a project
--       she doesn't own, but the owner (Alice) can UPDATE.
--   (e) favorite_projects / archived_projects are user-private.
--   (f) project_phases are visible to the project's team members and writable by
--       admins/owner (Alice writes; Carol, a non-admin non-owner, is blocked).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Lookup seed (idempotent) — make sure a default status exists for create_project.
-- Runs as postgres (RLS bypassed). Coexists with seed.sql / the migration.
-- -----------------------------------------------------------------------------
insert into public.sys_project_statuses (name, color_code, icon, sort_order, is_default)
select v.name, v.color_code, v.icon, v.sort_order, v.is_default
from (values
    ('Cancelled',   '#f37070', 'close-circle', 0, false),
    ('Proposed',    '#cbc8a1', 'clock-circle', 3, true),
    ('In Progress', '#80ca79', 'clock-circle', 5, false)
) as v(name, color_code, icon, sort_order, is_default)
where not exists (select 1 from public.sys_project_statuses s where s.name = v.name);

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
-- TEST (a): create_project works for a team member and adds the creator as a
--   project_member; a non-member is rejected.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _bob_team   uuid;
    _project_id uuid;
    _pm_count   int;
    _owner_id   uuid;
    _nonmember_err boolean := false;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';
    select id into _bob_team from public.teams
        where user_id = 'b2222222-2222-2222-2222-222222222222';

    -- Alice (a team member -> the owner) creates a project in her team.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _project_id := public.create_project('Apollo Launch', _alice_team);
    execute 'reset role';

    if _project_id is null then
        raise exception 'TEST (a) FAILED: create_project returned null';
    end if;

    -- Verify (as postgres / RLS bypassed): project owner is Alice and a
    -- project_members row exists for the creator's team_member.
    select owner_id into _owner_id from public.projects where id = _project_id;
    if _owner_id <> 'a1111111-1111-1111-1111-111111111111' then
        raise exception 'TEST (a) FAILED: project owner is % (expected Alice)', _owner_id;
    end if;

    select count(*) into _pm_count
    from public.project_members pm
    join public.team_members tm on tm.id = pm.team_member_id
    where pm.project_id = _project_id
      and tm.user_id = 'a1111111-1111-1111-1111-111111111111';
    if _pm_count <> 1 then
        raise exception 'TEST (a) FAILED: creator not added as project_member (got %)', _pm_count;
    end if;

    -- Bob is NOT a member of Alice's team -> create_project must raise.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform public.create_project('Sneaky Project', _alice_team);
    exception
        when others then _nonmember_err := true;
    end;
    execute 'reset role';

    if _nonmember_err is not true then
        raise exception 'TEST (a) FAILED: non-member was allowed to create a project in another team';
    end if;

    raise notice 'TEST (a) PASSED: create_project adds creator as project_member; non-member rejected';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): a team member can SELECT the team's projects.
--   Carol (Member of Alice's team) must see the project Alice created.
-- -----------------------------------------------------------------------------
do $$
declare _seen int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _seen from public.projects;
    execute 'reset role';

    if _seen <> 1 then
        raise exception 'TEST (b) FAILED: team member saw % projects (expected 1)', _seen;
    end if;
    raise notice 'TEST (b) PASSED: team member can read the team''s projects';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): a user from another team CANNOT see them.
--   Bob (other team) must see ZERO of Alice's team's projects.
-- -----------------------------------------------------------------------------
do $$
declare _seen int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _seen from public.projects;
    execute 'reset role';

    if _seen <> 0 then
        raise exception 'TEST (c) FAILED: cross-team project leakage (got % rows)', _seen;
    end if;
    raise notice 'TEST (c) PASSED: cross-team projects invisible';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): a non-admin non-owner team member (Carol) cannot UPDATE/DELETE a
--   project she doesn't own, but the owner (Alice) can UPDATE.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _carol_updated int;
    _carol_deleted int;
    _new_name text;
begin
    select id into _project_id from public.projects
        where name = 'Apollo Launch' limit 1;

    -- Carol (Member, not owner) attempts UPDATE + DELETE. RLS makes the rows
    -- invisible to her USING clause for write, so 0 rows are affected (no error).
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    update public.projects set name = 'Carol Was Here' where id = _project_id;
    get diagnostics _carol_updated = row_count;
    delete from public.projects where id = _project_id;
    get diagnostics _carol_deleted = row_count;
    execute 'reset role';

    if _carol_updated <> 0 then
        raise exception 'TEST (d) FAILED: non-admin non-owner updated a project (% rows)', _carol_updated;
    end if;
    if _carol_deleted <> 0 then
        raise exception 'TEST (d) FAILED: non-admin non-owner deleted a project (% rows)', _carol_deleted;
    end if;

    -- Owner (Alice) UPDATE must succeed.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    update public.projects set name = 'Apollo Launch v2' where id = _project_id;
    execute 'reset role';

    select name into _new_name from public.projects where id = _project_id;
    if _new_name <> 'Apollo Launch v2' then
        raise exception 'TEST (d) FAILED: owner could not update own project (name=%)', _new_name;
    end if;
    raise notice 'TEST (d) PASSED: non-admin non-owner blocked on update/delete; owner can update';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): favorite_projects / archived_projects are user-private.
--   Alice favorites + archives the project for herself; Bob must NOT see them,
--   and Alice sees her own.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _alice_fav int; _alice_arch int;
    _bob_fav int; _bob_arch int;
begin
    select id into _project_id from public.projects
        where name = 'Apollo Launch v2' limit 1;

    -- Alice (authenticated) writes her own private rows.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.favorite_projects (user_id, project_id)
        values ('a1111111-1111-1111-1111-111111111111', _project_id);
    insert into public.archived_projects (user_id, project_id)
        values ('a1111111-1111-1111-1111-111111111111', _project_id);
    select count(*) into _alice_fav  from public.favorite_projects;
    select count(*) into _alice_arch from public.archived_projects;
    execute 'reset role';

    if _alice_fav <> 1 or _alice_arch <> 1 then
        raise exception 'TEST (e) FAILED: Alice cannot see her own favorite/archived (fav=%, arch=%)',
            _alice_fav, _alice_arch;
    end if;

    -- Bob (authenticated) must see NONE of Alice's private rows.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_fav  from public.favorite_projects;
    select count(*) into _bob_arch from public.archived_projects;
    execute 'reset role';

    if _bob_fav <> 0 then
        raise exception 'TEST (e) FAILED: Bob saw Alice favorite_projects (got %)', _bob_fav;
    end if;
    if _bob_arch <> 0 then
        raise exception 'TEST (e) FAILED: Bob saw Alice archived_projects (got %)', _bob_arch;
    end if;
    raise notice 'TEST (e) PASSED: favorite_projects + archived_projects are user-private';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): project_phases visible to the project's team members; writable by
--   admins/owner. Alice (owner) inserts a phase; Carol (member) can SEE it but a
--   non-admin non-owner Carol insert is blocked; Bob (other team) cannot see it.
-- -----------------------------------------------------------------------------
do $$
declare
    _project_id uuid;
    _carol_sees int;
    _bob_sees   int;
    _carol_err  boolean := false;
    _phase_id   uuid;
begin
    select id into _project_id from public.projects
        where name = 'Apollo Launch v2' limit 1;

    -- Alice (owner -> is_project_team_admin) inserts a phase.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.project_phases (name, color_code, project_id, sort_index)
        values ('Discovery', '#70a6f3', _project_id, 0)
        returning id into _phase_id;
    execute 'reset role';

    if _phase_id is null then
        raise exception 'TEST (f) FAILED: owner could not insert a project phase';
    end if;

    -- Carol (member of the project's team) can SELECT the phase.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _carol_sees from public.project_phases where project_id = _project_id;

    -- Carol (non-admin non-owner) attempting to INSERT a phase must be blocked.
    begin
        insert into public.project_phases (name, color_code, project_id, sort_index)
            values ('Sneaky Phase', '#ff0000', _project_id, 1);
    exception
        when insufficient_privilege then _carol_err := true;  -- RLS WITH CHECK violation
    end;
    execute 'reset role';

    if _carol_sees <> 1 then
        raise exception 'TEST (f) FAILED: team member saw % project_phases (expected 1)', _carol_sees;
    end if;
    if _carol_err is not true then
        raise exception 'TEST (f) FAILED: non-admin non-owner was allowed to insert a project_phase';
    end if;

    -- Bob (other team) must see ZERO phases of Alice's project.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_sees from public.project_phases where project_id = _project_id;
    execute 'reset role';

    if _bob_sees <> 0 then
        raise exception 'TEST (f) FAILED: cross-team project_phase leakage (got %)', _bob_sees;
    end if;
    raise notice 'TEST (f) PASSED: project_phases readable by team members, write-restricted to admins/owner';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 3 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
