-- =============================================================================
-- Cubes Greenfield Rebuild — HR-2 RLS test (Attendance)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the HR-2 tables (hr_shifts /
-- hr_employee_shifts / hr_holidays / hr_attendance / hr_attendance_regularizations),
-- the can_view_employee / can_manage_employee helpers, the clock_in/clock_out and
-- request_regularization/decide_regularization RPCs, and their RLS policies.
-- Mirrors the proven Phase 1-9 / HR-1 pattern: it works WITH the handle_new_user
-- trigger rather than disabling it (postgres is not superuser here and cannot
-- disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/hr2_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY / FIXTURES
--   Insert five auth.users. on_auth_user_created auto-provisions for each: a
--   profile + organization + team + roles + an owner team_membership + active_team.
--     Alice -> OWNS org A (implicit HR admin).
--     Bob   -> NON-admin (Member) of Alice's team; an hr_employees row AND the
--              MANAGER of Carol (-> exercises the "manager-of" legs).
--     Carol -> NON-admin (Member) of Alice's team; an hr_employees row whose
--              manager_id = Bob; the self-service employee (clock in/out, request).
--     Erin  -> NON-admin (Member) of Alice's team; an UNRELATED co-member (not
--              self, not manager, not admin) -> the negative case.
--     Dave  -> a separate tenant (org D); unrelated to org A.
--   Fixture writes run as postgres (OWNS the public.* tables -> RLS bypassed).
--   Assertions switch into `authenticated` + set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) can_view_employee / can_manage_employee: self TRUE/—, HR admin TRUE/TRUE,
--       manager-of TRUE/TRUE, unrelated co-member FALSE/FALSE.
--   (b) hr_shifts / hr_holidays: an org member reads; a non-HR-admin cannot write;
--       an HR admin can.
--   (c) clock_in() then clock_out() creates today's attendance and computes
--       work_minutes (asserts the row exists + work_minutes >= 0, since now()).
--   (d) attendance is visible to self + HR admin, NOT to an unrelated co-member.
--   (e) request_regularization by the employee + decide_regularization by an HR
--       admin -> approved, and a 'regularized' attendance row is written.
--   (f) a non-manager non-admin co-member CANNOT decide a regularization.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fixture (runs as postgres -> RLS bypassed). The trigger provisions each tenant.
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
        ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'erin@example.com'),
        ('d4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'dave@example.com');

    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Bob + Carol + Erin become NON-admin (Member, default_role=true) of Alice's team.
    insert into public.team_members (user_id, team_id, role_id, active)
    select 'b2222222-2222-2222-2222-222222222222', _alice_team, r.id, true
    from public.roles r where r.team_id = _alice_team and r.default_role = true;

    insert into public.team_members (user_id, team_id, role_id, active)
    select 'c3333333-3333-3333-3333-333333333333', _alice_team, r.id, true
    from public.roles r where r.team_id = _alice_team and r.default_role = true;

    insert into public.team_members (user_id, team_id, role_id, active)
    select 'e5555555-5555-5555-5555-555555555555', _alice_team, r.id, true
    from public.roles r where r.team_id = _alice_team and r.default_role = true;
end
$$;

-- -----------------------------------------------------------------------------
-- Build the HR-1 directory rows (as Alice, the HR admin): Bob (manager), Carol
-- (managed by Bob), Erin (unrelated). Done via RLS so it also exercises HR-1.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _bob_emp   uuid;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';

    insert into public.hr_employees (org_id, user_id, employee_code, full_name)
    values (_alice_org, 'b2222222-2222-2222-2222-222222222222', 'EMP-BOB', 'Bob Manager')
    returning id into _bob_emp;

    insert into public.hr_employees (org_id, user_id, employee_code, full_name, manager_id)
    values (_alice_org, 'c3333333-3333-3333-3333-333333333333', 'EMP-CAROL', 'Carol Report', _bob_emp);

    insert into public.hr_employees (org_id, user_id, employee_code, full_name)
    values (_alice_org, 'e5555555-5555-5555-5555-555555555555', 'EMP-ERIN', 'Erin Unrelated');

    execute 'reset role';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): can_view_employee / can_manage_employee — self, HR admin, manager-of,
--   unrelated. Carol is the target. self=Carol, admin=Alice, manager=Bob,
--   unrelated=Erin.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _self_view boolean; _self_manage boolean;
    _adm_view  boolean; _adm_manage  boolean;
    _mgr_view  boolean; _mgr_manage  boolean;
    _unr_view  boolean; _unr_manage  boolean;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- self (Carol)
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _self_view := public.can_view_employee(_carol_emp);
    _self_manage := public.can_manage_employee(_carol_emp);
    execute 'reset role';

    -- HR admin (Alice)
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _adm_view := public.can_view_employee(_carol_emp);
    _adm_manage := public.can_manage_employee(_carol_emp);
    execute 'reset role';

    -- manager-of (Bob)
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _mgr_view := public.can_view_employee(_carol_emp);
    _mgr_manage := public.can_manage_employee(_carol_emp);
    execute 'reset role';

    -- unrelated co-member (Erin)
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _unr_view := public.can_view_employee(_carol_emp);
    _unr_manage := public.can_manage_employee(_carol_emp);
    execute 'reset role';

    if _self_view is not true then
        raise exception 'TEST (a) FAILED: can_view_employee not TRUE for self';
    end if;
    if _adm_view is not true or _adm_manage is not true then
        raise exception 'TEST (a) FAILED: can_view/manage not TRUE for HR admin';
    end if;
    if _mgr_view is not true or _mgr_manage is not true then
        raise exception 'TEST (a) FAILED: can_view/manage not TRUE for the manager';
    end if;
    if _unr_view is not false or _unr_manage is not false then
        raise exception 'TEST (a) FAILED: can_view/manage not FALSE for an unrelated co-member (view=%, manage=%)', _unr_view, _unr_manage;
    end if;

    raise notice 'TEST (a) PASSED: can_view/can_manage — self/admin/manager TRUE, unrelated FALSE';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): hr_shifts / hr_holidays — an org member (Erin) reads; a non-HR-admin
--   (Erin) CANNOT write; an HR admin (Alice) CAN.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _erin_shift_reads int; _erin_hol_reads int;
    _erin_blocked_shift boolean := false;
    _erin_blocked_hol   boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    -- Alice (HR admin) creates a shift + a holiday.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_shifts (org_id, name, start_time, end_time, break_minutes, is_default)
    values (_alice_org, 'General', '09:00', '18:00', 60, true);
    insert into public.hr_holidays (org_id, date, name)
    values (_alice_org, date '2026-12-25', 'Christmas');
    execute 'reset role';

    -- Erin (a plain org member) reads both, cannot insert either.
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _erin_shift_reads from public.hr_shifts where org_id = _alice_org;
    select count(*) into _erin_hol_reads   from public.hr_holidays where org_id = _alice_org;
    begin
        insert into public.hr_shifts (org_id, name) values (_alice_org, 'Night');
        _erin_blocked_shift := false;
    exception when insufficient_privilege then _erin_blocked_shift := true;
    end;
    begin
        insert into public.hr_holidays (org_id, date, name) values (_alice_org, date '2026-01-01', 'New Year');
        _erin_blocked_hol := false;
    exception when insufficient_privilege then _erin_blocked_hol := true;
    end;
    execute 'reset role';

    if _erin_shift_reads < 1 then
        raise exception 'TEST (b) FAILED: an org member could not read hr_shifts (got %)', _erin_shift_reads;
    end if;
    if _erin_hol_reads < 1 then
        raise exception 'TEST (b) FAILED: an org member could not read hr_holidays (got %)', _erin_hol_reads;
    end if;
    if _erin_blocked_shift is not true then
        raise exception 'TEST (b) FAILED: a non-HR-admin was allowed to INSERT a shift';
    end if;
    if _erin_blocked_hol is not true then
        raise exception 'TEST (b) FAILED: a non-HR-admin was allowed to INSERT a holiday';
    end if;

    raise notice 'TEST (b) PASSED: org members read shifts/holidays; non-HR-admin cannot write; HR admin can';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): clock_in() then clock_out() creates today's attendance for Carol and
--   computes work_minutes. Assign Carol the General shift (break 60) first so the
--   break path is exercised. work_minutes is asserted NOT NULL and >= 0 (now()).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _shift_id  uuid;
    _att_in    uuid;
    _att_out   uuid;
    _wm        integer;
    _ci        timestamp with time zone;
    _co        timestamp with time zone;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;
    select id into _shift_id from public.hr_shifts where org_id = _alice_org and is_default limit 1;

    -- Alice (HR admin) assigns Carol the default shift.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_employee_shifts (employee_id, org_id, shift_id)
    values (_carol_emp, _alice_org, _shift_id);
    execute 'reset role';

    -- Carol clocks in then out (RPCs are SECURITY DEFINER; she is authenticated).
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _att_in  := public.clock_in();
    _att_out := public.clock_out();
    execute 'reset role';

    if _att_in is null then
        raise exception 'TEST (c) FAILED: clock_in returned null';
    end if;
    if _att_out is distinct from _att_in then
        raise exception 'TEST (c) FAILED: clock_out did not target the same attendance row';
    end if;

    select work_minutes, clock_in, clock_out into _wm, _ci, _co
    from public.hr_attendance where id = _att_in;

    if _ci is null then
        raise exception 'TEST (c) FAILED: clock_in timestamp not set';
    end if;
    if _co is null then
        raise exception 'TEST (c) FAILED: clock_out timestamp not set';
    end if;
    if _wm is null or _wm < 0 then
        raise exception 'TEST (c) FAILED: work_minutes is null or negative (got %)', _wm;
    end if;

    raise notice 'TEST (c) PASSED: clock_in/clock_out created today''s attendance, work_minutes = % (>= 0)', _wm;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): attendance is visible to self (Carol) + HR admin (Alice), NOT to an
--   unrelated co-member (Erin).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _self_reads  int;
    _admin_reads int;
    _unrel_reads int;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Carol (self)
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _self_reads from public.hr_attendance where employee_id = _carol_emp;
    execute 'reset role';

    -- Alice (HR admin)
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _admin_reads from public.hr_attendance where employee_id = _carol_emp;
    execute 'reset role';

    -- Erin (unrelated co-member)
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _unrel_reads from public.hr_attendance where employee_id = _carol_emp;
    execute 'reset role';

    if _self_reads < 1 then
        raise exception 'TEST (d) FAILED: the employee could not see her own attendance (got %)', _self_reads;
    end if;
    if _admin_reads < 1 then
        raise exception 'TEST (d) FAILED: the HR admin could not see the attendance (got %)', _admin_reads;
    end if;
    if _unrel_reads <> 0 then
        raise exception 'TEST (d) FAILED: an unrelated co-member could see another''s attendance (got %)', _unrel_reads;
    end if;

    raise notice 'TEST (d) PASSED: attendance visible to self + HR admin; an unrelated co-member sees none';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): request_regularization by the employee (Carol) + decide_regularization
--   by an HR admin (Alice) -> approved, and a 'regularized' attendance row exists.
--   Uses a past date (2026-06-01) distinct from today's row.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _req_id    uuid;
    _status    text;
    _att_status text;
    _att_source text;
    _att_wm    integer;
    _reg_date  date := date '2026-06-01';
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Carol files a pending regularization for 2026-06-01 (09:00 - 18:00).
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _req_id := public.request_regularization(
        _reg_date,
        (_reg_date + time '09:00') at time zone 'UTC',
        (_reg_date + time '18:00') at time zone 'UTC',
        'Forgot to punch'
    );
    execute 'reset role';

    if _req_id is null then
        raise exception 'TEST (e) FAILED: request_regularization returned null';
    end if;

    -- Alice (HR admin) approves it.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    perform public.decide_regularization(_req_id, true, 'Approved by HR');
    execute 'reset role';

    select status into _status from public.hr_attendance_regularizations where id = _req_id;
    if _status is distinct from 'approved' then
        raise exception 'TEST (e) FAILED: regularization status not approved (got %)', _status;
    end if;

    select status, source, work_minutes into _att_status, _att_source, _att_wm
    from public.hr_attendance where employee_id = _carol_emp and date = _reg_date;

    if _att_source is distinct from 'regularized' then
        raise exception 'TEST (e) FAILED: no regularized attendance row written (source=%)', _att_source;
    end if;
    if _att_status is distinct from 'present' then
        raise exception 'TEST (e) FAILED: regularized attendance status not present (got %)', _att_status;
    end if;
    if _att_wm is null or _att_wm < 0 then
        raise exception 'TEST (e) FAILED: regularized work_minutes null/negative (got %)', _att_wm;
    end if;

    raise notice 'TEST (e) PASSED: employee requested + HR admin approved -> regularized attendance row (work_minutes = %)', _att_wm;
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): a non-manager non-admin co-member (Erin) CANNOT decide a
--   regularization (can_manage_employee FALSE -> the RPC raises).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _req_id    uuid;
    _blocked   boolean := false;
    _reg_date  date := date '2026-06-02';
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Carol files another pending request.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _req_id := public.request_regularization(
        _reg_date,
        (_reg_date + time '09:00') at time zone 'UTC',
        (_reg_date + time '18:00') at time zone 'UTC',
        'Second request'
    );
    execute 'reset role';

    -- Erin (unrelated co-member) tries to decide it -> must be blocked.
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform public.decide_regularization(_req_id, true, 'sneaky');
        _blocked := false;
    exception
        when others then _blocked := true;
    end;
    execute 'reset role';

    if _blocked is not true then
        raise exception 'TEST (f) FAILED: a non-manager non-admin co-member was allowed to decide a regularization';
    end if;

    -- And the request must still be pending.
    if not exists (
        select 1 from public.hr_attendance_regularizations
        where id = _req_id and status = 'pending'
    ) then
        raise exception 'TEST (f) FAILED: the regularization was altered by an unauthorized decider';
    end if;

    raise notice 'TEST (f) PASSED: a non-manager non-admin cannot decide a regularization';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL HR-2 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
