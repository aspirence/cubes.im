-- =============================================================================
-- Tier model, part 3 — limited members are scoped to their OWN tasks.
-- =============================================================================
-- The tier model so far:
--   * owner  — owns the account (one per account).
--   * admin  — ownership-level over the WHOLE workspace.
--   * member — can create projects, spaces, tasks and assign work; ownership-
--              level ON the projects/tasks they run (unchanged; the capability
--              catalog already grants create_projects/create_spaces to members).
--   * limited member — CANNOT create projects (already enforced via the
--              create_projects capability). This migration adds the rest of the
--              brief: a limited member only SEES their own assigned tasks and
--              may only ACT on those tasks — not every task in a project they
--              happen to be on. They also cannot create tasks.
--   * guest  — client-portal only (excluded from is_team_member).
--
-- Mechanism: a limited member is added to a project (so they can reach it), but
-- task-level access is narrowed to tasks they are assigned to. Because the
-- shared gate is_task_member() fans out to every task-scoped table (comments,
-- work logs, labels, dependencies, subtasks, references…), rewiring it through
-- one new predicate scopes all of them at once. Non-limited members are
-- completely unaffected.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. can_view_task — the per-task visibility predicate
-- -----------------------------------------------------------------------------
-- Everyone who can access the project can see its tasks, EXCEPT a limited member,
-- who can only see a task they are personally assigned to.
create or replace function public.can_view_task(_task_id uuid, _project_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select public.is_project_team_member(_project_id)
        and (
            not public.is_limited_member(public.team_id_of_project(_project_id))
            or exists (
                select 1
                from public.tasks_assignees ta
                join public.team_members tm on tm.id = ta.team_member_id
                where ta.task_id = _task_id
                  and tm.user_id = auth.uid()
            )
        );
$$;

revoke all on function public.can_view_task(uuid, uuid) from public;
grant execute on function public.can_view_task(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. is_task_member — now limited-aware (cascades to every task-scoped table)
-- -----------------------------------------------------------------------------
-- Was: is_project_team_member(project_of_task). Now delegates to can_view_task,
-- so task comments / work logs / labels / dependencies / subtasks / references
-- all restrict a limited member to their assigned tasks with no per-policy edit.
create or replace function public.is_task_member(_task_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select public.can_view_task(
        _task_id,
        (select t.project_id from public.tasks t where t.id = _task_id)
    );
$$;

-- -----------------------------------------------------------------------------
-- 3. tasks table policies
-- -----------------------------------------------------------------------------
-- SELECT: limited members see only their assigned tasks.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
    for select to authenticated
    using (public.can_view_task(id, project_id));

-- UPDATE: a limited member may act (status, dates, etc.) only on tasks assigned
-- to them; other members keep project-wide edit as before.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
    for update to authenticated
    using (public.can_view_task(id, project_id))
    with check (public.can_view_task(id, project_id));

-- INSERT: limited members cannot create tasks (they're assignees, not authors).
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
    for insert to authenticated
    with check (
        public.is_project_team_member(project_id)
        and not public.is_limited_member(public.team_id_of_project(project_id))
    );

-- -----------------------------------------------------------------------------
-- 4. create_task — block limited members (SECURITY DEFINER bypasses RLS, so the
--    guard must live in the function). create_task_with_template calls this, so
--    it inherits the guard. Body is otherwise identical to 20260401.
-- -----------------------------------------------------------------------------
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

    -- Caller MUST be a member of the project's team.
    if not public.is_project_team_member(p_project_id) then
        raise exception 'create_task: caller is not a member of project %', p_project_id;
    end if;

    -- Limited members can only work on tasks assigned to them — not author new ones.
    if public.is_limited_member(public.team_id_of_project(p_project_id)) then
        raise exception 'create_task: limited members cannot create tasks';
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

-- -----------------------------------------------------------------------------
-- 5. Catalog coherence — a limited member shouldn't restructure a project's
--    status columns. (Per-workspace overrides via set_capability() still win.)
-- -----------------------------------------------------------------------------
update public.permission_capabilities
   set default_limited = false
 where key = 'manage_statuses';
