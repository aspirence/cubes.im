-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 4: Tasks (the core of the product)
-- =============================================================================
-- Builds on Phase 1 (identity/tenancy), Phase 2 (settings/onboarding incl.
-- team_labels) and Phase 3 (projects, project_phases, project_members, the
-- project-granular RLS helpers, the create_project RPC and projects.tasks_counter).
--
-- Adds the task lookup tables (sys_task_status_categories / task_priorities),
-- the per-project task_statuses table, the core tasks table, the task-children
-- tables (tasks_assignees / task_labels / task_phase / task_comments), the task
-- triggers (task_no assignment, done/completed_at sync, updated_at touch,
-- default-status seeding on project create), the is_task_member RLS helper and
-- the create_task RPC, plus RLS enable + policies + grants.
--
-- Ported faithfully from the legacy Cubes Postgres schema
-- (cubes-backend/database/sql/{1_tables,2_dml,4_functions,triggers}.sql),
-- with the SAME Supabase adaptations Phases 1-3 established:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() (relied on via the
--     column DEFAULT, never cast explicitly in a function body).
--   * the legacy WL_HEX_COLOR domain -> plain text + an inline CHECK with the
--     same hex regex (keeps this migration self-contained; no cross-phase domain).
--   * any FUNCTION BODY touching gen_random_uuid()/citext/unaccent pins
--     `set search_path = public, extensions` (Phase 1-3 lesson).
--   * RLS is enforced in the database; Phase 1's is_team_member/is_team_admin and
--     Phase 3's is_project_team_member/is_project_team_admin/team_id_of_project
--     are REUSED (NOT recreated). Phase 4 adds is_task_member layered on top.
--
-- Intentional faithfulness notes vs. legacy columns (per the Phase 4 brief):
--   * sys_task_status_categories: legacy column `index` (reserved-ish) is renamed
--     `sort_order` here; legacy color_code_dark/description are DROPPED for now.
--   * task_priorities: legacy color_code_dark DROPPED for now.
--   * task_statuses: legacy team_id NOT NULL kept; added created_at; FK to
--     projects ON DELETE CASCADE (legacy) + category_id (legacy) + a team_id FK.
--   * tasks: legacy priority_id/status_id NOT NULL -> NULLABLE here with FK
--     ON DELETE SET NULL (a task can outlive a deleted priority/status). Legacy
--     reporter_id NOT NULL kept (FK -> users). parent_task_id FK ON DELETE
--     CASCADE (legacy). Added a UNIQUE(project_id, task_no). progress_value kept
--     nullable int. Legacy sort-order/billable/weight/progress_mode extras NOT in
--     the brief are DROPPED for now (re-add in a later phase if a UI needs them).
--   * tasks_assignees: legacy PK was (task_id, project_member_id); the brief uses
--     PK(task_id, team_member_id) (team_member is the stable identity), with
--     project_member_id NULLABLE ON DELETE SET NULL. assigned_by -> users.
--   * task_comments: legacy split content into task_comment_contents; the brief
--     simplifies to an inline `content text not null` + created_by -> users.
--
-- Re-runnable where practical (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS / guarded inserts). The lookup SEED lives in
-- supabase/seed.sql (so `supabase db reset` seeds it); it is ALSO inserted
-- (idempotently) at the end of this migration so a migrate-only apply has the
-- lookup rows available.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Lookup / system tables (no tenant scope)
-- =============================================================================
-- Seeded (see SECTION 9 + seed.sql) and readable by any authenticated user; no
-- write policy. color_code is text + an inline hex CHECK (Phase 1-3 convention).

-- -----------------------------------------------------------------------------
-- 1.1 sys_task_status_categories (legacy: sys_task_status_categories).
--     The three system categories every per-project status maps to: To Do
--     (is_todo), Doing (is_doing), Done (is_done). Legacy `index` -> `sort_order`.
-- -----------------------------------------------------------------------------
create table if not exists public.sys_task_status_categories (
    id         uuid    default gen_random_uuid() not null,
    name       text                              not null,
    color_code text                              not null,
    sort_order integer default 0                 not null,
    is_todo    boolean default false             not null,
    is_doing   boolean default false             not null,
    is_done    boolean default false             not null,
    constraint sys_task_status_categories_pk primary key (id),
    constraint sys_task_status_categories_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);

-- -----------------------------------------------------------------------------
-- 1.2 task_priorities (legacy: task_priorities). Low/Medium/High (value 0/1/2).
-- -----------------------------------------------------------------------------
create table if not exists public.task_priorities (
    id         uuid    default gen_random_uuid() not null,
    name       text                              not null,
    value      integer default 0                 not null,
    color_code text                              not null,
    constraint task_priorities_pk primary key (id),
    constraint task_priorities_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);


-- =============================================================================
-- SECTION 2: Project-scoped status table
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 task_statuses (legacy: task_statuses). Per-project workflow columns; each
--     maps to a system category. CASCADE on project delete. team_id -> teams,
--     category_id -> sys_task_status_categories.
-- -----------------------------------------------------------------------------
create table if not exists public.task_statuses (
    id          uuid                     default gen_random_uuid() not null,
    name        text                                               not null,
    project_id  uuid                                               not null,
    team_id     uuid                                               not null,
    category_id uuid                                               not null,
    sort_order  integer                  default 0                 not null,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint task_statuses_pk primary key (id),
    constraint task_statuses_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint task_statuses_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint task_statuses_category_id_fk
        foreign key (category_id) references public.sys_task_status_categories (id),
    constraint task_statuses_name_check check (char_length(name) <= 50)
);


-- =============================================================================
-- SECTION 3: Core tasks table
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 tasks (legacy: tasks). The core entity. status_id / priority_id are
--     NULLABLE here with FK ON DELETE SET NULL (a task can outlive a deleted
--     status/priority). parent_task_id (subtasks) ON DELETE CASCADE. task_no is
--     per-project (assigned by trigger) and UNIQUE(project_id, task_no).
-- -----------------------------------------------------------------------------
create table if not exists public.tasks (
    id             uuid                     default gen_random_uuid() not null,
    name           text                                               not null,
    description    text,
    project_id     uuid                                               not null,
    status_id      uuid,
    priority_id    uuid,
    reporter_id    uuid,
    parent_task_id uuid,
    task_no        integer,
    sort_order     integer                  default 0                 not null,
    start_date     timestamp with time zone,
    end_date       timestamp with time zone,
    total_minutes  numeric                  default 0                 not null,
    progress_value integer,
    done           boolean                  default false             not null,
    archived       boolean                  default false             not null,
    completed_at   timestamp with time zone,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint tasks_pk primary key (id),
    constraint tasks_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint tasks_status_id_fk
        foreign key (status_id) references public.task_statuses (id) on delete set null,
    constraint tasks_priority_id_fk
        foreign key (priority_id) references public.task_priorities (id) on delete set null,
    constraint tasks_reporter_id_fk
        foreign key (reporter_id) references public.users (id),
    constraint tasks_parent_task_id_fk
        foreign key (parent_task_id) references public.tasks (id) on delete cascade,
    constraint tasks_project_task_no_unique unique (project_id, task_no),
    constraint tasks_name_check check (char_length(name) <= 500),
    constraint tasks_description_check check (char_length(description) <= 500000),
    constraint tasks_total_minutes_check
        check (total_minutes >= 0::numeric and total_minutes <= 999999::numeric)
);


-- =============================================================================
-- SECTION 4: Task-children tables (scoped via task -> project)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 tasks_assignees (legacy: tasks_assignees). Brief PK(task_id, team_member_id)
--     — team_member is the stable assignment identity. project_member_id NULLABLE
--     ON DELETE SET NULL. assigned_by -> users.
-- -----------------------------------------------------------------------------
create table if not exists public.tasks_assignees (
    task_id           uuid                                               not null,
    team_member_id    uuid                                               not null,
    project_member_id uuid,
    assigned_by       uuid,
    created_at        timestamp with time zone default current_timestamp not null,
    constraint tasks_assignees_pk primary key (task_id, team_member_id),
    constraint tasks_assignees_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint tasks_assignees_team_member_id_fk
        foreign key (team_member_id) references public.team_members (id) on delete cascade,
    constraint tasks_assignees_project_member_id_fk
        foreign key (project_member_id) references public.project_members (id) on delete set null,
    constraint tasks_assignees_assigned_by_fk
        foreign key (assigned_by) references public.users (id)
);

-- -----------------------------------------------------------------------------
-- 4.2 task_labels (legacy: task_labels). Links a task to a team_label. Both FKs
--     CASCADE. PK(task_id, label_id).
-- -----------------------------------------------------------------------------
create table if not exists public.task_labels (
    task_id  uuid not null,
    label_id uuid not null,
    constraint task_labels_pk primary key (task_id, label_id),
    constraint task_labels_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_labels_label_id_fk
        foreign key (label_id) references public.team_labels (id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 4.3 task_phase (legacy: task_phase). At most one phase per task -> task_id PK.
--     phase_id -> project_phases CASCADE.
-- -----------------------------------------------------------------------------
create table if not exists public.task_phase (
    task_id  uuid not null,
    phase_id uuid not null,
    constraint task_phase_pk primary key (task_id),
    constraint task_phase_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_phase_phase_id_fk
        foreign key (phase_id) references public.project_phases (id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 4.4 task_comments (legacy: task_comments, simplified). Inline content (legacy
--     used a separate task_comment_contents table). created_by -> users.
-- -----------------------------------------------------------------------------
create table if not exists public.task_comments (
    id         uuid                     default gen_random_uuid() not null,
    task_id    uuid                                               not null,
    content    text                                               not null,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint task_comments_pk primary key (id),
    constraint task_comments_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_comments_created_by_fk
        foreign key (created_by) references public.users (id)
);


-- =============================================================================
-- SECTION 5: Indexes
-- =============================================================================
-- NOTE: legacy used CREATE INDEX CONCURRENTLY for some; concurrently is not
-- allowed inside a migration transaction block, so plain CREATE INDEX is used.

-- task_statuses
create index if not exists task_statuses_project_id_index
    on public.task_statuses (project_id);
create index if not exists task_statuses_team_id_index
    on public.task_statuses (team_id);
create index if not exists task_statuses_category_id_index
    on public.task_statuses (category_id);

-- tasks
create index if not exists tasks_project_id_index
    on public.tasks (project_id);
create index if not exists tasks_status_id_index
    on public.tasks (status_id);
create index if not exists tasks_priority_id_index
    on public.tasks (priority_id);
create index if not exists tasks_parent_task_id_index
    on public.tasks (parent_task_id);
create index if not exists tasks_reporter_id_index
    on public.tasks (reporter_id);
-- (UNIQUE(project_id, task_no) is enforced by the table constraint above.)

-- task-children
create index if not exists tasks_assignees_team_member_id_index
    on public.tasks_assignees (team_member_id);
create index if not exists tasks_assignees_project_member_id_index
    on public.tasks_assignees (project_member_id);
create index if not exists task_labels_label_id_index
    on public.task_labels (label_id);
create index if not exists task_phase_phase_id_index
    on public.task_phase (phase_id);
create index if not exists task_comments_task_id_index
    on public.task_comments (task_id);
create index if not exists task_comments_created_by_index
    on public.task_comments (created_by);


-- =============================================================================
-- SECTION 6: Triggers + trigger functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 6.1 assign_task_no() — BEFORE INSERT on tasks. If task_no is null, atomically
--     bump the project's tasks_counter and use the new value as task_no. The
--     UPDATE ... RETURNING is atomic per-row (row lock on the projects row), so
--     concurrent inserts get distinct, gap-free numbers per project.
--     (Legacy: update_project_tasks_counter_trigger_fn.)
-- -----------------------------------------------------------------------------
create or replace function public.assign_task_no()
    returns trigger
    language plpgsql
    set search_path = public
as
$$
begin
    if new.task_no is null then
        update public.projects
            set tasks_counter = tasks_counter + 1
            where id = new.project_id
            returning tasks_counter into new.task_no;
    end if;
    return new;
end;
$$;

drop trigger if exists tasks_assign_task_no on public.tasks;
create trigger tasks_assign_task_no
    before insert on public.tasks
    for each row
    execute function public.assign_task_no();

-- -----------------------------------------------------------------------------
-- 6.2 set_task_completed() — BEFORE INSERT OR UPDATE on tasks. Looks up the
--     status's category; if is_done then done=true and completed_at is set
--     (keeps an existing completed_at if one was supplied), else done=false and
--     completed_at is cleared. Pinned search_path (reads task_statuses /
--     sys_task_status_categories). (Legacy: task_status_change_trigger_fn, here
--     consolidated into a BEFORE trigger so done/completed_at stay consistent on
--     insert too.)
-- -----------------------------------------------------------------------------
create or replace function public.set_task_completed()
    returns trigger
    language plpgsql
    set search_path = public
as
$$
declare
    _is_done boolean := false;
begin
    if new.status_id is not null then
        select c.is_done
            into _is_done
            from public.task_statuses s
            join public.sys_task_status_categories c on c.id = s.category_id
            where s.id = new.status_id;
        _is_done := coalesce(_is_done, false);
    end if;

    if _is_done then
        new.done := true;
        new.completed_at := coalesce(new.completed_at, now());
    else
        new.done := false;
        new.completed_at := null;
    end if;

    return new;
end;
$$;

drop trigger if exists tasks_set_completed on public.tasks;
create trigger tasks_set_completed
    before insert or update on public.tasks
    for each row
    execute function public.set_task_completed();

-- -----------------------------------------------------------------------------
-- 6.3 set_task_updated_at() — BEFORE UPDATE on tasks (touch updated_at).
--     (Legacy: set_task_updated_at_trigger_fn.)
-- -----------------------------------------------------------------------------
create or replace function public.set_task_updated_at()
    returns trigger
    language plpgsql
as
$$
begin
    new.updated_at := current_timestamp;
    return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
    before update on public.tasks
    for each row
    execute function public.set_task_updated_at();

-- -----------------------------------------------------------------------------
-- 6.4 seed_default_task_statuses() — AFTER INSERT on projects. Inserts the three
--     default per-project statuses (To Do / Doing / Done) mapped to the system
--     categories, so a freshly-created project is immediately usable. Pinned
--     search_path (reads sys_task_status_categories). Idempotent per project:
--     skips if any status already exists for the project (guards re-entrancy).
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_task_statuses()
    returns trigger
    language plpgsql
    set search_path = public
as
$$
begin
    if exists (select 1 from public.task_statuses where project_id = new.id) then
        return new;
    end if;

    insert into public.task_statuses (name, project_id, team_id, category_id, sort_order)
    select v.name, new.id, new.team_id, cat.id, v.sort_order
    from (values
            ('To Do', true,  false, false, 0),
            ('Doing', false, true,  false, 1),
            ('Done',  false, false, true,  2)
         ) as v(name, want_todo, want_doing, want_done, sort_order)
    join lateral (
        select c.id
        from public.sys_task_status_categories c
        where (v.want_todo  and c.is_todo)
           or (v.want_doing and c.is_doing)
           or (v.want_done  and c.is_done)
        order by c.sort_order
        limit 1
    ) cat on true;

    return new;
end;
$$;

drop trigger if exists projects_seed_default_task_statuses on public.projects;
create trigger projects_seed_default_task_statuses
    after insert on public.projects
    for each row
    execute function public.seed_default_task_statuses();


-- =============================================================================
-- SECTION 7: RLS helper + create_task RPC (SECURITY DEFINER)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7.1 is_task_member(_task_id) — true if the caller is a member of the task's
--     project's team. SECURITY DEFINER + pinned search_path so it reads tasks
--     with RLS bypassed (avoids recursion through task-children policies). STABLE.
-- -----------------------------------------------------------------------------
create or replace function public.is_task_member(_task_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select public.is_project_team_member(
        (select t.project_id from public.tasks t where t.id = _task_id)
    );
$$;

-- -----------------------------------------------------------------------------
-- 7.2 create_task RPC. Verifies the caller is a member of the project's team,
--     resolves the status (given, else the project's first To-Do-category
--     status), inserts the task (reporter = auth.uid()), and inserts the given
--     assignees. Returns the new task id. SECURITY DEFINER + pinned search_path
--     (public, extensions) — it writes across tenant tables on behalf of
--     auth.uid() and relies on implicit casts (no explicit ::uuid in the body
--     that would need extensions for gen_random_uuid()).
-- -----------------------------------------------------------------------------
create or replace function public.create_task(
    p_name           text,
    p_project_id     uuid,
    p_status_id      uuid    default null,
    p_priority_id    uuid    default null,
    p_parent_task_id uuid    default null,
    p_assignees      uuid[]  default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id           uuid := auth.uid();
    _task_id           uuid;
    _task_name         text;
    _status_id         uuid;
    _team_member_id    uuid;
    _project_member_id uuid;
begin
    if _user_id is null then
        raise exception 'create_task: no authenticated user';
    end if;

    -- Caller MUST be a member of the project's team.
    if not public.is_project_team_member(p_project_id) then
        raise exception 'create_task: caller is not a member of project %', p_project_id;
    end if;

    _task_name := left(trim(coalesce(p_name, '')), 500);
    if _task_name = '' then
        raise exception 'create_task: task name is required';
    end if;

    -- Resolve the status: the caller-supplied one (if it belongs to this
    -- project), else the project's first To-Do-category status by sort_order.
    if p_status_id is not null then
        select s.id into _status_id
        from public.task_statuses s
        where s.id = p_status_id and s.project_id = p_project_id;
    end if;

    if _status_id is null then
        select s.id into _status_id
        from public.task_statuses s
        join public.sys_task_status_categories c on c.id = s.category_id
        where s.project_id = p_project_id and c.is_todo is true
        order by s.sort_order
        limit 1;
    end if;

    -- Insert the task (reporter = caller). task_no + done/completed_at are filled
    -- by the BEFORE triggers; sort_order is appended after the project's max.
    insert into public.tasks (name, description, project_id, status_id, priority_id,
                              reporter_id, parent_task_id, sort_order)
    values (_task_name, null, p_project_id, _status_id, p_priority_id,
            _user_id, p_parent_task_id,
            coalesce((select max(sort_order) + 1 from public.tasks
                      where project_id = p_project_id), 0))
    returning id into _task_id;

    -- Assignees: each is a team_members.id. Resolve the matching project_members
    -- row (if any) for project_member_id; skip duplicates.
    if p_assignees is not null then
        foreach _team_member_id in array p_assignees
        loop
            select pm.id into _project_member_id
            from public.project_members pm
            where pm.project_id = p_project_id
              and pm.team_member_id = _team_member_id
            limit 1;

            insert into public.tasks_assignees (task_id, team_member_id,
                                                project_member_id, assigned_by)
            values (_task_id, _team_member_id, _project_member_id, _user_id)
            on conflict (task_id, team_member_id) do nothing;

            _project_member_id := null;
        end loop;
    end if;

    return _task_id;
end;
$$;


-- =============================================================================
-- SECTION 8: Enable Row Level Security + policies
-- =============================================================================
alter table public.sys_task_status_categories enable row level security;
alter table public.task_priorities            enable row level security;
alter table public.task_statuses              enable row level security;
alter table public.tasks                      enable row level security;
alter table public.tasks_assignees            enable row level security;
alter table public.task_labels                enable row level security;
alter table public.task_phase                 enable row level security;
alter table public.task_comments              enable row level security;

-- Convention (matches Phases 1-3): drop-then-create so the migration is
-- re-runnable; policies target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 8.1 sys_task_status_categories / task_priorities — lookups: read-only to any
--     authenticated user; no write policy (writes via service_role only).
-- -------------------------------------------------------------------
drop policy if exists sys_task_status_categories_select on public.sys_task_status_categories;
create policy sys_task_status_categories_select on public.sys_task_status_categories
    for select to authenticated using (true);

drop policy if exists task_priorities_select on public.task_priorities;
create policy task_priorities_select on public.task_priorities
    for select to authenticated using (true);

-- -------------------------------------------------------------------
-- 8.2 task_statuses — project team members read + write
-- -------------------------------------------------------------------
drop policy if exists task_statuses_select on public.task_statuses;
create policy task_statuses_select on public.task_statuses
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists task_statuses_insert on public.task_statuses;
create policy task_statuses_insert on public.task_statuses
    for insert to authenticated
    with check (public.is_project_team_member(project_id));

drop policy if exists task_statuses_update on public.task_statuses;
create policy task_statuses_update on public.task_statuses
    for update to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));

drop policy if exists task_statuses_delete on public.task_statuses;
create policy task_statuses_delete on public.task_statuses
    for delete to authenticated
    using (public.is_project_team_member(project_id));

-- -------------------------------------------------------------------
-- 8.3 tasks — project team members read/insert/update; admins/owner OR the
--     reporter may delete.
-- -------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
    for insert to authenticated
    with check (public.is_project_team_member(project_id));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
    for update to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
    for delete to authenticated
    using (public.is_project_team_admin(project_id) or reporter_id = auth.uid());

-- -------------------------------------------------------------------
-- 8.4 tasks_assignees — all ops gated by is_task_member(task_id).
-- -------------------------------------------------------------------
drop policy if exists tasks_assignees_select on public.tasks_assignees;
create policy tasks_assignees_select on public.tasks_assignees
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists tasks_assignees_insert on public.tasks_assignees;
create policy tasks_assignees_insert on public.tasks_assignees
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists tasks_assignees_update on public.tasks_assignees;
create policy tasks_assignees_update on public.tasks_assignees
    for update to authenticated
    using (public.is_task_member(task_id))
    with check (public.is_task_member(task_id));

drop policy if exists tasks_assignees_delete on public.tasks_assignees;
create policy tasks_assignees_delete on public.tasks_assignees
    for delete to authenticated
    using (public.is_task_member(task_id));

-- -------------------------------------------------------------------
-- 8.5 task_labels — all ops gated by is_task_member(task_id).
-- -------------------------------------------------------------------
drop policy if exists task_labels_select on public.task_labels;
create policy task_labels_select on public.task_labels
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists task_labels_insert on public.task_labels;
create policy task_labels_insert on public.task_labels
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists task_labels_update on public.task_labels;
create policy task_labels_update on public.task_labels
    for update to authenticated
    using (public.is_task_member(task_id))
    with check (public.is_task_member(task_id));

drop policy if exists task_labels_delete on public.task_labels;
create policy task_labels_delete on public.task_labels
    for delete to authenticated
    using (public.is_task_member(task_id));

-- -------------------------------------------------------------------
-- 8.6 task_phase — all ops gated by is_task_member(task_id).
-- -------------------------------------------------------------------
drop policy if exists task_phase_select on public.task_phase;
create policy task_phase_select on public.task_phase
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists task_phase_insert on public.task_phase;
create policy task_phase_insert on public.task_phase
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists task_phase_update on public.task_phase;
create policy task_phase_update on public.task_phase
    for update to authenticated
    using (public.is_task_member(task_id))
    with check (public.is_task_member(task_id));

drop policy if exists task_phase_delete on public.task_phase;
create policy task_phase_delete on public.task_phase
    for delete to authenticated
    using (public.is_task_member(task_id));

-- -------------------------------------------------------------------
-- 8.7 task_comments — members read/insert; the author OR a project admin may
--     update/delete.
-- -------------------------------------------------------------------
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments
    for update to authenticated
    using (
        created_by = auth.uid()
        or public.is_project_team_admin(
            (select t.project_id from public.tasks t where t.id = task_id))
    )
    with check (
        created_by = auth.uid()
        or public.is_project_team_admin(
            (select t.project_id from public.tasks t where t.id = task_id))
    );

drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments
    for delete to authenticated
    using (
        created_by = auth.uid()
        or public.is_project_team_admin(
            (select t.project_id from public.tasks t where t.id = task_id))
    );


-- =============================================================================
-- SECTION 9: Lookup seed (idempotent) — sys_task_status_categories / task_priorities
-- =============================================================================
-- Ported from legacy 2_dml.sql (sys_insert_task_status_categories /
-- sys_insert_task_priorities). The SAME rows are also appended to seed.sql so a
-- `supabase db reset` seeds them; this inline copy makes a migrate-only apply
-- self-sufficient. Guarded with WHERE NOT EXISTS so re-running is safe.
insert into public.sys_task_status_categories (name, color_code, sort_order, is_todo, is_doing, is_done)
select v.name, v.color_code, v.sort_order, v.is_todo, v.is_doing, v.is_done
from (values
    ('To Do', '#a9a9a9', 0, true,  false, false),
    ('Doing', '#70a6f3', 1, false, true,  false),
    ('Done',  '#75c997', 2, false, false, true)
) as v(name, color_code, sort_order, is_todo, is_doing, is_done)
where not exists (
    select 1 from public.sys_task_status_categories c where c.name = v.name
);

insert into public.task_priorities (name, value, color_code)
select v.name, v.value, v.color_code
from (values
    ('Low',    0, '#75c997'),
    ('Medium', 1, '#fbc84c'),
    ('High',   2, '#f37070')
) as v(name, value, color_code)
where not exists (
    select 1 from public.task_priorities p where p.name = v.name
);


-- =============================================================================
-- SECTION 10: Function execute grants
-- =============================================================================
grant execute on function public.is_task_member(uuid) to authenticated;
grant execute on function public.create_task(text, uuid, uuid, uuid, uuid, uuid[]) to authenticated;


-- =============================================================================
-- SECTION 11: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated. Lookups also grant SELECT to anon.
grant select, insert, update, delete on public.task_statuses   to authenticated;
grant select, insert, update, delete on public.tasks           to authenticated;
grant select, insert, update, delete on public.tasks_assignees to authenticated;
grant select, insert, update, delete on public.task_labels     to authenticated;
grant select, insert, update, delete on public.task_phase      to authenticated;
grant select, insert, update, delete on public.task_comments   to authenticated;
grant select on public.sys_task_status_categories to authenticated, anon;
grant select on public.task_priorities            to authenticated, anon;

grant all on public.sys_task_status_categories to service_role;
grant all on public.task_priorities            to service_role;
grant all on public.task_statuses              to service_role;
grant all on public.tasks                      to service_role;
grant all on public.tasks_assignees            to service_role;
grant all on public.task_labels                to service_role;
grant all on public.task_phase                 to service_role;
grant all on public.task_comments              to service_role;

-- =============================================================================
-- END Phase 4
-- =============================================================================
