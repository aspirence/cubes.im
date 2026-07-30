-- =============================================================================
-- Cubes Greenfield Rebuild — HR-3: Leave Management (leave types / balances /
--   requests) + apply/decide/cancel RPCs + working-day & accrual helpers
-- =============================================================================
-- The third slice of the Keka-inspired HR module. Builds on HR-1
-- (20261001000000_hr1_core.sql) and HR-2 (20261002000000_hr2_attendance.sql):
-- reuses is_org_member(org_id) [Phase 1], is_hr_admin(org_id),
-- current_employee_id(org_id) [HR-1], can_view_employee(_employee_id) and
-- can_manage_employee(_employee_id) [HR-2], and the hr_employees / hr_holidays /
-- hr_attendance tables.
--
-- Adds (all org-scoped, snake_case, `hr_` prefix; org_id DENORMALIZED onto every
-- employee-scoped row so RLS can call is_hr_admin(org_id)/can_view_employee(...)
-- WITHOUT recursing back through hr_employees):
--   * hr_leave_types     — a named, codified leave type per org (paid?, annual
--     quota, accrual cadence, carry-forward policy, display color).
--     UNIQUE(org_id, code).
--   * hr_leave_balances  — per (employee, leave type, year): allotted / used /
--     pending / carried_forward. The single source of truth for "how much leave
--     is left". UNIQUE(employee_id, leave_type_id, year). Mutated almost entirely
--     by the SECURITY DEFINER RPCs below (apply/decide/cancel/accrue).
--   * hr_leave_requests  — an employee's leave application: date range, computed
--     working days, status (pending/approved/rejected/cancelled), approver/note.
--     CHECK to_date >= from_date.
--
-- Reusable helper added here (used by HR-4 payroll's loss-of-pay calc too):
--   * count_working_days(org, from, to) — inclusive working-day count that skips
--     Sat/Sun AND any non-optional hr_holidays for the org in the range.
--
-- RPCs (SECURITY DEFINER, search_path = public, extensions):
--   * apply_leave(type, from, to, reason) -> uuid — the caller applies for leave;
--     auto-provisions this year's balance row (allotted = the type's annual_quota
--     if it had to be created), verifies remaining balance, inserts a PENDING
--     request and reserves the days against balance.pending.
--   * decide_leave(request_id, approve, note) -> void — a manager/HR-admin of the
--     request's employee approves/rejects. Approve: pending -> used, status
--     'approved', and writes 'leave' hr_attendance rows for each working day.
--     Reject: releases the reserved pending. Stamps approver/decided_at.
--   * cancel_leave(request_id) -> void — the request's own employee cancels their
--     PENDING request; releases the reserved pending.
--   * accrue_monthly_leave() -> integer — the pg_cron entry point. For every still-
--     employed employee and every monthly-accrual leave type in their org, credits
--     (annual_quota / 12) to this year's balance.allotted (provisioning the row if
--     absent). Returns the number of balance rows touched.
--
-- Supabase adaptations carried over from Phases 1-9 / HR-1 / HR-2:
--   * gen_random_uuid() / citext live in the `extensions` schema. UUID PKs use a
--     column DEFAULT (gen_random_uuid()); helper/RPC bodies pin
--     `set search_path = public, extensions` (they generate UUIDs / call helpers).
--   * Every new table: enable RLS + add policies AND grant table privileges to
--     `authenticated` (else queries fail with permission-denied BEFORE RLS runs).
--   * The SECURITY DEFINER RPCs read/write balances & requests directly (RLS
--     bypassed) but gate explicitly on auth.uid() / can_manage_employee, so the
--     row policies stay simple and never recurse.
--   * pg_cron scheduling for accrue_monthly_leave is GUARDED (DO/EXCEPTION block,
--     mirrors Phase 7) so a missing pg_cron extension never aborts the migration.
--
-- Faithfulness / scope notes:
--   * Balances are the canonical ledger; requests reserve/consume against them.
--     remaining = allotted + carried_forward - used - pending.
--   * Working days exclude weekends + non-optional holidays (optional/"floating"
--     holidays still count as working days, matching HR-2's hr_holidays.optional).
--   * DEFERRED to later work: half-day leave, comp-off / time-off-in-lieu, leave
--     encashment, a negative-balance (LOP) policy, and the year-end carry-forward
--     job (max_carry_forward is stored but not yet applied). See docs/hr3-notes.md.
--
-- Re-runnable where practical (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS).
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables (in dependency order)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 hr_leave_types — a named, codified leave type for an org (org CASCADE).
--     code is the org-unique short key (e.g. 'AL','SL'). paid distinguishes paid
--     vs unpaid leave. annual_quota is the yearly entitlement. accrual is the
--     credit cadence ('annual' = full quota up front; 'monthly' = quota/12 each
--     month via accrue_monthly_leave). carry_forward + max_carry_forward describe
--     the (deferred) year-end roll-over policy. color is a UI display hint.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_leave_types (
    id                uuid                     default gen_random_uuid() not null,
    org_id            uuid                                               not null,
    name              text                                               not null,
    code              text                                               not null,
    paid              boolean                  default true              not null,
    annual_quota      numeric                  default 0                 not null,
    accrual           text                     default 'annual'          not null,
    carry_forward     boolean                  default false             not null,
    max_carry_forward numeric                  default 0                 not null,
    color             text,
    created_at        timestamp with time zone default current_timestamp not null,
    constraint hr_leave_types_pk primary key (id),
    constraint hr_leave_types_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_leave_types_name_check check (char_length(name) <= 200),
    constraint hr_leave_types_code_check check (char_length(code) <= 50),
    constraint hr_leave_types_accrual_check check (accrual in ('annual', 'monthly')),
    constraint hr_leave_types_org_code_uindex unique (org_id, code)
);

-- -----------------------------------------------------------------------------
-- 1.2 hr_leave_balances — the per-(employee, type, year) ledger. employee_id +
--     org_id (DENORMALIZED) + leave_type_id all CASCADE. remaining is derived:
--     allotted + carried_forward - used - pending. UNIQUE(employee, type, year)
--     is the upsert key used by the RPCs. Rows are normally created/mutated by the
--     SECURITY DEFINER RPCs; HR admins may also adjust them directly via RLS.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_leave_balances (
    id              uuid                     default gen_random_uuid() not null,
    employee_id     uuid                                               not null,
    org_id          uuid                                               not null,
    leave_type_id   uuid                                               not null,
    year            integer                                            not null,
    allotted        numeric                  default 0                 not null,
    used            numeric                  default 0                 not null,
    pending         numeric                  default 0                 not null,
    carried_forward numeric                  default 0                 not null,
    constraint hr_leave_balances_pk primary key (id),
    constraint hr_leave_balances_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_leave_balances_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_leave_balances_leave_type_id_fk
        foreign key (leave_type_id) references public.hr_leave_types (id) on delete cascade,
    constraint hr_leave_balances_employee_type_year_uindex unique (employee_id, leave_type_id, year)
);

-- -----------------------------------------------------------------------------
-- 1.3 hr_leave_requests — an employee's leave application. employee_id + org_id
--     (DENORMALIZED) + leave_type_id CASCADE. days is the computed working-day
--     count for [from_date, to_date]. status is the lifecycle enum. approver_id is
--     the deciding user (SET NULL on user delete). CHECK to_date >= from_date.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_leave_requests (
    id            uuid                     default gen_random_uuid() not null,
    employee_id   uuid                                               not null,
    org_id        uuid                                               not null,
    leave_type_id uuid                                               not null,
    from_date     date                                               not null,
    to_date       date                                               not null,
    days          numeric                                            not null,
    reason        text,
    status        text                     default 'pending'         not null,
    approver_id   uuid,
    decided_at    timestamp with time zone,
    note          text,
    created_at    timestamp with time zone default current_timestamp not null,
    constraint hr_leave_requests_pk primary key (id),
    constraint hr_leave_requests_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_leave_requests_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_leave_requests_leave_type_id_fk
        foreign key (leave_type_id) references public.hr_leave_types (id) on delete cascade,
    constraint hr_leave_requests_approver_id_fk
        foreign key (approver_id) references public.users (id) on delete set null,
    constraint hr_leave_requests_status_check
        check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    constraint hr_leave_requests_date_order_check check (to_date >= from_date)
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists hr_leave_types_org_id_index
    on public.hr_leave_types (org_id);

create index if not exists hr_leave_balances_employee_id_index
    on public.hr_leave_balances (employee_id);
create index if not exists hr_leave_balances_org_id_index
    on public.hr_leave_balances (org_id);
create index if not exists hr_leave_balances_leave_type_id_index
    on public.hr_leave_balances (leave_type_id);
create index if not exists hr_leave_balances_year_index
    on public.hr_leave_balances (year);

create index if not exists hr_leave_requests_employee_id_index
    on public.hr_leave_requests (employee_id);
create index if not exists hr_leave_requests_org_id_index
    on public.hr_leave_requests (org_id);
create index if not exists hr_leave_requests_leave_type_id_index
    on public.hr_leave_requests (leave_type_id);
create index if not exists hr_leave_requests_status_index
    on public.hr_leave_requests (status);


-- =============================================================================
-- SECTION 3: Working-day helper (SECURITY DEFINER)
-- =============================================================================
-- count_working_days: inclusive count of dates in [p_from, p_to] that are NEITHER
-- Saturday/Sunday NOR a non-optional holiday in the org's hr_holidays. STABLE,
-- pure read; SECURITY DEFINER so the leave RPCs/policies can call it without the
-- caller needing direct read access to hr_holidays. Returns 0 for an empty/reversed
-- range. Reused by HR-4 payroll for loss-of-pay day counting.
create or replace function public.count_working_days(
    p_org_id uuid,
    p_from   date,
    p_to     date
)
    returns numeric
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select count(*)::numeric
    from generate_series(p_from, p_to, interval '1 day') as d(day)
    where extract(isodow from d.day) < 6  -- 1=Mon .. 5=Fri (excludes 6=Sat, 7=Sun)
      and not exists (
            select 1
            from public.hr_holidays h
            where h.org_id = p_org_id
              and h.date = d.day::date
              and h.optional = false
      );
$$;


-- =============================================================================
-- SECTION 4: Leave RPCs (SECURITY DEFINER)
-- =============================================================================
-- All run as the definer (RLS bypassed) but gate explicitly on auth.uid() /
-- can_manage_employee. They generate UUIDs and call helpers so they pin
-- search_path = public, extensions.

-- -----------------------------------------------------------------------------
-- 4.1 apply_leave(type, from, to, reason) -> uuid — the caller applies for leave
--     against p_leave_type_id. Resolves the caller's hr_employees row in the SAME
--     org that owns the leave type (so the right tenant is used). Computes working
--     days via count_working_days; rejects zero-day ranges. Ensures this year's
--     balance row exists (creating it with allotted = the type's annual_quota when
--     absent), checks remaining (allotted + carried_forward - used - pending) >=
--     days, inserts a PENDING request and reserves the days against pending.
-- -----------------------------------------------------------------------------
create or replace function public.apply_leave(
    p_leave_type_id uuid,
    p_from          date,
    p_to            date,
    p_reason        text default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id   uuid := auth.uid();
    _type_org  uuid;
    _quota     numeric;
    _emp_id    uuid;
    _year      integer := extract(year from p_from)::integer;
    _days      numeric;
    _remaining numeric;
    _req_id    uuid;
begin
    if _user_id is null then
        raise exception 'apply_leave: no authenticated user';
    end if;

    if p_to < p_from then
        raise exception 'apply_leave: to_date (%) is before from_date (%)', p_to, p_from;
    end if;

    -- The leave type pins the org/tenant for this request.
    select org_id, annual_quota into _type_org, _quota
    from public.hr_leave_types
    where id = p_leave_type_id;

    if _type_org is null then
        raise exception 'apply_leave: leave type % not found', p_leave_type_id;
    end if;

    -- Resolve the caller's employee row in that same org.
    select id into _emp_id
    from public.hr_employees
    where user_id = _user_id
      and org_id = _type_org
    limit 1;

    if _emp_id is null then
        raise exception 'apply_leave: no employee record for the current user in this organization';
    end if;

    _days := public.count_working_days(_type_org, p_from, p_to);
    if _days is null or _days <= 0 then
        raise exception 'apply_leave: the requested range has no working days';
    end if;

    -- Ensure this year's balance row exists; seed allotted from the type's quota.
    insert into public.hr_leave_balances (employee_id, org_id, leave_type_id, year, allotted)
    values (_emp_id, _type_org, p_leave_type_id, _year, _quota)
    on conflict (employee_id, leave_type_id, year) do nothing;

    -- Lock the balance row, then check remaining headroom.
    select (allotted + carried_forward - used - pending) into _remaining
    from public.hr_leave_balances
    where employee_id = _emp_id and leave_type_id = p_leave_type_id and year = _year
    for update;

    if _remaining < _days then
        raise exception 'apply_leave: insufficient balance (remaining %, requested %)', _remaining, _days;
    end if;

    insert into public.hr_leave_requests
        (employee_id, org_id, leave_type_id, from_date, to_date, days, reason, status)
    values (_emp_id, _type_org, p_leave_type_id, p_from, p_to, _days, p_reason, 'pending')
    returning id into _req_id;

    -- Reserve the days.
    update public.hr_leave_balances
        set pending = pending + _days
        where employee_id = _emp_id and leave_type_id = p_leave_type_id and year = _year;

    return _req_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4.2 decide_leave(request_id, approve, note) -> void — a manager/HR-admin of the
--     request's employee (can_manage_employee) approves or rejects a PENDING
--     request. Approve: pending -= days, used += days, status 'approved', and a
--     'leave' hr_attendance row (source 'system') is upserted for every working
--     day in [from,to]. Reject: pending -= days, status 'rejected'. Both stamp
--     approver_id=auth.uid() and decided_at=now(); the note is recorded. No-op
--     beyond a friendly error if the request is not pending.
-- -----------------------------------------------------------------------------
create or replace function public.decide_leave(
    p_request_id uuid,
    p_approve    boolean,
    p_note       text default null
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id  uuid := auth.uid();
    _emp_id   uuid;
    _org_id   uuid;
    _type_id  uuid;
    _from     date;
    _to       date;
    _days     numeric;
    _status   text;
    _year     integer;
    _d        date;
begin
    if _user_id is null then
        raise exception 'decide_leave: no authenticated user';
    end if;

    select employee_id, org_id, leave_type_id, from_date, to_date, days, status
        into _emp_id, _org_id, _type_id, _from, _to, _days, _status
    from public.hr_leave_requests
    where id = p_request_id
    for update;

    if _emp_id is null then
        raise exception 'decide_leave: leave request % not found', p_request_id;
    end if;

    if not public.can_manage_employee(_emp_id) then
        raise exception 'decide_leave: caller cannot manage employee %', _emp_id;
    end if;

    if _status is distinct from 'pending' then
        raise exception 'decide_leave: request % is not pending (status %)', p_request_id, _status;
    end if;

    _year := extract(year from _from)::integer;

    if p_approve then
        update public.hr_leave_requests
            set status      = 'approved',
                approver_id = _user_id,
                decided_at  = now(),
                note        = p_note
            where id = p_request_id;

        update public.hr_leave_balances
            set pending = pending - _days,
                used    = used + _days
            where employee_id = _emp_id and leave_type_id = _type_id and year = _year;

        -- Mark each working day in the range as 'leave' attendance (system-sourced).
        for _d in
            select d.day::date
            from generate_series(_from, _to, interval '1 day') as d(day)
            where extract(isodow from d.day) < 6
              and not exists (
                    select 1 from public.hr_holidays h
                    where h.org_id = _org_id and h.date = d.day::date and h.optional = false
              )
        loop
            insert into public.hr_attendance (employee_id, org_id, date, status, source)
            values (_emp_id, _org_id, _d, 'leave', 'system')
            on conflict (employee_id, date)
                do update set status = 'leave', source = 'system';
        end loop;
    else
        update public.hr_leave_requests
            set status      = 'rejected',
                approver_id = _user_id,
                decided_at  = now(),
                note        = p_note
            where id = p_request_id;

        update public.hr_leave_balances
            set pending = pending - _days
            where employee_id = _emp_id and leave_type_id = _type_id and year = _year;
    end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4.3 cancel_leave(request_id) -> void — the request's OWN employee (linked to
--     auth.uid()) cancels their PENDING request: status 'cancelled' and the
--     reserved pending days are released. Raises if the caller is not the owner or
--     the request is not pending.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_leave(p_request_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id uuid := auth.uid();
    _emp_id  uuid;
    _type_id uuid;
    _from    date;
    _days    numeric;
    _status  text;
    _owner   uuid;
    _year    integer;
begin
    if _user_id is null then
        raise exception 'cancel_leave: no authenticated user';
    end if;

    select r.employee_id, r.leave_type_id, r.from_date, r.days, r.status, e.user_id
        into _emp_id, _type_id, _from, _days, _status, _owner
    from public.hr_leave_requests r
    join public.hr_employees e on e.id = r.employee_id
    where r.id = p_request_id
    for update of r;

    if _emp_id is null then
        raise exception 'cancel_leave: leave request % not found', p_request_id;
    end if;

    if _owner is distinct from _user_id then
        raise exception 'cancel_leave: only the requesting employee may cancel this request';
    end if;

    if _status is distinct from 'pending' then
        raise exception 'cancel_leave: request % is not pending (status %)', p_request_id, _status;
    end if;

    _year := extract(year from _from)::integer;

    update public.hr_leave_requests
        set status = 'cancelled'
        where id = p_request_id;

    update public.hr_leave_balances
        set pending = pending - _days
        where employee_id = _emp_id and leave_type_id = _type_id and year = _year;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4.4 accrue_monthly_leave() -> integer — the pg_cron entry point (runs as the
--     table owner, no auth.uid()). For every still-employed employee and every
--     MONTHLY-accrual leave type in that employee's org, credits (annual_quota/12)
--     to this calendar year's balance.allotted, provisioning the balance row if it
--     does not yet exist. Returns the number of balance rows touched. Idempotency
--     is intentionally NOT enforced here (one run per month is assumed); the
--     scheduled job (Section 7) runs on the 1st of each month.
-- -----------------------------------------------------------------------------
create or replace function public.accrue_monthly_leave()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _year    integer := extract(year from current_date)::integer;
    _count   integer := 0;
    _rec     record;
begin
    for _rec in
        select e.id as employee_id, e.org_id, lt.id as leave_type_id,
               (lt.annual_quota / 12.0) as monthly_amount
        from public.hr_employees e
        join public.hr_leave_types lt
          on lt.org_id = e.org_id
         and lt.accrual = 'monthly'
        where e.status in ('active', 'probation', 'on_notice')
    loop
        insert into public.hr_leave_balances (employee_id, org_id, leave_type_id, year, allotted)
        values (_rec.employee_id, _rec.org_id, _rec.leave_type_id, _year, _rec.monthly_amount)
        on conflict (employee_id, leave_type_id, year)
            do update set allotted = public.hr_leave_balances.allotted + _rec.monthly_amount;

        _count := _count + 1;
    end loop;

    return _count;
end;
$$;


-- =============================================================================
-- SECTION 5: Enable Row Level Security + policies
-- =============================================================================
alter table public.hr_leave_types    enable row level security;
alter table public.hr_leave_balances enable row level security;
alter table public.hr_leave_requests enable row level security;

-- Convention (matches Phases 1-9 / HR-1 / HR-2): drop-then-create so re-runnable;
-- policies target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 5.1 hr_leave_types — SELECT: any org member. INSERT/UPDATE/DELETE: HR admin.
-- -------------------------------------------------------------------
drop policy if exists hr_leave_types_select on public.hr_leave_types;
create policy hr_leave_types_select on public.hr_leave_types
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists hr_leave_types_insert on public.hr_leave_types;
create policy hr_leave_types_insert on public.hr_leave_types
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_leave_types_update on public.hr_leave_types;
create policy hr_leave_types_update on public.hr_leave_types
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_leave_types_delete on public.hr_leave_types;
create policy hr_leave_types_delete on public.hr_leave_types
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 5.2 hr_leave_balances — SELECT: can_view_employee (self / manager / HR admin).
--     INSERT/UPDATE/DELETE: HR admin (balances are otherwise mutated by the
--     SECURITY DEFINER RPCs, which bypass RLS). WITH CHECK mirrors USING.
-- -------------------------------------------------------------------
drop policy if exists hr_leave_balances_select on public.hr_leave_balances;
create policy hr_leave_balances_select on public.hr_leave_balances
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_leave_balances_insert on public.hr_leave_balances;
create policy hr_leave_balances_insert on public.hr_leave_balances
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_leave_balances_update on public.hr_leave_balances;
create policy hr_leave_balances_update on public.hr_leave_balances
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_leave_balances_delete on public.hr_leave_balances;
create policy hr_leave_balances_delete on public.hr_leave_balances
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 5.3 hr_leave_requests — SELECT: can_view_employee (self / manager / HR admin).
--     INSERT: the employee themselves (own requests; normally via apply_leave).
--     UPDATE: a manager/HR-admin (can_manage_employee, the decide leg) OR the
--     employee themselves (the self-cancel leg). DELETE: HR admin (requests are
--     otherwise an audit trail; they also cascade with the employee). WITH CHECK
--     mirrors so a writer cannot re-point employee_id/org_id out from under RLS.
-- -------------------------------------------------------------------
drop policy if exists hr_leave_requests_select on public.hr_leave_requests;
create policy hr_leave_requests_select on public.hr_leave_requests
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_leave_requests_insert on public.hr_leave_requests;
create policy hr_leave_requests_insert on public.hr_leave_requests
    for insert to authenticated
    with check (
        exists (
            select 1 from public.hr_employees e
            where e.id = hr_leave_requests.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_leave_requests_update on public.hr_leave_requests;
create policy hr_leave_requests_update on public.hr_leave_requests
    for update to authenticated
    using (
        public.can_manage_employee(employee_id)
        or exists (
            select 1 from public.hr_employees e
            where e.id = hr_leave_requests.employee_id
              and e.user_id = auth.uid()
        )
    )
    with check (
        public.can_manage_employee(employee_id)
        or exists (
            select 1 from public.hr_employees e
            where e.id = hr_leave_requests.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_leave_requests_delete on public.hr_leave_requests;
create policy hr_leave_requests_delete on public.hr_leave_requests
    for delete to authenticated
    using (public.is_hr_admin(org_id));


-- =============================================================================
-- SECTION 6: Function execute grants + table privileges
-- =============================================================================
grant execute on function public.count_working_days(uuid, date, date)   to authenticated;
grant execute on function public.apply_leave(uuid, date, date, text)    to authenticated;
grant execute on function public.decide_leave(uuid, boolean, text)      to authenticated;
grant execute on function public.cancel_leave(uuid)                     to authenticated;
grant execute on function public.accrue_monthly_leave()                 to authenticated;

-- RLS (Section 5) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.hr_leave_types    to authenticated;
grant select, insert, update, delete on public.hr_leave_balances to authenticated;
grant select, insert, update, delete on public.hr_leave_requests to authenticated;

grant all on public.hr_leave_types    to service_role;
grant all on public.hr_leave_balances to service_role;
grant all on public.hr_leave_requests to service_role;


-- =============================================================================
-- SECTION 7: pg_cron scheduling (guarded — never fails the migration)
-- =============================================================================
-- We try to (a) create the pg_cron extension, (b) schedule accrue_monthly_leave on
-- the 1st of each month (00:00), guarding against a duplicate job. If pg_cron is
-- unavailable (or cron.* objects are missing), we swallow the error with a NOTICE
-- so a missing extension does not abort the whole migration. The job can be
-- (re)created later by re-running this DO block once pg_cron is installed.
do $$
begin
    create extension if not exists pg_cron;

    -- Only schedule if there is no existing job by this name.
    if not exists (select 1 from cron.job where jobname = 'accrue-monthly-leave') then
        perform cron.schedule(
            'accrue-monthly-leave',
            '0 0 1 * *',
            $cron$ select public.accrue_monthly_leave(); $cron$
        );
        raise notice 'HR-3: scheduled pg_cron job "accrue-monthly-leave" (monthly, 1st @ 00:00).';
    else
        raise notice 'HR-3: pg_cron job "accrue-monthly-leave" already exists; left as is.';
    end if;
exception
    when others then
        raise notice 'HR-3: pg_cron setup skipped (% — %). Run accrue_monthly_leave() manually or schedule it once pg_cron is available.',
            sqlstate, sqlerrm;
end
$$;

-- =============================================================================
-- END HR-3
-- =============================================================================
