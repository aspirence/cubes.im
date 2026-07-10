-- =============================================================================
-- Cubes Greenfield Rebuild — HR-5: Analytics + Onboarding/Offboarding
-- =============================================================================
-- The fifth and final slice of the Keka-inspired HR module. Builds on Phase 1
-- (identity/tenancy + is_org_member), HR-1 (hr_employees / hr_departments +
-- is_hr_admin / current_employee_id), HR-2 (can_view_employee /
-- can_manage_employee + hr_attendance), HR-3 (hr_leave_requests +
-- count_working_days) and HR-4 (hr_payroll_runs). Nothing here re-creates an
-- existing object — it REUSES the established helpers and tables.
--
-- Adds:
--   * hr_onboarding_tasks — a per-employee onboarding/offboarding checklist item.
--     org_id is denormalized onto the row (same decision as HR-2/HR-3/HR-4) so the
--     RLS policies call is_hr_admin(org_id) / can_view_employee(employee_id) /
--     can_manage_employee(employee_id) WITHOUT recursing through hr_employees' RLS.
--   * seed_onboarding_checklist(employee, kind) — seeds a default checklist for an
--     employee (idempotent — skips if any task of that kind already exists).
--   * hr_org_analytics(org) — a single jsonb dashboard payload: headcount,
--     breakdowns by department/status/type/location, joiners/exits, today's
--     presence, this-month attendance rate, pending leave, the last payroll run,
--     and upcoming birthdays / work anniversaries.
--
-- One pre-existing-constraint amendment:
--   * HR-1's hr_employees_status_check only allowed
--     ('active','probation','on_notice','resigned','terminated'). The HR module
--     (and this slice's headcount/by_status logic) treats 'on_leave' as a valid
--     directory status, so the CHECK is widened here. Re-runnable (drop-if-exists
--     then add).
--
-- Supabase adaptations carried over from Phases 1-9 / HR-1..HR-4:
--   * gen_random_uuid() / citext live in the `extensions` schema. UUID PKs use a
--     column DEFAULT (gen_random_uuid()), resolved via the function's pinned
--     search_path. Every SECURITY DEFINER function body pins
--     `set search_path = public, extensions`.
--   * Every new table: enable RLS + add policies AND grant table privileges to
--     `authenticated` (else queries fail with permission-denied BEFORE RLS runs).
--
-- Faithfulness / scope notes — DEFERRED (documented in docs/hr5-notes.md):
--   attrition trend time-series, configurable checklist templates, asset tracking,
--   e-signature on offer letters, headcount forecasting.
--
-- Re-runnable where practical (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS / drop-then-add
-- CHECK constraint).
-- =============================================================================


-- =============================================================================
-- SECTION 0: Widen hr_employees.status to include 'on_leave'
-- =============================================================================
-- HR-1 shipped the directory status set WITHOUT 'on_leave'; the HR module uses it
-- (an active-but-currently-on-leave employee is still counted in headcount). Drop
-- and re-add so re-runnable. No data migration needed — only widens the allowed set.
alter table public.hr_employees
    drop constraint if exists hr_employees_status_check;
alter table public.hr_employees
    add constraint hr_employees_status_check
        check (status in ('active', 'probation', 'on_notice', 'on_leave', 'resigned', 'terminated'));


-- =============================================================================
-- SECTION 1: Table — hr_onboarding_tasks
-- =============================================================================
-- A single checklist item for an employee's onboarding (joining) or offboarding
-- (exit). org_id is denormalized for simple RLS. assignee_id is the app user who
-- owns the item (SET NULL if that user is deleted). sort_order orders the list;
-- completed_at is stamped by the app/UI when status flips to 'done'.
create table if not exists public.hr_onboarding_tasks (
    id           uuid                     default gen_random_uuid() not null,
    org_id       uuid                                               not null,
    employee_id  uuid                                               not null,
    kind         text                     default 'onboarding'      not null,
    title        text                                               not null,
    status       text                     default 'pending'         not null,
    due_date     date,
    assignee_id  uuid,
    sort_order   integer                  default 0                 not null,
    created_at   timestamp with time zone default current_timestamp not null,
    completed_at timestamp with time zone,
    constraint hr_onboarding_tasks_pk primary key (id),
    constraint hr_onboarding_tasks_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_onboarding_tasks_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_onboarding_tasks_assignee_id_fk
        foreign key (assignee_id) references public.users (id) on delete set null,
    constraint hr_onboarding_tasks_kind_check
        check (kind in ('onboarding', 'offboarding')),
    constraint hr_onboarding_tasks_status_check
        check (status in ('pending', 'in_progress', 'done')),
    constraint hr_onboarding_tasks_title_check check (char_length(title) <= 300)
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists hr_onboarding_tasks_org_id_index
    on public.hr_onboarding_tasks (org_id);
create index if not exists hr_onboarding_tasks_employee_id_index
    on public.hr_onboarding_tasks (employee_id);
create index if not exists hr_onboarding_tasks_employee_kind_index
    on public.hr_onboarding_tasks (employee_id, kind);
create index if not exists hr_onboarding_tasks_assignee_id_index
    on public.hr_onboarding_tasks (assignee_id);


-- =============================================================================
-- SECTION 3: seed_onboarding_checklist (SECURITY DEFINER, HR-manage gated)
-- =============================================================================
-- Seeds a default onboarding/offboarding checklist for an employee. Gate: the
-- caller must can_manage_employee(p_employee_id) (HR admin of the employee's org
-- OR the employee's manager). Resolves the org from the employee row (definer ->
-- RLS bypassed). IDEMPOTENT: if any task of that kind already exists for the
-- employee, it inserts nothing and returns 0. Returns the count inserted.
create or replace function public.seed_onboarding_checklist(
    p_employee_id uuid,
    p_kind        text default 'onboarding'
)
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _org_id    uuid;
    _titles    text[];
    _title     text;
    _i         integer := 0;
    _inserted  integer := 0;
begin
    if p_kind not in ('onboarding', 'offboarding') then
        raise exception 'seed_onboarding_checklist: invalid kind % (expected onboarding|offboarding)', p_kind;
    end if;

    -- Authorization: only someone who can MANAGE this employee may seed.
    if not public.can_manage_employee(p_employee_id) then
        raise exception 'seed_onboarding_checklist: caller cannot manage employee %', p_employee_id;
    end if;

    -- Resolve the owning org (definer => bypasses hr_employees RLS).
    select e.org_id into _org_id
    from public.hr_employees e
    where e.id = p_employee_id;

    if _org_id is null then
        raise exception 'seed_onboarding_checklist: employee % not found', p_employee_id;
    end if;

    -- Idempotency: skip entirely if a checklist of this kind already exists.
    if exists (
        select 1 from public.hr_onboarding_tasks t
        where t.employee_id = p_employee_id and t.kind = p_kind
    ) then
        return 0;
    end if;

    if p_kind = 'onboarding' then
        _titles := array[
            'Sign offer letter',
            'Complete paperwork',
            'Set up workstation & accounts',
            'Add to payroll',
            'Assign onboarding buddy',
            'Day-1 orientation',
            '30-day check-in'
        ];
    else
        _titles := array[
            'Knowledge transfer',
            'Revoke system access',
            'Collect company assets',
            'Final payroll settlement',
            'Exit interview'
        ];
    end if;

    foreach _title in array _titles
    loop
        _i := _i + 1;
        insert into public.hr_onboarding_tasks
            (org_id, employee_id, kind, title, sort_order)
        values
            (_org_id, p_employee_id, p_kind, _title, _i);
        _inserted := _inserted + 1;
    end loop;

    return _inserted;
end;
$$;


-- =============================================================================
-- SECTION 4: hr_org_analytics (SECURITY DEFINER, org-member gated)
-- =============================================================================
-- A single jsonb dashboard payload for an org. Gate: the caller must
-- is_org_member(p_org_id) (else raise). Runs as definer so the aggregates read
-- across hr_employees / hr_attendance / hr_leave_requests / hr_payroll_runs with
-- RLS bypassed — the org gate above is the access boundary.
--
-- "Active-ish" headcount counts statuses ('active','probation','on_notice',
-- 'on_leave') — i.e. everyone still ON the rolls (excludes 'resigned' /
-- 'terminated'). exits_30d is a PROXY: a point-in-time count of rows currently in
-- a terminal status (resigned/terminated). hr_employees has no exit_date column,
-- so this is "people who have left" rather than "left in the last 30 days" — see
-- the deferral note on an attrition time-series in docs/hr5-notes.md.
--
-- Birthday / anniversary window (across the year boundary):
--   For each candidate the NEXT occurrence of (month, day) is computed as the date
--   in the current year if it is still >= today, else the same (month, day) in the
--   next year. A row qualifies when that next-occurrence date falls within
--   [today, today + 30 days] (inclusive). Leap-day (Feb 29) birthdays use
--   make_date with month/day directly; in a non-leap year make_date(yyyy,2,29)
--   would error, so the next-occurrence is built defensively by trying the year
--   and rolling forward — see _next_occurrence inline below. We keep this readable
--   by computing the window in SQL with a small CTE per list.
create or replace function public.hr_org_analytics(p_org_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
declare
    _today           date := current_date;
    _horizon         date := current_date + 30;          -- inclusive 30-day window
    _month_start     date := date_trunc('month', current_date)::date;
    _headcount       integer;
    _total           integer;
    _by_department   jsonb;
    _by_status       jsonb;
    _by_type         jsonb;
    _by_location     jsonb;
    _on_probation    integer;
    _new_joiners     integer;
    _exits           integer;
    _present_today   integer;
    _att_rate        numeric;
    _leave_pending   integer;
    _payroll_last    jsonb;
    _birthdays       jsonb;
    _anniversaries   jsonb;
begin
    -- Authorization: must be a member of the org.
    if not public.is_org_member(p_org_id) then
        raise exception 'hr_org_analytics: caller is not a member of org %', p_org_id;
    end if;

    -- headcount (still on the rolls) + total.
    select count(*) filter (where status in ('active','probation','on_notice','on_leave')),
           count(*)
      into _headcount, _total
    from public.hr_employees
    where org_id = p_org_id;

    -- by_department: active-ish employees grouped by department name ('Unassigned'
    -- for null), ordered count desc.
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', cnt)
                              order by cnt desc, name), '[]'::jsonb)
      into _by_department
    from (
        select coalesce(d.name, 'Unassigned') as name, count(*) as cnt
        from public.hr_employees e
        left join public.hr_departments d on d.id = e.department_id
        where e.org_id = p_org_id
          and e.status in ('active','probation','on_notice','on_leave')
        group by coalesce(d.name, 'Unassigned')
    ) q;

    -- by_status: ALL employees, grouped by status, count desc.
    select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', cnt)
                              order by cnt desc, status), '[]'::jsonb)
      into _by_status
    from (
        select status, count(*) as cnt
        from public.hr_employees
        where org_id = p_org_id
        group by status
    ) q;

    -- by_type: ALL employees, grouped by employment_type, count desc.
    select coalesce(jsonb_agg(jsonb_build_object('type', employment_type, 'count', cnt)
                              order by cnt desc, employment_type), '[]'::jsonb)
      into _by_type
    from (
        select employment_type, count(*) as cnt
        from public.hr_employees
        where org_id = p_org_id
        group by employment_type
    ) q;

    -- by_location: ALL employees, grouped by work_location ('Unspecified' for null),
    -- count desc.
    select coalesce(jsonb_agg(jsonb_build_object('location', location, 'count', cnt)
                              order by cnt desc, location), '[]'::jsonb)
      into _by_location
    from (
        select coalesce(nullif(trim(work_location), ''), 'Unspecified') as location,
               count(*) as cnt
        from public.hr_employees
        where org_id = p_org_id
        group by coalesce(nullif(trim(work_location), ''), 'Unspecified')
    ) q;

    -- on_probation.
    select count(*) into _on_probation
    from public.hr_employees
    where org_id = p_org_id and status = 'probation';

    -- new_joiners_30d: date_of_joining within the last 30 days (<= today).
    select count(*) into _new_joiners
    from public.hr_employees
    where org_id = p_org_id
      and date_of_joining is not null
      and date_of_joining >= _today - 30
      and date_of_joining <= _today;

    -- exits_30d: proxy = count currently in a terminal status (see header note).
    select count(*) into _exits
    from public.hr_employees
    where org_id = p_org_id and status in ('terminated','resigned');

    -- present_today: distinct employees with an attendance row today marked
    -- present/wfh.
    select count(distinct employee_id) into _present_today
    from public.hr_attendance
    where org_id = p_org_id
      and date = _today
      and status in ('present','wfh');

    -- attendance_rate_month: present-ish / total-marked this calendar month, *100,
    -- 1 dp. nullif guards an all-zero month -> null.
    select round(
        count(*) filter (where status in ('present','wfh','half_day'))::numeric
        / nullif(count(*) filter (where status in ('present','wfh','half_day','absent','leave')), 0)
        * 100, 1)
      into _att_rate
    from public.hr_attendance
    where org_id = p_org_id
      and date >= _month_start
      and date <= _today;

    -- leave_pending: pending leave requests for the org.
    select count(*) into _leave_pending
    from public.hr_leave_requests
    where org_id = p_org_id and status = 'pending';

    -- payroll_last: the most recent run by (year, month), as a small object or null.
    select jsonb_build_object(
               'period_month',   r.period_month,
               'period_year',    r.period_year,
               'total_net',      r.total_net,
               'employee_count', r.employee_count,
               'status',         r.status)
      into _payroll_last
    from public.hr_payroll_runs r
    where r.org_id = p_org_id
    order by r.period_year desc, r.period_month desc, r.run_at desc
    limit 1;
    -- (left null when there are no runs)

    -- upcoming_birthdays: next-occurrence of (month, day) in [today, today+30].
    -- next_occ = make_date(year, month, day) for the first year (this/next) where
    -- it lands on/after today. Cap ~10, ordered by the upcoming day.
    select coalesce(jsonb_agg(jsonb_build_object(
                       'full_name',     full_name,
                       'date_of_birth', date_of_birth,
                       'day',           next_occ)
                   order by next_occ), '[]'::jsonb)
      into _birthdays
    from (
        select full_name, date_of_birth, next_occ
        from (
            select e.full_name,
                   e.date_of_birth,
                   case
                       when make_date(extract(year from _today)::int,
                                      extract(month from e.date_of_birth)::int,
                                      extract(day from e.date_of_birth)::int) >= _today
                       then make_date(extract(year from _today)::int,
                                      extract(month from e.date_of_birth)::int,
                                      extract(day from e.date_of_birth)::int)
                       else make_date(extract(year from _today)::int + 1,
                                      extract(month from e.date_of_birth)::int,
                                      extract(day from e.date_of_birth)::int)
                   end as next_occ
            from public.hr_employees e
            where e.org_id = p_org_id
              and e.date_of_birth is not null
              and e.status in ('active','probation','on_notice','on_leave')
              -- exclude Feb 29 to keep make_date safe in non-leap years (rare edge,
              -- documented as a deferral).
              and not (extract(month from e.date_of_birth) = 2
                       and extract(day from e.date_of_birth) = 29)
        ) occ
        where next_occ between _today and _horizon
        order by next_occ
        limit 10
    ) b;

    -- upcoming_anniversaries: same next-occurrence window over date_of_joining.
    -- years = tenure completed ON the upcoming anniversary (years from joining to
    -- next_occ). Exclude brand-new (years < 1). Cap ~10, ordered by upcoming day.
    select coalesce(jsonb_agg(jsonb_build_object(
                       'full_name',       full_name,
                       'date_of_joining', date_of_joining,
                       'years',           years,
                       'day',             next_occ)
                   order by next_occ), '[]'::jsonb)
      into _anniversaries
    from (
        select full_name, date_of_joining, years, next_occ
        from (
            select e.full_name,
                   e.date_of_joining,
                   (extract(year from age(occ.next_occ, e.date_of_joining)))::int as years,
                   occ.next_occ
            from public.hr_employees e
            cross join lateral (
                select case
                           when make_date(extract(year from _today)::int,
                                          extract(month from e.date_of_joining)::int,
                                          extract(day from e.date_of_joining)::int) >= _today
                           then make_date(extract(year from _today)::int,
                                          extract(month from e.date_of_joining)::int,
                                          extract(day from e.date_of_joining)::int)
                           else make_date(extract(year from _today)::int + 1,
                                          extract(month from e.date_of_joining)::int,
                                          extract(day from e.date_of_joining)::int)
                       end as next_occ
            ) occ
            where e.org_id = p_org_id
              and e.date_of_joining is not null
              and e.status in ('active','probation','on_notice','on_leave')
              and not (extract(month from e.date_of_joining) = 2
                       and extract(day from e.date_of_joining) = 29)
        ) cand
        where next_occ between _today and _horizon
          and years >= 1
        order by next_occ
        limit 10
    ) a;

    return jsonb_build_object(
        'headcount',             coalesce(_headcount, 0),
        'total_employees',       coalesce(_total, 0),
        'by_department',         coalesce(_by_department, '[]'::jsonb),
        'by_status',             coalesce(_by_status, '[]'::jsonb),
        'by_type',               coalesce(_by_type, '[]'::jsonb),
        'by_location',           coalesce(_by_location, '[]'::jsonb),
        'on_probation',          coalesce(_on_probation, 0),
        'new_joiners_30d',       coalesce(_new_joiners, 0),
        'exits_30d',             coalesce(_exits, 0),
        'present_today',         coalesce(_present_today, 0),
        'attendance_rate_month', _att_rate,                       -- null when no marks
        'leave_pending',         coalesce(_leave_pending, 0),
        'payroll_last',          _payroll_last,                   -- null when no runs
        'upcoming_birthdays',    coalesce(_birthdays, '[]'::jsonb),
        'upcoming_anniversaries',coalesce(_anniversaries, '[]'::jsonb)
    );
end;
$$;


-- =============================================================================
-- SECTION 5: Enable Row Level Security + policies
-- =============================================================================
alter table public.hr_onboarding_tasks enable row level security;

-- Convention (matches Phases 1-9 / HR-1..HR-4): drop-then-create so re-runnable;
-- policies target `authenticated`; service_role bypasses RLS.

-- SELECT: anyone who can VIEW the employee (self / HR admin / manager).
drop policy if exists hr_onboarding_tasks_select on public.hr_onboarding_tasks;
create policy hr_onboarding_tasks_select on public.hr_onboarding_tasks
    for select to authenticated
    using (public.can_view_employee(employee_id));

-- INSERT: HR admin of the org OR someone who can MANAGE the employee.
drop policy if exists hr_onboarding_tasks_insert on public.hr_onboarding_tasks;
create policy hr_onboarding_tasks_insert on public.hr_onboarding_tasks
    for insert to authenticated
    with check (public.is_hr_admin(org_id) or public.can_manage_employee(employee_id));

-- UPDATE: HR admin OR manager. with-check mirrors so a row cannot be re-pointed to
-- escape the policy.
drop policy if exists hr_onboarding_tasks_update on public.hr_onboarding_tasks;
create policy hr_onboarding_tasks_update on public.hr_onboarding_tasks
    for update to authenticated
    using (public.is_hr_admin(org_id) or public.can_manage_employee(employee_id))
    with check (public.is_hr_admin(org_id) or public.can_manage_employee(employee_id));

-- DELETE: HR admin OR manager.
drop policy if exists hr_onboarding_tasks_delete on public.hr_onboarding_tasks;
create policy hr_onboarding_tasks_delete on public.hr_onboarding_tasks
    for delete to authenticated
    using (public.is_hr_admin(org_id) or public.can_manage_employee(employee_id));


-- =============================================================================
-- SECTION 6: Function execute grants
-- =============================================================================
grant execute on function public.seed_onboarding_checklist(uuid, text) to authenticated;
grant execute on function public.hr_org_analytics(uuid)                to authenticated;


-- =============================================================================
-- SECTION 7: Table privileges for the API roles
-- =============================================================================
-- RLS (Section 5) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.hr_onboarding_tasks to authenticated;
grant all                            on public.hr_onboarding_tasks to service_role;

-- =============================================================================
-- END HR-5
-- =============================================================================
