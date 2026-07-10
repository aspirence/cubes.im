-- =============================================================================
-- Fix account deletion: give every FK that references public.users a sane
-- ON DELETE behaviour so deleting a user (account deletion) cleans up cleanly.
--   * ownership / membership / personal columns (named user_id) -> CASCADE
--   * authorship columns (owner_id, reporter_id, created_by, assigned_by, ...) -> SET NULL
-- Authorship columns are made NULLABLE first so SET NULL is legal.
-- Idempotent: re-running drops + re-adds the same constraints.
-- =============================================================================
do $$
declare
  r record;
  v_action  text;
  v_setnull boolean;
begin
  for r in
    select con.conname,
           con.conrelid::regclass::text as tbl,
           att.attname                  as col,
           att.attnotnull               as notnull
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum   = con.conkey[1]
    where con.contype  = 'f'
      and con.confrelid = 'public.users'::regclass
      and array_length(con.conkey, 1) = 1
      and con.conrelid::regclass::text like 'public.%'
  loop
    if r.col = 'user_id' then
      v_action := 'CASCADE';  v_setnull := false;
    else
      v_action := 'SET NULL'; v_setnull := true;
    end if;

    if v_setnull and r.notnull then
      execute format('alter table %s alter column %I drop not null', r.tbl, r.col);
    end if;

    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.users(id) on delete %s',
      r.tbl, r.conname, r.col, v_action
    );
    raise notice 'FK %.% -> users(id) ON DELETE %', r.tbl, r.col, v_action;
  end loop;
end
$$;
