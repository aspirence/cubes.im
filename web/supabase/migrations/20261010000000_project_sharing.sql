-- =============================================================================
-- Project sharing & visibility.
-- =============================================================================
-- Adds a flexible visibility model to projects:
--   * 'team'    (default) — every member of the project's team sees it
--                (the behavior before this migration).
--   * 'private' — only the project's members, its owner, and team admins.
--   * 'public'  — like 'team' inside the app, PLUS readable anonymously
--                through get_shared_project(share_token). The token is the
--                only public handle; project ids are never exposed to anon.
--
-- Enforcement is centralized: rather than re-writing every project-scoped
-- table's RLS policy, the shared read gate `is_project_team_member` (which the
-- Phase 3/4/9 policies and `is_task_member` already delegate to) is made
-- visibility-aware here. That single change locks a private project's tasks,
-- statuses, phases, members, assignees, comments, dependencies and work logs
-- to its members. SECURITY DEFINER reporting RPCs bypass RLS, so they are
-- patched explicitly with the same predicate.

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.projects
    add column if not exists visibility text default 'team' not null
        constraint projects_visibility_check
            check (visibility in ('team', 'private', 'public'));

alter table public.projects
    add column if not exists share_token uuid default gen_random_uuid() not null;

create unique index if not exists projects_share_token_uidx
    on public.projects (share_token);

-- -----------------------------------------------------------------------------
-- 2. is_project_member — caller is one of the project's members
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER with pinned search_path, matching the Phase 3 helpers
-- (reads project_members/team_members with RLS bypassed to avoid recursion).
create or replace function public.is_project_member(_project_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.project_members pm
        join public.team_members tm on tm.id = pm.team_member_id
        where pm.project_id = _project_id
          and tm.user_id = auth.uid()
    );
$$;

revoke all on function public.is_project_member(uuid) from public;
grant execute on function public.is_project_member(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. can_access_project — the visibility predicate, factored out
-- -----------------------------------------------------------------------------
-- Given a project's (id, team_id, visibility, owner_id), decides whether the
-- current caller may see it: non-private projects are visible to the whole
-- team; private projects only to the owner, project members, and team admins.
-- Callers must ALSO have established team membership (the RLS gate / the report
-- functions' is_team_member check) — this predicate only layers the
-- private-visibility restriction on top. auth.uid() reflects the real end user
-- even inside SECURITY DEFINER callers (it reads the JWT claim, not the role).
create or replace function public.can_access_project(
    _project_id uuid,
    _team_id    uuid,
    _visibility text,
    _owner_id   uuid
)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select _visibility <> 'private'
        or _owner_id = auth.uid()
        or public.is_project_member(_project_id)
        or public.is_team_admin(_team_id);
$$;

revoke all on function public.can_access_project(uuid, uuid, text, uuid) from public;
grant execute on function public.can_access_project(uuid, uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. is_project_team_member — now visibility-aware
-- -----------------------------------------------------------------------------
-- Re-homed from Phase 3. Previously: is_team_member(team_id_of_project(id)).
-- Now additionally requires can_access_project, so every policy that delegates
-- to this helper — tasks/task_statuses/project_phases/project_members select +
-- write, and everything routed through is_task_member (task comments,
-- dependencies, work logs) — respects private visibility with no per-table
-- policy changes. Owners/admins/project-members are unaffected; team/public
-- projects behave exactly as before.
create or replace function public.is_project_team_member(_project_id uuid)
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
          and public.is_team_member(p.team_id)
          and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)
    );
$$;

-- -----------------------------------------------------------------------------
-- 5. projects_select — hide private projects at the row level
-- -----------------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
    for select to authenticated
    using (
        public.is_team_member(team_id)
        and public.can_access_project(id, team_id, visibility, owner_id)
    );

-- -----------------------------------------------------------------------------
-- 6. Rotate the share token whenever a project leaves the public state
-- -----------------------------------------------------------------------------
-- Making a project private/team invalidates any previously-distributed public
-- link, so re-publishing later does not silently resurrect old links.
create or replace function public.rotate_share_token()
    returns trigger
    language plpgsql
as
$$
begin
    if old.visibility = 'public' and new.visibility <> 'public' then
        new.share_token := gen_random_uuid();
    end if;
    return new;
end;
$$;

drop trigger if exists projects_rotate_share_token on public.projects;
create trigger projects_rotate_share_token
    before update of visibility on public.projects
    for each row
    execute function public.rotate_share_token();

-- -----------------------------------------------------------------------------
-- 7. Reporting RPCs — exclude private projects the caller can't access
-- -----------------------------------------------------------------------------
-- These are SECURITY DEFINER and bypass RLS, so the visibility predicate is
-- applied explicitly to every projects reference. Signatures are preserved
-- verbatim from Phase 6.
create or replace function public.report_team_overview(p_team_id uuid)
    returns table (
        total_projects        bigint,
        active_projects       bigint,
        total_tasks           bigint,
        completed_tasks       bigint,
        overdue_tasks         bigint,
        total_members         bigint,
        total_logged_minutes  bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_team_overview: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        (select count(*) from public.projects p
          where p.team_id = p_team_id
            and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)),
        -- "active" := projects that have at least one not-done task (open work).
        (select count(distinct p.id)
           from public.projects p
           join public.tasks t on t.project_id = p.id
          where p.team_id = p_team_id and t.done is false
            and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)),
        (select count(*)
           from public.tasks t
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id
            and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)),
        (select count(*)
           from public.tasks t
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id and t.done is true
            and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)),
        (select count(*)
           from public.tasks t
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id
            and t.done is false
            and t.end_date is not null
            and t.end_date < now()
            and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)),
        (select count(*)
           from public.team_members tm
          where tm.team_id = p_team_id and tm.active is true),
        (select coalesce(round(sum(wl.time_spent)::numeric / 60), 0)::bigint
           from public.task_work_log wl
           join public.tasks t   on t.id = wl.task_id
           join public.projects p on p.id = t.project_id
          where p.team_id = p_team_id
            and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id));
end;
$$;

create or replace function public.report_projects(p_team_id uuid)
    returns table (
        project_id     uuid,
        project_name   text,
        total_tasks    bigint,
        completed_tasks bigint,
        completion_pct  numeric,
        logged_minutes  bigint,
        member_count    bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_projects: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        p.id,
        p.name,
        coalesce(tk.total_tasks, 0),
        coalesce(tk.completed_tasks, 0),
        case
            when coalesce(tk.total_tasks, 0) = 0 then 0::numeric
            else round(coalesce(tk.completed_tasks, 0)::numeric * 100
                       / tk.total_tasks, 2)
        end,
        coalesce(wl.logged_minutes, 0),
        coalesce(pm.member_count, 0)
    from public.projects p
    left join lateral (
        select count(*)                                   as total_tasks,
               count(*) filter (where t.done is true)     as completed_tasks
        from public.tasks t
        where t.project_id = p.id
    ) tk on true
    left join lateral (
        select round(sum(w.time_spent)::numeric / 60)::bigint as logged_minutes
        from public.task_work_log w
        join public.tasks t2 on t2.id = w.task_id
        where t2.project_id = p.id
    ) wl on true
    left join lateral (
        select count(*)::bigint as member_count
        from public.project_members m
        where m.project_id = p.id
    ) pm on true
    where p.team_id = p_team_id
      and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)
    order by p.name;
end;
$$;

create or replace function public.report_members(p_team_id uuid)
    returns table (
        team_member_id  uuid,
        user_name       text,
        assigned_tasks  bigint,
        completed_tasks bigint,
        logged_minutes  bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_members: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        tm.id,
        u.name,
        coalesce(asg.assigned_tasks, 0),
        coalesce(asg.completed_tasks, 0),
        coalesce(wl.logged_minutes, 0)
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    left join lateral (
        select count(*)                                as assigned_tasks,
               count(*) filter (where t.done is true)  as completed_tasks
        from public.tasks_assignees ta
        join public.tasks t on t.id = ta.task_id
        join public.projects p on p.id = t.project_id
        where ta.team_member_id = tm.id
          and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)
    ) asg on true
    left join lateral (
        select round(sum(w.time_spent)::numeric / 60)::bigint as logged_minutes
        from public.task_work_log w
        where w.user_id = tm.user_id
          and exists (
              select 1
              from public.tasks t3
              join public.projects p3 on p3.id = t3.project_id
              where t3.id = w.task_id and p3.team_id = p_team_id
                and public.can_access_project(p3.id, p3.team_id, p3.visibility, p3.owner_id)
          )
    ) wl on true
    where tm.team_id = p_team_id
      and tm.active is true
    order by u.name;
end;
$$;

create or replace function public.report_time_logs(
    p_team_id uuid,
    p_from    date default null,
    p_to      date default null
)
    returns table (
        log_id       uuid,
        task_name    text,
        project_name text,
        user_name    text,
        minutes      bigint,
        is_billable  boolean,
        logged_at    timestamp with time zone
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'report_time_logs: caller is not a member of team %', p_team_id;
    end if;

    return query
    select
        wl.id,
        t.name,
        p.name,
        u.name,
        round(wl.time_spent::numeric / 60)::bigint,
        wl.is_billable,
        wl.created_at
    from public.task_work_log wl
    join public.tasks    t on t.id = wl.task_id
    join public.projects p on p.id = t.project_id
    join public.users    u on u.id = wl.user_id
    where p.team_id = p_team_id
      and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)
      and (p_from is null or wl.created_at >= p_from::timestamptz)
      and (p_to   is null or wl.created_at < (p_to + 1)::timestamptz)
    order by wl.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. get_shared_project — anonymous read keyed by share token
-- -----------------------------------------------------------------------------
-- Returns null unless the token matches a project with visibility = 'public'.
-- The projection is deliberately minimal: no ids, no team/client/owner data.
create or replace function public.get_shared_project(p_token uuid)
    returns json
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select json_build_object(
        'project', json_build_object(
            'name',       p.name,
            'color_code', p.color_code,
            'notes',      p.notes,
            'start_date', p.start_date,
            'end_date',   p.end_date
        ),
        'tasks', coalesce(
            (
                select json_agg(
                    json_build_object(
                        'name',     t.name,
                        'done',     t.done,
                        'end_date', t.end_date,
                        'status',   ts.name
                    )
                    order by t.sort_order
                )
                from public.tasks t
                left join public.task_statuses ts on ts.id = t.status_id
                where t.project_id = p.id
                  and t.archived = false
                  and t.parent_task_id is null
            ),
            '[]'::json
        )
    )
    from public.projects p
    where p.share_token = p_token
      and p.visibility = 'public';
$$;

revoke all on function public.get_shared_project(uuid) from public;
grant execute on function public.get_shared_project(uuid) to anon, authenticated;
