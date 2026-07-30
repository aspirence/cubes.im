-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 1: Identity + Tenancy Core
-- =============================================================================
-- Ported faithfully from the legacy Cubes Postgres schema
-- (cubes-backend/database/sql/{0_extensions,1_tables,4_functions,triggers,indexes}.sql).
--
-- Scope (Phase 1 ONLY): identity + tenancy core. Projects / tasks / labels /
-- statuses / templates / billing-detail tables are deferred to later phases.
--
-- Key Supabase adaptations vs. legacy:
--   * uuid-ossp / uuid_generate_v4()  ->  pgcrypto gen_random_uuid()
--   * public.users becomes a PROFILE table keyed to auth.users(id)
--     (password / google_id / socket_id / user_no / temp_email / last_active dropped)
--   * email column is citext (replaces the legacy WL_EMAIL text+regex domain)
--   * provisioning logic (legacy register_user / create_new_team / role creation /
--     set_active_team) is re-homed into public.handle_new_user(), a SECURITY DEFINER
--     trigger on auth.users AFTER INSERT.
--   * RLS is enforced in the database (legacy enforced it in the Node backend).
--
-- This file is intended to be re-runnable where practical (IF NOT EXISTS, etc.).
-- =============================================================================

-- =============================================================================
-- SECTION 1: Extensions
-- =============================================================================
create extension if not exists pgcrypto with schema extensions;   -- gen_random_uuid()
create extension if not exists citext   with schema extensions;    -- case-insensitive email
create extension if not exists unaccent with schema extensions;    -- search (legacy used it)


-- =============================================================================
-- SECTION 2: Enumerated types
-- =============================================================================
-- Ported from legacy 1_tables.sql. Only LANGUAGE_TYPE is needed in Phase 1
-- (users.language). Wrapped in a guard so the migration is re-runnable.
do $$
begin
    if not exists (select 1 from pg_type where typname = 'language_type') then
        create type public.language_type as enum ('en', 'es', 'pt', 'alb', 'de', 'zh_cn', 'ko');
    end if;
end
$$;


-- =============================================================================
-- SECTION 3: Lookup / system tables (no tenant scope)
-- =============================================================================

-- timezones (legacy: timezones). Seeded from pg_timezone_names in seed.sql.
create table if not exists public.timezones (
    id         uuid     default gen_random_uuid() not null,
    name       text                               not null,
    abbrev     text                               not null,
    utc_offset interval                           not null,
    constraint timezones_pk primary key (id)
);

-- countries (legacy: countries).
create table if not exists public.countries (
    id       uuid       default gen_random_uuid() not null,
    code     char(2)                              not null,
    name     varchar(150)                         not null,
    phone    integer                              not null,
    currency varchar(3) default null::character varying,
    constraint countries_pk primary key (id)
);

-- project_access_levels (legacy: project_access_levels). Lookup used by
-- project_members in later phases; included now since it is a pure lookup
-- the orchestrator may want seeded early.
create table if not exists public.project_access_levels (
    id   uuid default gen_random_uuid() not null,
    name text                           not null,
    key  text                           not null,
    constraint project_access_levels_pk primary key (id)
);

-- permissions (legacy: permissions). TEXT id + name.
create table if not exists public.permissions (
    id          text not null,
    name        text not null,
    description text not null,
    constraint permissions_pk primary key (id)
);


-- =============================================================================
-- SECTION 4: Identity — users profile (keyed to auth.users)
-- =============================================================================
-- Legacy public.users was a standalone identity table. Here it becomes a PROFILE
-- table: id references auth.users(id). Supabase Auth owns password & OAuth ids,
-- so password / google_id / socket_id are dropped. user_no / temp_email /
-- last_active are dropped as non-essential to Phase 1.
--
-- active_team / timezone_id FKs are added later (after teams/timezones exist) so
-- ordering is not a problem; timezone_id is created here but its FK is added in
-- the constraints sub-section below. NOTE: legacy users.timezone_id was NOT NULL;
-- to keep handle_new_user robust we keep it NOT NULL but default it to UTC.
create table if not exists public.users (
    id              uuid                                              not null,
    name            text                                              not null,
    email           citext                                            not null,
    avatar_url      text,
    active_team     uuid,
    timezone_id     uuid,
    language        public.language_type     default 'en'::public.language_type,
    setup_completed boolean                  default false            not null,
    is_deleted      boolean                  default false,
    deleted_at      timestamp with time zone,
    created_at      timestamp with time zone default current_timestamp not null,
    updated_at      timestamp with time zone default current_timestamp not null,
    constraint users_pk primary key (id),
    constraint users_auth_fk foreign key (id) references auth.users (id) on delete cascade,
    constraint users_email_check check (char_length((email)::text) <= 255),
    constraint users_name_check check (char_length(name) <= 55)
);


-- =============================================================================
-- SECTION 5: Tenancy — organizations
-- =============================================================================
-- Legacy: organizations. Top-level billing tenant, owned by exactly one user
-- (user_id UNIQUE). Subscription / trial / storage / working_hours kept.
-- license_type_id kept as a plain UUID column (legacy had NO FK on it).
create table if not exists public.organizations (
    id                       uuid                     default gen_random_uuid() not null,
    organization_name        text                                               not null,
    contact_number           text,
    contact_number_secondary text,
    address_line_1           text,
    address_line_2           text,
    country                  uuid,
    city                     text,
    state                    text,
    postal_code              text,
    trial_in_progress        boolean                  default false             not null,
    trial_expire_date        date,
    subscription_status      text                     default 'active'::text    not null,
    storage                  integer                  default 1                 not null,
    updating_plan            boolean                  default false,
    user_id                  uuid                                               not null,
    license_type_id          uuid,
    is_lkr_billing           boolean                  default false,
    working_hours            double precision         default 8                 not null,
    created_at               timestamp with time zone default current_timestamp,
    updated_at               timestamp with time zone default current_timestamp,
    constraint organizations_pk primary key (id),
    constraint organizations_user_unique unique (user_id),
    constraint organizations_user_id_fk foreign key (user_id) references public.users (id) on delete cascade,
    constraint organizations_country_fk foreign key (country) references public.countries (id),
    constraint subscription_statuses_allowed
        check (subscription_status = any
               (array ['active'::text, 'past_due'::text, 'trialing'::text, 'paused'::text,
                       'deleted'::text, 'life_time_deal'::text, 'free'::text, 'custom'::text, 'credit'::text]))
);

-- organization_working_days (legacy: organization_working_days).
create table if not exists public.organization_working_days (
    id              uuid                     default gen_random_uuid() not null,
    monday          boolean                  default true              not null,
    tuesday         boolean                  default true              not null,
    wednesday       boolean                  default true              not null,
    thursday        boolean                  default true              not null,
    friday          boolean                  default true              not null,
    saturday        boolean                  default false             not null,
    sunday          boolean                  default false             not null,
    organization_id uuid                                               not null,
    created_at      timestamp with time zone default current_timestamp not null,
    updated_at      timestamp with time zone default current_timestamp not null,
    constraint organization_working_days_pk primary key (id),
    constraint org_working_days_organization_id_fk
        foreign key (organization_id) references public.organizations (id) on delete cascade
);


-- =============================================================================
-- SECTION 6: Tenancy — teams (the real isolation boundary)
-- =============================================================================
-- Legacy: teams. A workspace inside an organization; the practical tenancy
-- boundary for almost all app data.
create table if not exists public.teams (
    id              uuid                     default gen_random_uuid() not null,
    name            text                                               not null,
    user_id         uuid                                               not null,
    organization_id uuid,
    created_at      timestamp with time zone default current_timestamp not null,
    updated_at      timestamp with time zone default current_timestamp not null,
    constraint teams_pk primary key (id),
    constraint teams_user_id_fk foreign key (user_id) references public.users (id),
    constraint teams_organization_id_fk foreign key (organization_id) references public.organizations (id),
    constraint teams_name_check check (char_length(name) <= 55)
);

-- Deferred FK on users.active_team (now that teams exists).
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'users_active_team_fk'
    ) then
        alter table public.users
            add constraint users_active_team_fk
                foreign key (active_team) references public.teams (id);
    end if;
end
$$;

-- Deferred FK on users.timezone_id (now that timezones exists).
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'users_timezone_id_fk'
    ) then
        alter table public.users
            add constraint users_timezone_id_fk
                foreign key (timezone_id) references public.timezones (id);
    end if;
end
$$;


-- =============================================================================
-- SECTION 7: Tenancy — roles, job_titles
-- =============================================================================

-- roles (legacy: roles). Team-scoped owner/admin/member with boolean flags.
create table if not exists public.roles (
    id           uuid    default gen_random_uuid() not null,
    name         text                              not null,
    team_id      uuid                              not null,
    default_role boolean default false             not null,
    admin_role   boolean default false             not null,
    owner        boolean default false             not null,
    constraint roles_pk primary key (id),
    constraint roles_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade
);

-- job_titles (legacy: job_titles). Team-scoped.
create table if not exists public.job_titles (
    id      uuid default gen_random_uuid() not null,
    name    text                           not null,
    team_id uuid                           not null,
    constraint job_titles_pk primary key (id),
    constraint job_titles_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint job_titles_name_check check (char_length(name) <= 55)
);


-- =============================================================================
-- SECTION 8: Tenancy — team_members (core membership / access-control row)
-- =============================================================================
-- Legacy: team_members. user_id is NULLABLE (pending email invites).
create table if not exists public.team_members (
    id           uuid                     default gen_random_uuid() not null,
    user_id      uuid,
    team_id      uuid                                               not null,
    role_id      uuid                                               not null,
    job_title_id uuid,
    active       boolean                  default true,
    created_at   timestamp with time zone default current_timestamp not null,
    updated_at   timestamp with time zone default current_timestamp not null,
    constraint team_members_pk primary key (id),
    constraint team_members_user_id_fk foreign key (user_id) references public.users (id) on delete cascade,
    constraint team_members_team_id_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint team_members_role_id_fk foreign key (role_id) references public.roles (id),
    constraint team_members_job_title_id_fk foreign key (job_title_id) references public.job_titles (id) on delete set null
);


-- =============================================================================
-- SECTION 9: Permissions join — role_permissions
-- =============================================================================
-- Legacy: role_permissions. (role_id, permission_id) PK.
create table if not exists public.role_permissions (
    role_id       uuid not null,
    permission_id text not null,
    constraint role_permissions_pk primary key (role_id, permission_id),
    constraint role_permissions_role_id_fk foreign key (role_id) references public.roles (id) on delete cascade,
    constraint role_permissions_permission_id_fk foreign key (permission_id) references public.permissions (id)
);


-- =============================================================================
-- SECTION 10: Indexes (ported from legacy indexes.sql, adapted for Phase 1)
-- =============================================================================
-- NOTE: legacy used CREATE INDEX CONCURRENTLY; concurrently is not allowed inside
-- a migration transaction block, so plain CREATE INDEX is used here.

-- lookups
create unique index if not exists permissions_name_uindex
    on public.permissions (name);
create unique index if not exists project_access_levels_key_uindex
    on public.project_access_levels (key);
create unique index if not exists project_access_levels_name_uindex
    on public.project_access_levels (name);

-- users
create unique index if not exists users_email_uindex
    on public.users (email);
create index if not exists users_active_team_index
    on public.users (active_team);

-- organizations / teams
create index if not exists organizations_user_id_index
    on public.organizations (user_id);
create index if not exists teams_organization_id_index
    on public.teams (organization_id);
create index if not exists teams_user_id_index
    on public.teams (user_id);

-- team_members (mirrors legacy idx_team_members_team_user / project_lookup)
create index if not exists idx_team_members_team_user
    on public.team_members (team_id, user_id)
    where active = true;
create index if not exists idx_team_members_user_id
    on public.team_members (user_id);
create index if not exists team_members_team_id_index
    on public.team_members (team_id);

-- roles / job_titles
create index if not exists roles_team_id_index
    on public.roles (team_id);
create unique index if not exists job_titles_name_team_id_uindex
    on public.job_titles (name, team_id);
create index if not exists job_titles_team_id_index
    on public.job_titles (team_id);

-- role_permissions
create index if not exists role_permissions_role_id_index
    on public.role_permissions (role_id);


-- =============================================================================
-- SECTION 11: lower_email trigger (ported from legacy triggers.sql)
-- =============================================================================
-- citext already makes email comparisons case-insensitive, but we still lower &
-- trim on write to match legacy data hygiene.
create or replace function public.lower_email()
    returns trigger
    language plpgsql
    set search_path = public, extensions
as
$$
begin
    if (new.email is not null and length(trim(new.email::text)) > 0) then
        -- assignment to the citext column auto-casts; no explicit ::citext needed
        new.email = lower(trim(new.email::text));
    end if;
    return new;
end;
$$;

drop trigger if exists users_email_lower on public.users;
create trigger users_email_lower
    before insert or update
    on public.users
    for each row
execute function public.lower_email();


-- =============================================================================
-- SECTION 12: RLS helper functions (SECURITY DEFINER)
-- =============================================================================
-- These are SECURITY DEFINER so they bypass RLS when they query team_members
-- directly. That is exactly what avoids infinite recursion: a policy ON
-- team_members that called a normal function selecting team_members would
-- re-trigger the same policy forever. By running as the function owner with
-- RLS bypassed (and a pinned search_path) we read membership safely.

-- is_team_member: true if an ACTIVE membership links the current user to _team_id.
create or replace function public.is_team_member(_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.team_members tm
        where tm.team_id = _team_id
          and tm.user_id = auth.uid()
          and tm.active is true
    );
$$;

-- is_team_admin: true if the current user's active membership in _team_id has a
-- role flagged owner OR admin_role.
create or replace function public.is_team_admin(_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.team_members tm
        join public.roles r on r.id = tm.role_id
        where tm.team_id = _team_id
          and tm.user_id = auth.uid()
          and tm.active is true
          and (r.owner is true or r.admin_role is true)
    );
$$;

-- is_org_member: true if the current user owns the org OR is an active member of
-- ANY team belonging to that org.
create or replace function public.is_org_member(_org_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1 from public.organizations o
        where o.id = _org_id
          and o.user_id = auth.uid()
    )
    or exists (
        select 1
        from public.team_members tm
        join public.teams t on t.id = tm.team_id
        where t.organization_id = _org_id
          and tm.user_id = auth.uid()
          and tm.active is true
    );
$$;

-- Helper: does the current user share an active team with a given user_id?
-- Used by the users-profile co-member SELECT policy. SECURITY DEFINER to avoid
-- recursion through team_members RLS.
create or replace function public.shares_team_with(_other_user_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.team_members me
        join public.team_members other on other.team_id = me.team_id
        where me.user_id = auth.uid()
          and me.active is true
          and other.user_id = _other_user_id
          and other.active is true
    );
$$;


-- =============================================================================
-- SECTION 13: Provisioning — handle_new_user() trigger on auth.users
-- =============================================================================
-- Re-homes the legacy register_user / create_new_team / role-creation /
-- set_active_team logic. Fires AFTER INSERT on auth.users and, in one shot:
--   1. inserts the public.users profile (name + email from auth metadata),
--   2. creates a default organization (owner = new user),
--   3. creates a default team in that organization,
--   4. creates Member / Admin / Owner roles for that team,
--   5. inserts the owner team_members row,
--   6. sets users.active_team to the new team.
-- SECURITY DEFINER so it can write to public.* regardless of the caller.
create or replace function public.handle_new_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _display_name text;
    _email        text;
    _team_name    text;
    _timezone_id  uuid;
    _org_id       uuid;
    _team_id      uuid;
    _owner_role   uuid;
begin
    _email := lower(trim(new.email));

    -- Prefer an explicit display name from auth metadata, else fall back to the
    -- email local-part. raw_user_meta_data keys mirror what Supabase Auth stores
    -- for email/password ('name') and common OAuth providers ('full_name').
    _display_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        split_part(_email, '@', 1)
    );
    -- users.name has a 55-char check; truncate defensively.
    _display_name := left(_display_name, 55);

    -- Team name: legacy used a provided team_name; default to "<name>'s Team".
    _team_name := left(coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'team_name'), ''),
        _display_name || '''s Team'
    ), 55);

    -- Resolve a timezone (UTC fallback). Lookups are seeded before any auth user.
    select id into _timezone_id from public.timezones where name = 'UTC' limit 1;

    -- 1. profile row
    insert into public.users (id, name, email, timezone_id)
    values (new.id, _display_name, _email, _timezone_id);

    -- 2. organization (owner = new user). Mirrors legacy register_user defaults:
    --    a long trial window + 'active' status. license_type_id left null (the
    --    sys_license_types lookup is out of Phase 1 scope).
    insert into public.organizations (user_id, organization_name, trial_in_progress,
                                      trial_expire_date, subscription_status)
    values (new.id, _team_name, true, current_date + interval '9999 days', 'active')
    returning id into _org_id;

    -- 3. team
    insert into public.teams (name, user_id, organization_id)
    values (_team_name, new.id, _org_id)
    returning id into _team_id;

    -- 4. default roles (matches legacy ordering & flags)
    insert into public.roles (name, team_id, default_role) values ('Member', _team_id, true);
    insert into public.roles (name, team_id, admin_role)   values ('Admin', _team_id, true);
    insert into public.roles (name, team_id, owner)        values ('Owner', _team_id, true)
        returning id into _owner_role;

    -- 5. owner membership
    insert into public.team_members (user_id, team_id, role_id, active)
    values (new.id, _team_id, _owner_role, true);

    -- 6. mark active team
    update public.users set active_team = _team_id where id = new.id;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row
execute function public.handle_new_user();


-- =============================================================================
-- SECTION 14: Enable Row Level Security
-- =============================================================================
alter table public.users                     enable row level security;
alter table public.organizations             enable row level security;
alter table public.organization_working_days enable row level security;
alter table public.teams                     enable row level security;
alter table public.team_members              enable row level security;
alter table public.roles                     enable row level security;
alter table public.job_titles                enable row level security;
alter table public.role_permissions          enable row level security;
alter table public.timezones                 enable row level security;
alter table public.countries                 enable row level security;
alter table public.project_access_levels     enable row level security;
alter table public.permissions               enable row level security;


-- =============================================================================
-- SECTION 15: RLS policies
-- =============================================================================
-- Convention: drop-then-create so the migration is re-runnable. Policies target
-- the `authenticated` role; service_role bypasses RLS entirely (used by the
-- handle_new_user trigger context / seed / admin tasks).

-- -------------------------------------------------------------------
-- 15.1 public.users — own profile, plus co-team-member profiles (read)
-- -------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
    for select to authenticated
    using (id = auth.uid() or public.shares_team_with(id));

drop policy if exists users_update on public.users;
create policy users_update on public.users
    for update to authenticated
    using (id = auth.uid())
    with check (id = auth.uid());

-- (No INSERT/DELETE policy: profile rows are created by the handle_new_user
--  trigger as service_role, and deleted via auth.users cascade.)

-- -------------------------------------------------------------------
-- 15.2 organizations — org members read; owner-only write
-- -------------------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
    for select to authenticated
    using (public.is_org_member(id));

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations
    for delete to authenticated
    using (user_id = auth.uid());

-- -------------------------------------------------------------------
-- 15.3 organization_working_days — scope via parent organization
-- -------------------------------------------------------------------
drop policy if exists org_working_days_select on public.organization_working_days;
create policy org_working_days_select on public.organization_working_days
    for select to authenticated
    using (public.is_org_member(organization_id));

drop policy if exists org_working_days_modify on public.organization_working_days;
create policy org_working_days_modify on public.organization_working_days
    for all to authenticated
    using (exists (select 1 from public.organizations o
                   where o.id = organization_working_days.organization_id
                     and o.user_id = auth.uid()))
    with check (exists (select 1 from public.organizations o
                        where o.id = organization_working_days.organization_id
                          and o.user_id = auth.uid()));

-- -------------------------------------------------------------------
-- 15.4 teams — members read; admins update/delete; org members insert
-- -------------------------------------------------------------------
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
    for select to authenticated
    using (public.is_team_member(id));

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams
    for insert to authenticated
    with check (public.is_org_member(organization_id));

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams
    for update to authenticated
    using (public.is_team_admin(id))
    with check (public.is_team_admin(id));

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams
    for delete to authenticated
    using (public.is_team_admin(id));

-- -------------------------------------------------------------------
-- 15.5 team_members — members read; admins write
-- -------------------------------------------------------------------
drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists team_members_insert on public.team_members;
create policy team_members_insert on public.team_members
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists team_members_update on public.team_members;
create policy team_members_update on public.team_members
    for update to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- -------------------------------------------------------------------
-- 15.6 roles — members read; admins write
-- -------------------------------------------------------------------
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
    for update to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- -------------------------------------------------------------------
-- 15.7 job_titles — members read; admins write
-- -------------------------------------------------------------------
drop policy if exists job_titles_select on public.job_titles;
create policy job_titles_select on public.job_titles
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists job_titles_insert on public.job_titles;
create policy job_titles_insert on public.job_titles
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists job_titles_update on public.job_titles;
create policy job_titles_update on public.job_titles
    for update to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists job_titles_delete on public.job_titles;
create policy job_titles_delete on public.job_titles
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- -------------------------------------------------------------------
-- 15.8 role_permissions — scope via the role's team
-- -------------------------------------------------------------------
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
    for select to authenticated
    using (exists (select 1 from public.roles r
                   where r.id = role_permissions.role_id
                     and public.is_team_member(r.team_id)));

drop policy if exists role_permissions_modify on public.role_permissions;
create policy role_permissions_modify on public.role_permissions
    for all to authenticated
    using (exists (select 1 from public.roles r
                   where r.id = role_permissions.role_id
                     and public.is_team_admin(r.team_id)))
    with check (exists (select 1 from public.roles r
                        where r.id = role_permissions.role_id
                          and public.is_team_admin(r.team_id)));

-- -------------------------------------------------------------------
-- 15.9 lookups — readable by any authenticated user; no write policy
--      (writes restricted to service_role, which bypasses RLS)
-- -------------------------------------------------------------------
drop policy if exists timezones_select on public.timezones;
create policy timezones_select on public.timezones
    for select to authenticated using (true);

drop policy if exists countries_select on public.countries;
create policy countries_select on public.countries
    for select to authenticated using (true);

drop policy if exists project_access_levels_select on public.project_access_levels;
create policy project_access_levels_select on public.project_access_levels
    for select to authenticated using (true);

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
    for select to authenticated using (true);


-- =============================================================================
-- SECTION 16: Function execute grants
-- =============================================================================
-- Helper functions are used inside policies; grant execute so the authenticated
-- role can call them (also handy if the app calls them directly).
grant execute on function public.is_team_member(uuid)   to authenticated;
grant execute on function public.is_team_admin(uuid)     to authenticated;
grant execute on function public.is_org_member(uuid)     to authenticated;
grant execute on function public.shares_team_with(uuid)  to authenticated;

-- =============================================================================
-- SECTION 17: Table privileges for the API roles
-- =============================================================================
-- Supabase's PostgREST connects as `anon` / `authenticated`. RLS (above) governs
-- which ROWS are visible/mutable; these grants govern TABLE-level access. Without
-- them every query would fail with "permission denied" before RLS is even checked.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- =============================================================================
-- END Phase 1
-- =============================================================================
