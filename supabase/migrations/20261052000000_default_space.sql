-- ============================================================================
-- Default Space: every workspace starts with one Space ("Space") so the
-- projects tree is never empty and new projects have an obvious home.
--
-- Spaces are rows in project_folders. Creation paths for teams are
-- handle_new_user (signup) and create_team (additional workspaces) — instead
-- of patching each, an AFTER INSERT trigger on teams covers both plus any
-- future path. A backfill adds the Space to existing teams that have none.
--
-- Notes:
--  * teams.user_id (the creator) is NOT NULL and, on every path, its users
--    profile row exists before the team insert — safe as created_by.
--  * key stays NULL (matches the app's folder-creation idiom); color_code
--    takes the table default. unique(team_id, name) can't collide here: the
--    trigger fires on brand-new teams and the backfill targets teams with
--    zero folders.
-- ============================================================================

create or replace function public.handle_new_team_defaults()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    insert into public.project_folders (name, team_id, created_by)
    values ('Space', new.id, new.user_id);
    return new;
end;
$$;

drop trigger if exists on_team_created_defaults on public.teams;
create trigger on_team_created_defaults
    after insert on public.teams
    for each row
execute function public.handle_new_team_defaults();

-- Backfill: existing teams with no Spaces at all get the default one.
insert into public.project_folders (name, team_id, created_by)
select 'Space', t.id, t.user_id
from public.teams t
where not exists (
    select 1 from public.project_folders f where f.team_id = t.id
);
