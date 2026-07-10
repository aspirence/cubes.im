-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 1 RLS test
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP dependency). Proves the Phase 1 RLS
-- policies isolate tenants. This version works WITH the handle_new_user trigger
-- rather than trying to disable it (postgres is not superuser here and cannot
-- disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase1_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY
--   Insert three auth.users (Alice, Bob, Carol). The on_auth_user_created trigger
--   auto-provisions, for each: a profile + organization + team + Member/Admin/Owner
--   roles + an owner team_membership + active_team. Each user thus OWNS one team.
--   We then add Carol as a non-admin (Member) of Alice's team for the privilege
--   test. Fixture writes run as postgres, which OWNS the public.* tables and so
--   BYPASSES RLS. Assertions switch into the `authenticated` role and set
--   request.jwt.claims.sub (what Supabase's auth.uid() reads).
--
-- COVERAGE
--   (a) a user CAN see their own team
--   (b) a user CANNOT see another tenant's team / org / members / roles
--   (c) a non-admin member CANNOT update roles (needs is_team_admin)
--   (d) lookups are readable by any authenticated user
--   (e) profile visibility: own + co-team-member visible, unrelated hidden
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fixture (runs as postgres → RLS bypassed). Trigger provisions each tenant.
-- -----------------------------------------------------------------------------
do $$
begin
    insert into auth.users (id, instance_id, aud, role, email)
    values
        ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'alice@example.com'),
        ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'bob@example.com'),
        ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'carol@example.com');

    -- Carol becomes a NON-admin (Member, default_role=true) of Alice's team.
    insert into public.team_members (user_id, team_id, role_id, active)
    select '33333333-3333-3333-3333-333333333333', t.id, r.id, true
    from public.teams t
    join public.roles r on r.team_id = t.id and r.default_role = true
    where t.user_id = '11111111-1111-1111-1111-111111111111';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): a user CAN select their own team.
-- -----------------------------------------------------------------------------
do $$
declare _cnt int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _cnt from public.teams
        where user_id = '11111111-1111-1111-1111-111111111111';
    execute 'reset role';
    if _cnt <> 1 then
        raise exception 'TEST (a) FAILED: member could not select own team (got % rows, expected 1)', _cnt;
    end if;
    raise notice 'TEST (a) PASSED: member can select own team';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): a user CANNOT select another tenant's rows.
--   Alice must NOT see Bob's team / org / team_members / roles.
-- -----------------------------------------------------------------------------
do $$
declare _teams int; _orgs int; _members int; _roles int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _teams   from public.teams
        where user_id = '22222222-2222-2222-2222-222222222222';
    select count(*) into _orgs    from public.organizations
        where user_id = '22222222-2222-2222-2222-222222222222';
    select count(*) into _members from public.team_members tm
        join public.teams t on t.id = tm.team_id
        where t.user_id = '22222222-2222-2222-2222-222222222222';
    select count(*) into _roles   from public.roles r
        join public.teams t on t.id = r.team_id
        where t.user_id = '22222222-2222-2222-2222-222222222222';
    execute 'reset role';
    if _teams <> 0 or _orgs <> 0 or _members <> 0 or _roles <> 0 then
        raise exception 'TEST (b) FAILED: cross-tenant leakage (teams=%, orgs=%, members=%, roles=%)',
            _teams, _orgs, _members, _roles;
    end if;
    raise notice 'TEST (b) PASSED: cross-tenant rows are invisible';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): a non-admin (Carol, Member of Alice's team) CANNOT update roles.
-- -----------------------------------------------------------------------------
do $$
declare _updated int; _alice_team uuid;
begin
    -- captured as postgres (RLS bypassed)
    select id into _alice_team from public.teams
        where user_id = '11111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    with upd as (
        update public.roles set name = 'Hacked'
        where team_id = _alice_team and default_role = true
        returning 1
    )
    select count(*) into _updated from upd;
    execute 'reset role';
    if _updated <> 0 then
        raise exception 'TEST (c) FAILED: non-admin updated a role (% rows affected)', _updated;
    end if;
    raise notice 'TEST (c) PASSED: non-admin cannot update roles';
end
$$;

-- Defense-in-depth: confirm (as postgres) the role name was NOT changed.
do $$
declare _name text; _alice_team uuid;
begin
    select id into _alice_team from public.teams
        where user_id = '11111111-1111-1111-1111-111111111111';
    select name into _name from public.roles
        where team_id = _alice_team and default_role = true;
    if _name <> 'Member' then
        raise exception 'TEST (c) FAILED: role name was actually changed to %', _name;
    end if;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): lookups are readable by any authenticated user.
-- -----------------------------------------------------------------------------
do $$
declare _tz int; _pal int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _tz  from public.timezones;
    select count(*) into _pal from public.project_access_levels;
    execute 'reset role';
    if _tz < 1 then
        raise exception 'TEST (d) FAILED: authenticated user could not read timezones';
    end if;
    if _pal < 1 then
        raise exception 'TEST (d) FAILED: authenticated user could not read project_access_levels';
    end if;
    raise notice 'TEST (d) PASSED: lookups readable (timezones=%, access_levels=%)', _tz, _pal;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): profile visibility — own + co-team-member visible, unrelated hidden.
--   Alice shares a team with Carol (visible) but not with Bob (hidden).
-- -----------------------------------------------------------------------------
do $$
declare _self int; _carol int; _bob int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _self  from public.users where id = '11111111-1111-1111-1111-111111111111';
    select count(*) into _carol from public.users where id = '33333333-3333-3333-3333-333333333333';
    select count(*) into _bob   from public.users where id = '22222222-2222-2222-2222-222222222222';
    execute 'reset role';
    if _self <> 1 then
        raise exception 'TEST (e) FAILED: user cannot read own profile';
    end if;
    if _carol <> 1 then
        raise exception 'TEST (e) FAILED: co-team-member profile not visible (got % rows)', _carol;
    end if;
    if _bob <> 0 then
        raise exception 'TEST (e) FAILED: unrelated profile visible (got % rows)', _bob;
    end if;
    raise notice 'TEST (e) PASSED: own + co-member visible, unrelated hidden';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 1 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
