-- =============================================================================
-- Cubes Greenfield Rebuild — HR-4: Payroll (salary structures / components /
--   payroll runs / payslips / reimbursements / loans / bank details) + payslip
--   computation engine, run_payroll orchestrator, finalize + India preset RPCs
-- =============================================================================
-- The fourth slice of the Keka-inspired HR module. Builds on HR-1
-- (20261001000000_hr1_core.sql), HR-2 (20261002000000_hr2_attendance.sql) and
-- HR-3 (20261003000000_hr3_leave.sql): reuses is_org_member(org_id) [Phase 1],
-- is_hr_admin(org_id), current_employee_id(org_id) [HR-1],
-- can_view_employee(_employee_id) / can_manage_employee(_employee_id) [HR-2],
-- count_working_days(org, from, to) [HR-3], and the hr_employees / hr_attendance
-- tables.
--
-- Design decision: payroll is GENERIC (any currency, any component layout) with
-- an OPTIONAL India preset (apply_india_salary_preset) that seeds a conventional
-- Basic/HRA/Special-Allowance + PF/Professional-Tax breakdown. The engine knows
-- nothing India-specific; the preset is a convenience that just inserts rows.
--
-- Adds (all org-scoped, snake_case, `hr_` prefix; org_id DENORMALIZED onto every
-- employee-scoped row — and employee_id denormalized onto components/payslips —
-- so RLS can call is_hr_admin(org_id) / can_view_employee(employee_id) WITHOUT
-- recursing back through hr_employees):
--   * hr_salary_structures — a versioned CTC record for an employee. ctc is the
--     ANNUAL cost-to-company. effective_from lets multiple structures coexist;
--     the newest one whose effective_from <= the period drives a payslip.
--   * hr_salary_components — the line items of a structure: earnings/deductions,
--     each resolved as a fixed monthly amount or a percent of CTC / of Basic.
--     is_basic flags the component that anchors percent_of_basic math.
--   * hr_payroll_runs — one run per (org, month, year); a draft -> finalized ->
--     paid lifecycle with rolled-up totals. UNIQUE(org_id, period_month, year).
--   * hr_payslips — the per-employee output of a run: gross / deductions / net,
--     day counts, and the earnings/deductions breakdown snapshotted as jsonb.
--     UNIQUE(payroll_run_id, employee_id). Created only by run_payroll.
--   * hr_reimbursements — an employee expense claim with an approval lifecycle;
--     approved claims dated in the period are added to that month's payslip.
--   * hr_loans_advances — a loan/advance with a monthly EMI; active loans' EMIs
--     are deducted from each payslip.
--   * hr_bank_details — one disbursement account per employee (UNIQUE employee).
--
-- RPCs (SECURITY DEFINER, search_path = public, extensions):
--   * apply_india_salary_preset(structure_id) -> void — HR-admin gated; seeds the
--     conventional Indian component split for a structure (approximate; documented
--     as a convenience, NOT a statutory engine).
--   * compute_payslip(employee_id, month, year) -> jsonb — the pure-ish computation
--     helper: resolves the latest applicable structure, evaluates every component,
--     applies loss-of-pay (from 'absent' attendance), loan EMIs and approved
--     reimbursements, and returns {gross, total_deductions, net, working_days,
--     paid_days, lop_days, earnings, deductions}. Returns zeros when no structure.
--   * run_payroll(org_id, month, year) -> uuid — HR-admin gated; upserts the draft
--     run, (re)builds a payslip for every active employee that has a structure, and
--     rolls up the run totals. Returns the run id.
--   * finalize_payroll_run(run_id) -> void — HR-admin gated; flips status to
--     'finalized' (a lightweight lock; 'paid' is a later/manual transition).
--
-- Supabase adaptations carried over from Phases 1-9 / HR-1 / HR-2 / HR-3:
--   * gen_random_uuid() / citext live in the `extensions` schema. UUID PKs use a
--     column DEFAULT (gen_random_uuid()); helper/RPC bodies pin
--     `set search_path = public, extensions` (they generate UUIDs / call helpers).
--   * Every new table: enable RLS + add policies AND grant table privileges to
--     `authenticated` (else queries fail with permission-denied BEFORE RLS runs).
--   * The SECURITY DEFINER RPCs read/write payroll rows directly (RLS bypassed)
--     but gate explicitly on is_hr_admin / auth.uid(), so row policies stay simple
--     and never recurse.
--
-- Faithfulness / scope notes — DEFERRED to later work (see docs/hr4-notes.md):
--   TDS / income-tax slab engine, statutory PF/ESI filing & ECR exports, payslip
--   PDF rendering (app-side), bank disbursement file generation (external),
--   loan amortization schedules, multi-currency FX, proration on mid-month
--   join/exit beyond the LOP model, and arrears.
--
-- Re-runnable where practical (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS).
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables (in dependency order)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 hr_salary_structures — a versioned ANNUAL CTC record for an employee.
--     employee_id + org_id (DENORMALIZED) CASCADE. effective_from defaults to
--     today; multiple structures may coexist and the newest one whose
--     effective_from <= the period end drives that month's payslip ("one current
--     structure per employee — allow multiple by effective_from").
-- -----------------------------------------------------------------------------
create table if not exists public.hr_salary_structures (
    id             uuid                     default gen_random_uuid() not null,
    employee_id    uuid                                               not null,
    org_id         uuid                                               not null,
    effective_from date                     default current_date      not null,
    ctc            numeric                                            not null, -- ANNUAL cost-to-company
    currency       text                     default 'USD'             not null,
    created_at     timestamp with time zone default current_timestamp not null,
    constraint hr_salary_structures_pk primary key (id),
    constraint hr_salary_structures_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_salary_structures_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_salary_structures_ctc_check check (ctc >= 0),
    constraint hr_salary_structures_currency_check check (char_length(currency) <= 10)
);

-- -----------------------------------------------------------------------------
-- 1.2 hr_salary_components — the line items of a structure. structure_id + org_id
--     + employee_id (all DENORMALIZED for RLS) CASCADE. kind is earning/deduction.
--     calc selects how `value` is interpreted: 'fixed' = a monthly amount;
--     'percent_of_ctc' = value% of (ctc/12); 'percent_of_basic' = value% of the
--     resolved Basic. is_basic flags the anchor component. sort_order is a UI hint.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_salary_components (
    id           uuid    default gen_random_uuid() not null,
    structure_id uuid                              not null,
    org_id       uuid                              not null,
    employee_id  uuid                              not null,
    name         text                              not null,
    kind         text                              not null,
    calc         text    default 'fixed'           not null,
    value        numeric default 0                 not null, -- monthly fixed amount OR a percent
    is_basic     boolean default false             not null,
    sort_order   integer default 0                 not null,
    constraint hr_salary_components_pk primary key (id),
    constraint hr_salary_components_structure_id_fk
        foreign key (structure_id) references public.hr_salary_structures (id) on delete cascade,
    constraint hr_salary_components_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_salary_components_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_salary_components_name_check check (char_length(name) <= 200),
    constraint hr_salary_components_kind_check check (kind in ('earning', 'deduction')),
    constraint hr_salary_components_calc_check
        check (calc in ('fixed', 'percent_of_ctc', 'percent_of_basic'))
);

-- -----------------------------------------------------------------------------
-- 1.3 hr_payroll_runs — one run per (org, month, year). org CASCADE. status is the
--     draft -> finalized -> paid lifecycle. run_by is the triggering user (SET NULL
--     on user delete). The total_* / employee_count columns are rolled up by
--     run_payroll. UNIQUE(org_id, period_month, period_year) is the upsert key.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_payroll_runs (
    id                uuid                     default gen_random_uuid() not null,
    org_id            uuid                                               not null,
    period_month      integer                                           not null,
    period_year       integer                                           not null,
    status            text                     default 'draft'          not null,
    run_by            uuid,
    run_at            timestamp with time zone default now()            not null,
    total_gross       numeric                  default 0                not null,
    total_deductions  numeric                  default 0                not null,
    total_net         numeric                  default 0                not null,
    employee_count    integer                  default 0                not null,
    constraint hr_payroll_runs_pk primary key (id),
    constraint hr_payroll_runs_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_payroll_runs_run_by_fk
        foreign key (run_by) references public.users (id) on delete set null,
    constraint hr_payroll_runs_month_check check (period_month between 1 and 12),
    constraint hr_payroll_runs_status_check check (status in ('draft', 'finalized', 'paid')),
    constraint hr_payroll_runs_org_period_uindex unique (org_id, period_month, period_year)
);

-- -----------------------------------------------------------------------------
-- 1.4 hr_payslips — the per-employee output of a run. payroll_run_id + employee_id
--     + org_id (DENORMALIZED) CASCADE. gross / total_deductions / net are the money
--     totals; working_days / paid_days / lop_days the day counts. earnings /
--     deductions snapshot the line-item breakdown as jsonb ([{name, amount}]).
--     UNIQUE(payroll_run_id, employee_id). Written ONLY by run_payroll (no client
--     INSERT/UPDATE policy).
-- -----------------------------------------------------------------------------
create table if not exists public.hr_payslips (
    id               uuid                     default gen_random_uuid() not null,
    payroll_run_id   uuid                                               not null,
    employee_id      uuid                                               not null,
    org_id           uuid                                               not null,
    gross            numeric                  default 0                 not null,
    total_deductions numeric                  default 0                 not null,
    net              numeric                  default 0                 not null,
    working_days     numeric                  default 0                 not null,
    paid_days        numeric                  default 0                 not null,
    lop_days         numeric                  default 0                 not null,
    earnings         jsonb                    default '[]'::jsonb       not null, -- [{name, amount}]
    deductions       jsonb                    default '[]'::jsonb       not null, -- [{name, amount}]
    created_at       timestamp with time zone default current_timestamp not null,
    constraint hr_payslips_pk primary key (id),
    constraint hr_payslips_payroll_run_id_fk
        foreign key (payroll_run_id) references public.hr_payroll_runs (id) on delete cascade,
    constraint hr_payslips_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_payslips_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_payslips_run_employee_uindex unique (payroll_run_id, employee_id)
);

-- -----------------------------------------------------------------------------
-- 1.5 hr_reimbursements — an employee expense claim. employee_id + org_id
--     (DENORMALIZED) CASCADE. status is pending -> approved/rejected -> paid.
--     approver_id is the deciding user (SET NULL on user delete). Approved claims
--     dated in a payroll period are added to that month's payslip earnings.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_reimbursements (
    id           uuid                     default gen_random_uuid() not null,
    employee_id  uuid                                               not null,
    org_id       uuid                                               not null,
    category     text,
    amount       numeric                                            not null,
    date         date                     default current_date      not null,
    status       text                     default 'pending'         not null,
    receipt_path text,
    approver_id  uuid,
    decided_at   timestamp with time zone,
    created_at   timestamp with time zone default current_timestamp not null,
    constraint hr_reimbursements_pk primary key (id),
    constraint hr_reimbursements_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_reimbursements_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_reimbursements_approver_id_fk
        foreign key (approver_id) references public.users (id) on delete set null,
    constraint hr_reimbursements_amount_check check (amount >= 0),
    constraint hr_reimbursements_category_check check (char_length(category) <= 200),
    constraint hr_reimbursements_status_check
        check (status in ('pending', 'approved', 'rejected', 'paid'))
);

-- -----------------------------------------------------------------------------
-- 1.6 hr_loans_advances — a loan/advance for an employee. employee_id + org_id
--     (DENORMALIZED) CASCADE. emi is the monthly instalment; active loans' EMIs are
--     deducted from each payslip. balance tracks the remaining principal. status is
--     active/closed (no amortization schedule yet — see deferrals).
-- -----------------------------------------------------------------------------
create table if not exists public.hr_loans_advances (
    id          uuid                     default gen_random_uuid() not null,
    employee_id uuid                                               not null,
    org_id      uuid                                               not null,
    type        text                     default 'loan'            not null,
    principal   numeric                  default 0                 not null,
    emi         numeric                  default 0                 not null,
    balance     numeric                  default 0                 not null,
    status      text                     default 'active'          not null,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint hr_loans_advances_pk primary key (id),
    constraint hr_loans_advances_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_loans_advances_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_loans_advances_type_check check (char_length(type) <= 50),
    constraint hr_loans_advances_status_check check (status in ('active', 'closed'))
);

-- -----------------------------------------------------------------------------
-- 1.7 hr_bank_details — one disbursement account per employee. employee_id is
--     UNIQUE (one account per employee) + org_id (DENORMALIZED), both CASCADE.
--     Generic columns (ifsc is India-specific but optional / nullable elsewhere).
-- -----------------------------------------------------------------------------
create table if not exists public.hr_bank_details (
    id             uuid                     default gen_random_uuid() not null,
    employee_id    uuid                                               not null,
    org_id         uuid                                               not null,
    account_name   text,
    account_number text,
    ifsc           text,
    bank_name      text,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint hr_bank_details_pk primary key (id),
    constraint hr_bank_details_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_bank_details_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_bank_details_employee_uindex unique (employee_id)
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists hr_salary_structures_employee_id_index
    on public.hr_salary_structures (employee_id);
create index if not exists hr_salary_structures_org_id_index
    on public.hr_salary_structures (org_id);
create index if not exists hr_salary_structures_effective_from_index
    on public.hr_salary_structures (effective_from);

create index if not exists hr_salary_components_structure_id_index
    on public.hr_salary_components (structure_id);
create index if not exists hr_salary_components_org_id_index
    on public.hr_salary_components (org_id);
create index if not exists hr_salary_components_employee_id_index
    on public.hr_salary_components (employee_id);

create index if not exists hr_payroll_runs_org_id_index
    on public.hr_payroll_runs (org_id);
create index if not exists hr_payroll_runs_status_index
    on public.hr_payroll_runs (status);

create index if not exists hr_payslips_payroll_run_id_index
    on public.hr_payslips (payroll_run_id);
create index if not exists hr_payslips_employee_id_index
    on public.hr_payslips (employee_id);
create index if not exists hr_payslips_org_id_index
    on public.hr_payslips (org_id);

create index if not exists hr_reimbursements_employee_id_index
    on public.hr_reimbursements (employee_id);
create index if not exists hr_reimbursements_org_id_index
    on public.hr_reimbursements (org_id);
create index if not exists hr_reimbursements_status_index
    on public.hr_reimbursements (status);
create index if not exists hr_reimbursements_date_index
    on public.hr_reimbursements (date);

create index if not exists hr_loans_advances_employee_id_index
    on public.hr_loans_advances (employee_id);
create index if not exists hr_loans_advances_org_id_index
    on public.hr_loans_advances (org_id);
create index if not exists hr_loans_advances_status_index
    on public.hr_loans_advances (status);

create index if not exists hr_bank_details_org_id_index
    on public.hr_bank_details (org_id);


-- =============================================================================
-- SECTION 3: India salary preset (SECURITY DEFINER, HR-admin gated)
-- =============================================================================
-- apply_india_salary_preset: given a structure (with its annual ctc), inserts the
-- conventional Indian monthly component split:
--   earnings:  Basic            = 40% of CTC (is_basic; calc percent_of_ctc),
--              HRA              = 50% of Basic (calc percent_of_basic),
--              Special Allowance = the remainder so earnings ≈ monthly CTC
--                                  (calc fixed; = monthly_ctc - basic - hra).
--   deductions: Provident Fund   = 12% of Basic (calc percent_of_basic),
--               Professional Tax = 200 flat (calc fixed).
-- APPROXIMATE — a convenience seed, not a statutory engine (no PF wage ceiling,
-- no EPS split, no TDS). HR can edit the rows afterwards.
create or replace function public.apply_india_salary_preset(p_structure_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _org_id      uuid;
    _emp_id      uuid;
    _ctc         numeric;
    _monthly_ctc numeric;
    _basic       numeric;
    _hra         numeric;
    _special     numeric;
begin
    select org_id, employee_id, ctc
        into _org_id, _emp_id, _ctc
    from public.hr_salary_structures
    where id = p_structure_id;

    if _org_id is null then
        raise exception 'apply_india_salary_preset: structure % not found', p_structure_id;
    end if;

    if not public.is_hr_admin(_org_id) then
        raise exception 'apply_india_salary_preset: caller is not an HR admin of org %', _org_id;
    end if;

    _monthly_ctc := coalesce(_ctc, 0) / 12.0;
    _basic       := round(_monthly_ctc * 0.40, 2);          -- 40% of monthly CTC
    _hra         := round(_basic * 0.50, 2);                -- 50% of Basic
    _special     := round(_monthly_ctc - _basic - _hra, 2); -- remainder so earnings ≈ monthly CTC
    if _special < 0 then
        _special := 0;
    end if;

    insert into public.hr_salary_components
        (structure_id, org_id, employee_id, name, kind, calc, value, is_basic, sort_order)
    values
        (p_structure_id, _org_id, _emp_id, 'Basic',             'earning',   'percent_of_ctc',   40,       true,  1),
        (p_structure_id, _org_id, _emp_id, 'HRA',               'earning',   'percent_of_basic', 50,       false, 2),
        (p_structure_id, _org_id, _emp_id, 'Special Allowance', 'earning',   'fixed',            _special, false, 3),
        (p_structure_id, _org_id, _emp_id, 'Provident Fund',    'deduction', 'percent_of_basic', 12,       false, 4),
        (p_structure_id, _org_id, _emp_id, 'Professional Tax',  'deduction', 'fixed',            200,      false, 5);
end;
$$;


-- =============================================================================
-- SECTION 4: Payslip computation engine (SECURITY DEFINER)
-- =============================================================================
-- compute_payslip(employee_id, month, year) -> jsonb: the internal computation
-- helper. Resolves the employee's latest applicable salary structure, evaluates
-- every component into a monthly amount, applies loss-of-pay, loan EMIs and
-- approved reimbursements, and returns the full payslip object. Returns all-zeros
-- (with empty arrays) when the employee has no applicable structure. Pure read of
-- HR data; run_payroll persists the result into hr_payslips.
create or replace function public.compute_payslip(
    p_employee_id uuid,
    p_month       integer,
    p_year        integer
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _org_id        uuid;
    _structure_id  uuid;
    _ctc           numeric;
    _monthly_ctc   numeric;
    _basic_amount  numeric := 0;
    _month_start   date := make_date(p_year, p_month, 1);
    _month_end     date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
    _gross_base    numeric := 0;
    _ded_base      numeric := 0;
    _working_days  numeric := 0;
    _lop_days      numeric := 0;
    _paid_days     numeric := 0;
    _lop_deduction numeric := 0;
    _loan_emi      numeric := 0;
    _reimb         numeric := 0;
    _gross         numeric := 0;
    _total_ded     numeric := 0;
    _net           numeric := 0;
    _earnings      jsonb := '[]'::jsonb;
    _deductions    jsonb := '[]'::jsonb;
    _rec           record;
    _amount        numeric;
begin
    -- Resolve the employee's org from the directory row.
    select org_id into _org_id
    from public.hr_employees
    where id = p_employee_id;

    if _org_id is null then
        -- No such employee: return a zeroed payslip.
        return jsonb_build_object(
            'gross', 0, 'total_deductions', 0, 'net', 0,
            'working_days', 0, 'paid_days', 0, 'lop_days', 0,
            'earnings', '[]'::jsonb, 'deductions', '[]'::jsonb
        );
    end if;

    -- Latest structure effective on or before the period end (newest wins).
    select id, ctc into _structure_id, _ctc
    from public.hr_salary_structures
    where employee_id = p_employee_id
      and effective_from <= _month_end
    order by effective_from desc, created_at desc
    limit 1;

    if _structure_id is null then
        -- No applicable salary structure: zeroed payslip (the employee is skipped
        -- by run_payroll, but the helper stays total on its own).
        return jsonb_build_object(
            'gross', 0, 'total_deductions', 0, 'net', 0,
            'working_days', 0, 'paid_days', 0, 'lop_days', 0,
            'earnings', '[]'::jsonb, 'deductions', '[]'::jsonb
        );
    end if;

    _monthly_ctc := coalesce(_ctc, 0) / 12.0;

    -- Resolve Basic FIRST (anchors percent_of_basic): the is_basic component, else
    -- the first component named like 'basic'. fixed -> value; percent_of_ctc ->
    -- value/100 * monthly_ctc. (percent_of_basic on the basic row itself is unusual
    -- and treated as 0 to avoid self-reference.)
    select
        case c.calc
            when 'fixed'          then c.value
            when 'percent_of_ctc' then c.value / 100.0 * _monthly_ctc
            else 0
        end
        into _basic_amount
    from public.hr_salary_components c
    where c.structure_id = _structure_id
      and (c.is_basic = true or c.name ilike 'basic')
    order by c.is_basic desc, c.sort_order asc
    limit 1;

    _basic_amount := coalesce(_basic_amount, 0);

    -- Evaluate every component into a monthly amount; sum earnings / deductions and
    -- build the breakdown arrays.
    for _rec in
        select c.name, c.kind, c.calc, c.value
        from public.hr_salary_components c
        where c.structure_id = _structure_id
        order by c.sort_order asc, c.name asc
    loop
        _amount := case _rec.calc
            when 'fixed'            then _rec.value
            when 'percent_of_ctc'   then _rec.value / 100.0 * _monthly_ctc
            when 'percent_of_basic' then _rec.value / 100.0 * _basic_amount
            else 0
        end;
        _amount := round(coalesce(_amount, 0), 2);

        if _rec.kind = 'earning' then
            _gross_base := _gross_base + _amount;
            _earnings := _earnings || jsonb_build_object('name', _rec.name, 'amount', _amount);
        else
            _ded_base := _ded_base + _amount;
            _deductions := _deductions || jsonb_build_object('name', _rec.name, 'amount', _amount);
        end if;
    end loop;

    -- Day counts. working_days from the shared HR-3 helper (skips weekends + non-
    -- optional holidays). lop_days = 'absent' attendance rows in the month.
    _working_days := public.count_working_days(_org_id, _month_start, _month_end);

    select count(*)::numeric into _lop_days
    from public.hr_attendance a
    where a.employee_id = p_employee_id
      and a.date between _month_start and _month_end
      and a.status = 'absent';

    _lop_days  := coalesce(_lop_days, 0);
    _paid_days := _working_days - _lop_days;

    -- Loss of Pay: pro-rate gross_base over working days for each absent day.
    if _working_days > 0 and _lop_days > 0 then
        _lop_deduction := round(_gross_base / _working_days * _lop_days, 2);
    else
        _lop_deduction := 0;
    end if;
    if _lop_deduction > 0 then
        _deductions := _deductions || jsonb_build_object('name', 'Loss of Pay', 'amount', _lop_deduction);
    end if;

    -- Loan EMIs: sum of active loans' EMIs.
    select coalesce(sum(emi), 0) into _loan_emi
    from public.hr_loans_advances
    where employee_id = p_employee_id
      and status = 'active';
    _loan_emi := round(coalesce(_loan_emi, 0), 2);
    if _loan_emi > 0 then
        _deductions := _deductions || jsonb_build_object('name', 'Loan EMI', 'amount', _loan_emi);
    end if;

    -- Reimbursements: approved claims dated within the month -> extra earning.
    select coalesce(sum(amount), 0) into _reimb
    from public.hr_reimbursements
    where employee_id = p_employee_id
      and status = 'approved'
      and date between _month_start and _month_end;
    _reimb := round(coalesce(_reimb, 0), 2);
    if _reimb > 0 then
        _earnings := _earnings || jsonb_build_object('name', 'Reimbursements', 'amount', _reimb);
    end if;

    -- Totals.
    _gross     := round(_gross_base + _reimb, 2);
    _total_ded := round(_ded_base + _lop_deduction + _loan_emi, 2);
    _net       := round(_gross - _total_ded, 2);

    return jsonb_build_object(
        'gross', _gross,
        'total_deductions', _total_ded,
        'net', _net,
        'working_days', _working_days,
        'paid_days', _paid_days,
        'lop_days', _lop_days,
        'earnings', _earnings,
        'deductions', _deductions
    );
end;
$$;


-- =============================================================================
-- SECTION 5: Payroll orchestration (SECURITY DEFINER, HR-admin gated)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 5.1 run_payroll(org_id, month, year) -> uuid — HR-admin of p_org_id only. Upserts
--     the draft run row (stamping run_by/run_at), wipes any existing payslips for
--     that run, then for every ACTIVE employee in the org that has an applicable
--     salary structure: computes the payslip via compute_payslip and inserts a
--     hr_payslips row. Finally rolls up total_gross / total_deductions / total_net /
--     employee_count onto the run. Returns the run id. Idempotent — re-running for
--     the same period rebuilds the payslips and totals from scratch.
-- -----------------------------------------------------------------------------
create or replace function public.run_payroll(
    p_org_id uuid,
    p_month  integer,
    p_year   integer
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run_id uuid;
    _emp    record;
    _slip   jsonb;
begin
    if not public.is_hr_admin(p_org_id) then
        raise exception 'run_payroll: caller is not an HR admin of org %', p_org_id;
    end if;

    if p_month < 1 or p_month > 12 then
        raise exception 'run_payroll: period_month % out of range (1..12)', p_month;
    end if;

    -- Upsert the (draft) run for this period; refresh run_by/run_at on re-run.
    insert into public.hr_payroll_runs (org_id, period_month, period_year, status, run_by, run_at)
    values (p_org_id, p_month, p_year, 'draft', auth.uid(), now())
    on conflict (org_id, period_month, period_year)
        do update set status = 'draft', run_by = auth.uid(), run_at = now()
    returning id into _run_id;

    -- Clear prior payslips for this run (idempotent rebuild).
    delete from public.hr_payslips where payroll_run_id = _run_id;

    -- One payslip per active employee that has an applicable salary structure.
    for _emp in
        select e.id as employee_id
        from public.hr_employees e
        where e.org_id = p_org_id
          and e.status in ('active', 'probation', 'on_notice')
          and exists (
                select 1 from public.hr_salary_structures s
                where s.employee_id = e.id
                  and s.effective_from <= (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
          )
    loop
        _slip := public.compute_payslip(_emp.employee_id, p_month, p_year);

        insert into public.hr_payslips
            (payroll_run_id, employee_id, org_id, gross, total_deductions, net,
             working_days, paid_days, lop_days, earnings, deductions)
        values (
            _run_id,
            _emp.employee_id,
            p_org_id,
            (_slip ->> 'gross')::numeric,
            (_slip ->> 'total_deductions')::numeric,
            (_slip ->> 'net')::numeric,
            (_slip ->> 'working_days')::numeric,
            (_slip ->> 'paid_days')::numeric,
            (_slip ->> 'lop_days')::numeric,
            coalesce(_slip -> 'earnings', '[]'::jsonb),
            coalesce(_slip -> 'deductions', '[]'::jsonb)
        );
    end loop;

    -- Roll up the run totals from the freshly inserted payslips.
    update public.hr_payroll_runs r
        set total_gross      = coalesce(t.sum_gross, 0),
            total_deductions = coalesce(t.sum_ded, 0),
            total_net        = coalesce(t.sum_net, 0),
            employee_count   = coalesce(t.cnt, 0)
    from (
        select sum(gross) as sum_gross,
               sum(total_deductions) as sum_ded,
               sum(net) as sum_net,
               count(*) as cnt
        from public.hr_payslips
        where payroll_run_id = _run_id
    ) t
    where r.id = _run_id;

    return _run_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.2 finalize_payroll_run(run_id) -> void — HR-admin of the run's org. Flips the
--     run status to 'finalized' (a lightweight lock signalling "approved for
--     payment"). 'paid' is a separate, later transition. No-op-with-error if the
--     run does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.finalize_payroll_run(p_run_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _org_id uuid;
begin
    select org_id into _org_id
    from public.hr_payroll_runs
    where id = p_run_id;

    if _org_id is null then
        raise exception 'finalize_payroll_run: run % not found', p_run_id;
    end if;

    if not public.is_hr_admin(_org_id) then
        raise exception 'finalize_payroll_run: caller is not an HR admin of org %', _org_id;
    end if;

    update public.hr_payroll_runs
        set status = 'finalized'
        where id = p_run_id;
end;
$$;


-- =============================================================================
-- SECTION 6: Enable Row Level Security + policies
-- =============================================================================
alter table public.hr_salary_structures enable row level security;
alter table public.hr_salary_components enable row level security;
alter table public.hr_payroll_runs      enable row level security;
alter table public.hr_payslips          enable row level security;
alter table public.hr_reimbursements    enable row level security;
alter table public.hr_loans_advances    enable row level security;
alter table public.hr_bank_details      enable row level security;

-- Convention (matches Phases 1-9 / HR-1 / HR-2 / HR-3): drop-then-create so
-- re-runnable; policies target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 6.1 hr_salary_structures — SELECT: can_view_employee (self / manager / HR admin).
--     INSERT/UPDATE/DELETE: HR admin. WITH CHECK mirrors USING.
-- -------------------------------------------------------------------
drop policy if exists hr_salary_structures_select on public.hr_salary_structures;
create policy hr_salary_structures_select on public.hr_salary_structures
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_salary_structures_insert on public.hr_salary_structures;
create policy hr_salary_structures_insert on public.hr_salary_structures
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_salary_structures_update on public.hr_salary_structures;
create policy hr_salary_structures_update on public.hr_salary_structures
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_salary_structures_delete on public.hr_salary_structures;
create policy hr_salary_structures_delete on public.hr_salary_structures
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.2 hr_salary_components — SELECT: can_view_employee. INSERT/UPDATE/DELETE: HR
--     admin. (The India preset RPC inserts these as the definer, bypassing RLS.)
-- -------------------------------------------------------------------
drop policy if exists hr_salary_components_select on public.hr_salary_components;
create policy hr_salary_components_select on public.hr_salary_components
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_salary_components_insert on public.hr_salary_components;
create policy hr_salary_components_insert on public.hr_salary_components
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_salary_components_update on public.hr_salary_components;
create policy hr_salary_components_update on public.hr_salary_components
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_salary_components_delete on public.hr_salary_components;
create policy hr_salary_components_delete on public.hr_salary_components
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.3 hr_payroll_runs — SELECT/INSERT/UPDATE/DELETE: HR admin (payroll is an
--     admin-only surface; runs are normally created by run_payroll).
-- -------------------------------------------------------------------
drop policy if exists hr_payroll_runs_select on public.hr_payroll_runs;
create policy hr_payroll_runs_select on public.hr_payroll_runs
    for select to authenticated
    using (public.is_hr_admin(org_id));

drop policy if exists hr_payroll_runs_insert on public.hr_payroll_runs;
create policy hr_payroll_runs_insert on public.hr_payroll_runs
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_payroll_runs_update on public.hr_payroll_runs;
create policy hr_payroll_runs_update on public.hr_payroll_runs
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_payroll_runs_delete on public.hr_payroll_runs;
create policy hr_payroll_runs_delete on public.hr_payroll_runs
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.4 hr_payslips — SELECT: can_view_employee (self / manager / HR admin). No
--     client INSERT/UPDATE (payslips are produced ONLY by run_payroll, which runs
--     as the definer). DELETE: HR admin.
-- -------------------------------------------------------------------
drop policy if exists hr_payslips_select on public.hr_payslips;
create policy hr_payslips_select on public.hr_payslips
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_payslips_delete on public.hr_payslips;
create policy hr_payslips_delete on public.hr_payslips
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.5 hr_reimbursements — SELECT: can_view_employee. INSERT: the employee
--     themselves (own claims). UPDATE: can_manage_employee (manager/HR-admin
--     decides). DELETE: HR admin. WITH CHECK mirrors so a writer cannot re-point
--     employee_id out from under RLS.
-- -------------------------------------------------------------------
drop policy if exists hr_reimbursements_select on public.hr_reimbursements;
create policy hr_reimbursements_select on public.hr_reimbursements
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_reimbursements_insert on public.hr_reimbursements;
create policy hr_reimbursements_insert on public.hr_reimbursements
    for insert to authenticated
    with check (
        exists (
            select 1 from public.hr_employees e
            where e.id = hr_reimbursements.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_reimbursements_update on public.hr_reimbursements;
create policy hr_reimbursements_update on public.hr_reimbursements
    for update to authenticated
    using (public.can_manage_employee(employee_id))
    with check (public.can_manage_employee(employee_id));

drop policy if exists hr_reimbursements_delete on public.hr_reimbursements;
create policy hr_reimbursements_delete on public.hr_reimbursements
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.6 hr_loans_advances — SELECT: can_view_employee. INSERT/UPDATE/DELETE: HR
--     admin (loans are an admin-managed ledger).
-- -------------------------------------------------------------------
drop policy if exists hr_loans_advances_select on public.hr_loans_advances;
create policy hr_loans_advances_select on public.hr_loans_advances
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_loans_advances_insert on public.hr_loans_advances;
create policy hr_loans_advances_insert on public.hr_loans_advances
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_loans_advances_update on public.hr_loans_advances;
create policy hr_loans_advances_update on public.hr_loans_advances
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_loans_advances_delete on public.hr_loans_advances;
create policy hr_loans_advances_delete on public.hr_loans_advances
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.7 hr_bank_details — SELECT: can_view_employee. INSERT/UPDATE: HR admin OR the
--     employee themselves (self-service upsert of own account). DELETE: HR admin.
--     WITH CHECK mirrors the INSERT/UPDATE predicate.
-- -------------------------------------------------------------------
drop policy if exists hr_bank_details_select on public.hr_bank_details;
create policy hr_bank_details_select on public.hr_bank_details
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_bank_details_insert on public.hr_bank_details;
create policy hr_bank_details_insert on public.hr_bank_details
    for insert to authenticated
    with check (
        public.is_hr_admin(org_id)
        or exists (
            select 1 from public.hr_employees e
            where e.id = hr_bank_details.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_bank_details_update on public.hr_bank_details;
create policy hr_bank_details_update on public.hr_bank_details
    for update to authenticated
    using (
        public.is_hr_admin(org_id)
        or exists (
            select 1 from public.hr_employees e
            where e.id = hr_bank_details.employee_id
              and e.user_id = auth.uid()
        )
    )
    with check (
        public.is_hr_admin(org_id)
        or exists (
            select 1 from public.hr_employees e
            where e.id = hr_bank_details.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_bank_details_delete on public.hr_bank_details;
create policy hr_bank_details_delete on public.hr_bank_details
    for delete to authenticated
    using (public.is_hr_admin(org_id));


-- =============================================================================
-- SECTION 7: Function execute grants + table privileges
-- =============================================================================
grant execute on function public.apply_india_salary_preset(uuid)        to authenticated;
grant execute on function public.compute_payslip(uuid, integer, integer) to authenticated;
grant execute on function public.run_payroll(uuid, integer, integer)     to authenticated;
grant execute on function public.finalize_payroll_run(uuid)             to authenticated;

-- RLS (Section 6) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.hr_salary_structures to authenticated;
grant select, insert, update, delete on public.hr_salary_components to authenticated;
grant select, insert, update, delete on public.hr_payroll_runs      to authenticated;
grant select, insert, update, delete on public.hr_payslips          to authenticated;
grant select, insert, update, delete on public.hr_reimbursements    to authenticated;
grant select, insert, update, delete on public.hr_loans_advances    to authenticated;
grant select, insert, update, delete on public.hr_bank_details      to authenticated;

grant all on public.hr_salary_structures to service_role;
grant all on public.hr_salary_components to service_role;
grant all on public.hr_payroll_runs      to service_role;
grant all on public.hr_payslips          to service_role;
grant all on public.hr_reimbursements    to service_role;
grant all on public.hr_loans_advances    to service_role;
grant all on public.hr_bank_details      to service_role;

-- =============================================================================
-- END HR-4
-- =============================================================================
