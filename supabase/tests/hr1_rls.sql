-- =============================================================================
-- Cubes Greenfield Rebuild — HR-1 RLS test (Core HR)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the HR-1 tables (hr_admins /
-- hr_departments / hr_designations / hr_employees / hr_documents), the
-- is_hr_admin helper, and the RLS policies. Mirrors the proven Phase 1-8
-- pattern: it works WITH the handle_new_user trigger rather than disabling it
-- (postgres is not superuser here and cannot disable a trigger it does not own
-- on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/hr1_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY
--   Insert three auth.users (Alice, Bob, Dave). on_auth_user_created
--   auto-provisions for each: a profile + organization + team + roles + an owner
--   team_membership + active_team. Alice OWNS org A. Bob is added as a NON-admin
--   (Member) of Alice's team -> Bob is an org-A MEMBER but NOT an HR admin. Dave
--   is a wholly separate tenant (org D). Fixture writes run as postgres (OWNS the
--   public.* tables -> RLS bypassed). Assertions switch into the `authenticated`
--   role and set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) is_hr_admin: org owner (Alice) TRUE; a user added to hr_admins (Bob)
--       TRUE; an unrelated user (Dave) FALSE.
--   (b) hr_departments / hr_designations: an org member (Carol) can READ; a
--       non-HR-admin member (Carol) CANNOT insert; an HR admin (Alice) CAN.
--   (c) hr_employees: org members see the directory; cross-org (Dave) invisible;
--       an HR admin (Alice) creates BOTH a user-linked AND a record-only
--       (user_id NULL) employee; a linked employee (Carol) can UPDATE her OWN
--       row but NOT another's.
--   (d) hr_documents: visible to the HR admin (Alice) + the owning employee
--       (Carol) only; a non-owning org member (Bob) sees none.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fixture (runs as postgres -> RLS bypassed). The trigger provisions each tenant.
--   Alice  -> owner of org A (implicit HR admin).
--   Bob    -> NON-admin (Member) of Alice's team; later DESIGNATED HR admin via
--             an hr_admins row -> tests "added to hr_admins => TRUE".
--   Carol  -> NON-admin (Member) of Alice's team; a plain org-A member (the
--             "non-HR-admin member" + the self-service employee).
--   Dave   -> a separate tenant (org D); unrelated to org A.
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
        ('c3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'carol@example.com'),
        ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'dave@example.com');

    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Bob + Carol become NON-admin (Member, default_role=true) of Alice's team.
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
-- TEST (a): is_hr_admin — org owner TRUE; an hr_admins-listed user TRUE; an
--   unrelated user FALSE. We FIRST add Bob to hr_admins (as Alice, exercising the
--   hr_admins INSERT policy = is_hr_admin), then check all three.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org   uuid;
    _alice_admin boolean;
    _bob_admin   boolean;
    _dave_admin  boolean;
    _carol_added boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    -- Alice (org owner = implicit HR admin) designates Bob as an HR admin.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_admins (org_id, user_id)
    values (_alice_org, 'b2222222-2222-2222-2222-222222222222');
    execute 'reset role';

    -- Sanity: a NON-HR-admin member (Carol) cannot designate an HR admin.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        insert into public.hr_admins (org_id, user_id)
        values (_alice_org, 'c3333333-3333-3333-3333-333333333333');
        _carol_added := true;
    exception when insufficient_privilege then _carol_added := false;
    end;
    execute 'reset role';

    if _carol_added is true then
        raise exception 'TEST (a) FAILED: a non-HR-admin member was allowed to designate an HR admin';
    end if;

    -- is_hr_admin under each identity.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _alice_admin := public.is_hr_admin(_alice_org);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _bob_admin := public.is_hr_admin(_alice_org);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _dave_admin := public.is_hr_admin(_alice_org);
    execute 'reset role';

    if _alice_admin is not true then
        raise exception 'TEST (a) FAILED: is_hr_admin was not TRUE for the org owner';
    end if;
    if _bob_admin is not true then
        raise exception 'TEST (a) FAILED: is_hr_admin was not TRUE for an hr_admins-listed user';
    end if;
    if _dave_admin is not false then
        raise exception 'TEST (a) FAILED: is_hr_admin was not FALSE for an unrelated user (got %)', _dave_admin;
    end if;

    raise notice 'TEST (a) PASSED: is_hr_admin TRUE for owner + listed admin, FALSE for an unrelated user (and non-admin cannot self-designate)';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): hr_departments / hr_designations — an org member (Carol) can READ;
--   a non-HR-admin member (Carol) CANNOT insert; an HR admin (Alice) CAN.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org    uuid;
    _carol_blocked_dept boolean := false;
    _carol_blocked_desg boolean := false;
    _carol_dept_reads int;
    _carol_desg_reads int;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    -- Alice (HR admin) creates a department + a designation.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_departments (org_id, name) values (_alice_org, 'Engineering');
    insert into public.hr_designations (org_id, title, level) values (_alice_org, 'Senior Engineer', 3);
    execute 'reset role';

    -- Carol (a plain org member) can READ both, but cannot INSERT either.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _carol_dept_reads from public.hr_departments where org_id = _alice_org;
    select count(*) into _carol_desg_reads from public.hr_designations where org_id = _alice_org;
    begin
        insert into public.hr_departments (org_id, name) values (_alice_org, 'Sales');
        _carol_blocked_dept := false;
    exception when insufficient_privilege then _carol_blocked_dept := true;
    end;
    begin
        insert into public.hr_designations (org_id, title) values (_alice_org, 'Intern');
        _carol_blocked_desg := false;
    exception when insufficient_privilege then _carol_blocked_desg := true;
    end;
    execute 'reset role';

    if _carol_dept_reads < 1 then
        raise exception 'TEST (b) FAILED: an org member could not read hr_departments (got %)', _carol_dept_reads;
    end if;
    if _carol_desg_reads < 1 then
        raise exception 'TEST (b) FAILED: an org member could not read hr_designations (got %)', _carol_desg_reads;
    end if;
    if _carol_blocked_dept is not true then
        raise exception 'TEST (b) FAILED: a non-HR-admin member was allowed to INSERT a department';
    end if;
    if _carol_blocked_desg is not true then
        raise exception 'TEST (b) FAILED: a non-HR-admin member was allowed to INSERT a designation';
    end if;

    raise notice 'TEST (b) PASSED: org members read depts/designations; non-HR-admin cannot insert; HR admin can';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): hr_employees — org members see the directory; cross-org (Dave)
--   invisible; an HR admin (Alice) creates BOTH a user-linked (Carol) AND a
--   record-only (user_id NULL) employee; a linked employee (Carol) can UPDATE her
--   OWN row but NOT another's.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org    uuid;
    _dept_id      uuid;
    _desg_id      uuid;
    _carol_emp    uuid;
    _ghost_emp    uuid;
    _bob_reads    int;
    _dave_reads   int;
    _self_updated boolean := false;
    _other_blocked boolean := false;
    _carol_new_loc text;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _dept_id from public.hr_departments where org_id = _alice_org limit 1;
    select id into _desg_id from public.hr_designations where org_id = _alice_org limit 1;

    -- Alice (HR admin) creates a user-LINKED employee (Carol) + a RECORD-ONLY one.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_employees
        (org_id, user_id, employee_code, full_name, work_email, department_id, designation_id)
    values
        (_alice_org, 'c3333333-3333-3333-3333-333333333333', 'EMP-001',
         'Carol Member', 'carol.work@example.com', _dept_id, _desg_id)
    returning id into _carol_emp;

    -- Record-only employee: user_id NULL, fully usable from on-row full_name/email.
    insert into public.hr_employees
        (org_id, user_id, employee_code, full_name, work_email)
    values
        (_alice_org, null, 'EMP-002', 'Ghost Contractor', 'ghost@example.com')
    returning id into _ghost_emp;
    execute 'reset role';

    if _carol_emp is null then
        raise exception 'TEST (c) FAILED: HR admin could not create a user-linked employee';
    end if;
    if _ghost_emp is null then
        raise exception 'TEST (c) FAILED: HR admin could not create a record-only (user_id NULL) employee';
    end if;

    -- Bob (org member) sees BOTH directory rows.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_reads from public.hr_employees where org_id = _alice_org;
    execute 'reset role';

    if _bob_reads < 2 then
        raise exception 'TEST (c) FAILED: an org member could not see the directory (got %, expected >= 2)', _bob_reads;
    end if;

    -- Dave (cross-org tenant) sees NONE of org A's employees.
    perform set_config('request.jwt.claims',
        '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _dave_reads from public.hr_employees where org_id = _alice_org;
    execute 'reset role';

    if _dave_reads <> 0 then
        raise exception 'TEST (c) FAILED: cross-org directory leakage (got % rows)', _dave_reads;
    end if;

    -- Carol (a linked employee, NOT an HR admin) can UPDATE her OWN row.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    update public.hr_employees set work_location = 'Remote - Carol' where id = _carol_emp;
    -- ... but NOT another employee's row (the record-only ghost is not hers).
    begin
        update public.hr_employees set work_location = 'hacked' where id = _ghost_emp;
        -- UPDATE with a failing USING predicate affects 0 rows (no error); confirm.
        if not found then
            _other_blocked := true;
        else
            _other_blocked := false;
        end if;
    exception when insufficient_privilege then _other_blocked := true;
    end;
    execute 'reset role';

    select work_location into _carol_new_loc from public.hr_employees where id = _carol_emp;
    if _carol_new_loc is distinct from 'Remote - Carol' then
        raise exception 'TEST (c) FAILED: a linked employee could not update her own row (loc=%)', _carol_new_loc;
    end if;
    _self_updated := true;
    if _other_blocked is not true then
        raise exception 'TEST (c) FAILED: a linked employee was allowed to update another employee''s row';
    end if;
    -- And the ghost row must be untouched.
    if exists (select 1 from public.hr_employees where id = _ghost_emp and work_location = 'hacked') then
        raise exception 'TEST (c) FAILED: another employee''s row was modified by a non-admin';
    end if;

    raise notice 'TEST (c) PASSED: directory visible to org members, cross-org invisible; HR admin made linked + record-only employees; self-update OK, other-update blocked';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): hr_documents — visible to the HR admin (Alice) + the owning employee
--   (Carol, whose hr_employees row links to her user) ONLY; a non-owning org
--   member (Bob) sees none.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org    uuid;
    _carol_emp    uuid;
    _doc_id       uuid;
    _alice_reads  int;
    _carol_reads  int;
    _bob_reads    int;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Alice (HR admin) uploads a document row for Carol (path: <org>/<emp>/<file>).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_documents (employee_id, org_id, doc_type, name, storage_path, uploaded_by)
    values (_carol_emp, _alice_org, 'offer_letter', 'Offer Letter.pdf',
            _alice_org::text || '/' || _carol_emp::text || '/offer.pdf',
            'a1111111-1111-1111-1111-111111111111')
    returning id into _doc_id;
    select count(*) into _alice_reads from public.hr_documents where employee_id = _carol_emp;
    execute 'reset role';

    if _doc_id is null then
        raise exception 'TEST (d) FAILED: HR admin could not create a document row';
    end if;
    if _alice_reads < 1 then
        raise exception 'TEST (d) FAILED: HR admin could not read the document (got %)', _alice_reads;
    end if;

    -- Carol (the owning employee) can read her own document.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _carol_reads from public.hr_documents where employee_id = _carol_emp;
    execute 'reset role';

    if _carol_reads < 1 then
        raise exception 'TEST (d) FAILED: the owning employee could not read her own document (got %)', _carol_reads;
    end if;

    -- Bob (an org member, but NOT the owning employee and now an HR admin from
    -- TEST (a)!) -> careful: Bob WAS made an HR admin in TEST (a), so he SHOULD
    -- see it. To prove the "owning employee only" leg for a NON-admin, we test
    -- with a freshly de-scoped view: remove Bob from hr_admins first, then assert
    -- he sees NONE.
    delete from public.hr_admins
        where org_id = _alice_org and user_id = 'b2222222-2222-2222-2222-222222222222';

    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _bob_reads from public.hr_documents where employee_id = _carol_emp;
    execute 'reset role';

    if _bob_reads <> 0 then
        raise exception 'TEST (d) FAILED: a non-admin, non-owning org member could read another''s document (got %)', _bob_reads;
    end if;

    raise notice 'TEST (d) PASSED: documents visible to the HR admin + owning employee only; a non-owning org member sees none';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL HR-1 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
