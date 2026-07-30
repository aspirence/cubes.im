-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 3: Projects
-- =============================================================================
-- Builds on Phase 1 (identity/tenancy) and Phase 2 (settings/onboarding). Adds
-- the project lookup tables (sys_project_statuses / sys_project_healths), the
-- team-scoped projects + project_folders tables, the project-scoped
-- project_phases + project_members tables, the user-scoped project_subscribers /
-- favorite_projects / archived_projects tables, the project-granular RLS helper
-- functions, and the create_project RPC.
--
-- Ported faithfully from the legacy Cubes Postgres schema
-- (cubes-backend/database/sql/{1_tables,2_dml,4_functions}.sql), with the
-- SAME Supabase adaptations Phases 1-2 established:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() (relied on via the
--     column DEFAULT, never cast explicitly in a function body)
--   * the legacy WL_HEX_COLOR domain -> plain text + an inline CHECK with the
--     same hex regex (keeps this migration self-contained; no cross-phase domain)
--   * RLS is enforced in the database; Phase 1's helper funcs are REUSED
--     (public.is_team_member / is_team_admin — NOT recreated here); Phase 3 adds
--     project-granular helpers (team_id_of_project / is_project_team_member /
--     is_project_team_admin) layered on top of them.
--
-- DEFERRALS (carried over from the legacy create_project, which did more):
--   * task_statuses / tasks / tasks_assignees   -> Phase 4 (tasks).
--   * project_task_list_cols                     -> Phase 4 (task list UI).
--   * project_logs                               -> later (activity/audit).
--   create_project here ONLY creates the project + the creator's project_members
--   row. See docs/phase3-notes.md.
--
-- Faithfulness notes vs. legacy columns (intentional, per the Phase 3 brief):
--   * projects.status_id / health_id          legacy NOT NULL  -> NULLABLE here
--     (so a project can be created without forcing a status; the app/UI defaults
--     are applied later). FK ON DELETE SET NULL instead of restricting.
--   * project_members.project_access_level_id / role_id  legacy NOT NULL ->
--     NULLABLE here (create_project resolves them when possible, else leaves
--     null). FK references kept.
--   * project_subscribers.team_member_id       legacy NOT NULL -> NULLABLE here.
--   * projects.estimated_man_days              kept INTEGER default 0.
--   * legacy projects extras NOT in the Phase 3 brief (phase_label,
--     estimated_working_days) are DROPPED for now (re-add in a later phase if a
--     UI needs them). hours_per_day default 8 kept.
--
-- Re-runnable where practical (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS / guarded ALTERs). The sys_* lookup SEED lives in
-- supabase/seed.sql (so `supabase db reset` seeds it); it is ALSO inserted
-- (idempotently) at the end of this migration so a migrate-only apply has the
-- lookup rows available.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Lookup / system tables (no tenant scope)
-- =============================================================================
-- Legacy color_code used the WL_HEX_COLOR domain; here it's text + an inline
-- hex CHECK (same convention as Phase 2). These are seeded (see SECTION 9 +
-- seed.sql) and readable by any authenticated user; no write policy.

-- -----------------------------------------------------------------------------
-- 1.1 sys_project_statuses (legacy: sys_project_statuses).
-- -----------------------------------------------------------------------------
create table if not exists public.sys_project_statuses (
    id         uuid    default gen_random_uuid() not null,
    name       text                              not null,
    color_code text                              not null,
    icon       text                              not null,
    sort_order integer default 0                 not null,
    is_default boolean default false             not null,
    constraint sys_project_statuses_pk primary key (id),
    constraint sys_project_statuses_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);

-- -----------------------------------------------------------------------------
-- 1.2 sys_project_healths (legacy: sys_project_healths).
-- -----------------------------------------------------------------------------
create table if not exists public.sys_project_healths (
    id         uuid    default gen_random_uuid() not null,
    name       text                              not null,
    color_code text                              not null,
    sort_order integer default 0                 not null,
    is_default boolean default false             not null,
    constraint sys_project_healths_pk primary key (id),
    constraint sys_project_healths_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);


-- =============================================================================
-- SECTION 2: Team-scoped tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 project_folders (legacy: project_folders). Team-scoped, self-referential
--     (parent_folder_id). created_by -> users. color_code default '#70a6f3'.
--     `key` kept (legacy NOT NULL); a per-team unique (team_id, key) index is
--     created below.
-- -----------------------------------------------------------------------------
create table if not exists public.project_folders (
    id               uuid                     default gen_random_uuid()    not null,
    name             text                                                  not null,
    key              text,
    color_code       text                     default '#70a6f3'::text      not null,
    team_id          uuid                                                  not null,
    created_by       uuid                                                  not null,
    parent_folder_id uuid,
    created_at       timestamp with time zone default current_timestamp    not null,
    updated_at       timestamp with time zone default current_timestamp    not null,
    constraint project_folders_pk primary key (id),
    constraint project_folders_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint project_folders_created_by_fk
        foreign key (created_by) references public.users (id),
    constraint project_folders_parent_folder_fk
        foreign key (parent_folder_id) references public.project_folders (id) on delete set null,
    constraint project_folders_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);

-- -----------------------------------------------------------------------------
-- 2.2 projects (legacy: projects). The team-scoped project entity.
--     status_id / health_id / category_id / folder_id / client_id are all
--     NULLABLE here (see header note). FKs mirror legacy ON DELETE semantics
--     where they make sense (client/category/folder set-null on parent delete).
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
    id                    uuid                     default gen_random_uuid() not null,
    name                  text                                               not null,
    key                   text                                               not null,
    color_code            text                     default '#70a6f3'::text   not null,
    notes                 text,
    team_id               uuid                                               not null,
    client_id             uuid,
    owner_id              uuid                                               not null,
    status_id             uuid,
    health_id             uuid,
    category_id           uuid,
    folder_id             uuid,
    start_date            timestamp with time zone,
    end_date              timestamp with time zone,
    estimated_man_days    integer                  default 0,
    hours_per_day         integer                  default 8,
    tasks_counter         integer                  default 0                 not null,
    use_manual_progress   boolean                  default false             not null,
    use_weighted_progress boolean                  default false             not null,
    use_time_progress     boolean                  default false             not null,
    created_at            timestamp with time zone default current_timestamp not null,
    updated_at            timestamp with time zone default current_timestamp not null,
    constraint projects_pk primary key (id),
    constraint projects_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint projects_client_id_fk
        foreign key (client_id) references public.clients (id) on delete set null,
    constraint projects_owner_id_fk
        foreign key (owner_id) references public.users (id),
    constraint projects_status_id_fk
        foreign key (status_id) references public.sys_project_statuses (id) on delete set null,
    constraint projects_health_id_fk
        foreign key (health_id) references public.sys_project_healths (id) on delete set null,
    constraint projects_category_id_fk
        foreign key (category_id) references public.project_categories (id) on delete set null,
    constraint projects_folder_id_fk
        foreign key (folder_id) references public.project_folders (id) on delete set null,
    constraint projects_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'),
    constraint projects_name_check  check (char_length(name) <= 100),
    constraint projects_notes_check check (char_length(notes) <= 500)
);


-- =============================================================================
-- SECTION 3: Project-scoped tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 project_phases (legacy: project_phases). Project-scoped; CASCADE on
--     project delete. sort_index default 0; start/end dates optional.
-- -----------------------------------------------------------------------------
create table if not exists public.project_phases (
    id         uuid                     default gen_random_uuid() not null,
    name       text                                               not null,
    color_code text                                               not null,
    project_id uuid                                               not null,
    sort_index integer                  default 0                 not null,
    start_date timestamp with time zone,
    end_date   timestamp with time zone,
    created_at timestamp with time zone default current_timestamp not null,
    constraint project_phases_pk primary key (id),
    constraint project_phases_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint project_phases_color_code_check
        check (color_code ~* '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
);

-- -----------------------------------------------------------------------------
-- 3.2 project_members (legacy: project_members). Links a team_member to a
--     project with an access level + role + default view. project_id and
--     team_member_id CASCADE on parent delete. project_access_level_id / role_id
--     are NULLABLE here (create_project resolves them when possible). A UNIQUE
--     (project_id, team_member_id) prevents duplicate memberships.
-- -----------------------------------------------------------------------------
create table if not exists public.project_members (
    id                      uuid                     default gen_random_uuid()  not null,
    project_id              uuid                                                not null,
    team_member_id          uuid                                                not null,
    project_access_level_id uuid,
    role_id                 uuid,
    default_view            text                     default 'TASK_LIST'::text  not null,
    created_at              timestamp with time zone default current_timestamp  not null,
    constraint project_members_pk primary key (id),
    constraint project_members_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint project_members_team_member_id_fk
        foreign key (team_member_id) references public.team_members (id) on delete cascade,
    constraint project_members_access_level_fk
        foreign key (project_access_level_id) references public.project_access_levels (id),
    constraint project_members_role_id_fk
        foreign key (role_id) references public.roles (id),
    constraint project_members_project_member_unique unique (project_id, team_member_id)
);


-- =============================================================================
-- SECTION 4: User-scoped tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 project_subscribers (legacy: project_subscribers). A user subscribed to a
--     project's activity. team_member_id NULLABLE here. Unique on
--     (user_id, project_id) so a user subscribes once per project.
-- -----------------------------------------------------------------------------
create table if not exists public.project_subscribers (
    id             uuid                     default gen_random_uuid() not null,
    user_id        uuid                                               not null,
    project_id     uuid                                               not null,
    team_member_id uuid,
    created_at     timestamp with time zone default current_timestamp not null,
    constraint project_subscribers_pk primary key (id),
    constraint project_subscribers_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint project_subscribers_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint project_subscribers_team_member_id_fk
        foreign key (team_member_id) references public.team_members (id) on delete set null,
    constraint project_subscribers_user_project_unique unique (user_id, project_id)
);

-- -----------------------------------------------------------------------------
-- 4.2 favorite_projects (legacy: favorite_projects). (user_id, project_id) PK.
-- -----------------------------------------------------------------------------
create table if not exists public.favorite_projects (
    user_id    uuid not null,
    project_id uuid not null,
    constraint favorite_projects_pk primary key (user_id, project_id),
    constraint favorite_projects_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint favorite_projects_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 4.3 archived_projects (legacy: archived_projects). Legacy PK was
--     (user_id, project_id). Here we keep a surrogate id PK and a UNIQUE
--     (project_id, user_id) — equivalent per-user uniqueness, plus a clean
--     single-column referenceable id for later phases.
-- -----------------------------------------------------------------------------
create table if not exists public.archived_projects (
    id         uuid default gen_random_uuid() not null,
    project_id uuid                           not null,
    user_id    uuid                           not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint archived_projects_pk primary key (id),
    constraint archived_projects_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint archived_projects_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint archived_projects_project_user_unique unique (project_id, user_id)
);


-- =============================================================================
-- SECTION 5: Indexes (ported from legacy indexes.sql, adapted for Phase 3)
-- =============================================================================
-- NOTE: legacy used CREATE INDEX CONCURRENTLY for some; concurrently is not
-- allowed inside a migration transaction block, so plain CREATE INDEX is used.

-- project_folders
create unique index if not exists project_folders_team_id_key_uindex
    on public.project_folders (team_id, key) where key is not null;
create unique index if not exists project_folders_team_id_name_uindex
    on public.project_folders (team_id, lower(name));
create index if not exists project_folders_team_id_index
    on public.project_folders (team_id);

-- projects
create index if not exists projects_team_id_index
    on public.projects (team_id);
create index if not exists projects_folder_id_index
    on public.projects (folder_id);
create index if not exists projects_client_id_index
    on public.projects (client_id);
create unique index if not exists projects_key_team_id_uindex
    on public.projects (lower(key), team_id);
create unique index if not exists projects_name_team_id_uindex
    on public.projects (lower(name), team_id);

-- project_phases
create unique index if not exists project_phases_name_project_uindex
    on public.project_phases (lower(name), project_id);
create index if not exists idx_project_phases_project_sort
    on public.project_phases (project_id, sort_index);

-- project_members
create index if not exists project_members_project_id_index
    on public.project_members (project_id);
create index if not exists project_members_team_member_id_index
    on public.project_members (team_member_id);

-- project_subscribers
create index if not exists project_subscribers_project_id_index
    on public.project_subscribers (project_id);
create index if not exists project_subscribers_user_id_index
    on public.project_subscribers (user_id);

-- favorite_projects / archived_projects
create index if not exists favorite_projects_project_id_index
    on public.favorite_projects (project_id);
create index if not exists archived_projects_project_id_index
    on public.archived_projects (project_id);
create index if not exists archived_projects_user_id_index
    on public.archived_projects (user_id);


-- =============================================================================
-- SECTION 6: Project-granular RLS helper functions (SECURITY DEFINER)
-- =============================================================================
-- Layered on top of Phase 1's is_team_member / is_team_admin. SECURITY DEFINER
-- with a pinned search_path so they read projects/team_members with RLS
-- bypassed (avoids recursion through the very policies that call them). They are
-- STABLE (no writes) and resolve the project's team once, then delegate.

-- team_id_of_project: returns projects.team_id for a given project (or null).
create or replace function public.team_id_of_project(_project_id uuid)
    returns uuid
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select p.team_id from public.projects p where p.id = _project_id;
$$;

-- is_project_team_member: true if the caller is an active member of the
-- project's team.
create or replace function public.is_project_team_member(_project_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select public.is_team_member(public.team_id_of_project(_project_id));
$$;

-- is_project_team_admin: true if the caller is an admin/owner of the project's
-- team OR is the project's owner (owner_id = auth.uid()).
create or replace function public.is_project_team_admin(_project_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select public.is_team_admin(public.team_id_of_project(_project_id))
        or exists (
            select 1 from public.projects p
            where p.id = _project_id
              and p.owner_id = auth.uid()
        );
$$;


-- =============================================================================
-- SECTION 7: create_project RPC (SECURITY DEFINER)
-- =============================================================================
-- Re-homed from legacy create_project(_body json). SIMPLIFIED & DEFERRED:
--   * Verifies the caller is_team_member(p_team_id) (else raises).
--   * Generates a project key from the name (uppercase alnum prefix) if the
--     caller doesn't pass one; keys are per-team-unique via index (collisions
--     would raise — acceptable for Phase 3; the app can pass an explicit key).
--   * Inserts the project with owner_id = auth.uid().
--   * Adds the creator as a project_members row, looking up their team_members
--     row for that team, and assigning the highest-privilege project_access_level
--     when resolvable (ADMIN > PROJECT_MANAGER > MEMBER), else null.
--   * Resolves the team's default (Member) role for the project_members row.
--   * Sets the project's default status to the sys_project_statuses is_default
--     row when one exists (else null).
-- DEFERRED (legacy did these; tasks come in Phase 4): task_statuses, tasks,
--   tasks_assignees, project_task_list_cols, project_logs. See docs.
-- SECURITY DEFINER + pinned search_path (public, extensions) because it writes
-- across tenant tables on behalf of auth.uid() and the project_members default
-- view / key generation rely on implicit casts (no explicit ::citext anywhere).
create or replace function public.create_project(
    p_name        text,
    p_team_id     uuid,
    p_client_id   uuid default null,
    p_color_code  text default null,
    p_category_id uuid default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id        uuid := auth.uid();
    _project_id     uuid;
    _project_name   text;
    _key            text;
    _color          text;
    _team_member_id uuid;
    _access_level   uuid;
    _role_id        uuid;
    _status_id      uuid;
begin
    if _user_id is null then
        raise exception 'create_project: no authenticated user';
    end if;

    -- Caller MUST be an active member of the target team.
    if not public.is_team_member(p_team_id) then
        raise exception 'create_project: caller is not a member of team %', p_team_id;
    end if;

    _project_name := left(trim(coalesce(p_name, '')), 100);
    if _project_name = '' then
        raise exception 'create_project: project name is required';
    end if;

    -- Reject duplicate (case-insensitive) project names within the team early
    -- with a clear message (the unique index would otherwise raise a generic
    -- constraint error).
    if exists (
        select 1 from public.projects
        where team_id = p_team_id and lower(name) = lower(_project_name)
    ) then
        raise exception 'create_project: a project named "%" already exists in this team', _project_name;
    end if;

    -- Derive a key: first 3 alphanumerics of the name, uppercased; fall back to
    -- 'PRJ' when the name has no alphanumerics. Per-team uniqueness is enforced
    -- by the projects_key_team_id_uindex index.
    _key := upper(left(regexp_replace(_project_name, '[^a-zA-Z0-9]', '', 'g'), 3));
    if _key = '' then
        _key := 'PRJ';
    end if;

    -- color_code: caller value if a valid hex, else the legacy default.
    _color := coalesce(p_color_code, '#70a6f3');

    -- Resolve the default project status (is_default) if one is seeded.
    select s.id into _status_id
    from public.sys_project_statuses s
    where s.is_default is true
    order by s.sort_order
    limit 1;

    -- Insert the project (owner = caller).
    insert into public.projects (name, key, color_code, team_id, client_id,
                                 owner_id, status_id, category_id)
    values (_project_name, _key, _color, p_team_id, p_client_id,
            _user_id, _status_id, p_category_id)
    returning id into _project_id;

    -- Resolve the caller's team_members row for this team.
    select tm.id into _team_member_id
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = _user_id
      and tm.active is true
    limit 1;

    -- Highest-privilege project access level, if the lookup is seeded.
    select pal.id into _access_level
    from public.project_access_levels pal
    order by case pal.key
                 when 'ADMIN'           then 1
                 when 'PROJECT_MANAGER' then 2
                 when 'MEMBER'          then 3
                 else 4
             end
    limit 1;

    -- The team's default (Member) role, if resolvable.
    select r.id into _role_id
    from public.roles r
    where r.team_id = p_team_id and r.default_role is true
    limit 1;

    -- Add the creator as a project member (only if we found their membership).
    if _team_member_id is not null then
        insert into public.project_members (project_id, team_member_id,
                                            project_access_level_id, role_id)
        values (_project_id, _team_member_id, _access_level, _role_id)
        on conflict (project_id, team_member_id) do nothing;
    end if;

    -- NOTE (DEFERRED to Phase 4): task_statuses (To Do / Doing / Done), tasks,
    -- tasks_assignees, project_task_list_cols and project_logs are intentionally
    -- NOT created here — those tables do not exist yet.

    return _project_id;
end;
$$;


-- =============================================================================
-- SECTION 8: Enable Row Level Security + policies
-- =============================================================================
alter table public.sys_project_statuses enable row level security;
alter table public.sys_project_healths  enable row level security;
alter table public.project_folders      enable row level security;
alter table public.projects             enable row level security;
alter table public.project_phases       enable row level security;
alter table public.project_members      enable row level security;
alter table public.project_subscribers  enable row level security;
alter table public.favorite_projects    enable row level security;
alter table public.archived_projects    enable row level security;

-- Convention (matches Phases 1-2): drop-then-create so the migration is
-- re-runnable; policies target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 8.1 sys_project_statuses / sys_project_healths — lookups: read-only to any
--     authenticated user; no write policy (writes via service_role only).
-- -------------------------------------------------------------------
drop policy if exists sys_project_statuses_select on public.sys_project_statuses;
create policy sys_project_statuses_select on public.sys_project_statuses
    for select to authenticated using (true);

drop policy if exists sys_project_healths_select on public.sys_project_healths;
create policy sys_project_healths_select on public.sys_project_healths
    for select to authenticated using (true);

-- -------------------------------------------------------------------
-- 8.2 project_folders — members read; admins write
-- -------------------------------------------------------------------
drop policy if exists project_folders_select on public.project_folders;
create policy project_folders_select on public.project_folders
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists project_folders_insert on public.project_folders;
create policy project_folders_insert on public.project_folders
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists project_folders_update on public.project_folders;
create policy project_folders_update on public.project_folders
    for update to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists project_folders_delete on public.project_folders;
create policy project_folders_delete on public.project_folders
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- -------------------------------------------------------------------
-- 8.3 projects — members read/insert; admins OR owner update/delete
-- -------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
    for insert to authenticated
    with check (public.is_team_member(team_id));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
    for update to authenticated
    using (public.is_team_admin(team_id) or owner_id = auth.uid())
    with check (public.is_team_admin(team_id) or owner_id = auth.uid());

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
    for delete to authenticated
    using (public.is_team_admin(team_id) or owner_id = auth.uid());

-- -------------------------------------------------------------------
-- 8.4 project_phases — project team members read; admins/owner write
-- -------------------------------------------------------------------
drop policy if exists project_phases_select on public.project_phases;
create policy project_phases_select on public.project_phases
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists project_phases_insert on public.project_phases;
create policy project_phases_insert on public.project_phases
    for insert to authenticated
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_phases_update on public.project_phases;
create policy project_phases_update on public.project_phases
    for update to authenticated
    using (public.is_project_team_admin(project_id))
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_phases_delete on public.project_phases;
create policy project_phases_delete on public.project_phases
    for delete to authenticated
    using (public.is_project_team_admin(project_id));

-- -------------------------------------------------------------------
-- 8.5 project_members — project team members read; admins/owner write
-- -------------------------------------------------------------------
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists project_members_insert on public.project_members;
create policy project_members_insert on public.project_members
    for insert to authenticated
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_members_update on public.project_members;
create policy project_members_update on public.project_members
    for update to authenticated
    using (public.is_project_team_admin(project_id))
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_members_delete on public.project_members;
create policy project_members_delete on public.project_members
    for delete to authenticated
    using (public.is_project_team_admin(project_id));

-- -------------------------------------------------------------------
-- 8.6 project_subscribers — strictly user-private (all ops)
-- -------------------------------------------------------------------
drop policy if exists project_subscribers_select on public.project_subscribers;
create policy project_subscribers_select on public.project_subscribers
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists project_subscribers_insert on public.project_subscribers;
create policy project_subscribers_insert on public.project_subscribers
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists project_subscribers_update on public.project_subscribers;
create policy project_subscribers_update on public.project_subscribers
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists project_subscribers_delete on public.project_subscribers;
create policy project_subscribers_delete on public.project_subscribers
    for delete to authenticated
    using (user_id = auth.uid());

-- -------------------------------------------------------------------
-- 8.7 favorite_projects — strictly user-private (all ops)
-- -------------------------------------------------------------------
drop policy if exists favorite_projects_select on public.favorite_projects;
create policy favorite_projects_select on public.favorite_projects
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists favorite_projects_insert on public.favorite_projects;
create policy favorite_projects_insert on public.favorite_projects
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists favorite_projects_update on public.favorite_projects;
create policy favorite_projects_update on public.favorite_projects
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists favorite_projects_delete on public.favorite_projects;
create policy favorite_projects_delete on public.favorite_projects
    for delete to authenticated
    using (user_id = auth.uid());

-- -------------------------------------------------------------------
-- 8.8 archived_projects — strictly user-private (all ops)
-- -------------------------------------------------------------------
drop policy if exists archived_projects_select on public.archived_projects;
create policy archived_projects_select on public.archived_projects
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists archived_projects_insert on public.archived_projects;
create policy archived_projects_insert on public.archived_projects
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists archived_projects_update on public.archived_projects;
create policy archived_projects_update on public.archived_projects
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists archived_projects_delete on public.archived_projects;
create policy archived_projects_delete on public.archived_projects
    for delete to authenticated
    using (user_id = auth.uid());


-- =============================================================================
-- SECTION 9: Lookup seed (idempotent) — sys_project_statuses / sys_project_healths
-- =============================================================================
-- Ported from legacy 2_dml.sql (sys_insert_project_statuses /
-- sys_insert_project_healths). The SAME rows are also appended to seed.sql so a
-- `supabase db reset` seeds them; this inline copy makes a migrate-only apply
-- self-sufficient. Guarded with WHERE NOT EXISTS so re-running is safe.
insert into public.sys_project_statuses (name, color_code, icon, sort_order, is_default)
select v.name, v.color_code, v.icon, v.sort_order, v.is_default
from (values
    ('Cancelled',   '#f37070', 'close-circle', 0, false),
    ('Blocked',     '#cbc8a1', 'stop',         1, false),
    ('On Hold',     '#cbc8a1', 'stop',         2, false),
    ('Proposed',    '#cbc8a1', 'clock-circle', 3, true),
    ('In Planning', '#cbc8a1', 'clock-circle', 4, false),
    ('In Progress', '#80ca79', 'clock-circle', 5, false),
    ('Completed',   '#80ca79', 'check-circle', 6, false),
    ('Continuous',  '#80ca79', 'clock-circle', 7, false)
) as v(name, color_code, icon, sort_order, is_default)
where not exists (
    select 1 from public.sys_project_statuses s where s.name = v.name
);

insert into public.sys_project_healths (name, color_code, sort_order, is_default)
select v.name, v.color_code, v.sort_order, v.is_default
from (values
    ('Not Set',         '#a9a9a9', 0, true),
    ('Needs Attention', '#fbc84c', 1, false),
    ('At Risk',         '#f37070', 2, false),
    ('Good',            '#75c997', 3, false)
) as v(name, color_code, sort_order, is_default)
where not exists (
    select 1 from public.sys_project_healths h where h.name = v.name
);


-- =============================================================================
-- SECTION 10: Function execute grants
-- =============================================================================
grant execute on function public.team_id_of_project(uuid)      to authenticated;
grant execute on function public.is_project_team_member(uuid)  to authenticated;
grant execute on function public.is_project_team_admin(uuid)   to authenticated;
grant execute on function public.create_project(text, uuid, uuid, text, uuid) to authenticated;


-- =============================================================================
-- SECTION 11: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated. Lookups also grant SELECT to anon.
grant select, insert, update, delete on public.project_folders     to authenticated;
grant select, insert, update, delete on public.projects            to authenticated;
grant select, insert, update, delete on public.project_phases      to authenticated;
grant select, insert, update, delete on public.project_members     to authenticated;
grant select, insert, update, delete on public.project_subscribers to authenticated;
grant select, insert, update, delete on public.favorite_projects   to authenticated;
grant select, insert, update, delete on public.archived_projects   to authenticated;
grant select on public.sys_project_statuses to authenticated, anon;
grant select on public.sys_project_healths  to authenticated, anon;

grant all on public.project_folders      to service_role;
grant all on public.projects             to service_role;
grant all on public.project_phases       to service_role;
grant all on public.project_members      to service_role;
grant all on public.project_subscribers  to service_role;
grant all on public.favorite_projects    to service_role;
grant all on public.archived_projects    to service_role;
grant all on public.sys_project_statuses to service_role;
grant all on public.sys_project_healths  to service_role;

-- =============================================================================
-- END Phase 3
-- =============================================================================
