-- =============================================================================
-- Cubes — the workspace gamification score (foundation).
-- =============================================================================
-- Each employee earns "cubes" (points) for the work they do. How cubes are
-- awarded/spent will be driven by a configurable rules engine later; for now
-- this adds the stored score so the org chart can colour cards by performance
-- and owners/admins can adjust it. Writes go through the existing hr_employees
-- RLS (HR admin), so no new policy is needed.
alter table public.hr_employees
    add column if not exists cubes integer not null default 0;

-- Seed some spread for existing employees so the org chart shows performance
-- variety out of the box (one-time; only touches rows still at the default 0).
update public.hr_employees
   set cubes = (20 + floor(random() * 100))::int
 where cubes = 0;
