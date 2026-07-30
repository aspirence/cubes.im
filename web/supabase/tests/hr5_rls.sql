-- =============================================================================
-- Cubes Greenfield Rebuild — HR-5 RLS test (Analytics + Onboarding)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the HR-5 table
-- (hr_onboarding_tasks), the seed_onboarding_checklist / hr_org_analytics RPCs and
-- their RLS policies. Mirrors the proven Phase 1-9 / HR-1..HR-4 pattern: it works
-- WITH the handle_new_user trigger rather than disabling it (postgres is not
-- superuser here and cannot disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/hr5_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY / FIXTURES
--   Insert three auth.users. on_auth_user_created auto-provisions for each: a
--   profile + organization + team + roles + an owner team_membership + active_team.
--     Alice -> OWNS org A (implicit HR admin).
--     Bob   -> NON-admin (Member) of Alice's team; an hr_employees row in the
--              'Engineering' department, status 'active'. He has a BIRTHDAY a few
--              days out AND a 2-year-old joining ANNIVERSARY a few days out (both
--              built relative to current_date so they fall in the 30-day window).
--     Erin  -> NON-admin (Member) of Alice's team; an UNRELATED co-member (not
--              self, not manager, not admin) -> the negative case. Status 'active',
--              no department (-> 'Unassigned' bucket).
--   Birthday/anniversary dates are computed as current_date + 5 days, with the
--   YEAR shifted back so date_of_birth / date_of_joining are real past dates whose
--   (month, day) recurs inside [today, today+30].
--   Fixture writes run as postgres (OWNS the public.* tables -> RLS bypassed).
--   Assertions switch into `authenticated` + set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) seed_onboarding_checklist: inserts the 7-item onboarding list, is
--       idempotent (second call -> 0), and a NON-manager cannot seed someone else's.
--   (b) onboarding tasks RLS: the employee sees their OWN tasks; an unrelated
--       co-member cannot; the HR admin can UPDATE status.
--   (c) hr_org_analytics: headcount / by_department / leave_pending / payroll_last
--       match the seed; upcoming_birthdays + upcoming_anniversaries include Bob; a
--       NON-member call raises.
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
        ('e5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'erin@example.com');

    select id into _alice_team from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111';

    -- Bob + Erin become NON-admin (Member, default_role=true) of Alice's team.
    insert into public.team_members (user_id, team_id, role_id, active)
    select 'b2222222-2222-2222-2222-222222222222', _alice_team, r.id, true
    from public.roles r where r.team_id = _alice_team and r.default_role = true;

    insert into public.team_members (user_id, team_id, role_id, active)
    select 'e5555555-5555-5555-5555-555555555555', _alice_team, r.id, true
    from public.roles r where r.team_id = _alice_team and r.default_role = true;
end
$$;

-- -----------------------------------------------------------------------------
-- Build the HR-1 directory (as Alice, the HR admin): an 'Engineering' department,
-- Bob (in Engineering, birthday + 2yr anniversary a few days out), Erin (no dept).
-- A pending leave request and a payroll run. Done via RLS so it exercises HR-1/3/4.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _dept_id   uuid;
    _type_id   uuid;
    _bob_emp   uuid;
    _erin_emp  uuid;
    _bday      date := current_date + 5;   -- birthday recurs in 5 days
    _anniv     date := current_date + 5;   -- work anniversary recurs in 5 days
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';

    insert into public.hr_departments (org_id, name)
    values (_alice_org, 'Engineering')
    returning id into _dept_id;

    -- Bob: active, Engineering. date_of_birth = 1990 with (month,day) of today+5;
    -- date_of_joining = exactly 2 years ago shifted to (month,day) of today+5, so
    -- the upcoming anniversary marks 2 completed years.
    insert into public.hr_employees
        (org_id, user_id, employee_code, full_name, department_id, status,
         employment_type, work_location, date_of_birth, date_of_joining)
    values
        (_alice_org, 'b2222222-2222-2222-2222-222222222222', 'EMP-BOB', 'Bob Builder',
         _dept_id, 'active', 'full_time', 'Bangalore',
         make_date(1990, extract(month from _bday)::int, extract(day from _bday)::int),
         make_date((extract(year from current_date)::int - 2),
                   extract(month from _anniv)::int, extract(day from _anniv)::int))
    returning id into _bob_emp;

    -- Erin: active, NO department (-> 'Unassigned'), no birthday/anniversary in window.
    insert into public.hr_employees
        (org_id, user_id, employee_code, full_name, status, employment_type, work_location)
    values
        (_alice_org, 'e5555555-5555-5555-5555-555555555555', 'EMP-ERIN', 'Erin Unrelated',
         'active', 'full_time', 'Remote')
    returning id into _erin_emp;

    -- A leave type (HR-admin-gated insert) the leave request will reference.
    insert into public.hr_leave_types (org_id, name, code, annual_quota)
    values (_alice_org, 'Casual Leave', 'CL', 12)
    returning id into _type_id;

    -- An attendance row today for Bob (present) -> present_today should be >= 1.
    -- can_view_employee(Bob) holds for Alice (HR admin) -> insert allowed.
    insert into public.hr_attendance (employee_id, org_id, date, status, source)
    values (_bob_emp, _alice_org, current_date, 'present', 'manual');

    -- A finalized payroll run (the most-recent run analytics should surface).
    insert into public.hr_payroll_runs
        (org_id, period_month, period_year, status, total_net, employee_count)
    values
        (_alice_org, 5, 2026, 'finalized', 95000, 2);

    execute 'reset role';

    -- The pending leave request is self-service: hr_leave_requests_insert requires
    -- the row's employee = auth.uid(), so Bob inserts his own (leave_pending counts it).
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_leave_requests
        (org_id, employee_id, leave_type_id, from_date, to_date, days, status)
    values
        (_alice_org, _bob_emp, _type_id, current_date + 10, current_date + 11, 2, 'pending');
    execute 'reset role';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): seed_onboarding_checklist — Alice (HR admin) seeds Bob's onboarding
--   list (count = 7); a second call is idempotent (-> 0). Erin (a non-manager,
--   non-admin co-member) cannot seed Bob's checklist.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _bob_emp   uuid;
    _first     integer;
    _second    integer;
    _row_count integer;
    _erin_blocked boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _bob_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'b2222222-2222-2222-2222-222222222222' limit 1;

    -- Alice (HR admin) seeds, then re-seeds (idempotent).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _first  := public.seed_onboarding_checklist(_bob_emp, 'onboarding');
    _second := public.seed_onboarding_checklist(_bob_emp, 'onboarding');
    select count(*) into _row_count from public.hr_onboarding_tasks
        where employee_id = _bob_emp and kind = 'onboarding';
    execute 'reset role';

    -- Erin (non-manager co-member) cannot seed Bob's checklist.
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform public.seed_onboarding_checklist(_bob_emp, 'onboarding');
        _erin_blocked := false;
    exception when others then _erin_blocked := true;
    end;
    execute 'reset role';

    if _first <> 7 then
        raise exception 'TEST (a) FAILED: first seed expected 7 inserted, got %', _first;
    end if;
    if _second <> 0 then
        raise exception 'TEST (a) FAILED: second seed expected 0 (idempotent), got %', _second;
    end if;
    if _row_count <> 7 then
        raise exception 'TEST (a) FAILED: expected 7 onboarding rows after two seeds, got %', _row_count;
    end if;
    if _erin_blocked is not true then
        raise exception 'TEST (a) FAILED: a non-manager was allowed to seed another employee''s checklist';
    end if;

    raise notice 'TEST (a) PASSED: seed inserts 7, idempotent (0 on re-seed), non-manager blocked';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): onboarding-task RLS — Bob (the employee) sees his OWN tasks; Erin (an
--   unrelated co-member) cannot; Alice (HR admin) can UPDATE a task's status.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _bob_emp   uuid;
    _self_reads  integer;
    _unrel_reads integer;
    _task_id   uuid;
    _new_status text;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _bob_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'b2222222-2222-2222-2222-222222222222' limit 1;

    -- Bob (self) sees his own tasks.
    perform set_config('request.jwt.claims',
        '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _self_reads from public.hr_onboarding_tasks where employee_id = _bob_emp;
    execute 'reset role';

    -- Erin (unrelated) cannot see Bob's tasks.
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _unrel_reads from public.hr_onboarding_tasks where employee_id = _bob_emp;
    execute 'reset role';

    -- Alice (HR admin) updates a task's status to 'done'.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select id into _task_id from public.hr_onboarding_tasks
        where employee_id = _bob_emp and kind = 'onboarding' order by sort_order limit 1;
    update public.hr_onboarding_tasks
        set status = 'done', completed_at = now()
        where id = _task_id;
    execute 'reset role';

    select status into _new_status from public.hr_onboarding_tasks where id = _task_id;

    if _self_reads <> 7 then
        raise exception 'TEST (b) FAILED: the employee could not see his own 7 tasks (got %)', _self_reads;
    end if;
    if _unrel_reads <> 0 then
        raise exception 'TEST (b) FAILED: an unrelated co-member could see another''s tasks (got %)', _unrel_reads;
    end if;
    if _new_status is distinct from 'done' then
        raise exception 'TEST (b) FAILED: HR admin could not update task status (got %)', _new_status;
    end if;

    raise notice 'TEST (b) PASSED: employee sees own 7 tasks; unrelated sees 0; HR admin updates status -> done';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): hr_org_analytics — consistent with the seed for the HR admin, and a
--   NON-member call raises. Asserts headcount=2, by_department has Engineering=1
--   and Unassigned=1, leave_pending=1, payroll_last matches the seeded run, and
--   both upcoming_birthdays and upcoming_anniversaries include Bob (with years=2).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _a         jsonb;
    _headcount int;
    _total     int;
    _leave_pending int;
    _eng_count int;
    _unassigned_count int;
    _present_today int;
    _payroll_net numeric;
    _payroll_status text;
    _bday_names text;
    _anniv_names text;
    _anniv_years int;
    _nonmember_blocked boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;

    -- Alice (HR admin / org member) gets the dashboard.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _a := public.hr_org_analytics(_alice_org);
    execute 'reset role';

    _headcount     := (_a ->> 'headcount')::int;
    _total         := (_a ->> 'total_employees')::int;
    _leave_pending := (_a ->> 'leave_pending')::int;
    _present_today := (_a ->> 'present_today')::int;
    _payroll_net   := (_a -> 'payroll_last' ->> 'total_net')::numeric;
    _payroll_status:= (_a -> 'payroll_last' ->> 'status');

    -- by_department: pull Engineering + Unassigned counts.
    select max((el ->> 'count')::int) filter (where el ->> 'name' = 'Engineering'),
           max((el ->> 'count')::int) filter (where el ->> 'name' = 'Unassigned')
      into _eng_count, _unassigned_count
    from jsonb_array_elements(_a -> 'by_department') el;

    -- upcoming_birthdays / upcoming_anniversaries: do they include Bob?
    select string_agg(el ->> 'full_name', ',') into _bday_names
    from jsonb_array_elements(_a -> 'upcoming_birthdays') el;

    select string_agg(el ->> 'full_name', ','),
           max((el ->> 'years')::int) filter (where el ->> 'full_name' = 'Bob Builder')
      into _anniv_names, _anniv_years
    from jsonb_array_elements(_a -> 'upcoming_anniversaries') el;

    -- A non-member (a brand-new auth user with their OWN org) cannot read org A.
    insert into auth.users (id, instance_id, aud, role, email)
    values ('f6666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000',
            'authenticated', 'authenticated', 'frank@example.com');
    perform set_config('request.jwt.claims',
        '{"sub":"f6666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform public.hr_org_analytics(_alice_org);
        _nonmember_blocked := false;
    exception when others then _nonmember_blocked := true;
    end;
    execute 'reset role';

    -- Assertions.
    if _headcount <> 2 then
        raise exception 'TEST (c) FAILED: headcount expected 2 (Bob + Erin active), got %', _headcount;
    end if;
    if _total <> 2 then
        raise exception 'TEST (c) FAILED: total_employees expected 2, got %', _total;
    end if;
    if _eng_count is distinct from 1 then
        raise exception 'TEST (c) FAILED: by_department Engineering expected 1, got %', _eng_count;
    end if;
    if _unassigned_count is distinct from 1 then
        raise exception 'TEST (c) FAILED: by_department Unassigned expected 1, got %', _unassigned_count;
    end if;
    if _leave_pending <> 1 then
        raise exception 'TEST (c) FAILED: leave_pending expected 1, got %', _leave_pending;
    end if;
    if _present_today < 1 then
        raise exception 'TEST (c) FAILED: present_today expected >= 1 (Bob present), got %', _present_today;
    end if;
    if _payroll_net is distinct from 95000 or _payroll_status is distinct from 'finalized' then
        raise exception 'TEST (c) FAILED: payroll_last mismatch (net %, status %)', _payroll_net, _payroll_status;
    end if;
    if _bday_names is null or position('Bob Builder' in _bday_names) = 0 then
        raise exception 'TEST (c) FAILED: upcoming_birthdays did not include Bob (got %)', _bday_names;
    end if;
    if _anniv_names is null or position('Bob Builder' in _anniv_names) = 0 then
        raise exception 'TEST (c) FAILED: upcoming_anniversaries did not include Bob (got %)', _anniv_names;
    end if;
    if _anniv_years is distinct from 2 then
        raise exception 'TEST (c) FAILED: Bob''s anniversary years expected 2, got %', _anniv_years;
    end if;
    if _nonmember_blocked is not true then
        raise exception 'TEST (c) FAILED: a non-member was allowed to read org analytics';
    end if;

    raise notice 'TEST (c) PASSED: analytics consistent (headcount 2, Eng 1 / Unassigned 1, leave_pending 1, payroll_last 95000/finalized, present_today %, Bob in birthdays + anniversaries years=2); non-member blocked', _present_today;
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL HR-5 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
