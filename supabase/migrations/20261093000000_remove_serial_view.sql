-- =============================================================================
-- Remove the Serial view (reverts 20261090 / 20261091)
-- =============================================================================
-- The default tab strip goes back to List | Board, followed by the fixed
-- utility tabs. Serial is dropped from every project and from the seed, and
-- the remaining views are renumbered into a clean run so no gap is left where
-- Serial used to sit.
-- =============================================================================

-- Back to the pre-Serial default for new projects.
create or replace function public.seed_default_project_views()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    insert into public.project_views (project_id, view_key, position)
    values (new.id, 'list', 0), (new.id, 'board', 1)
    on conflict (project_id, view_key) do nothing;
    return new;
end;
$$;

delete from public.project_views where view_key = 'serial';

-- Close the hole Serial left behind (e.g. list 0, board 2 -> list 0, board 1).
with ordered as (
    select
        v.project_id,
        v.view_key,
        row_number() over (
            partition by v.project_id
            order by v.position, v.view_key
        ) - 1 as new_position
    from public.project_views v
)
update public.project_views v
   set position = o.new_position
  from ordered o
 where o.project_id = v.project_id
   and o.view_key = v.view_key
   and v.position is distinct from o.new_position;
