-- =============================================================================
-- app_activate_for_project — two-way app/project activation.
-- =============================================================================
-- When a project ADDS an app's view (Video Review / Files / Social Studio via
-- the project's "+ View" picker) the app should auto-activate for that project.
-- Activation scope lives in installed_apps.config (see app-scope.ts):
--   { scope:"all" }                          -> app covers every project
--   { scope:"selected", projectIds:[...] }   -> only the listed projects
-- Adding a project's view therefore appends that project id to projectIds when
-- the app is scoped to "selected" (a no-op when scope is "all"/unset, since the
-- project is already covered, or when the app isn't installed for the team).
--
-- Adding a view is a PROJECT-admin action, but installed_apps writes are gated
-- by RLS to TEAM admins. So this runs SECURITY DEFINER and does its own
-- authorization: the caller must be a project admin of p_project_id. It can only
-- ever add THAT project (never touch other projects or apps), so a project admin
-- extending their own project's app scope is a safe, narrow grant.

create or replace function public.app_activate_for_project(
    p_project_id uuid,
    p_app_key    text
)
    returns void
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _team uuid;
begin
    if not public.is_project_team_admin(p_project_id) then
        raise exception 'app_activate_for_project: caller is not a project admin for %', p_project_id;
    end if;

    select team_id into _team from public.projects where id = p_project_id;
    if _team is null then
        return;
    end if;

    -- Atomic append: the UPDATE row-locks the matched installed_apps row and
    -- reads its LIVE config, so two admins activating different projects for the
    -- same app concurrently can't clobber one another (a read-then-write
    -- snapshot could). The predicate makes this a safe no-op unless the app is
    -- installed for this team, scoped to "selected", and the project isn't
    -- already listed. projectIds are stored as string uuids, matching the client.
    update public.installed_apps
       set config = jsonb_set(
             coalesce(config, '{}'::jsonb),
             '{projectIds}',
             coalesce(config -> 'projectIds', '[]'::jsonb) || to_jsonb(p_project_id::text)),
           updated_at = now()
     where team_id = _team
       and app_key = p_app_key
       and coalesce(config ->> 'scope', 'all') = 'selected'
       and not (coalesce(config -> 'projectIds', '[]'::jsonb) @> to_jsonb(p_project_id::text));
end;
$$;

revoke all on function public.app_activate_for_project(uuid, text) from public, anon;
grant execute on function public.app_activate_for_project(uuid, text) to authenticated;
