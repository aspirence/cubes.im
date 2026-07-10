-- =============================================================================
-- Cubes Greenfield Rebuild — HR-3 RLS test (Leave Management)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the HR-3 tables
-- (hr_leave_types / hr_leave_balances / hr_leave_requests), the count_working_days
-- helper, the apply_leave / decide_leave / cancel_leave RPCs, and their RLS
-- policies. Mirrors the proven Phase 1-9 / HR-1 / HR-2 pattern: it works WITH the
-- handle_new_user trigger rather than disabling it (postgres is not superuser here
-- and cannot disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/hr3_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY / FIXTURES
--   Insert four auth.users. on_auth_user_created auto-provisions for each: a
--   profile + organization + team + roles + an owner team_membership + active_team.
--     Alice -> OWNS org A (implicit HR admin).
--     Bob   -> NON-admin (Member) of Alice's team; an hr_employees row AND the
--              MANAGER of Carol (-> exercises the "manager-of" decide leg).
--     Carol -> NON-admin (Member) of Alice's team; an hr_employees row whose
--              manager_id = Bob; the self-service employee (apply/cancel leave).
--     Erin  -> NON-admin (Member) of Alice's team; an UNRELATED co-member (not
--              self, not manager, not admin) -> the negative case.
--   Fixture writes run as postgres (OWNS the public.* tables -> RLS bypassed).
--   Assertions switch into `authenticated` + set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) hr_leave_types: an org member (Erin) reads; a non-HR-admin (Erin) CANNOT
--       write; an HR admin (Alice) CAN.
--   (b) count_working_days excludes weekends + a seeded (non-optional) holiday.
--   (c) apply_leave creates a pending request, computes days correctly, and bumps
--       balance.pending; a second over-balance apply is rejected.
--   (d) decide_leave APPROVE -> used += days, pending -= days, status 'approved',
--       and 'leave' hr_attendance rows written for the working days.
--   (e) decide_leave REJECT -> pending released, status 'rejected'.
--   (f) cancel_leave by the employee -> pending released, status 'cancelled'.
--   (g) balances + requests are visible to self (Carol) + HR admin (Alice), NOT to
--       an unrelated co-member (Erin).
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
         'authenticated', 'authenticated', 'erin@example.com');

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
-- TEST (a): hr_leave_types — an org member (Erin) reads; a non-HR-admin (Erin)
--   CANNOT write; an HR admin (Alice) CAN. Alice seeds an 'AL' (annual, quota 12)
--   type used by the rest of the suite.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _erin_reads int;
    _erin_blocked boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    -- Alice (HR admin) creates a leave type.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_leave_types (org_id, name, code, paid, annual_quota, accrual, color)
    values (_alice_org, 'Annual Leave', 'AL', true, 12, 'annual', '#3366ff');
    execute 'reset role';

    -- Erin (a plain org member) reads it, cannot insert a type.
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _erin_reads from public.hr_leave_types where org_id = _alice_org;
    begin
        insert into public.hr_leave_types (org_id, name, code) values (_alice_org, 'Sneaky', 'SNK');
        _erin_blocked := false;
    exception when insufficient_privilege then _erin_blocked := true;
    end;
    execute 'reset role';

    if _erin_reads < 1 then
        raise exception 'TEST (a) FAILED: an org member could not read hr_leave_types (got %)', _erin_reads;
    end if;
    if _erin_blocked is not true then
        raise exception 'TEST (a) FAILED: a non-HR-admin was allowed to INSERT a leave type';
    end if;

    raise notice 'TEST (a) PASSED: org members read leave types; non-HR-admin cannot write; HR admin can';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): count_working_days excludes weekends + a seeded (non-optional)
--   holiday. Range 2026-07-06 (Mon) .. 2026-07-12 (Sun) is Mon-Fri (5 working
--   days) + Sat/Sun. Seed a holiday on Wed 2026-07-08 -> expect 4 working days.
--   Also assert that an OPTIONAL holiday is NOT subtracted.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _wd_plain   numeric;
    _wd_holiday numeric;
    _wd_optional numeric;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    -- Baseline: Mon..Sun with no holiday in range -> 5 working days.
    _wd_plain := public.count_working_days(_alice_org, date '2026-07-06', date '2026-07-12');
    if _wd_plain <> 5 then
        raise exception 'TEST (b) FAILED: expected 5 working days for a full week, got %', _wd_plain;
    end if;

    -- Alice seeds a mandatory holiday on Wed 2026-07-08.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_holidays (org_id, date, name, optional)
    values (_alice_org, date '2026-07-08', 'Mid-week Holiday', false);
    -- And an OPTIONAL holiday on Thu 2026-07-09 (must NOT reduce the count).
    insert into public.hr_holidays (org_id, date, name, optional)
    values (_alice_org, date '2026-07-09', 'Optional Festival', true);
    execute 'reset role';

    _wd_holiday  := public.count_working_days(_alice_org, date '2026-07-06', date '2026-07-12');
    if _wd_holiday <> 4 then
        raise exception 'TEST (b) FAILED: expected 4 working days after a mid-week holiday, got %', _wd_holiday;
    end if;

    -- Sanity: weekend-only range (Sat..Sun) is 0 working days.
    _wd_optional := public.count_working_days(_alice_org, date '2026-07-11', date '2026-07-12');
    if _wd_optional <> 0 then
        raise exception 'TEST (b) FAILED: expected 0 working days for a weekend, got %', _wd_optional;
    end if;

    raise notice 'TEST (b) PASSED: count_working_days skips weekends + non-optional holidays (5 -> 4), keeps optional holidays';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): apply_leave (as Carol) creates a PENDING request, computes days
--   correctly and bumps balance.pending. Then a second over-balance apply (more
--   than the remaining 12-day quota) is REJECTED.
--   Range 2026-08-03 (Mon) .. 2026-08-07 (Fri) = 5 working days; no holidays.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _type_id   uuid;
    _req_id    uuid;
    _req_days  numeric;
    _req_status text;
    _pending   numeric;
    _over_blocked boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;
    select id into _type_id from public.hr_leave_types
        where org_id = _alice_org and code = 'AL' limit 1;

    -- Carol applies for 5 working days.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _req_id := public.apply_leave(_type_id, date '2026-08-03', date '2026-08-07', 'Family trip');
    execute 'reset role';

    if _req_id is null then
        raise exception 'TEST (c) FAILED: apply_leave returned null';
    end if;

    select days, status into _req_days, _req_status
    from public.hr_leave_requests where id = _req_id;
    if _req_days <> 5 then
        raise exception 'TEST (c) FAILED: apply_leave computed % days (expected 5)', _req_days;
    end if;
    if _req_status is distinct from 'pending' then
        raise exception 'TEST (c) FAILED: new request not pending (got %)', _req_status;
    end if;

    select pending into _pending from public.hr_leave_balances
        where employee_id = _carol_emp and leave_type_id = _type_id and year = 2026;
    if _pending <> 5 then
        raise exception 'TEST (c) FAILED: balance.pending not bumped to 5 (got %)', _pending;
    end if;

    -- A second apply for 10 more working days exceeds remaining (12 - 5 pending = 7).
    -- 2026-08-10 (Mon) .. 2026-08-21 (Fri) = 10 working days -> must be rejected.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform public.apply_leave(_type_id, date '2026-08-10', date '2026-08-21', 'Too much');
        _over_blocked := false;
    exception when others then _over_blocked := true;
    end;
    execute 'reset role';

    if _over_blocked is not true then
        raise exception 'TEST (c) FAILED: an over-balance apply_leave was allowed';
    end if;

    -- Pending must be unchanged (still 5) after the rejected over-apply.
    select pending into _pending from public.hr_leave_balances
        where employee_id = _carol_emp and leave_type_id = _type_id and year = 2026;
    if _pending <> 5 then
        raise exception 'TEST (c) FAILED: pending changed after a rejected over-apply (got %)', _pending;
    end if;

    raise notice 'TEST (c) PASSED: apply_leave -> pending request, days=5, balance.pending=5; over-balance apply rejected';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): decide_leave APPROVE (by HR admin Alice) -> used += days, pending -=
--   days, status 'approved', and 'leave' hr_attendance rows (source 'system')
--   written for each of the 5 working days.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _type_id   uuid;
    _req_id    uuid;
    _status    text;
    _used      numeric;
    _pending   numeric;
    _leave_rows int;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;
    select id into _type_id from public.hr_leave_types
        where org_id = _alice_org and code = 'AL' limit 1;
    select id into _req_id from public.hr_leave_requests
        where employee_id = _carol_emp and status = 'pending'
          and from_date = date '2026-08-03' limit 1;

    -- Alice (HR admin) approves Carol's 5-day request.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    perform public.decide_leave(_req_id, true, 'Approved — enjoy!');
    execute 'reset role';

    select status into _status from public.hr_leave_requests where id = _req_id;
    if _status is distinct from 'approved' then
        raise exception 'TEST (d) FAILED: request not approved (got %)', _status;
    end if;

    select used, pending into _used, _pending from public.hr_leave_balances
        where employee_id = _carol_emp and leave_type_id = _type_id and year = 2026;
    if _used <> 5 then
        raise exception 'TEST (d) FAILED: used not incremented to 5 (got %)', _used;
    end if;
    if _pending <> 0 then
        raise exception 'TEST (d) FAILED: pending not released to 0 (got %)', _pending;
    end if;

    -- Five 'leave' attendance rows (Mon..Fri 2026-08-03..07), system-sourced.
    select count(*) into _leave_rows from public.hr_attendance
        where employee_id = _carol_emp
          and date between date '2026-08-03' and date '2026-08-07'
          and status = 'leave' and source = 'system';
    if _leave_rows <> 5 then
        raise exception 'TEST (d) FAILED: expected 5 leave attendance rows, got %', _leave_rows;
    end if;

    raise notice 'TEST (d) PASSED: approve -> used=5, pending=0, status approved, 5 leave attendance rows';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): decide_leave REJECT (by HR admin Alice) -> pending released, status
--   'rejected'. Carol first applies for a fresh 2-day request; remaining after
--   the approved 5 is 7, so a 2-day apply succeeds and reserves 2 pending.
--   Range 2026-09-07 (Mon) .. 2026-09-08 (Tue) = 2 working days.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _type_id   uuid;
    _req_id    uuid;
    _status    text;
    _pending_before numeric;
    _pending_after  numeric;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;
    select id into _type_id from public.hr_leave_types
        where org_id = _alice_org and code = 'AL' limit 1;

    -- Carol applies (2 working days) -> pending goes 0 -> 2.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _req_id := public.apply_leave(_type_id, date '2026-09-07', date '2026-09-08', 'Short break');
    execute 'reset role';

    select pending into _pending_before from public.hr_leave_balances
        where employee_id = _carol_emp and leave_type_id = _type_id and year = 2026;
    if _pending_before <> 2 then
        raise exception 'TEST (e) FAILED: pending not 2 after fresh apply (got %)', _pending_before;
    end if;

    -- Alice (HR admin) rejects it.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    perform public.decide_leave(_req_id, false, 'Not now');
    execute 'reset role';

    select status into _status from public.hr_leave_requests where id = _req_id;
    if _status is distinct from 'rejected' then
        raise exception 'TEST (e) FAILED: request not rejected (got %)', _status;
    end if;

    select pending into _pending_after from public.hr_leave_balances
        where employee_id = _carol_emp and leave_type_id = _type_id and year = 2026;
    if _pending_after <> 0 then
        raise exception 'TEST (e) FAILED: pending not released on reject (got %)', _pending_after;
    end if;

    raise notice 'TEST (e) PASSED: reject -> status rejected, pending released back to 0';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): cancel_leave by the employee (Carol) -> pending released, status
--   'cancelled'. Carol applies a 3-day request then cancels it herself.
--   Range 2026-10-05 (Mon) .. 2026-10-07 (Wed) = 3 working days.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _type_id   uuid;
    _req_id    uuid;
    _status    text;
    _pending_before numeric;
    _pending_after  numeric;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;
    select id into _type_id from public.hr_leave_types
        where org_id = _alice_org and code = 'AL' limit 1;

    -- Carol applies (3 working days) then cancels.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _req_id := public.apply_leave(_type_id, date '2026-10-05', date '2026-10-07', 'Maybe');

    select pending into _pending_before from public.hr_leave_balances
        where employee_id = _carol_emp and leave_type_id = _type_id and year = 2026;
    if _pending_before <> 3 then
        raise exception 'TEST (f) FAILED: pending not 3 after apply (got %)', _pending_before;
    end if;

    perform public.cancel_leave(_req_id);
    execute 'reset role';

    select status into _status from public.hr_leave_requests where id = _req_id;
    if _status is distinct from 'cancelled' then
        raise exception 'TEST (f) FAILED: request not cancelled (got %)', _status;
    end if;

    select pending into _pending_after from public.hr_leave_balances
        where employee_id = _carol_emp and leave_type_id = _type_id and year = 2026;
    if _pending_after <> 0 then
        raise exception 'TEST (f) FAILED: pending not released on cancel (got %)', _pending_after;
    end if;

    raise notice 'TEST (f) PASSED: cancel_leave by the employee -> status cancelled, pending released';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (g): balances + requests are visible to self (Carol) + HR admin (Alice),
--   NOT to an unrelated co-member (Erin).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _self_bal int;  _admin_bal int;  _unrel_bal int;
    _self_req int;  _admin_req int;  _unrel_req int;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Carol (self)
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _self_bal from public.hr_leave_balances where employee_id = _carol_emp;
    select count(*) into _self_req from public.hr_leave_requests where employee_id = _carol_emp;
    execute 'reset role';

    -- Alice (HR admin)
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _admin_bal from public.hr_leave_balances where employee_id = _carol_emp;
    select count(*) into _admin_req from public.hr_leave_requests where employee_id = _carol_emp;
    execute 'reset role';

    -- Erin (unrelated co-member)
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _unrel_bal from public.hr_leave_balances where employee_id = _carol_emp;
    select count(*) into _unrel_req from public.hr_leave_requests where employee_id = _carol_emp;
    execute 'reset role';

    if _self_bal < 1 or _self_req < 1 then
        raise exception 'TEST (g) FAILED: the employee could not see her own balances/requests (bal=%, req=%)', _self_bal, _self_req;
    end if;
    if _admin_bal < 1 or _admin_req < 1 then
        raise exception 'TEST (g) FAILED: the HR admin could not see the balances/requests (bal=%, req=%)', _admin_bal, _admin_req;
    end if;
    if _unrel_bal <> 0 or _unrel_req <> 0 then
        raise exception 'TEST (g) FAILED: an unrelated co-member could see another''s balances/requests (bal=%, req=%)', _unrel_bal, _unrel_req;
    end if;

    raise notice 'TEST (g) PASSED: balances/requests visible to self + HR admin; an unrelated co-member sees none';
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL HR-3 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
