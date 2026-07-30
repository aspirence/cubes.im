-- =============================================================================
-- Fix account deletion (corrected). The previous attempt filtered tables with
-- `conrelid::regclass::text like 'public.%'`, but regclass text omits the schema
-- when public is in search_path, so it matched 0 rows. This version joins
-- pg_namespace and qualifies every ALTER with the public schema.
--   * columns named user_id  -> ON DELETE CASCADE
--   * authorship columns     -> ON DELETE SET NULL (made nullable first)
-- Idempotent.
-- =============================================================================
do $$
declare
  r record;
  v_action  text;
  v_setnull boolean;
begin
  for r in
    select con.conname,
           cl.relname     as tbl,
           att.attname    as col,
           att.attnotnull as notnull
    from pg_constraint con
    join pg_class      cl  on cl.oid  = con.conrelid
    join pg_namespace  nsp on nsp.oid = cl.relnamespace
    join pg_attribute  att on att.attrelid = con.conrelid
                          and att.attnum   = con.conkey[1]
    where con.contype  = 'f'
      and con.confrelid = 'public.users'::regclass
      and array_length(con.conkey, 1) = 1
      and nsp.nspname   = 'public'
  loop
    if r.col = 'user_id' then
      v_action := 'CASCADE';  v_setnull := false;
    else
      v_action := 'SET NULL'; v_setnull := true;
    end if;

    if v_setnull and r.notnull then
      execute format('alter table public.%I alter column %I drop not null', r.tbl, r.col);
    end if;

    execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.users(id) on delete %s',
      r.tbl, r.conname, r.col, v_action
    );
    raise notice 'FK %.% -> users(id) ON DELETE %', r.tbl, r.col, v_action;
  end loop;
end
$$;
