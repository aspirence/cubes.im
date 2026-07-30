-- =============================================================================
-- Repair Serial's position (fixes 20261090)
-- =============================================================================
-- 20261090 inserted Serial at a hardcoded position 1, assuming List always sits
-- at 0. Views are user-reorderable, so a project that had been rearranged (e.g.
-- Board 0, List 1) ended up with Serial colliding with List at the same
-- position — two tabs claiming one slot.
--
-- This renumbers EVERY project's views into a clean 0..n-1 sequence, ordering
-- by the position they already have and breaking ties so Serial lands directly
-- after List. Projects that were already correct come out unchanged.
-- =============================================================================

with ordered as (
    select
        v.project_id,
        v.view_key,
        row_number() over (
            partition by v.project_id
            order by
                v.position,
                -- Tie-break: List first, then Serial (so a colliding Serial
                -- settles immediately after List), then everything else.
                case v.view_key
                    when 'list'   then 0
                    when 'serial' then 1
                    else 2
                end,
                v.view_key
        ) - 1 as new_position
    from public.project_views v
)
update public.project_views v
   set position = o.new_position
  from ordered o
 where o.project_id = v.project_id
   and o.view_key = v.view_key
   and v.position is distinct from o.new_position;
