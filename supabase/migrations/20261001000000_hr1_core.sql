-- =============================================================================
-- Cubes Greenfield Rebuild — HR-1: Core HR (departments / designations /
--   employees / documents) + HR-admin role + private hr-docs storage
-- =============================================================================
-- The first slice of the HR module (Keka-inspired). Builds on Phase 1
-- (identity/tenancy: organizations / teams / team_members / users +
-- is_org_member / is_team_member / is_team_admin) and Phase 8 (is_org_admin,
-- the org-owner-OR-team-admin pattern this file mirrors for is_hr_admin).
--
-- Adds (all org-scoped, snake_case, `hr_` prefix):
--   * hr_admins        — a user designated HR Admin for an org. Org owner is
--     implicitly HR Admin too (see is_hr_admin). UNIQUE(org_id, user_id).
--   * hr_departments   — org departments. head_user_id is an optional dept head.
--   * hr_designations  — org job titles + a numeric level.
--   * hr_employees     — the HR profile. user_id is NULLABLE: an employee may be
--     RECORD-ONLY (no app login). full_name / work_email live ON THE ROW so a
--     record-only employee is fully usable; user_id can be linked later. Optional
--     department / designation / manager (manager_id self-references hr_employees).
--   * hr_documents     — per-employee files (offer letters, IDs, contracts) stored
--     in the private `hr-docs` bucket; the row holds the storage_path.
--   * is_hr_admin(_org_id)        — caller is the org OWNER or rows in hr_admins
--     for (_org_id, auth.uid()). SECURITY DEFINER (queries hr_admins directly so
--     the hr_admins policies that CALL it do not recurse).
--   * current_employee_id(_org_id) — the caller's hr_employees.id in that org, or
--     NULL (handy for self-service UI).
--   * the private `hr-docs` storage bucket + storage.objects policies. Path
--     convention: `<org_id>/<employee_id>/<file>`; the FIRST path segment is the
--     org_id, scoped via is_hr_admin / is_org_member.
--   * RLS enable + policies + table/exec grants for everything above.
--
-- Supabase adaptations carried over from Phases 1-8:
--   * gen_random_uuid() / citext live in the `extensions` schema. UUID PKs use a
--     column DEFAULT (extensions.gen_random_uuid()); citext columns are declared
--     plainly and rely on the IMPLICIT assignment cast on INSERT — no FUNCTION
--     BODY here generates a UUID or casts ::citext, but the helper fns still pin
--     `set search_path = public, extensions` for determinism / consistency.
--   * Every new table: enable RLS + add policies AND grant table privileges to
--     `authenticated` (else queries fail with permission-denied BEFORE RLS runs).
--
-- Faithfulness / scope notes:
--   * Decision (HR_PLAN §7.2): HR Admin is a DEDICATED assignable role via the
--     hr_admins table OR the org owner — NOT every org/team admin. (is_org_admin
--     from Phase 8 is intentionally NOT reused as the HR gate.)
--   * Decision (HR_PLAN §7.3): employees may be record-only (user_id NULL).
--   * DEFERRED to later HR phases: attendance/shifts/holidays (HR-2), leave (HR-3),
--     payroll/salary/payslips/bank (HR-4), analytics/org-chart/onboarding (HR-5).
--
-- Re-runnable where practical (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS / ON CONFLICT DO
-- NOTHING).
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables (in dependency order)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 hr_admins. A user designated HR Admin for an org. Both FKs CASCADE so a row
--     never outlives its org or user. UNIQUE(org_id, user_id) prevents dupes. The
--     org OWNER is NOT required to have a row here — is_hr_admin treats the owner
--     as HR Admin implicitly.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_admins (
    id         uuid                     default gen_random_uuid() not null,
    org_id     uuid                                               not null,
    user_id    uuid                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint hr_admins_pk primary key (id),
    constraint hr_admins_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_admins_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint hr_admins_org_user_uindex unique (org_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 1.2 hr_departments. head_user_id is an optional dept head (a users row);
--     SET NULL on user delete so the dept survives losing its head. org CASCADE.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_departments (
    id           uuid                     default gen_random_uuid() not null,
    org_id       uuid                                               not null,
    name         text                                               not null,
    head_user_id uuid,
    created_at   timestamp with time zone default current_timestamp not null,
    constraint hr_departments_pk primary key (id),
    constraint hr_departments_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_departments_head_user_id_fk
        foreign key (head_user_id) references public.users (id) on delete set null,
    constraint hr_departments_name_check check (char_length(name) <= 200)
);

-- -----------------------------------------------------------------------------
-- 1.3 hr_designations. Job titles + a numeric level (seniority ordering). org
--     CASCADE.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_designations (
    id         uuid                     default gen_random_uuid() not null,
    org_id     uuid                                               not null,
    title      text                                               not null,
    level      integer                  default 0                 not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint hr_designations_pk primary key (id),
    constraint hr_designations_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_designations_title_check check (char_length(title) <= 200)
);

-- -----------------------------------------------------------------------------
-- 1.4 hr_employees — the HR profile. user_id is NULLABLE (record-only employees);
--     SET NULL on user delete so the HR record survives the app account going
--     away (full_name / work_email on the row keep it usable). department /
--     designation / manager are all optional and SET NULL on parent delete.
--     manager_id self-references hr_employees (an employee's manager is another
--     employee). UNIQUE(org_id, employee_code) keeps codes unique per org (NULLs
--     allowed — a record may have no code).
-- -----------------------------------------------------------------------------
create table if not exists public.hr_employees (
    id               uuid                     default gen_random_uuid() not null,
    org_id           uuid                                               not null,
    user_id          uuid,
    employee_code    text,
    full_name        text                                               not null,
    work_email       citext,
    department_id    uuid,
    designation_id   uuid,
    manager_id       uuid,
    employment_type  text                     default 'full_time'       not null,
    status           text                     default 'active'          not null,
    date_of_joining  date,
    date_of_birth    date,
    gender           text,
    personal_email   citext,
    phone            text,
    address          text,
    emergency_contact text,
    work_location    text,
    probation_end    date,
    created_at       timestamp with time zone default current_timestamp not null,
    updated_at       timestamp with time zone default current_timestamp not null,
    constraint hr_employees_pk primary key (id),
    constraint hr_employees_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_employees_user_id_fk
        foreign key (user_id) references public.users (id) on delete set null,
    constraint hr_employees_department_id_fk
        foreign key (department_id) references public.hr_departments (id) on delete set null,
    constraint hr_employees_designation_id_fk
        foreign key (designation_id) references public.hr_designations (id) on delete set null,
    constraint hr_employees_manager_id_fk
        foreign key (manager_id) references public.hr_employees (id) on delete set null,
    constraint hr_employees_employment_type_check
        check (employment_type in ('full_time', 'part_time', 'contract', 'intern')),
    constraint hr_employees_status_check
        check (status in ('active', 'probation', 'on_notice', 'resigned', 'terminated')),
    constraint hr_employees_full_name_check check (char_length(full_name) <= 200),
    constraint hr_employees_employee_code_check check (char_length(employee_code) <= 50),
    constraint hr_employees_org_code_uindex unique (org_id, employee_code)
);

-- -----------------------------------------------------------------------------
-- 1.5 hr_documents — per-employee files. employee_id + org_id both CASCADE.
--     storage_path is the object path in the `hr-docs` bucket
--     (`<org_id>/<employee_id>/<file>`). uploaded_by SET NULL on user delete.
-- -----------------------------------------------------------------------------
create table if not exists public.hr_documents (
    id           uuid                     default gen_random_uuid() not null,
    employee_id  uuid                                               not null,
    org_id       uuid                                               not null,
    doc_type     text,
    name         text                                               not null,
    storage_path text                                               not null,
    uploaded_by  uuid,
    created_at   timestamp with time zone default current_timestamp not null,
    constraint hr_documents_pk primary key (id),
    constraint hr_documents_employee_id_fk
        foreign key (employee_id) references public.hr_employees (id) on delete cascade,
    constraint hr_documents_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint hr_documents_uploaded_by_fk
        foreign key (uploaded_by) references public.users (id) on delete set null,
    constraint hr_documents_name_check check (char_length(name) <= 255)
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists hr_admins_org_id_index
    on public.hr_admins (org_id);
create index if not exists hr_admins_user_id_index
    on public.hr_admins (user_id);

create index if not exists hr_departments_org_id_index
    on public.hr_departments (org_id);
create index if not exists hr_departments_head_user_id_index
    on public.hr_departments (head_user_id);

create index if not exists hr_designations_org_id_index
    on public.hr_designations (org_id);

create index if not exists hr_employees_org_id_index
    on public.hr_employees (org_id);
create index if not exists hr_employees_user_id_index
    on public.hr_employees (user_id);
create index if not exists hr_employees_department_id_index
    on public.hr_employees (department_id);
create index if not exists hr_employees_designation_id_index
    on public.hr_employees (designation_id);
create index if not exists hr_employees_manager_id_index
    on public.hr_employees (manager_id);

create index if not exists hr_documents_employee_id_index
    on public.hr_documents (employee_id);
create index if not exists hr_documents_org_id_index
    on public.hr_documents (org_id);


-- =============================================================================
-- SECTION 3: updated_at touch trigger (hr_employees)
-- =============================================================================
-- Bumps updated_at on every UPDATE (mirrors Phase 4 set_task_updated_at). No
-- UUID/citext generation in the body, but search_path pinned for consistency.
create or replace function public.set_hr_employee_updated_at()
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

drop trigger if exists hr_employees_set_updated_at on public.hr_employees;
create trigger hr_employees_set_updated_at
    before update on public.hr_employees
    for each row
    execute function public.set_hr_employee_updated_at();


-- =============================================================================
-- SECTION 4: HR helper functions (SECURITY DEFINER)
-- =============================================================================
-- SECURITY DEFINER so they bypass RLS when they read hr_admins / hr_employees
-- directly. This is precisely what prevents recursion: the hr_admins policies
-- below CALL is_hr_admin, and is_hr_admin reads hr_admins — running as the owner
-- with RLS bypassed (and a pinned search_path) reads it safely. Mirrors Phase 8
-- is_org_admin (org owner OR a flagged admin), but the flag here is an hr_admins
-- row, NOT team-admin status.

-- is_hr_admin: true if the current user OWNS the org OR has an hr_admins row for
-- (_org_id, auth.uid()).
create or replace function public.is_hr_admin(_org_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select exists (
        select 1 from public.organizations o
        where o.id = _org_id
          and o.user_id = auth.uid()
    )
    or exists (
        select 1 from public.hr_admins ha
        where ha.org_id = _org_id
          and ha.user_id = auth.uid()
    );
$$;

-- current_employee_id: the caller's hr_employees.id in _org_id (linked via
-- user_id), or NULL. Handy for self-service UI ("my profile / my documents").
create or replace function public.current_employee_id(_org_id uuid)
    returns uuid
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select e.id
    from public.hr_employees e
    where e.org_id = _org_id
      and e.user_id = auth.uid()
    limit 1;
$$;


-- =============================================================================
-- SECTION 5: Supabase Storage — hr-docs bucket + storage.objects policies
-- =============================================================================
-- Private bucket (served via signed URLs / RLS-checked downloads). Idempotent.
insert into storage.buckets (id, name, public)
values ('hr-docs', 'hr-docs', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase; add scoped policies
-- (drop-if-exists first -> re-runnable). Path convention:
-- `<org_id>/<employee_id>/<file>`, so (storage.foldername(name))[1] is the org_id.
-- READ: any org member of that org (directory-style access; the hr_documents row
-- RLS still gates which DB rows a non-admin sees). WRITE (insert/update/delete):
-- only that org's HR admins.

drop policy if exists "hr_docs_select_org_member" on storage.objects;
create policy "hr_docs_select_org_member" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'hr-docs'
        and public.is_org_member(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "hr_docs_insert_hr_admin" on storage.objects;
create policy "hr_docs_insert_hr_admin" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'hr-docs'
        and public.is_hr_admin(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "hr_docs_update_hr_admin" on storage.objects;
create policy "hr_docs_update_hr_admin" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'hr-docs'
        and public.is_hr_admin(((storage.foldername(name))[1])::uuid)
    )
    with check (
        bucket_id = 'hr-docs'
        and public.is_hr_admin(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "hr_docs_delete_hr_admin" on storage.objects;
create policy "hr_docs_delete_hr_admin" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'hr-docs'
        and public.is_hr_admin(((storage.foldername(name))[1])::uuid)
    );


-- =============================================================================
-- SECTION 6: Enable Row Level Security + policies (public tables)
-- =============================================================================
alter table public.hr_admins      enable row level security;
alter table public.hr_departments enable row level security;
alter table public.hr_designations enable row level security;
alter table public.hr_employees   enable row level security;
alter table public.hr_documents   enable row level security;

-- Convention (matches Phases 1-8): drop-then-create so re-runnable; policies
-- target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 6.1 hr_admins — SELECT: any org member (everyone can see who the HR admins
--     are). INSERT/DELETE: an HR admin of that org (org owner OR an existing HR
--     admin) — so designating others is itself an HR-admin power. No UPDATE
--     (a designation has no mutable fields; change = delete + insert).
-- -------------------------------------------------------------------
drop policy if exists hr_admins_select on public.hr_admins;
create policy hr_admins_select on public.hr_admins
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists hr_admins_insert on public.hr_admins;
create policy hr_admins_insert on public.hr_admins
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_admins_delete on public.hr_admins;
create policy hr_admins_delete on public.hr_admins
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.2 hr_departments — SELECT: any org member. INSERT/UPDATE/DELETE: HR admin.
-- -------------------------------------------------------------------
drop policy if exists hr_departments_select on public.hr_departments;
create policy hr_departments_select on public.hr_departments
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists hr_departments_insert on public.hr_departments;
create policy hr_departments_insert on public.hr_departments
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_departments_update on public.hr_departments;
create policy hr_departments_update on public.hr_departments
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_departments_delete on public.hr_departments;
create policy hr_departments_delete on public.hr_departments
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.3 hr_designations — SELECT: any org member. INSERT/UPDATE/DELETE: HR admin.
-- -------------------------------------------------------------------
drop policy if exists hr_designations_select on public.hr_designations;
create policy hr_designations_select on public.hr_designations
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists hr_designations_insert on public.hr_designations;
create policy hr_designations_insert on public.hr_designations
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_designations_update on public.hr_designations;
create policy hr_designations_update on public.hr_designations
    for update to authenticated
    using (public.is_hr_admin(org_id))
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_designations_delete on public.hr_designations;
create policy hr_designations_delete on public.hr_designations
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.4 hr_employees — SELECT: any org member (the directory is visible org-wide).
--     INSERT/DELETE: HR admin. UPDATE: HR admin OR the employee themselves
--     (user_id = auth.uid()) — self may edit their own profile. The WITH CHECK
--     keeps the same predicate so a self-editor cannot re-point user_id/org_id
--     to escape the policy (HR admin retains full reach).
-- -------------------------------------------------------------------
drop policy if exists hr_employees_select on public.hr_employees;
create policy hr_employees_select on public.hr_employees
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists hr_employees_insert on public.hr_employees;
create policy hr_employees_insert on public.hr_employees
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_employees_update on public.hr_employees;
create policy hr_employees_update on public.hr_employees
    for update to authenticated
    using (public.is_hr_admin(org_id) or user_id = auth.uid())
    with check (public.is_hr_admin(org_id) or user_id = auth.uid());

drop policy if exists hr_employees_delete on public.hr_employees;
create policy hr_employees_delete on public.hr_employees
    for delete to authenticated
    using (public.is_hr_admin(org_id));

-- -------------------------------------------------------------------
-- 6.5 hr_documents — SELECT: HR admin OR the owning employee (the employee whose
--     hr_employees row links to auth.uid()). INSERT/DELETE: HR admin only. No
--     UPDATE policy (doc metadata is immutable; replace = delete + insert).
-- -------------------------------------------------------------------
drop policy if exists hr_documents_select on public.hr_documents;
create policy hr_documents_select on public.hr_documents
    for select to authenticated
    using (
        public.is_hr_admin(org_id)
        or exists (
            select 1 from public.hr_employees e
            where e.id = hr_documents.employee_id
              and e.user_id = auth.uid()
        )
    );

drop policy if exists hr_documents_insert on public.hr_documents;
create policy hr_documents_insert on public.hr_documents
    for insert to authenticated
    with check (public.is_hr_admin(org_id));

drop policy if exists hr_documents_delete on public.hr_documents;
create policy hr_documents_delete on public.hr_documents
    for delete to authenticated
    using (public.is_hr_admin(org_id));


-- =============================================================================
-- SECTION 7: Function execute grants
-- =============================================================================
grant execute on function public.is_hr_admin(uuid)          to authenticated;
grant execute on function public.current_employee_id(uuid)  to authenticated;
-- set_hr_employee_updated_at is a trigger fn (runs as owner on the table); no
-- execute grant to authenticated is needed.


-- =============================================================================
-- SECTION 8: Table privileges for the API roles
-- =============================================================================
-- RLS (Section 6) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.hr_admins      to authenticated;
grant select, insert, update, delete on public.hr_departments to authenticated;
grant select, insert, update, delete on public.hr_designations to authenticated;
grant select, insert, update, delete on public.hr_employees   to authenticated;
grant select, insert, update, delete on public.hr_documents   to authenticated;

grant all on public.hr_admins      to service_role;
grant all on public.hr_departments to service_role;
grant all on public.hr_designations to service_role;
grant all on public.hr_employees   to service_role;
grant all on public.hr_documents   to service_role;

-- =============================================================================
-- END HR-1
-- =============================================================================
