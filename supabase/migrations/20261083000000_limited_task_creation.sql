-- =============================================================================
-- "Can limited members create tasks?" — a real setting, at two levels.
-- =============================================================================
-- Until now limited members were hard-blocked from authoring tasks (20261063).
-- This turns the block into configuration:
--   * WORKSPACE level — a new `create_tasks` capability in the permission
--     catalog. Owners/admins flip it per tier on Settings → Permissions
--     (defaults keep today's behavior: member ON, limited OFF).
--   * PROJECT level — projects.limited_task_creation ('inherit'|'allow'|'deny')
--     overrides the workspace answer for LIMITED members on that project.
-- One helper (can_create_tasks) answers the effective question; the RLS insert
-- policy and the create_task RPC both delegate to it. Owner/admin are always
-- allowed, guests never (both via member_can).

-- ------------------------------------------------------------------ catalog --
insert into public.permission_capabilities
    (key, label, description, category, default_member, default_limited, sort)
values
    ('create_tasks', 'Create tasks',
     'Author new tasks in projects they can access.',
     'Tasks', true, false, 85)
on conflict (key) do nothing;

-- ------------------------------------------------------------ project knob --
alter table public.projects
    add column if not exists limited_task_creation text not null default 'inherit';

do $$
begin
    alter table public.projects
        add constraint projects_limited_task_creation_check
        check (limited_task_creation in ('inherit', 'allow', 'deny'));
exception
    when duplicate_object then null;
end;
$$;

-- ------------------------------------------------------------------- helper --
create or replace function public.can_create_tasks(_project_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select public.is_project_team_member(_project_id)
       and case
             when public.is_limited_member(public.team_id_of_project(_project_id)) then
               case (select p.limited_task_creation
                       from public.projects p where p.id = _project_id)
                 when 'allow' then true
                 when 'deny'  then false
                 else public.member_can(public.team_id_of_project(_project_id), 'create_tasks')
               end
             else public.member_can(public.team_id_of_project(_project_id), 'create_tasks')
           end;
$$;

revoke all on function public.can_create_tasks(uuid) from public;
grant execute on function public.can_create_tasks(uuid) to authenticated;

-- ------------------------------------------------------------------- policy --
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
    for insert to authenticated
    with check (public.can_create_tasks(project_id));

-- -------------------------------------------------------------- create_task --
-- Body identical to 20261063 except the authoring gate now delegates to
-- can_create_tasks (workspace capability + project override).
create or replace function public.create_task(
    p_name           text,
    p_project_id     uuid,
    p_status_id      uuid    default null,
    p_priority_id    uuid    default null,
    p_parent_task_id uuid    default null,
    p_assignees      uuid[]  default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id           uuid := auth.uid();
    _task_id           uuid;
    _task_name         text;
    _status_id         uuid;
    _team_member_id    uuid;
    _project_member_id uuid;
begin
    if _user_id is null then
        raise exception 'create_task: no authenticated user';
    end if;

    -- Effective authoring permission: team membership + workspace capability
    -- (create_tasks) + the project's limited_task_creation override.
    if not public.can_create_tasks(p_project_id) then
        raise exception 'create_task: caller cannot create tasks in project %', p_project_id;
    end if;

    _task_name := left(trim(coalesce(p_name, '')), 500);
    if _task_name = '' then
        raise exception 'create_task: task name is required';
    end if;

    -- Resolve the status: the caller-supplied one (if it belongs to this
    -- project), else the project's first To-Do-category status by sort_order.
    if p_status_id is not null then
        select s.id into _status_id
        from public.task_statuses s
        where s.id = p_status_id and s.project_id = p_project_id;
    end if;

    if _status_id is null then
        select s.id into _status_id
        from public.task_statuses s
        join public.sys_task_status_categories c on c.id = s.category_id
        where s.project_id = p_project_id and c.is_todo is true
        order by s.sort_order
        limit 1;
    end if;

    -- Insert the task (reporter = caller). task_no + done/completed_at are filled
    -- by the BEFORE triggers; sort_order is appended after the project's max.
    insert into public.tasks (name, description, project_id, status_id, priority_id,
                              reporter_id, parent_task_id, sort_order)
    values (_task_name, null, p_project_id, _status_id, p_priority_id,
            _user_id, p_parent_task_id,
            coalesce((select max(sort_order) + 1 from public.tasks
                      where project_id = p_project_id), 0))
    returning id into _task_id;

    -- Assignees: each is a team_members.id. Resolve the matching project_members
    -- row (if any) for project_member_id; skip duplicates.
    if p_assignees is not null then
        foreach _team_member_id in array p_assignees
        loop
            select pm.id into _project_member_id
            from public.project_members pm
            where pm.project_id = p_project_id
              and pm.team_member_id = _team_member_id
            limit 1;

            insert into public.tasks_assignees (task_id, team_member_id,
                                                project_member_id, assigned_by)
            values (_task_id, _team_member_id, _project_member_id, _user_id)
            on conflict (task_id, team_member_id) do nothing;

            _project_member_id := null;
        end loop;
    end if;

    return _task_id;
end;
$$;

-- =============================================================================
-- Project SHARING as a capability too (share_projects).
-- =============================================================================
-- Sharing (adding/removing people on a project — the project_members writes
-- behind the share modal) was hard-gated to is_project_team_admin. It becomes
-- a workspace capability: owners/admins and project admins/PMs keep it always;
-- members/limited get it only when the workspace toggles `share_projects` on
-- (defaults OFF for both — limited can never share unless explicitly granted).
-- Changing a project's visibility / Make Public stays owner+admin only
-- (projects_update policy, untouched).

insert into public.permission_capabilities
    (key, label, description, category, default_member, default_limited, sort)
values
    ('share_projects', 'Share projects',
     'Add or remove people on projects they can access.',
     'Projects', false, false, 45)
on conflict (key) do nothing;

create or replace function public.can_share_project(_project_id uuid)
    returns boolean
    language sql stable security definer set search_path = public
as
$$
    select public.is_project_team_admin(_project_id)
        or (
             public.is_project_team_member(_project_id)
             and public.member_can(public.team_id_of_project(_project_id), 'share_projects')
           );
$$;

revoke all on function public.can_share_project(uuid) from public;
grant execute on function public.can_share_project(uuid) to authenticated;

drop policy if exists project_members_insert on public.project_members;
create policy project_members_insert on public.project_members
    for insert to authenticated
    with check (public.can_share_project(project_id));

drop policy if exists project_members_update on public.project_members;
create policy project_members_update on public.project_members
    for update to authenticated
    using (public.can_share_project(project_id))
    with check (public.can_share_project(project_id));

drop policy if exists project_members_delete on public.project_members;
create policy project_members_delete on public.project_members
    for delete to authenticated
    using (public.can_share_project(project_id));

-- =============================================================================
-- END limited task creation + sharing capability
-- =============================================================================
