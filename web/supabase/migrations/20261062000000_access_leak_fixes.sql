-- =============================================================================
-- Access-leak fixes — SECURITY DEFINER aggregators must re-apply project access.
-- =============================================================================
-- SECURITY DEFINER functions run with the owner's rights and BYPASS RLS. Any
-- such function that RETURNS project-scoped rows to the caller, or FANS OUT
-- notifications to other users, must re-apply the project-visibility predicate
-- itself — otherwise it leaks data from projects/spaces the recipient can no
-- longer access (e.g. a task assigned before the caller was removed from the
-- project, or before the project/Space was made private).
--
-- An audit of all 46 project-scoped SECURITY DEFINER functions found the
-- report_* family already patched (20261010) and everything else either
-- admin-gated, write-only, or RLS-equivalent — except three:
--   * get_my_tasks              (HIGH)   — returns caller's tasks, no gate
--   * wf_overdue_tasks          (MEDIUM) — team-gated aggregate, no per-project gate
--   * notify_on_task_comment    (LOW)    — notifies participants without a gate
--
-- For the CALLER, can_access_project(auth.uid()) is the right check. For
-- functions that notify OTHER users, this migration adds a reusable
-- user-parameterized mirror, user_can_access_project(user, project), so the
-- same rule can be applied everywhere a function fans out to a recipient set.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. user_can_access_project(_user_id, _project_id)
-- -----------------------------------------------------------------------------
-- The visibility predicate evaluated for an ARBITRARY user (not auth.uid()).
-- Mirrors can_access_project including the private-Space cascade, so any
-- fan-out surface (notifications, digests, mentions) can gate each recipient.
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
                -- owner
                p.owner_id = _user_id
                -- explicit project member
                or exists (
                    select 1
                    from public.project_members pm
                    join public.team_members tm on tm.id = pm.team_member_id
                    where pm.project_id = p.id
                      and tm.user_id = _user_id
                )
                -- team admin / owner
                or exists (
                    select 1
                    from public.team_members tm
                    left join public.roles r on r.id = tm.role_id
                    where tm.team_id = p.team_id
                      and tm.user_id = _user_id
                      and coalesce(tm.active, true)
                      and (coalesce(r.admin_role, false) or coalesce(r.owner, false))
                )
                -- team-visible project, and the user is an active, non-limited,
                -- non-guest member who can also see the containing Space
                or (
                    p.visibility <> 'private'
                    and exists (
                        select 1
                        from public.team_members tm
                        where tm.team_id = p.team_id
                          and tm.user_id = _user_id
                          and coalesce(tm.active, true)
                          and coalesce(tm.member_type, 'member') not in ('limited', 'guest')
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
grant execute on function public.user_can_access_project(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 1. get_my_tasks — HIGH. Add the caller visibility gate.
-- -----------------------------------------------------------------------------
create or replace function public.get_my_tasks()
    returns table (
        task_id      uuid,
        name         text,
        project_id   uuid,
        project_name text,
        status_name  text,
        priority     text,
        end_date     timestamp with time zone
    )
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select distinct on (t.id)
           t.id            as task_id,
           t.name          as name,
           t.project_id    as project_id,
           p.name          as project_name,
           ts.name         as status_name,
           pr.name         as priority,
           t.end_date      as end_date
    from public.tasks t
    join public.tasks_assignees ta on ta.task_id = t.id
    join public.team_members   tm on tm.id = ta.team_member_id
    join public.projects        p on p.id = t.project_id
    left join public.task_statuses   ts on ts.id = t.status_id
    left join public.task_priorities pr on pr.id = t.priority_id
    where tm.user_id = auth.uid()
      and t.done is false
      and t.archived is false
      and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)
    order by t.id, t.end_date nulls last;
$$;

-- -----------------------------------------------------------------------------
-- 2. wf_overdue_tasks — MEDIUM. Gate both aggregate SELECTs per project.
-- -----------------------------------------------------------------------------
create or replace function public.wf_overdue_tasks(p_team_id uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = public
as
$$
declare
    _overdue  jsonb;
    _due_soon jsonb;
    _oc       integer;
    _dc       integer;
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'wf_overdue_tasks: caller is not a member of team %', p_team_id;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'name', t.name, 'project', p.name, 'end_date', t.end_date)
               order by t.end_date), '[]'::jsonb),
           count(*)
      into _overdue, _oc
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where p.team_id = p_team_id
       and t.done = false and t.archived = false
       and t.end_date is not null and t.end_date < now()
       and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id);

    select coalesce(jsonb_agg(jsonb_build_object(
               'name', t.name, 'project', p.name, 'end_date', t.end_date)
               order by t.end_date), '[]'::jsonb),
           count(*)
      into _due_soon, _dc
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where p.team_id = p_team_id
       and t.done = false and t.archived = false
       and t.end_date is not null
       and t.end_date >= now() and t.end_date < now() + interval '7 days'
       and public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id);

    return jsonb_build_object(
        'overdue_count', _oc, 'due_soon_count', _dc,
        'overdue', _overdue, 'due_soon', _due_soon);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. notify_on_task_comment — LOW. Notify only participants who can still
--    access the task's project (gate each recipient with the user-parameterized
--    predicate, since auth.uid() here is the commenter, not the recipient).
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_task_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _task_name    text;
    _project_id   uuid;
    _team_id      uuid;
    _reporter_id  uuid;
    _commenter    uuid := new.created_by;
    _recipient    uuid;
begin
    select t.name, t.project_id, t.reporter_id, p.team_id
        into _task_name, _project_id, _reporter_id, _team_id
        from public.tasks t
        join public.projects p on p.id = t.project_id
        where t.id = new.task_id;

    -- Distinct set of participant users: assignees' users + the reporter, minus
    -- the commenter and nulls, and minus anyone who can no longer access the
    -- project (e.g. removed from the project / a now-private project or Space).
    for _recipient in
        select distinct u
        from (
            select tm.user_id as u
                from public.tasks_assignees ta
                join public.team_members tm on tm.id = ta.team_member_id
                where ta.task_id = new.task_id
            union
            select _reporter_id as u
        ) parts
        where u is not null
          and u is distinct from _commenter
          and public.user_can_access_project(u, _project_id)
    loop
        perform public.create_notification(
            p_user_id    => _recipient,
            p_message    => 'New comment on ' || coalesce(_task_name, 'a task'),
            p_type       => 'comment',
            p_url        => null,
            p_team_id    => _team_id,
            p_task_id    => new.task_id,
            p_project_id => _project_id
        );
    end loop;

    return new;
end;
$$;
