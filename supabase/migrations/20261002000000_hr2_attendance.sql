-- =============================================================================
-- Cubes Greenfield Rebuild — HR-2: Attendance (shifts / employee-shifts /
--   holidays / attendance / regularizations) + clock-in/out & regularization RPCs
-- =============================================================================
-- The second slice of the Keka-inspired HR module. Builds on HR-1
-- (20261001000000_hr1_core.sql): reuses is_hr_admin(org_id), current_employee_id
-- (org_id), hr_employees (id, org_id, user_id NULLABLE, full_name, manager_id ->
-- hr_employees, status, …), and on Phase 1 (is_org_member(org_id)).
--
-- Adds (all org-scoped, snake_case, `hr_` prefix; org_id DENORMALIZED onto every
-- employee-scoped row so RLS can call is_hr_admin(org_id)/is_org_member(org_id)
-- WITHOUT a recursive join back through hr_employees):
--   * hr_shifts                     — named work shifts (start/end time, break,
--     working_days[], default flag). Org-scoped.
--   * hr_employee_shifts            — assigns a shift to an employee from a date.
--     shift_id SET NULL so a deleted shift just unlinks the assignment.
--   * hr_holidays                   — org holiday calendar. UNIQUE(org_id,date,name).
--   * hr_attendance                 — one row per (employee, date): clock_in/out,
--     status, computed work_minutes, source. UNIQUE(employee_id, date).
--   * hr_attendance_regularizations — employee requests to fix a day's punches;
--     a manager/HR-admin approves -> writes a 'regularized' attendance row.
--
-- Reusable HR helpers added here (used by HR-3 leave & HR-4 payroll too):
--   * can_view_employee(_employee_id)   — caller IS that employee, OR is_hr_admin
--     of the employee's org, OR is that employee's manager.
--   * can_manage_employee(_employee_id) — is_hr_admin of the employee's org, OR is
--     that employee's manager.
--
-- RPCs (SECURITY DEFINER, search_path = public, extensions):
--   * clock_in()  -> uuid  — upsert today's hr_attendance for the caller, set
--     clock_in=now() (if unset), status='present', source='web'.
--   * clock_out() -> uuid  — set today's clock_out=now(), compute work_minutes
--     (in→out minus the resolvable shift break). Raises if no clock_in today.
--   * request_regularization(date,in,out,reason) -> uuid — caller files a pending
--     request for their own employee.
--   * decide_regularization(id, approve, note) -> void — a manager/HR-admin of the
--     request's employee approves/rejects; on approve writes a 'regularized'
--     attendance row with the requested in/out + computed work_minutes.
--
-- Supabase adaptations carried over from Phases 1-9 / HR-1:
--   * gen_random_uuid() / citext live in the `extensions` schema. UUID PKs use a
--     column DEFAULT (gen_random_uuid()); helper/RPC bodies pin
--     `set search_path = public, extensions` (they generate UUIDs / call helpers).
--   * Every new table: enable RLS + add policies AND grant table privileges to
--     `authenticated` (else queries fail with permission-denied BEFORE RLS runs).
--   * SECURITY DEFINER helpers read hr_employees / hr_attendance directly so the
--     policies that CALL them do not recurse through those tables' RLS.
--
-- Faithfulness / scope notes:
--   * Decision: employee-scoped attendance tables DENORMALIZE org_id (HR_PLAN —
--     "set org_id on insert so RLS uses is_hr_admin(org_id) directly").
--   * Self-service punches go through the SECURITY DEFINER clock_in/clock_out
--     RPCs; HR admins may still do manual hr_attendance writes via RLS.
--   * DEFERRED to later work: geo/biometric capture, shift rotation/scheduling,
--     overtime/late-grace rules, monthly attendance summaries, auto weekend/
--     holiday marking (HR-2 leaves the door open via status enum values).
--
-- Re-runnable where practical (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS).
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables (in dependency order)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 hr_shifts — named work shifts. Org-scoped (org CASCADE). working_days is an
--     int[] of weekday numbers (0=Sun..6=Sat); default Mon-Fri. is_default flags
--     the org's fallback shift. start_time/end_time are wall-clock `time`s.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_shifts (
    id            uuid                     default gen_random_uuid() not null,
    org_id        uuid                                               not null,
    name          text                                               not null,
    start_time    time,
    end_time      time,
    break_minutes integer                  default 0                 not null,
    working_days  integer[]                default '{1,2,3,4,5}'     not null,
    is_default    boolean                  default false             not null,
    created_at    timestamp with time zone default current_timestamp not null,
    constraint hr_shifts_pk primary key (id),
    constraint hr_shifts_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_shifts_name_check check (char_length(name) <= 200),
    constraint hr_shifts_break_minutes_check check (break_minutes >= 0)
);

-- -----------------------------------------------------------------------------
-- 1.2 hr_employee_shifts — assigns a shift to an employee effective from a date.
--     employee_id + org_id (DENORMALIZED) CASCADE; shift_id SET NULL so deleting a
--     shift just unlinks (the assignment row survives as "no shift").
-- -----------------------------------------------------------------------------
create table if not exists public.hr_employee_shifts (
    id             uuid                     default gen_random_uuid() not null,
    employee_id    uuid                                               not null,
    org_id         uuid                                               not null,
    shift_id       uuid,
    effective_from date                     default current_date      not null,
    created_at     timestamp with time zone default current_timestamp not null,
    constraint hr_employee_shifts_pk primary key (id),
    constraint hr_employee_shifts_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_employee_shifts_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_employee_shifts_shift_id_fk
        foreign key (shift_id) references public.hr_shifts (id) on delete set null
);

-- -----------------------------------------------------------------------------
-- 1.3 hr_holidays — org holiday calendar. optional=true marks a "floating"/
--     optional holiday. UNIQUE(org_id, date, name) prevents exact dupes while
--     still allowing two distinct holidays to share a date. org CASCADE.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_holidays (
    id         uuid                     default gen_random_uuid() not null,
    org_id     uuid                                               not null,
    date       date                                               not null,
    name       text                                               not null,
    optional   boolean                  default false             not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint hr_holidays_pk primary key (id),
    constraint hr_holidays_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_holidays_name_check check (char_length(name) <= 200),
    constraint hr_holidays_org_date_name_uindex unique (org_id, date, name)
);

-- -----------------------------------------------------------------------------
-- 1.4 hr_attendance — one row per (employee, date). clock_in/clock_out are
--     timestamptz; work_minutes is the computed worked time (set by the RPCs or a
--     manual HR write). status/source are CHECK-constrained enums. employee_id +
--     org_id (DENORMALIZED) CASCADE. UNIQUE(employee_id, date) is the upsert key.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_attendance (
    id           uuid                     default gen_random_uuid() not null,
    employee_id  uuid                                               not null,
    org_id       uuid                                               not null,
    date         date                                               not null,
    clock_in     timestamp with time zone,
    clock_out    timestamp with time zone,
    status       text                     default 'present'         not null,
    work_minutes integer,
    source       text                     default 'web'             not null,
    notes        text,
    created_at   timestamp with time zone default current_timestamp not null,
    updated_at   timestamp with time zone default current_timestamp not null,
    constraint hr_attendance_pk primary key (id),
    constraint hr_attendance_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_attendance_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_attendance_status_check
        check (status in ('present', 'absent', 'half_day', 'wfh', 'leave', 'holiday', 'weekend')),
    constraint hr_attendance_source_check
        check (source in ('web', 'manual', 'regularized', 'system')),
    constraint hr_attendance_employee_date_uindex unique (employee_id, date)
);

-- -----------------------------------------------------------------------------
-- 1.5 hr_attendance_regularizations — an employee's request to correct a day's
--     punches. status is pending/approved/rejected. approver_id is the deciding
--     user (SET NULL on user delete). employee_id + org_id (DENORMALIZED) CASCADE.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_attendance_regularizations (
    id            uuid                     default gen_random_uuid() not null,
    employee_id   uuid                                               not null,
    org_id        uuid                                               not null,
    date          date                                               not null,
    requested_in  timestamp with time zone,
    requested_out timestamp with time zone,
    reason        text,
    status        text                     default 'pending'         not null,
    approver_id   uuid,
    decided_at    timestamp with time zone,
    created_at    timestamp with time zone default current_timestamp not null,
    constraint hr_attendance_regularizations_pk primary key (id),
    constraint hr_attendance_regularizations_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_attendance_regularizations_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_attendance_regularizations_approver_id_fk
        foreign key (approver_id) references public.users (id) on delete set null,
    constraint hr_attendance_regularizations_status_check
        check (status in ('pending', 'approved', 'rejected'))
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists hr_shifts_org_id_index
    on public.hr_shifts (org_id);

create index if not exists hr_employee_shifts_employee_id_index
    on public.hr_employee_shifts (employee_id);
create index if not exists hr_employee_shifts_org_id_index
    on public.hr_employee_shifts (org_id);
create index if not exists hr_employee_shifts_shift_id_index
    on public.hr_employee_shifts (shift_id);

create index if not exists hr_holidays_org_id_index
    on public.hr_holidays (org_id);
create index if not exists hr_holidays_date_index
    on public.hr_holidays (date);

create index if not exists hr_attendance_employee_id_index
    on public.hr_attendance (employee_id);
create index if not exists hr_attendance_org_id_index
    on public.hr_attendance (org_id);
create index if not exists hr_attendance_date_index
    on public.hr_attendance (date);

create index if not exists hr_attendance_regularizations_employee_id_index
    on public.hr_attendance_regularizations (employee_id);
create index if not exists hr_attendance_regularizations_org_id_index
    on public.hr_attendance_regularizations (org_id);
create index if not exists hr_attendance_regularizations_status_index
    on public.hr_attendance_regularizations (status);


-- =============================================================================
-- SECTION 3: updated_at touch trigger (hr_attendance)
-- =============================================================================
-- Bumps updated_at on every UPDATE (mirrors HR-1 set_hr_employee_updated_at).
create or replace function public.set_hr_attendance_updated_at()
    returns trigger
    language plpgsql
    set search_path = public
as
$$
begin
    new.updated_at := current_timestamp;
    return new;
end;
$$;

drop trigger if exists hr_attendance_set_updated_at on public.hr_attendance;
create trigger hr_attendance_set_updated_at
    before update on public.hr_attendance
    for each row
    execute function public.set_hr_attendance_updated_at();


-- =============================================================================
-- SECTION 4: Reusable HR authorization helpers (SECURITY DEFINER)
-- =============================================================================
-- SECURITY DEFINER so they read hr_employees directly with RLS bypassed — this is
-- what lets the attendance/regularization policies CALL them without recursing
-- through hr_employees' RLS. STABLE: pure reads. Pinned search_path. These two
-- are reused by HR-3 (leave) and HR-4 (payroll).

-- can_view_employee: the caller IS that employee (hr_employees.user_id =
-- auth.uid()), OR is_hr_admin of the employee's org, OR is that employee's manager
-- (the manager hr_employees row links to auth.uid()).
create or replace function public.can_view_employee(_employee_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select exists (
        select 1
        from public.hr_employees e
        where e.id = _employee_id
          and (
                e.user_id = auth.uid()
             or public.is_hr_admin(e.org_id)
             or exists (
                    select 1
                    from public.hr_employees m
                    where m.id = e.manager_id
                      and m.user_id = auth.uid()
                )
          )
    );
$$;

-- can_manage_employee: is_hr_admin of the employee's org, OR the caller is that
-- employee's manager. (No "self" — you manage your reports, not yourself.)
create or replace function public.can_manage_employee(_employee_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select exists (
        select 1
        from public.hr_employees e
        where e.id = _employee_id
          and (
                public.is_hr_admin(e.org_id)
             or exists (
                    select 1
                    from public.hr_employees m
                    where m.id = e.manager_id
                      and m.user_id = auth.uid()
                )
          )
    );
$$;


-- =============================================================================
-- SECTION 5: Attendance RPCs (SECURITY DEFINER)
-- =============================================================================
-- All run as the definer (RLS bypassed) but gate explicitly on auth.uid() /
-- can_manage_employee. They generate UUIDs and call helpers so they pin
-- search_path = public, extensions.

-- -----------------------------------------------------------------------------
-- 5.0 Internal: resolve the shift break (minutes) for an employee on a date. The
--     latest hr_employee_shifts assignment effective on/before the date wins; its
--     shift's break_minutes (or 0). Returns 0 if nothing resolves. SECURITY
--     DEFINER, STABLE — a pure helper used by clock_out/decide_regularization.
-- -----------------------------------------------------------------------------
create or replace function public.hr_shift_break_minutes(_employee_id uuid, _date date)
    returns integer
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select coalesce(s.break_minutes, 0)
    from public.hr_employee_shifts es
    left join public.hr_shifts s on s.id = es.shift_id
    where es.employee_id = _employee_id
      and es.effective_from <= _date
    order by es.effective_from desc, es.created_at desc
    limit 1;
$$;

-- -----------------------------------------------------------------------------
-- 5.1 clock_in() -> uuid — find the caller's hr_employees row (any org; pick one)
--     and upsert today's hr_attendance: set clock_in=now() only if not already
--     set, status='present', source='web'. Returns the attendance id.
-- -----------------------------------------------------------------------------
create or replace function public.clock_in()
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id  uuid := auth.uid();
    _emp_id   uuid;
    _org_id   uuid;
    _att_id   uuid;
begin
    if _user_id is null then
        raise exception 'clock_in: no authenticated user';
    end if;

    select id, org_id into _emp_id, _org_id
    from public.hr_employees
    where user_id = _user_id
    limit 1;

    if _emp_id is null then
        raise exception 'clock_in: no employee record for the current user';
    end if;

    insert into public.hr_attendance (employee_id, org_id, date, clock_in, status, source)
    values (_emp_id, _org_id, current_date, now(), 'present', 'web')
    on conflict (employee_id, date)
        do update set
            clock_in = coalesce(public.hr_attendance.clock_in, excluded.clock_in),
            status   = 'present',
            source   = 'web'
    returning id into _att_id;

    return _att_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.2 clock_out() -> uuid — set today's attendance clock_out=now(); compute
--     work_minutes = round((out - in)/60) minus the resolvable shift break (never
--     negative). Raises if there is no clock_in for today. Returns the row id.
-- -----------------------------------------------------------------------------
create or replace function public.clock_out()
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id   uuid := auth.uid();
    _emp_id    uuid;
    _att_id    uuid;
    _clock_in  timestamp with time zone;
    _out       timestamp with time zone := now();
    _break     integer;
    _minutes   integer;
begin
    if _user_id is null then
        raise exception 'clock_out: no authenticated user';
    end if;

    select id into _emp_id
    from public.hr_employees
    where user_id = _user_id
    limit 1;

    if _emp_id is null then
        raise exception 'clock_out: no employee record for the current user';
    end if;

    select id, clock_in into _att_id, _clock_in
    from public.hr_attendance
    where employee_id = _emp_id and date = current_date
    for update;

    if _att_id is null or _clock_in is null then
        raise exception 'clock_out: no clock_in recorded for the current user today';
    end if;

    _break   := coalesce(public.hr_shift_break_minutes(_emp_id, current_date), 0);
    _minutes := greatest(0, round(extract(epoch from (_out - _clock_in)) / 60.0)::integer - _break);

    update public.hr_attendance
        set clock_out    = _out,
            work_minutes = _minutes
        where id = _att_id;

    return _att_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.3 request_regularization(date, in, out, reason) -> uuid — file a PENDING
--     regularization for the caller's own employee. Returns the request id.
-- -----------------------------------------------------------------------------
create or replace function public.request_regularization(
    p_date   date,
    p_in     timestamp with time zone,
    p_out    timestamp with time zone,
    p_reason text default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id uuid := auth.uid();
    _emp_id  uuid;
    _org_id  uuid;
    _req_id  uuid;
begin
    if _user_id is null then
        raise exception 'request_regularization: no authenticated user';
    end if;

    select id, org_id into _emp_id, _org_id
    from public.hr_employees
    where user_id = _user_id
    limit 1;

    if _emp_id is null then
        raise exception 'request_regularization: no employee record for the current user';
    end if;

    insert into public.hr_attendance_regularizations
        (employee_id, org_id, date, requested_in, requested_out, reason, status)
    values (_emp_id, _org_id, p_date, p_in, p_out, p_reason, 'pending')
    returning id into _req_id;

    return _req_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.4 decide_regularization(id, approve, note) -> void — the caller must
--     can_manage_employee(the request's employee). Sets status approved/rejected,
--     approver_id=auth.uid(), decided_at=now(), appends the note to reason. On
--     APPROVE, upserts hr_attendance for that employee+date with the requested
--     in/out, status='present', source='regularized', work_minutes computed
--     (requested span minus the resolvable shift break).
-- -----------------------------------------------------------------------------
create or replace function public.decide_regularization(
    p_id      uuid,
    p_approve boolean,
    p_note    text default null
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id uuid := auth.uid();
    _emp_id  uuid;
    _org_id  uuid;
    _date    date;
    _r_in    timestamp with time zone;
    _r_out   timestamp with time zone;
    _break   integer;
    _minutes integer;
begin
    if _user_id is null then
        raise exception 'decide_regularization: no authenticated user';
    end if;

    select employee_id, org_id, date, requested_in, requested_out
        into _emp_id, _org_id, _date, _r_in, _r_out
    from public.hr_attendance_regularizations
    where id = p_id
    for update;

    if _emp_id is null then
        raise exception 'decide_regularization: regularization % not found', p_id;
    end if;

    if not public.can_manage_employee(_emp_id) then
        raise exception 'decide_regularization: caller cannot manage employee %', _emp_id;
    end if;

    update public.hr_attendance_regularizations
        set status      = case when p_approve then 'approved' else 'rejected' end,
            approver_id = _user_id,
            decided_at  = now(),
            reason      = case
                              when p_note is null then reason
                              when reason is null then p_note
                              else reason || E'\n' || p_note
                          end
        where id = p_id;

    if p_approve then
        if _r_in is not null and _r_out is not null then
            _break   := coalesce(public.hr_shift_break_minutes(_emp_id, _date), 0);
            _minutes := greatest(0, round(extract(epoch from (_r_out - _r_in)) / 60.0)::integer - _break);
        else
            _minutes := null;
        end if;

        insert into public.hr_attendance
            (employee_id, org_id, date, clock_in, clock_out, status, work_minutes, source)
        values (_emp_id, _org_id, _date, _r_in, _r_out, 'present', _minutes, 'regularized')
        on conflict (employee_id, date)
            do update set
                clock_in     = excluded.clock_in,
                clock_out    = excluded.clock_out,
                status       = 'present',
                work_minutes = excluded.work_minutes,
                source       = 'regularized';
    end if;
end;
$$;


-- =============================================================================
-- SECTION 6: Enable Row Level Security + policies
-- =============================================================================
alter table public.hr_shifts                     enable row level security;
alter table public.hr_employee_shifts            enable row level security;
alter table public.hr_holidays                   enable row level security;
alter table public.hr_attendance                 enable row level security;
alter table public.hr_attendance_regularizations enable row level security;

-- Convention (matches Phases 1-9 / HR-1): drop-then-create so re-runnable;
-- policies target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 6.1 hr_shifts — SELECT: any org member. INSERT/UPDATE/DELETE: HR admin.
-- -------------------------------------------------------------------
drop policy if exists hr_shifts_select on public.hr_shifts;
create policy hr_shifts_select on public.hr_shifts
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists hr_shifts_insert on public.hr_shifts;
create policy hr_shifts_insert on public.hr_shifts
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_shifts_update on public.hr_shifts;
create policy hr_shifts_update on public.hr_shifts
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_shifts_delete on public.hr_shifts;
create policy hr_shifts_delete on public.hr_shifts
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.2 hr_employee_shifts — SELECT: the employee/manager/HR-admin OR any org
--     member (assignments are operational, org-wide visible). WRITE: HR admin.
-- -------------------------------------------------------------------
drop policy if exists hr_employee_shifts_select on public.hr_employee_shifts;
create policy hr_employee_shifts_select on public.hr_employee_shifts
    for select to authenticated
    using (public.can_view_employee(employee_id) or public.is_org_member(org_id));

drop policy if exists hr_employee_shifts_insert on public.hr_employee_shifts;
create policy hr_employee_shifts_insert on public.hr_employee_shifts
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_employee_shifts_update on public.hr_employee_shifts;
create policy hr_employee_shifts_update on public.hr_employee_shifts
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_employee_shifts_delete on public.hr_employee_shifts;
create policy hr_employee_shifts_delete on public.hr_employee_shifts
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.3 hr_holidays — SELECT: any org member. INSERT/UPDATE/DELETE: HR admin.
-- -------------------------------------------------------------------
drop policy if exists hr_holidays_select on public.hr_holidays;
create policy hr_holidays_select on public.hr_holidays
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists hr_holidays_insert on public.hr_holidays;
create policy hr_holidays_insert on public.hr_holidays
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_holidays_update on public.hr_holidays;
create policy hr_holidays_update on public.hr_holidays
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_holidays_delete on public.hr_holidays;
create policy hr_holidays_delete on public.hr_holidays
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.4 hr_attendance — SELECT: can_view_employee (self / manager / HR admin).
--     INSERT/UPDATE: can_view_employee too (own punches go through the SECURITY
--     DEFINER RPCs; HR admins / managers may also write manually). DELETE: HR
--     admin. WITH CHECK mirrors so a self-writer cannot re-point employee_id.
-- -------------------------------------------------------------------
drop policy if exists hr_attendance_select on public.hr_attendance;
create policy hr_attendance_select on public.hr_attendance
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_attendance_insert on public.hr_attendance;
create policy hr_attendance_insert on public.hr_attendance
    for insert to authenticated
    with check (public.can_view_employee(employee_id));

drop policy if exists hr_attendance_update on public.hr_attendance;
create policy hr_attendance_update on public.hr_attendance
    for update to authenticated
    using (public.can_view_employee(employee_id))
    with check (public.can_view_employee(employee_id));

drop policy if exists hr_attendance_delete on public.hr_attendance;
create policy hr_attendance_delete on public.hr_attendance
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.5 hr_attendance_regularizations — SELECT: can_view_employee (self / manager /
--     HR admin). INSERT: the employee themselves (own requests). UPDATE: a
--     manager/HR-admin (can_manage_employee) — the decide leg. No DELETE policy
--     (requests are an audit trail; cascade with the employee).
-- -------------------------------------------------------------------
drop policy if exists hr_attendance_regularizations_select on public.hr_attendance_regularizations;
create policy hr_attendance_regularizations_select on public.hr_attendance_regularizations
    for select to authenticated
    using (public.can_view_employee(employee_id));

drop policy if exists hr_attendance_regularizations_insert on public.hr_attendance_regularizations;
create policy hr_attendance_regularizations_insert on public.hr_attendance_regularizations
    for insert to authenticated
    with check (
        exists (
            select 1 from public.hr_employees e
            where e.id = hr_attendance_regularizations.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_attendance_regularizations_update on public.hr_attendance_regularizations;
create policy hr_attendance_regularizations_update on public.hr_attendance_regularizations
    for update to authenticated
    using (public.can_manage_employee(employee_id))
    with check (public.can_manage_employee(employee_id));


-- =============================================================================
-- SECTION 7: Function execute grants
-- =============================================================================
grant execute on function public.can_view_employee(uuid)              to authenticated;
grant execute on function public.can_manage_employee(uuid)            to authenticated;
grant execute on function public.hr_shift_break_minutes(uuid, date)   to authenticated;
grant execute on function public.clock_in()                           to authenticated;
grant execute on function public.clock_out()                          to authenticated;
grant execute on function public.request_regularization(date, timestamptz, timestamptz, text)
                                                                      to authenticated;
grant execute on function public.decide_regularization(uuid, boolean, text)
                                                                      to authenticated;
-- set_hr_attendance_updated_at is a trigger fn (runs as owner on the table); no
-- execute grant to authenticated is needed.


-- =============================================================================
-- SECTION 8: Table privileges for the API roles
-- =============================================================================
-- RLS (Section 6) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.hr_shifts                     to authenticated;
grant select, insert, update, delete on public.hr_employee_shifts            to authenticated;
grant select, insert, update, delete on public.hr_holidays                   to authenticated;
grant select, insert, update, delete on public.hr_attendance                 to authenticated;
grant select, insert, update, delete on public.hr_attendance_regularizations to authenticated;

grant all on public.hr_shifts                     to service_role;
grant all on public.hr_employee_shifts            to service_role;
grant all on public.hr_holidays                   to service_role;
grant all on public.hr_attendance                 to service_role;
grant all on public.hr_attendance_regularizations to service_role;

-- =============================================================================
-- END HR-2
-- =============================================================================
