-- =============================================================================
-- Agents: an active / paused flag.
-- =============================================================================
-- Lets an agent be turned on or off (e.g. pause the Operations Manager without
-- deleting it). Writes go through the existing agents RLS (is_team_admin FOR
-- ALL), so no new policy or grant is needed.
alter table public.agents
    add column if not exists is_active boolean not null default true;
