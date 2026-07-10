-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 2 RLS test
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the Phase 2 RLS policies
-- isolate tenants and that the onboarding/invite RPCs behave. Mirrors the
-- proven Phase 1 pattern: it works WITH the handle_new_user trigger rather than
-- disabling it (postgres is not superuser here and cannot disable a trigger it
-- does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/phase2_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it
-- leaves no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY
--   Insert two auth.users (Alice, Bob). on_auth_user_created auto-provisions for
--   each: a profile + organization + team + Member/Admin/Owner roles + an owner
--   team_membership + active_team. Carol is added as a NON-admin (Member) of
--   Alice's team for the privilege tests. Fixture writes run as postgres (OWNS
--   the public.* tables -> RLS bypassed). Assertions switch into the
--   `authenticated` role and set request.jwt.claims.sub (what auth.uid() reads).
--
-- COVERAGE
--   (a) a team member can read own team's clients / labels / categories
--   (b) cross-team config rows are invisible
--   (c) a non-admin member CANNOT insert a client (admin-only) but CAN insert a
--       team_label (member-writable)
--   (d) notification_settings + survey_responses are strictly user-private
--   (e) accept_invitation: invite Bob's email into Alice's team, then as Bob
--       accept it and assert Bob becomes a team_member of Alice's team
--   (f) complete_account_setup: sets setup_completed and renames the team
-- =============================================================================

begin;

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

    -- Seed config rows in BOTH Alice's and Bob's teams (as postgres / RLS off).
    insert into public.clients (name, team_id)
    select 'Acme Co', t.id from public.teams t
    where t.user_id = 'a1111111-1111-1111-1111-111111111111';
    insert into public.clients (name, team_id)
    select 'Bob Industries', t.id from public.teams t
    where t.user_id = 'b2222222-2222-2222-2222-222222222222';

    insert into public.team_labels (name, color_code, team_id)
    select 'urgent', '#ff0000', t.id from public.teams t
    where t.user_id = 'a1111111-1111-1111-1111-111111111111';

    insert into public.project_categories (name, color_code, team_id, created_by)
    select 'Internal', '#70a6f3', t.id, 'a1111111-1111-1111-1111-111111111111'
    from public.teams t
    where t.user_id = 'a1111111-1111-1111-1111-111111111111';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): a team member can read own team's clients / labels / categories.
-- -----------------------------------------------------------------------------
do $$
declare _clients int; _labels int; _cats int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _clients from public.clients;
    select count(*) into _labels  from public.team_labels;
    select count(*) into _cats    from public.project_categories;
    execute 'reset role';
    if _clients <> 1 then
        raise exception 'TEST (a) FAILED: member saw % clients (expected 1, only own team)', _clients;
    end if;
    if _labels <> 1 then
        raise exception 'TEST (a) FAILED: member saw % team_labels (expected 1)', _labels;
    end if;
    if _cats <> 1 then
        raise exception 'TEST (a) FAILED: member saw % project_categories (expected 1)', _cats;
    end if;
    raise notice 'TEST (a) PASSED: member reads own team clients/labels/categories';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): cross-team config rows are invisible.
--   Alice must NOT see Bob's client.
-- -----------------------------------------------------------------------------
do $$
declare _bob_clients int;
begin
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_clients
    from public.clients c
    join public.teams t on t.id = c.team_id
    where t.user_id = 'b2222222-2222-2222-2222-222222222222';
    execute 'reset role';
    if _bob_clients <> 0 then
        raise exception 'TEST (b) FAILED: cross-team client leakage (got % rows)', _bob_clients;
    end if;
    raise notice 'TEST (b) PASSED: cross-team config rows invisible';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): a non-admin (Carol, Member of Alice's team) CANNOT insert a client
--   (admin-only) but CAN insert a team_label (member-writable).
-- -----------------------------------------------------------------------------
do $$
declare _alice_team uuid; _client_err boolean := false; _labels_after int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';

    -- (c.1) admin-only client insert must be blocked by the RLS WITH CHECK.
    --        A WITH CHECK violation raises SQLSTATE 42501 / insufficient_privilege.
    begin
        insert into public.clients (name, team_id) values ('Sneaky Client', _alice_team);
    exception
        when insufficient_privilege then _client_err := true;  -- RLS violation
    end;

    -- (c.2) member-writable team_label insert must succeed.
    insert into public.team_labels (name, color_code, team_id)
        values ('member-made', '#00ff00', _alice_team);

    select count(*) into _labels_after from public.team_labels where team_id = _alice_team;
    execute 'reset role';

    if _client_err is not true then
        raise exception 'TEST (c) FAILED: non-admin was allowed to insert a client';
    end if;
    -- 1 seeded ('urgent') + 1 just inserted ('member-made') = 2
    if _labels_after <> 2 then
        raise exception 'TEST (c) FAILED: member could not insert a team_label (count=%)', _labels_after;
    end if;
    raise notice 'TEST (c) PASSED: non-admin blocked on client, allowed on team_label';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): notification_settings + survey_responses are strictly user-private.
--   Alice writes her own rows; Bob must NOT see them.
-- -----------------------------------------------------------------------------
do $$
declare _alice_team uuid; _bob_sees_ns int; _bob_sees_sr int; _alice_sees_ns int;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Alice (authenticated) inserts her own private rows.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.notification_settings (user_id, team_id, daily_digest_enabled)
        values ('a1111111-1111-1111-1111-111111111111', _alice_team, true);
    insert into public.survey_responses (user_id, response)
        values ('a1111111-1111-1111-1111-111111111111', '{"role":"founder"}'::jsonb);
    select count(*) into _alice_sees_ns from public.notification_settings;
    execute 'reset role';

    if _alice_sees_ns <> 1 then
        raise exception 'TEST (d) FAILED: Alice cannot see her own notification_settings (got %)', _alice_sees_ns;
    end if;

    -- Bob (authenticated) must see NONE of Alice's private rows.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_sees_ns from public.notification_settings;
    select count(*) into _bob_sees_sr from public.survey_responses;
    execute 'reset role';

    if _bob_sees_ns <> 0 then
        raise exception 'TEST (d) FAILED: Bob saw Alice notification_settings (got %)', _bob_sees_ns;
    end if;
    if _bob_sees_sr <> 0 then
        raise exception 'TEST (d) FAILED: Bob saw Alice survey_responses (got %)', _bob_sees_sr;
    end if;
    raise notice 'TEST (d) PASSED: notification_settings + survey_responses are user-private';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): accept_invitation.
--   Admin (Alice) creates an email_invitation for Bob's email into Alice's team.
--   Then, as Bob (authenticated), call accept_invitation and assert Bob becomes
--   a team_member of Alice's team and the invitation is consumed.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _invite_id  uuid;
    _bob_member int;
    _invite_left int;
    _returned   uuid;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Alice (admin/authenticated) inserts the invitation via RLS-governed insert.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.email_invitations (team_id, email, name)
        values (_alice_team, 'bob@example.com', 'Bob')
        returning id into _invite_id;
    execute 'reset role';

    -- Bob (authenticated) accepts. accept_invitation is SECURITY DEFINER and
    -- reads auth.uid() from the jwt claim sub.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _returned := public.accept_invitation(_invite_id);
    execute 'reset role';

    if _returned <> _alice_team then
        raise exception 'TEST (e) FAILED: accept_invitation returned % (expected %)', _returned, _alice_team;
    end if;

    -- Verify as postgres (RLS bypassed): Bob is now an ACTIVE member of Alice's team.
    select count(*) into _bob_member
    from public.team_members
    where team_id = _alice_team
      and user_id = 'b2222222-2222-2222-2222-222222222222'
      and active is true;
    select count(*) into _invite_left
    from public.email_invitations where id = _invite_id;

    if _bob_member <> 1 then
        raise exception 'TEST (e) FAILED: Bob is not a member of Alice''s team (got %)', _bob_member;
    end if;
    if _invite_left <> 0 then
        raise exception 'TEST (e) FAILED: invitation was not consumed (% left)', _invite_left;
    end if;
    raise notice 'TEST (e) PASSED: accept_invitation added Bob and consumed the invite';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): complete_account_setup sets setup_completed and renames the team.
--   Run as Alice (owner of her team).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _returned   uuid;
    _team_name  text;
    _org_name   text;
    _setup      boolean;
begin
    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _returned := public.complete_account_setup('Aspirence HQ', 'Aspirence Inc');
    execute 'reset role';

    if _returned <> _alice_team then
        raise exception 'TEST (f) FAILED: complete_account_setup returned % (expected %)', _returned, _alice_team;
    end if;

    -- Verify as postgres (RLS bypassed).
    select name into _team_name from public.teams where id = _alice_team;
    select organization_name into _org_name
    from public.organizations o
    join public.teams t on t.organization_id = o.id
    where t.id = _alice_team;
    select setup_completed into _setup from public.users
    where id = 'a1111111-1111-1111-1111-111111111111';

    if _team_name <> 'Aspirence HQ' then
        raise exception 'TEST (f) FAILED: team not renamed (name=%)', _team_name;
    end if;
    if _org_name <> 'Aspirence Inc' then
        raise exception 'TEST (f) FAILED: org not renamed (name=%)', _org_name;
    end if;
    if _setup is not true then
        raise exception 'TEST (f) FAILED: setup_completed not set';
    end if;
    raise notice 'TEST (f) PASSED: complete_account_setup renamed team+org and set setup_completed';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL PHASE 2 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
