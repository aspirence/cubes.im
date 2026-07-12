-- ============================================================================
-- Permission model — Phase 2b: gate create_project by the create_projects
-- capability. create_project is SECURITY DEFINER (bypasses RLS), so the
-- projects_insert policy alone can't restrict it — the check must live inside
-- the function. Owner/admin always; member/limited per Settings > Permissions;
-- guests never. (Identical to the prior definition except the gate.)
-- ============================================================================
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

    -- Caller must have the create-projects capability for this workspace.
    if not public.member_can(p_team_id, 'create_projects') then
        raise exception 'create_project: you do not have permission to create projects in this workspace';
    end if;

    _project_name := left(trim(coalesce(p_name, '')), 100);
    if _project_name = '' then
        raise exception 'create_project: project name is required';
    end if;

    if exists (
        select 1 from public.projects
        where team_id = p_team_id and lower(name) = lower(_project_name)
    ) then
        raise exception 'create_project: a project named "%" already exists in this team', _project_name;
    end if;

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

    _color := coalesce(p_color_code, '#70a6f3');

    select s.id into _status_id
    from public.sys_project_statuses s
    where s.is_default is true
    order by s.sort_order
    limit 1;

    insert into public.projects (name, key, color_code, team_id, client_id,
                                 owner_id, status_id, category_id)
    values (_project_name, _key, _color, p_team_id, p_client_id,
            _user_id, _status_id, p_category_id)
    returning id into _project_id;

    select tm.id into _team_member_id
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = _user_id
      and tm.active is true
    limit 1;

    select pal.id into _access_level
    from public.project_access_levels pal
    order by case pal.key
                 when 'ADMIN'           then 1
                 when 'PROJECT_MANAGER' then 2
                 when 'MEMBER'          then 3
                 else 4
             end
    limit 1;

    select r.id into _role_id
    from public.roles r
    where r.team_id = p_team_id and r.default_role is true
    limit 1;

    if _team_member_id is not null then
        insert into public.project_members (project_id, team_member_id,
                                            project_access_level_id, role_id)
        values (_project_id, _team_member_id, _access_level, _role_id)
        on conflict (project_id, team_member_id) do nothing;
    end if;

    return _project_id;
end;
$$;
