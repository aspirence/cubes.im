-- ============================================================================
-- Default workspace content: every team starts with one Space ("Space") and
-- one starter project ("My First Project") inside it, so the projects tree is
-- never empty and a first-time user lands on something real, not a blank
-- slate. Existing projects-table triggers seed the project's task statuses
-- (To Do / Doing / Done) and default views (List + Board) automatically.
--
-- Teams are created on three paths — handle_new_user (signup), create_team
-- (additional workspaces), provision_my_account (self-heal) — so instead of
-- patching each, a trigger on teams covers them all. It is a DEFERRED
-- constraint trigger: it runs at transaction commit, by which point the
-- creator's roles + team_members rows exist (signup creates them after the
-- team), letting the project fully mirror create_project() including the
-- creator's project_members row. A backfill seeds existing teams.
-- ============================================================================

-- Shared by the trigger and the backfill. Creates the default Space when the
-- team has no folders, and the starter project when it has no projects — so
-- seed scripts / imports that provision their own content in the same
-- transaction are left alone.
create or replace function public.seed_default_team_content(p_team_id uuid, p_owner uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _folder    uuid;
    _status    uuid;
    _project   uuid;
    _tm        uuid;
    _access    uuid;
    _role      uuid;
begin
    -- Default Space (only when the team has none).
    select f.id into _folder
    from public.project_folders f
    where f.team_id = p_team_id
    order by f.created_at
    limit 1;

    if _folder is null then
        insert into public.project_folders (name, team_id, created_by)
        values ('Space', p_team_id, p_owner)
        returning id into _folder;
    end if;

    -- Starter project (only when the team has none). Mirrors create_project():
    -- default sys project status, owner = team creator, creator added as a
    -- project member when their membership is resolvable.
    if not exists (select 1 from public.projects p where p.team_id = p_team_id) then
        select s.id into _status
        from public.sys_project_statuses s
        where s.is_default is true
        order by s.sort_order
        limit 1;

        insert into public.projects (name, key, team_id, owner_id, status_id, folder_id)
        values ('My First Project', 'MYF', p_team_id, p_owner, _status, _folder)
        returning id into _project;

        select tm.id into _tm
        from public.team_members tm
        where tm.team_id = p_team_id
          and tm.user_id = p_owner
          and tm.active is true
        limit 1;

        if _tm is not null then
            select pal.id into _access
            from public.project_access_levels pal
            order by case pal.key
                         when 'ADMIN'           then 1
                         when 'PROJECT_MANAGER' then 2
                         when 'MEMBER'          then 3
                         else 4
                     end
            limit 1;

            select r.id into _role
            from public.roles r
            where r.team_id = p_team_id and r.default_role is true
            limit 1;

            insert into public.project_members (project_id, team_member_id,
                                                project_access_level_id, role_id)
            values (_project, _tm, _access, _role)
            on conflict (project_id, team_member_id) do nothing;
        end if;
    end if;
end;
$$;

-- SECURITY DEFINER taking arbitrary team ids — not for direct client calls.
revoke all on function public.seed_default_team_content(uuid, uuid)
    from public, anon, authenticated;

create or replace function public.handle_new_team_defaults()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    perform public.seed_default_team_content(new.id, new.user_id);
    return null;
exception
    when others then
        -- Default content must never block workspace creation.
        return null;
end;
$$;

drop trigger if exists on_team_created_defaults on public.teams;
create constraint trigger on_team_created_defaults
    after insert on public.teams
    deferrable initially deferred
    for each row
execute function public.handle_new_team_defaults();

-- Backfill: give every existing team the default Space (if it has no folders)
-- and the starter project (if it has no projects).
select public.seed_default_team_content(t.id, t.user_id)
from public.teams t;
