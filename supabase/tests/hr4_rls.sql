-- =============================================================================
-- Cubes Greenfield Rebuild — HR-4 RLS test (Payroll)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP). Proves the HR-4 tables
-- (hr_salary_structures / hr_salary_components / hr_payroll_runs / hr_payslips /
-- hr_reimbursements / hr_loans_advances / hr_bank_details), the compute_payslip /
-- run_payroll / finalize_payroll_run / apply_india_salary_preset RPCs, and their
-- RLS policies. Mirrors the proven Phase 1-9 / HR-1 / HR-2 / HR-3 pattern: it works
-- WITH the handle_new_user trigger rather than disabling it (postgres is not
-- superuser here and cannot disable a trigger it does not own on auth.users).
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/hr4_rls.sql
--
-- The whole file runs in one transaction and ROLLS BACK at the end, so it leaves
-- no data behind. Any failed assertion raises an exception and aborts.
--
-- STRATEGY / FIXTURES
--   Insert four auth.users. on_auth_user_created auto-provisions for each: a
--   profile + organization + team + roles + an owner team_membership + active_team.
--     Alice -> OWNS org A (implicit HR admin).
--     Bob   -> NON-admin (Member) of Alice's team; an hr_employees row AND the
--              MANAGER of Carol (-> exercises the "manager-of" approve leg).
--     Carol -> NON-admin (Member) of Alice's team; an hr_employees row whose
--              manager_id = Bob; the self-service employee (salary / reimbursement /
--              bank / LOP subject).
--     Erin  -> NON-admin (Member) of Alice's team; an UNRELATED co-member (not
--              self, not manager, not admin) -> the negative case.
--   Fixture writes run as postgres (OWNS the public.* tables -> RLS bypassed).
--   Assertions switch into `authenticated` + set request.jwt.claims.sub (auth.uid()).
--
-- COVERAGE
--   (a) salary structure + components: HR admin (Alice) writes; the employee
--       (Carol) sees her OWN salary; an unrelated co-member (Erin) cannot.
--   (b) run_payroll creates a run + a payslip per employee with a structure, and
--       net = gross - total_deductions from the components (CTC 120000 -> monthly
--       10000: Basic 4000 + HRA 2000 + Special 4000 = gross 10000; PF 480 + PTax
--       200 = ded 680; net 9320). Carol has a structure, Erin does NOT (skipped).
--   (c) payslip visible to its employee (Carol) + HR admin (Alice), NOT to an
--       unrelated co-member (Erin).
--   (d) reimbursement: Carol inserts a pending claim; Alice (HR admin) approves it.
--   (e) bank details: Carol upserts her OWN account; Alice (HR admin) reads it.
--   (f) LOP: Carol gets 1 'absent' day in the period -> lop_days=1 and a
--       Loss-of-Pay deduction reducing net below the no-LOP baseline.
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
-- TEST (a): salary structure + components. Alice (HR admin) creates Carol's
--   structure (CTC 120000) + a known set of components. The employee (Carol) sees
--   her own salary; an unrelated co-member (Erin) cannot. A non-HR-admin (Carol)
--   cannot write a structure.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _struct_id uuid;
    _self_reads int;
    _unrel_reads int;
    _carol_blocked boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Alice (HR admin) creates Carol's salary structure + components.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';

    insert into public.hr_salary_structures (employee_id, org_id, effective_from, ctc, currency)
    values (_carol_emp, _alice_org, date '2026-01-01', 120000, 'USD')
    returning id into _struct_id;

    -- monthly_ctc = 10000. Basic 40% -> 4000; HRA 50% of basic -> 2000;
    -- Special Allowance fixed 4000; PF 12% of basic -> 480; PTax fixed 200.
    insert into public.hr_salary_components
        (structure_id, org_id, employee_id, name, kind, calc, value, is_basic, sort_order)
    values
        (_struct_id, _alice_org, _carol_emp, 'Basic',             'earning',   'percent_of_ctc',   40,   true,  1),
        (_struct_id, _alice_org, _carol_emp, 'HRA',               'earning',   'percent_of_basic', 50,   false, 2),
        (_struct_id, _alice_org, _carol_emp, 'Special Allowance', 'earning',   'fixed',            4000, false, 3),
        (_struct_id, _alice_org, _carol_emp, 'Provident Fund',    'deduction', 'percent_of_basic', 12,   false, 4),
        (_struct_id, _alice_org, _carol_emp, 'Professional Tax',  'deduction', 'fixed',            200,  false, 5);
    execute 'reset role';

    -- Carol (self) reads her structure; cannot write one.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _self_reads from public.hr_salary_structures where employee_id = _carol_emp;
    begin
        insert into public.hr_salary_structures (employee_id, org_id, ctc)
        values (_carol_emp, _alice_org, 999999);
        _carol_blocked := false;
    exception when insufficient_privilege then _carol_blocked := true;
    end;
    execute 'reset role';

    -- Erin (unrelated) cannot see Carol's salary.
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _unrel_reads from public.hr_salary_structures where employee_id = _carol_emp;
    execute 'reset role';

    if _self_reads < 1 then
        raise exception 'TEST (a) FAILED: the employee could not read her own salary structure (got %)', _self_reads;
    end if;
    if _carol_blocked is not true then
        raise exception 'TEST (a) FAILED: a non-HR-admin was allowed to INSERT a salary structure';
    end if;
    if _unrel_reads <> 0 then
        raise exception 'TEST (a) FAILED: an unrelated co-member could read another''s salary (got %)', _unrel_reads;
    end if;

    raise notice 'TEST (a) PASSED: HR admin writes salary; employee sees own; non-admin cannot write; unrelated cannot read';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): run_payroll creates a run + a payslip per employee with a structure,
--   and net = gross - total_deductions from the components. Carol has a structure
--   (gross 10000, deductions 680, net 9320); Erin has NONE (skipped). Period
--   2026-03 (no LOP / loans / reimbursements yet -> the clean baseline).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _erin_emp  uuid;
    _run_id    uuid;
    _slip_count int;
    _gross numeric; _ded numeric; _net numeric;
    _emp_count int; _run_gross numeric; _run_net numeric;
    _erin_slip int;
    _non_admin_blocked boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;
    select id into _erin_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'e5555555-5555-5555-5555-555555555555' limit 1;

    -- A non-HR-admin (Carol) cannot run payroll.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        perform public.run_payroll(_alice_org, 3, 2026);
        _non_admin_blocked := false;
    exception when others then _non_admin_blocked := true;
    end;
    execute 'reset role';
    if _non_admin_blocked is not true then
        raise exception 'TEST (b) FAILED: a non-HR-admin was allowed to run payroll';
    end if;

    -- Alice (HR admin) runs payroll for 2026-03.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _run_id := public.run_payroll(_alice_org, 3, 2026);
    execute 'reset role';

    if _run_id is null then
        raise exception 'TEST (b) FAILED: run_payroll returned null';
    end if;

    -- Exactly one payslip (Carol) — Erin has no structure and is skipped.
    select count(*) into _slip_count from public.hr_payslips where payroll_run_id = _run_id;
    if _slip_count <> 1 then
        raise exception 'TEST (b) FAILED: expected 1 payslip (only Carol has a structure), got %', _slip_count;
    end if;

    select count(*) into _erin_slip from public.hr_payslips
        where payroll_run_id = _run_id and employee_id = _erin_emp;
    if _erin_slip <> 0 then
        raise exception 'TEST (b) FAILED: an employee without a structure got a payslip';
    end if;

    select gross, total_deductions, net into _gross, _ded, _net
    from public.hr_payslips where payroll_run_id = _run_id and employee_id = _carol_emp;

    if _gross <> 10000 then
        raise exception 'TEST (b) FAILED: gross expected 10000, got %', _gross;
    end if;
    if _ded <> 680 then
        raise exception 'TEST (b) FAILED: total_deductions expected 680 (PF 480 + PTax 200), got %', _ded;
    end if;
    if _net <> 9320 then
        raise exception 'TEST (b) FAILED: net expected 9320 (10000 - 680), got %', _net;
    end if;
    if _net <> _gross - _ded then
        raise exception 'TEST (b) FAILED: net (%) <> gross (%) - deductions (%)', _net, _gross, _ded;
    end if;

    -- Run totals rolled up.
    select employee_count, total_gross, total_net into _emp_count, _run_gross, _run_net
    from public.hr_payroll_runs where id = _run_id;
    if _emp_count <> 1 or _run_gross <> 10000 or _run_net <> 9320 then
        raise exception 'TEST (b) FAILED: run totals wrong (count %, gross %, net %)', _emp_count, _run_gross, _run_net;
    end if;

    raise notice 'TEST (b) PASSED: run_payroll -> 1 payslip, gross=10000, deductions=680, net=9320; totals rolled up; non-admin blocked';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): payslip visible to its employee (Carol) + HR admin (Alice), NOT to an
--   unrelated co-member (Erin). Also: finalize_payroll_run flips status to
--   'finalized' for the HR admin.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _run_id    uuid;
    _self int; _admin int; _unrel int;
    _status text;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;
    select id into _run_id from public.hr_payroll_runs
        where org_id = _alice_org and period_month = 3 and period_year = 2026 limit 1;

    -- Carol (self)
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _self from public.hr_payslips where employee_id = _carol_emp;
    execute 'reset role';

    -- Alice (HR admin) — sees it AND finalizes the run.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _admin from public.hr_payslips where employee_id = _carol_emp;
    perform public.finalize_payroll_run(_run_id);
    execute 'reset role';

    -- Erin (unrelated)
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _unrel from public.hr_payslips where employee_id = _carol_emp;
    execute 'reset role';

    if _self < 1 then
        raise exception 'TEST (c) FAILED: the employee could not see her own payslip (got %)', _self;
    end if;
    if _admin < 1 then
        raise exception 'TEST (c) FAILED: the HR admin could not see the payslip (got %)', _admin;
    end if;
    if _unrel <> 0 then
        raise exception 'TEST (c) FAILED: an unrelated co-member could see another''s payslip (got %)', _unrel;
    end if;

    select status into _status from public.hr_payroll_runs where id = _run_id;
    if _status is distinct from 'finalized' then
        raise exception 'TEST (c) FAILED: run not finalized (got %)', _status;
    end if;

    raise notice 'TEST (c) PASSED: payslip visible to self + HR admin, not unrelated; finalize -> status finalized';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): reimbursement — Carol inserts a pending claim; Alice (HR admin)
--   approves it (status -> approved). An unrelated co-member (Erin) cannot insert a
--   claim on Carol's behalf.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _reimb_id  uuid;
    _status    text;
    _erin_blocked boolean := false;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Carol inserts her own pending claim.
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_reimbursements (employee_id, org_id, category, amount, date)
    values (_carol_emp, _alice_org, 'Travel', 1500, date '2026-03-10')
    returning id into _reimb_id;
    execute 'reset role';

    -- Erin cannot insert a claim FOR Carol (not her own employee row).
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
        insert into public.hr_reimbursements (employee_id, org_id, category, amount)
        values (_carol_emp, _alice_org, 'Sneaky', 9999);
        _erin_blocked := false;
    exception when insufficient_privilege then _erin_blocked := true;
    end;
    execute 'reset role';

    -- Alice (HR admin) approves Carol's claim.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    update public.hr_reimbursements
        set status = 'approved', approver_id = 'a1111111-1111-1111-1111-111111111111', decided_at = now()
        where id = _reimb_id;
    execute 'reset role';

    if _erin_blocked is not true then
        raise exception 'TEST (d) FAILED: an unrelated co-member inserted a reimbursement for another employee';
    end if;

    select status into _status from public.hr_reimbursements where id = _reimb_id;
    if _status is distinct from 'approved' then
        raise exception 'TEST (d) FAILED: reimbursement not approved (got %)', _status;
    end if;

    raise notice 'TEST (d) PASSED: employee inserts a pending claim; HR admin approves -> approved; unrelated insert blocked';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): bank details — Carol upserts her OWN account; Alice (HR admin) reads
--   it. An unrelated co-member (Erin) cannot read it.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _admin_reads int;
    _unrel_reads int;
    _acct text;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Carol inserts her own bank details, then updates them (self-service upsert).
    perform set_config('request.jwt.claims',
        '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_bank_details (employee_id, org_id, account_name, account_number, bank_name)
    values (_carol_emp, _alice_org, 'Carol Report', '0001112223', 'Acme Bank');
    update public.hr_bank_details
        set account_number = '9998887776', updated_at = now()
        where employee_id = _carol_emp;
    execute 'reset role';

    -- Alice (HR admin) reads the account.
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*), max(account_number) into _admin_reads, _acct
    from public.hr_bank_details where employee_id = _carol_emp;
    execute 'reset role';

    -- Erin (unrelated) cannot read it.
    perform set_config('request.jwt.claims',
        '{"sub":"e5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    select count(*) into _unrel_reads from public.hr_bank_details where employee_id = _carol_emp;
    execute 'reset role';

    if _admin_reads < 1 or _acct is distinct from '9998887776' then
        raise exception 'TEST (e) FAILED: HR admin could not read the upserted bank details (reads %, acct %)', _admin_reads, _acct;
    end if;
    if _unrel_reads <> 0 then
        raise exception 'TEST (e) FAILED: an unrelated co-member could read another''s bank details (got %)', _unrel_reads;
    end if;

    raise notice 'TEST (e) PASSED: employee upserts own bank details; HR admin reads them; unrelated cannot';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): LOP — Carol gets 1 'absent' attendance day in a fresh period (2026-04)
--   -> lop_days = 1, a Loss-of-Pay deduction appears, and net drops below the
--   no-LOP baseline (9320). gross stays 10000 (LOP is a deduction, not a gross cut).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_org uuid;
    _carol_emp uuid;
    _run_id    uuid;
    _slip      record;
    _lop_present boolean := false;
    _ded jsonb;
    _el  jsonb;
begin
    select organization_id into _alice_org from public.teams
        where user_id = 'a1111111-1111-1111-1111-111111111111' limit 1;
    select id into _carol_emp from public.hr_employees
        where org_id = _alice_org and user_id = 'c3333333-3333-3333-3333-333333333333' limit 1;

    -- Alice (HR admin) records one 'absent' day for Carol in April (2026-04-08, Wed).
    perform set_config('request.jwt.claims',
        '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.hr_attendance (employee_id, org_id, date, status, source)
    values (_carol_emp, _alice_org, date '2026-04-08', 'absent', 'manual');

    -- Run payroll for 2026-04.
    _run_id := public.run_payroll(_alice_org, 4, 2026);
    execute 'reset role';

    select gross, total_deductions, net, working_days, paid_days, lop_days, deductions
        into _slip
    from public.hr_payslips where payroll_run_id = _run_id and employee_id = _carol_emp;

    if _slip.lop_days <> 1 then
        raise exception 'TEST (f) FAILED: expected lop_days=1, got %', _slip.lop_days;
    end if;
    if _slip.paid_days <> _slip.working_days - 1 then
        raise exception 'TEST (f) FAILED: paid_days (%) <> working_days (%) - 1', _slip.paid_days, _slip.working_days;
    end if;

    -- gross unchanged at 10000 (LOP is a deduction line, not a gross reduction).
    if _slip.gross <> 10000 then
        raise exception 'TEST (f) FAILED: gross should remain 10000 with LOP, got %', _slip.gross;
    end if;

    -- A 'Loss of Pay' deduction line must be present and net must drop below 9320.
    for _ded in select * from jsonb_array_elements(_slip.deductions)
    loop
        if (_ded ->> 'name') = 'Loss of Pay' and (_ded ->> 'amount')::numeric > 0 then
            _lop_present := true;
        end if;
    end loop;

    if _lop_present is not true then
        raise exception 'TEST (f) FAILED: no positive Loss of Pay deduction line in %', _slip.deductions;
    end if;
    if _slip.net >= 9320 then
        raise exception 'TEST (f) FAILED: net (%) did not drop below the no-LOP baseline 9320', _slip.net;
    end if;
    if _slip.net <> _slip.gross - _slip.total_deductions then
        raise exception 'TEST (f) FAILED: net (%) <> gross (%) - deductions (%)', _slip.net, _slip.gross, _slip.total_deductions;
    end if;

    raise notice 'TEST (f) PASSED: 1 absent day -> lop_days=1, Loss-of-Pay deduction, net % < 9320 baseline', _slip.net;
end
$$;

do $$
begin
    raise notice '================================================';
    raise notice 'ALL HR-4 RLS TESTS PASSED';
    raise notice '================================================';
end
$$;

rollback;
