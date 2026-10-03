-- Flush the DEV database back to an empty app: every row of app data in
-- `public` and every login in `auth` — keeping the schema, the reference and
-- platform-configuration tables listed in `flush_keep` below, the migration
-- history and the pg_cron jobs. Storage files are removed separately, through
-- the Storage API (storage.objects refuses direct deletes).
--
-- Run it through scripts/flush-dev-db.sh, which picks a reachable connection,
-- writes the backup script, asks before flushing and removes the files.
-- Modes:
--
--   -v mode=guard     only prove this is the dev database, then stop
--   -v mode=plan      (default) what would go and what stays; changes nothing
--   -v mode=rehearse  runs every step (backup included), checks, then ROLLS BACK
--   -v mode=flush     runs every step, checks the result, and commits
--
-- rehearse and flush lock every table they empty, then run `-v backup=<file>`
-- (a list of \copy commands the wrapper generates) inside the same
-- transaction: the backup holds exactly the rows the flush removes. flush
-- refuses to run without one.
--
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v mode=plan -f scripts/flush-dev-db.sql
--
-- One transaction: any failure (a lock that won't come, a check that fails)
-- rolls the whole flush back.

\set ON_ERROR_STOP on
\if :{?mode}
\else
  \set mode plan
\endif
select :'mode' in ('guard', 'plan', 'rehearse', 'flush') as mode_ok,
       :'mode' = 'guard' as is_guard,
       :'mode' = 'plan' as is_plan,
       :'mode' = 'flush' as is_flush
\gset
\if :mode_ok
\else
  \echo 'mode must be guard, plan, rehearse or flush'
  select 1 / 0 as bad_mode;
\endif

-- Which server is this? A URL can name one host while libpq connects to
-- another (a host= parameter, PGHOSTADDR), so ask the server itself: the
-- moment its Storage schema was created is the dev project's provisioning
-- time, to the microsecond, and no other project shares it. If the dev
-- project is ever recreated, update the value.
select coalesce((select min(executed_at) from storage.migrations)
                = timestamp '2026-09-19 10:58:49.367693', false) as is_dev
\gset
\if :is_dev
\else
  \echo 'Refusing: this is not the dev database (sivarqzgyeniuveqnjtq).'
  select 1 / 0 as not_the_dev_database;
\endif
\if :is_guard
  \quit
\endif
-- Since 2026-10-03 this project IS production (cubes.im runs on it). Nothing
-- here may empty it again: only the read-only plan and the guard still run.
\if :is_plan
\else
  \echo 'Refusing: sivarqzgyeniuveqnjtq has been the production database since 2026-10-03. This script no longer flushes it.'
  select 1 / 0 as production_database;
\endif
\if :is_flush
  \if :{?backup}
  \else
    \echo 'Refusing: mode=flush needs -v backup=<file> — run it through scripts/flush-dev-db.sh.'
    select 1 / 0 as no_backup;
  \endif
\endif

begin;
-- Locking needs every table the flush empties; the running dev server or a
-- cron job can hold one. Fail fast (and roll back) rather than hang.
set local lock_timeout = '20s';

-- The tables that stay. Everything else in `public` is emptied — so a table
-- added by a later migration is flushed by default, never silently kept.
create temp table flush_keep (t regclass primary key) on commit drop;
insert into flush_keep (t) values
    -- Reference data every workspace reads (seeded by migrations / seed.sql,
    -- no tenant key; the sign-up and new-workspace triggers look these up).
    ('public.countries'),
    ('public.timezones'),
    ('public.sys_project_healths'),
    ('public.sys_project_statuses'),
    ('public.sys_task_status_categories'),
    ('public.task_priorities'),
    ('public.project_access_levels'),
    -- The permission catalogue (roles and their grants are per workspace).
    ('public.permissions'),
    ('public.permission_capabilities'),
    -- Free email providers that can't be claimed as an organisation's domain.
    ('public.blocked_email_domains'),
    -- Platform configuration from the admin center: email, pricing, billing,
    -- push and the app runner.
    ('public.platform_config'),
    ('public.platform_pricing'),
    ('public.platform_email_sender'),
    ('public.platform_email_templates'),
    ('public.platform_email_triggers'),
    ('public.platform_email_secrets'),
    ('public.billing_config'),
    ('public.push_config'),
    ('public.app_runner_config');

-- Every public table and whether it stays.
create temp table flush_plan (t regclass primary key, keep boolean not null, rows_before bigint) on commit drop;
insert into flush_plan (t, keep)
select c.oid::regclass, c.oid in (select k.t from flush_keep k)
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p');

\if :is_plan
\else
  -- From here to the end, nothing can write to a table the flush empties
  -- (reads carry on): the counts, the backup and the flush all see the same rows.
  do
  $$
  begin
      execute (select 'lock table ' || string_agg(t::text, ', ' order by t::text)
                      || ', auth.users, auth.identities in exclusive mode'
                 from flush_plan
                where not keep);
  end;
  $$;
\endif

create function pg_temp.flush_rows(t regclass) returns bigint
    language plpgsql
as
$$
declare
    n bigint;
begin
    execute format('select count(*) from %s', t) into n;
    return n;
end;
$$;
update flush_plan set rows_before = pg_temp.flush_rows(t);

\echo
\echo '== Kept (reference / platform configuration):'
select t as "table", rows_before as "rows" from flush_plan where keep order by t::text;
\echo '== Flushed:'
select count(*) as tables,
       count(*) filter (where rows_before > 0) as with_rows,
       coalesce(sum(rows_before), 0) as rows
  from flush_plan
 where not keep;
select (select count(*) from auth.users) as logins,
       (select count(*) from storage.objects) as "storage files (removed via the API)";

\if :is_plan
  rollback;
  \echo 'Plan only: nothing was changed.'
  \quit
\endif

-- 0. The backup: every table as CSV, taken under the locks above.
\if :{?backup}
  \echo 'Backing up every table…'
  \i :backup
\endif

-- 1. Empty every public table that isn't kept, in one TRUNCATE without
--    CASCADE: if anything outside the list still pointed into it, Postgres
--    refuses rather than quietly emptying that table too. The only such
--    pointers are kept tables' FKs into flushed ones (the platform tables'
--    `updated_by` → users): null the column, lift the FK for the TRUNCATE,
--    and put the same constraint back.
do
$$
declare
    b record;
    wipe text;
begin
    create temp table flush_bridges on commit drop as
    select c.conrelid::regclass as tbl,
           c.conname,
           pg_get_constraintdef(c.oid) as def,
           array(select a.attname
                   from unnest(c.conkey) k
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as cols
      from pg_constraint c
     where c.contype = 'f'
       and c.conrelid in (select t from flush_keep)
       and c.confrelid in (select t from flush_plan where not keep);

    for b in select * from flush_bridges loop
        execute format('update %s set %s', b.tbl,
                       (select string_agg(format('%I = null', col), ', ') from unnest(b.cols) col));
        execute format('alter table %s drop constraint %I', b.tbl, b.conname);
    end loop;

    select string_agg(t::text, ', ' order by t::text) into wipe from flush_plan where not keep;
    execute 'truncate table ' || wipe || ' restart identity';

    for b in select * from flush_bridges loop
        execute format('alter table %s add constraint %I %s', b.tbl, b.conname, b.def);
    end loop;
end;
$$;

-- 2. Every login. Inside `auth` the FKs cascade to identities, sessions,
--    refresh tokens and MFA rows; `public.users` (ON DELETE CASCADE) is
--    already empty.
delete from auth.users;

-- 3. pg_cron's run history (the jobs themselves stay). Best effort: it is
--    only a log, and not every project grants it.
do
$$
begin
    delete from cron.job_run_details;
exception
    when insufficient_privilege or undefined_table then
        raise notice 'cron.job_run_details left as it was (%).', sqlerrm;
end;
$$;

-- 4. Check the result before it can be committed.
do
$$
declare
    left_behind text;
    changed text;
begin
    select string_agg(format('%s (%s)', t, n), ', ') into left_behind
      from (select t, pg_temp.flush_rows(t) as n from flush_plan where not keep) x
     where n > 0;
    if left_behind is not null then
        raise exception 'flush left rows behind: %', left_behind;
    end if;

    select string_agg(format('%s (%s → %s)', t, rows_before, n), ', ') into changed
      from (select t, rows_before, pg_temp.flush_rows(t) as n from flush_plan where keep) x
     where n <> rows_before;
    if changed is not null then
        raise exception 'a kept table lost rows: %', changed;
    end if;

    if exists (select 1 from auth.users) then
        raise exception 'auth.users is not empty';
    end if;
end;
$$;

\if :is_flush
  commit;
  \echo 'Flushed: every public table but the kept ones is empty, and every login is gone.'
\else
  rollback;
  \echo 'Rehearsal passed: every step ran and every check held — then it was rolled back. Nothing changed.'
\endif
