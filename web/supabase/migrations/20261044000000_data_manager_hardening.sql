-- =============================================================================
-- Cubes — Data Manager hardening (from adversarial review)
-- =============================================================================
-- 1) create_project: the derived 3-letter key collided under the unique
--    (lower(key), team_id) index whenever two project names share a prefix —
--    e.g. "Marketing" and "Marketing (2)" (the backup importer's rename path)
--    both derive 'MAR' and the second insert blew up. The key now gets a
--    numeric suffix until it is unique within the team.
-- 2) clear_team_data: also wipes team-scoped work data that the projects
--    cascade misses (workflows, agents, video-review videos, files), and the
--    owner gate no longer trusts the roles.owner flag alone — an admin can
--    edit roles, so the caller must ALSO be the team's creator or the
--    organization owner (non-forgeable columns).

create or replace function public.create_project(
    p_name        text,
    p_team_id     uuid,
    p_client_id   uuid default null,
    p_color_code  text default null,
    p_category_id uuid default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id        uuid := auth.uid();
    _project_id     uuid;
    _project_name   text;
    _key            text;
    _key_base       text;
    _key_n          int  := 1;
    _color          text;
    _team_member_id uuid;
    _access_level   uuid;
    _role_id        uuid;
    _status_id      uuid;
begin
    if _user_id is null then
        raise exception 'create_project: no authenticated user';
    end if;

    -- Caller MUST be an active member of the target team.
    if not public.is_team_member(p_team_id) then
        raise exception 'create_project: caller is not a member of team %', p_team_id;
    end if;

    _project_name := left(trim(coalesce(p_name, '')), 100);
    if _project_name = '' then
        raise exception 'create_project: project name is required';
    end if;

    -- Reject duplicate (case-insensitive) project names within the team early
    -- with a clear message (the unique index would otherwise raise a generic
    -- constraint error).
    if exists (
        select 1 from public.projects
        where team_id = p_team_id and lower(name) = lower(_project_name)
    ) then
        raise exception 'create_project: a project named "%" already exists in this team', _project_name;
    end if;

    -- Derive a key: first 3 alphanumerics of the name, uppercased; fall back to
    -- 'PRJ' when the name has no alphanumerics. Suffix with a counter until it
    -- is unique within the team (projects_key_team_id_uindex).
    _key := upper(left(regexp_replace(_project_name, '[^a-zA-Z0-9]', '', 'g'), 3));
    if _key = '' then
        _key := 'PRJ';
    end if;
    _key_base := _key;
    while exists (
        select 1 from public.projects
        where team_id = p_team_id and lower(key) = lower(_key)
    ) loop
        _key_n := _key_n + 1;
        _key   := _key_base || _key_n::text;
    end loop;

    -- color_code: caller value if a valid hex, else the legacy default.
    _color := coalesce(p_color_code, '#70a6f3');

    -- Resolve the default project status (is_default) if one is seeded.
    select s.id into _status_id
    from public.sys_project_statuses s
    where s.is_default is true
    order by s.sort_order
    limit 1;

    -- Insert the project (owner = caller).
    insert into public.projects (name, key, color_code, team_id, client_id,
                                 owner_id, status_id, category_id)
    values (_project_name, _key, _color, p_team_id, p_client_id,
            _user_id, _status_id, p_category_id)
    returning id into _project_id;

    -- Resolve the caller's team_members row for this team.
    select tm.id into _team_member_id
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = _user_id
      and tm.active is true
    limit 1;

    -- Highest-privilege project access level, if the lookup is seeded.
    select pal.id into _access_level
    from public.project_access_levels pal
    order by case pal.key
                 when 'ADMIN'           then 1
                 when 'PROJECT_MANAGER' then 2
                 when 'MEMBER'          then 3
                 else 4
             end
    limit 1;

    -- The team's default (Member) role, if resolvable.
    select r.id into _role_id
    from public.roles r
    where r.team_id = p_team_id and r.default_role is true
    limit 1;

    -- Add the creator as a project member (only if we found their membership).
    if _team_member_id is not null then
        insert into public.project_members (project_id, team_member_id,
                                            project_access_level_id, role_id)
        values (_project_id, _team_member_id, _access_level, _role_id)
        on conflict (project_id, team_member_id) do nothing;
    end if;

    return _project_id;
end;
$$;

-- clear_team_data v2: extended coverage + hardened gate.
create or replace function public.clear_team_data(p_team_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _projects  int;
    _folders   int;
    _labels    int;
    _clients   int;
    _templates int;
    _workflows int;
    _appdata   int;
begin
    -- Owner gate. roles.owner alone is not enough: team admins can edit roles
    -- and self-promote. The caller must hold the Owner role AND be either the
    -- team's creator (teams.user_id) or the organization owner
    -- (organizations.user_id) — neither column is admin-mutable.
    if not (
        public.is_team_owner(p_team_id)
        and exists (
            select 1
            from public.teams t
            left join public.organizations o on o.id = t.organization_id
            where t.id = p_team_id
              and (t.user_id = auth.uid() or o.user_id = auth.uid())
        )
    ) then
        raise exception 'forbidden: only the workspace owner can clear workspace data';
    end if;

    -- Projects cascade to tasks, statuses, assignees, label-joins, comments,
    -- attachments, views, automations, and project-scoped app rows.
    with gone as (
        delete from public.projects where team_id = p_team_id returning 1
    )
    select count(*) into _projects from gone;

    with gone as (
        delete from public.project_folders where team_id = p_team_id returning 1
    )
    select count(*) into _folders from gone;

    with gone as (
        delete from public.team_labels where team_id = p_team_id returning 1
    )
    select count(*) into _labels from gone;

    with gone as (
        delete from public.clients where team_id = p_team_id returning 1
    )
    select count(*) into _clients from gone;

    with a as (
        delete from public.project_templates where team_id = p_team_id returning 1
    ), b as (
        delete from public.task_templates where team_id = p_team_id returning 1
    ), c as (
        delete from public.status_templates where team_id = p_team_id returning 1
    )
    select (select count(*) from a) + (select count(*) from b) + (select count(*) from c)
      into _templates;

    -- Team-scoped automation/AI work data (not covered by the projects cascade).
    with a as (
        delete from public.workflows where team_id = p_team_id returning 1
    ), b as (
        delete from public.agents where team_id = p_team_id returning 1
    )
    select (select count(*) from a) + (select count(*) from b) into _workflows;

    -- Team-scoped app rows whose project FK is SET NULL (they'd survive the
    -- cascade as orphans): video-review videos, files app rows.
    with a as (
        delete from public.app_video_review_videos where team_id = p_team_id returning 1
    ), b as (
        delete from public.app_files_files where team_id = p_team_id returning 1
    ), c as (
        delete from public.app_files_folders where team_id = p_team_id returning 1
    )
    select (select count(*) from a) + (select count(*) from b) + (select count(*) from c)
      into _appdata;

    return jsonb_build_object(
        'projects', _projects,
        'folders', _folders,
        'labels', _labels,
        'clients', _clients,
        'templates', _templates,
        'workflows', _workflows,
        'appData', _appdata
    );
end;
$$;

revoke all on function public.clear_team_data(uuid) from public, anon;
grant execute on function public.clear_team_data(uuid) to authenticated;
