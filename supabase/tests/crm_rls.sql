-- =============================================================================
-- Cubes CRM app — RLS test (app_crm_*)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP), mirroring the hr1_rls.sql pattern.
-- Proves the owner-controlled access model:
--   * is_crm_admin: team OWNER true; a GRANTED member true; an UNGRANTED member
--     false; an unrelated tenant false.
--   * Only the owner can grant/revoke (app_crm_admins policies), and only to
--     active team members.
--   * app_crm_companies (representative data table): CRM admins read/write;
--     ungranted members and other tenants see nothing.
--   * Installing the app (installed_apps insert) seeds the 5 default stages.
--   * The activity trigger writes a 'created' timeline row readable by CRM
--     admins only; direct client inserts into app_crm_activities are refused.
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/crm_rls.sql
--
-- Runs in one transaction and ROLLS BACK — leaves no data behind.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fixture (runs as postgres -> RLS bypassed). The auth trigger provisions each
-- tenant. Alice OWNS team A. Bob + Carol join as NON-admin members. Dave is a
-- separate tenant. Bob will be GRANTED CRM access; Carol stays ungranted.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
begin
    insert into auth.users (id, instance_id, aud, role, email)
    values
        ('a1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'alice-crm@example.com'),
        ('b2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'bob-crm@example.com'),
        ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'carol-crm@example.com'),
        ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'dave-crm@example.com');

    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    insert into public.team_members (user_id, team_id, role_id, active)
    select 'b2222222-2222-2222-2222-222222222222', _alice_team, r.id, true
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true;

    insert into public.team_members (user_id, team_id, role_id, active)
    select 'c3333333-3333-3333-3333-333333333333', _alice_team, r.id, true
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): install seeds the default pipeline. Alice (team admin via the
--   installed_apps policy) installs the CRM app -> 5 stages appear.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _stage_count int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.installed_apps (team_id, app_key, installed_by)
    values (_alice_team, 'crm', 'a1111111-1111-1111-1111-111111111111');
    _stage_count := (select count(*) from public.app_crm_stages where team_id = _alice_team);
    execute 'reset role';

    if _stage_count <> 5 then
        raise exception 'TEST (a) FAILED: expected 5 seeded stages, got %', _stage_count;
    end if;

    raise notice 'TEST (a) PASSED: installing the CRM app seeded the default 5-stage pipeline';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): grants. Alice (owner) grants Bob. Bob (granted, NOT owner) cannot
--   grant Carol. Alice cannot grant Dave (not a team member).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _blocked boolean;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Owner grants Bob.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.app_crm_admins (team_id, user_id, created_by)
    values (_alice_team, 'b2222222-2222-2222-2222-222222222222',
            'a1111111-1111-1111-1111-111111111111');
    execute 'reset role';

    -- Bob (granted, not owner) must NOT be able to grant Carol.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        insert into public.app_crm_admins (team_id, user_id)
        values (_alice_team, 'c3333333-3333-3333-3333-333333333333');
    exception when insufficient_privilege then _blocked := true;
    end;
    execute 'reset role';
    if not _blocked then
        raise exception 'TEST (b) FAILED: a non-owner CRM admin was allowed to grant access';
    end if;

    -- Owner must NOT be able to grant a non-member (Dave).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        insert into public.app_crm_admins (team_id, user_id)
        values (_alice_team, 'd4444444-4444-4444-4444-444444444444');
    exception when insufficient_privilege then _blocked := true;
    end;
    execute 'reset role';
    if not _blocked then
        raise exception 'TEST (b) FAILED: the owner was allowed to grant a non-member';
    end if;

    raise notice 'TEST (b) PASSED: owner grants; non-owner cannot grant; non-members cannot be granted';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): is_crm_admin — owner TRUE; granted member TRUE; ungranted member
--   FALSE; unrelated tenant FALSE.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _alice boolean; _bob boolean; _carol boolean; _dave boolean;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _alice := public.is_crm_admin(_alice_team);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _bob := public.is_crm_admin(_alice_team);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _carol := public.is_crm_admin(_alice_team);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _dave := public.is_crm_admin(_alice_team);
    execute 'reset role';

    if _alice is not true then
        raise exception 'TEST (c) FAILED: is_crm_admin not TRUE for the team owner';
    end if;
    if _bob is not true then
        raise exception 'TEST (c) FAILED: is_crm_admin not TRUE for a granted member';
    end if;
    if _carol is not false then
        raise exception 'TEST (c) FAILED: is_crm_admin not FALSE for an ungranted member';
    end if;
    if _dave is not false then
        raise exception 'TEST (c) FAILED: is_crm_admin not FALSE for an unrelated tenant';
    end if;

    raise notice 'TEST (c) PASSED: is_crm_admin gates exactly owner + granted members';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): app_crm_companies — Bob (granted) inserts + reads; Carol (ungranted
--   member) reads NOTHING and cannot insert; Dave reads nothing. The insert
--   trigger writes a 'created' activity Bob can read; Carol cannot; and a
--   direct client insert into app_crm_activities is refused (no insert policy).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _company_id uuid;
    _reads int;
    _acts int;
    _blocked boolean;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Bob (granted) creates a company and sees the trigger-written activity.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.app_crm_companies (team_id, name)
    values (_alice_team, 'Acme Corp') returning id into _company_id;
    _reads := (select count(*) from public.app_crm_companies where team_id = _alice_team);
    _acts := (select count(*) from public.app_crm_activities
              where team_id = _alice_team
                and target_type = 'company' and target_id = _company_id
                and event = 'created');
    execute 'reset role';
    if _reads <> 1 then
        raise exception 'TEST (d) FAILED: a granted member could not read the company (got % rows)', _reads;
    end if;
    if _acts <> 1 then
        raise exception 'TEST (d) FAILED: the insert trigger did not write a readable created-activity (got %)', _acts;
    end if;

    -- Bob cannot forge timeline rows directly.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        insert into public.app_crm_activities (team_id, target_type, target_id, event)
        values (_alice_team, 'company', _company_id, 'created');
    exception when insufficient_privilege then _blocked := true;
    end;
    execute 'reset role';
    if not _blocked then
        raise exception 'TEST (d) FAILED: a client was allowed to insert into app_crm_activities directly';
    end if;

    -- Carol (ungranted member): zero visibility, no writes.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _reads := (select count(*) from public.app_crm_companies where team_id = _alice_team);
    _acts := (select count(*) from public.app_crm_activities where team_id = _alice_team);
    _blocked := false;
    begin
        insert into public.app_crm_companies (team_id, name)
        values (_alice_team, 'Carol Sneaky Inc');
    exception when insufficient_privilege then _blocked := true;
    end;
    execute 'reset role';
    if _reads <> 0 or _acts <> 0 then
        raise exception 'TEST (d) FAILED: an ungranted member saw CRM rows (companies %, activities %)', _reads, _acts;
    end if;
    if not _blocked then
        raise exception 'TEST (d) FAILED: an ungranted member was allowed to insert a company';
    end if;

    -- Dave (other tenant): zero visibility.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _reads := (select count(*) from public.app_crm_companies where team_id = _alice_team);
    execute 'reset role';
    if _reads <> 0 then
        raise exception 'TEST (d) FAILED: another tenant saw CRM companies (got %)', _reads;
    end if;

    raise notice 'TEST (d) PASSED: CRM data visible to CRM admins only; timeline is trigger-written only';
end
$$;

rollback;
