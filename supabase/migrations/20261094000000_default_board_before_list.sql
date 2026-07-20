-- =============================================================================
-- Default view order: Board before List
-- =============================================================================
-- The default project tab strip becomes Board | List, followed by the fixed
-- utility tabs (Doc | Activity | Overview, ordered in the code registry).
--
-- The backfill only touches projects still sitting on the untouched default
-- (exactly List + Board, List first) — a project whose views were reordered or
-- extended is a deliberate arrangement and is left alone.
-- =============================================================================

create or replace function public.seed_default_project_views()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    insert into public.project_views (project_id, view_key, position)
    values (new.id, 'board', 0), (new.id, 'list', 1)
    on conflict (project_id, view_key) do nothing;
    return new;
end;
$$;

with untouched as (
    select v.project_id
      from public.project_views v
     group by v.project_id
    having count(*) = 2
       and bool_or(v.view_key = 'list'  and v.position = 0)
       and bool_or(v.view_key = 'board' and v.position = 1)
)
update public.project_views v
   set position = case v.view_key when 'board' then 0 else 1 end
  from untouched u
 where u.project_id = v.project_id;
