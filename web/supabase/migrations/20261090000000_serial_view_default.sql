-- =============================================================================
-- Serial view: seed it by default, and backfill every existing project
-- =============================================================================
-- Projects previously seeded List (0) + Board (1). The default tab strip now
-- carries Serial between them — a flat, continuously numbered run of the
-- project's tasks — so every project reads: List | Serial | Board, followed by
-- the fixed utility tabs (Overview | Doc | Activity).
--
-- Positions are re-numbered rather than appended so Serial lands next to List
-- instead of after whatever the project already had.
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
    values (new.id, 'list', 0), (new.id, 'serial', 1), (new.id, 'board', 2)
    on conflict (project_id, view_key) do nothing;
    return new;
end;
$$;

-- ----- backfill existing projects -------------------------------------------
-- Make room: anything at or after Board's slot shifts right by one, so the
-- insert below can't collide on (project_id, position) orderings.
update public.project_views v
   set position = v.position + 1
 where v.view_key <> 'list'
   and exists (
        select 1 from public.project_views l
        where l.project_id = v.project_id and l.view_key = 'list'
   )
   and v.position >= 1
   and not exists (
        select 1 from public.project_views s
        where s.project_id = v.project_id and s.view_key = 'serial'
   );

insert into public.project_views (project_id, view_key, position)
select p.id, 'serial', 1
  from public.projects p
 where not exists (
        select 1 from public.project_views v
        where v.project_id = p.id and v.view_key = 'serial'
      )
on conflict (project_id, view_key) do nothing;
