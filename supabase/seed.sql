-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 1 seed data (lookup / system tables)
-- =============================================================================
-- Loaded by `supabase db reset` (configured via [db.seed] sql_paths in
-- config.toml). Only seeds the Phase 1 lookup tables. All inserts are guarded
-- so re-seeding is safe.
--
-- Ported from legacy cubes-backend/database/sql/2_dml.sql where source data
-- exists. NOTE on provenance:
--   * timezones            -> legacy seeds these from pg_timezone_names (kept).
--   * project_access_levels -> legacy sys_insert_project_access_levels() (kept).
--   * countries            -> legacy had NO seed data for countries. A small,
--                             representative set is provided here so org address
--                             forms work; extend as needed.
--   * permissions          -> legacy had NO seed data for permissions (the table
--                             existed but was unpopulated in the dump). A sensible
--                             Cubes permission catalog is provided here.
--
-- IMPORTANT — demo users are NOT seeded here.
--   Auth identities must be created through the Supabase Auth API (auth.users
--   is owned by GoTrue; inserting directly bypasses password hashing & the
--   handle_new_user() provisioning trigger semantics). The orchestrator will
--   seed demo auth users separately (e.g. via `supabase` admin API / a Node
--   script that calls auth.admin.createUser), which will then fan out into
--   public.users / organizations / teams / roles / team_members automatically
--   via the on_auth_user_created trigger. <-- placeholder, intentionally left
--   to the orchestrator.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- timezones  (legacy: INSERT ... SELECT FROM pg_timezone_names)
-- -----------------------------------------------------------------------------
-- Mirrors legacy 2_dml.sql exactly. abbrev/utc_offset come from the server's
-- timezone database. Guarded so re-running does not duplicate rows.
insert into public.timezones (name, abbrev, utc_offset)
select name, abbrev, utc_offset
from pg_timezone_names
where name not in (select name from public.timezones);


-- -----------------------------------------------------------------------------
-- project_access_levels  (legacy: sys_insert_project_access_levels())
-- -----------------------------------------------------------------------------
insert into public.project_access_levels (name, key)
select v.name, v.key
from (values
    ('Admin', 'ADMIN'),
    ('Member', 'MEMBER'),
    ('Project Manager', 'PROJECT_MANAGER')
) as v(name, key)
where not exists (
    select 1 from public.project_access_levels p where p.key = v.key
);


-- -----------------------------------------------------------------------------
-- countries  (no legacy seed — representative subset; extend as needed)
-- -----------------------------------------------------------------------------
insert into public.countries (code, name, phone, currency)
select v.code, v.name, v.phone, v.currency
from (values
    ('US', 'United States',        1,   'USD'),
    ('GB', 'United Kingdom',       44,  'GBP'),
    ('CA', 'Canada',               1,   'CAD'),
    ('AU', 'Australia',            61,  'AUD'),
    ('IN', 'India',                91,  'INR'),
    ('DE', 'Germany',              49,  'EUR'),
    ('FR', 'France',               33,  'EUR'),
    ('ES', 'Spain',                34,  'EUR'),
    ('PT', 'Portugal',             351, 'EUR'),
    ('NL', 'Netherlands',          31,  'EUR'),
    ('IT', 'Italy',                39,  'EUR'),
    ('BR', 'Brazil',               55,  'BRL'),
    ('MX', 'Mexico',               52,  'MXN'),
    ('JP', 'Japan',                81,  'JPY'),
    ('CN', 'China',                86,  'CNY'),
    ('KR', 'South Korea',          82,  'KRW'),
    ('SG', 'Singapore',            65,  'SGD'),
    ('AE', 'United Arab Emirates', 971, 'AED'),
    ('ZA', 'South Africa',         27,  'ZAR'),
    ('LK', 'Sri Lanka',            94,  'LKR')
) as v(code, name, phone, currency)
where not exists (
    select 1 from public.countries c where c.code = v.code
);


-- -----------------------------------------------------------------------------
-- permissions  (no legacy seed — Cubes-style permission catalog)
-- -----------------------------------------------------------------------------
-- TEXT ids. role_permissions references these. Grant assignment to roles is
-- handled by the app / later phases; here we only populate the catalog.
insert into public.permissions (id, name, description)
select v.id, v.name, v.description
from (values
    ('settings:manage',         'Manage Settings',        'Manage team and organization settings'),
    ('members:manage',          'Manage Members',         'Invite, edit, and remove team members'),
    ('roles:manage',            'Manage Roles',           'Create and edit roles and their permissions'),
    ('projects:create',         'Create Projects',        'Create new projects'),
    ('projects:manage',         'Manage Projects',        'Edit and delete projects'),
    ('projects:view',           'View Projects',          'View projects and their contents'),
    ('tasks:create',            'Create Tasks',           'Create new tasks'),
    ('tasks:manage',            'Manage Tasks',           'Edit and delete tasks'),
    ('tasks:assign',            'Assign Tasks',           'Assign tasks to members'),
    ('clients:manage',          'Manage Clients',         'Create, edit, and delete clients'),
    ('reports:view',            'View Reports',           'Access reporting and analytics'),
    ('billing:manage',          'Manage Billing',         'Manage subscription and billing')
) as v(id, name, description)
where not exists (
    select 1 from public.permissions p where p.id = v.id
);

-- =============================================================================
-- END Phase 1 seed
-- =============================================================================


-- =============================================================================
-- Phase 3 seed data (project lookup tables)
-- =============================================================================
-- Ported from legacy cubes-backend/database/sql/2_dml.sql
-- (sys_insert_project_statuses / sys_insert_project_healths). These rows are
-- ALSO inserted (idempotently) by the Phase 3 migration so a migrate-only apply
-- is self-sufficient; they are repeated here so `supabase db reset` seeds them.
-- All inserts are guarded (WHERE NOT EXISTS) so re-seeding is safe.

-- -----------------------------------------------------------------------------
-- sys_project_statuses  (legacy: sys_insert_project_statuses())
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- sys_project_healths  (legacy: sys_insert_project_healths())
-- -----------------------------------------------------------------------------
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
-- END Phase 3 seed
-- =============================================================================


-- =============================================================================
-- Phase 4 seed data (task lookup tables)
-- =============================================================================
-- Ported from legacy cubes-backend/database/sql/2_dml.sql
-- (sys_insert_task_status_categories / sys_insert_task_priorities). These rows
-- are ALSO inserted (idempotently) by the Phase 4 migration so a migrate-only
-- apply is self-sufficient; they are repeated here so `supabase db reset` seeds
-- them. All inserts are guarded (WHERE NOT EXISTS) so re-seeding is safe.

-- -----------------------------------------------------------------------------
-- sys_task_status_categories  (legacy: sys_insert_task_status_categories())
--   The three system categories: To Do (is_todo) / Doing (is_doing) / Done
--   (is_done). Legacy `index` column is `sort_order` here.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- task_priorities  (legacy: sys_insert_task_priorities())
--   Low / Medium / High with value 0 / 1 / 2.
-- -----------------------------------------------------------------------------
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
-- END Phase 4 seed
-- =============================================================================
