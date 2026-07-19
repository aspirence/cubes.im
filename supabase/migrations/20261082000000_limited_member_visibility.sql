-- =============================================================================
-- Limited-member visibility rework: see team-visible projects & spaces,
-- but (unchanged) only their ASSIGNED tasks.
-- =============================================================================
-- Old model (20261055/20261061): a `limited` member saw ONLY projects/spaces
-- they were explicitly added to — team-visible ones were hidden.
-- New model:
--   * projects & spaces: team-visible (`visibility <> 'private'`) → every
--     member INCLUDING limited; private → only owner/creator, explicit
--     project/space members, and team admins. (Unchanged for member/admin.)
--   * tasks: UNCHANGED — can_view_task (20261063) already narrows a limited
--     member to tasks assigned to them; members see all tasks of projects
--     they can access.
--   * guests: UNCHANGED — still excluded everywhere via is_team_member /
--     explicit guards.
--
-- Only the three helpers change; every policy (projects_select,
-- project_folders_select, tasks_select, task-child tables, report RPCs,
-- notification fan-out) delegates to them and picks the new rules up
-- automatically.

-- -----------------------------------------------------------------------------
-- 1. can_access_space — drop the limited-member guard on team-visible spaces.
-- -----------------------------------------------------------------------------
create or replace function public.can_access_space(_folder_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select exists (
        select 1
        from public.project_folders f
        where f.id = _folder_id
          and public.is_team_member(f.team_id)          -- excludes guests
          and (
                f.created_by = auth.uid()
                or public.is_team_admin(f.team_id)
                or public.is_space_member(f.id)
                or f.visibility <> 'private'            -- team-visible: every member, limited included
              )
    );
$$;

revoke all on function public.can_access_space(uuid) from public;
grant execute on function public.can_access_space(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. can_access_project — same relaxation for team-visible projects.
-- -----------------------------------------------------------------------------
create or replace function public.can_access_project(
    _project_id uuid,
    _team_id    uuid,
    _visibility text,
    _owner_id   uuid
)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select
        _owner_id = auth.uid()
        or public.is_project_member(_project_id)
        or public.is_team_admin(_team_id)
        or (
              _visibility <> 'private'                  -- team-visible: every member, limited included
              and public.project_space_accessible(_project_id)
           );
$$;

revoke all on function public.can_access_project(uuid, uuid, text, uuid) from public;
grant execute on function public.can_access_project(uuid, uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. user_can_access_project — the user-parameterized mirror (notification /
--    report fan-out) admits limited members too; guests stay excluded.
-- -----------------------------------------------------------------------------
create or replace function public.user_can_access_project(
    _user_id    uuid,
    _project_id uuid
)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.projects p
        where p.id = _project_id
          and (
                p.owner_id = _user_id
                or exists (
                    select 1
                    from public.project_members pm
                    join public.team_members tm on tm.id = pm.team_member_id
                    where pm.project_id = p.id
                      and tm.user_id = _user_id
                )
                or exists (
                    select 1
                    from public.team_members tm
                    left join public.roles r on r.id = tm.role_id
                    where tm.team_id = p.team_id
                      and tm.user_id = _user_id
                      and coalesce(tm.active, true)
                      and (coalesce(r.admin_role, false) or coalesce(r.owner, false))
                )
                -- team-visible project: any active non-guest member (limited
                -- included) who can also see the containing Space
                or (
                    p.visibility <> 'private'
                    and exists (
                        select 1
                        from public.team_members tm
                        where tm.team_id = p.team_id
                          and tm.user_id = _user_id
                          and coalesce(tm.active, true)
                          and coalesce(tm.member_type, 'member') <> 'guest'
                    )
                    and (
                        p.folder_id is null
                        or exists (
                            select 1
                            from public.project_folders f
                            where f.id = p.folder_id
                              and (
                                    f.created_by = _user_id
                                    or f.visibility <> 'private'
                                    or exists (
                                        select 1
                                        from public.space_members sm
                                        join public.team_members tm on tm.id = sm.team_member_id
                                        where sm.folder_id = f.id
                                          and tm.user_id = _user_id
                                    )
                                    or exists (
                                        select 1
                                        from public.team_members tm
                                        left join public.roles r on r.id = tm.role_id
                                        where tm.team_id = f.team_id
                                          and tm.user_id = _user_id
                                          and (coalesce(r.admin_role, false) or coalesce(r.owner, false))
                                    )
                              )
                        )
                    )
                )
              )
    );
$$;

revoke all on function public.user_can_access_project(uuid, uuid) from public;
grant execute on function public.user_can_access_project(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. user_accessible_projects — set-returning helper for the SERVICE-ROLE MCP
--    path, which bypasses RLS and must re-apply the same model manually.
-- -----------------------------------------------------------------------------
create or replace function public.user_accessible_projects(
    _user_id uuid,
    _team_id uuid
)
    returns setof uuid
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select p.id
    from public.projects p
    where p.team_id = _team_id
      and public.user_can_access_project(_user_id, p.id);
$$;

revoke all on function public.user_accessible_projects(uuid, uuid) from public;
grant execute on function public.user_accessible_projects(uuid, uuid) to service_role;

-- =============================================================================
-- END limited member visibility
-- =============================================================================
