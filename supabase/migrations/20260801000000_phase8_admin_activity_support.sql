-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 8: Admin center + Activity logs + Support
-- =============================================================================
-- Builds on Phase 1 (identity/tenancy + organizations/teams/team_members/users +
-- is_team_member / is_team_admin / is_org_member), Phase 3 (projects + the
-- project-granular helpers team_id_of_project / is_project_team_member) and
-- Phase 4 (tasks / task_statuses / task_priorities / tasks_assignees + the
-- task_no / set_task_completed BEFORE triggers + is_task_member).
--
-- Adds:
--   * task_activity_logs   — append-only audit of task changes (created, renamed,
--     status_changed, priority_changed, assigned, completed). Rows are written
--     ONLY by AFTER triggers on tasks / tasks_assignees that run as the table
--     owner (SECURITY DEFINER), so they bypass RLS for the INSERT. There is NO
--     INSERT/UPDATE/DELETE policy — the table is read-only to clients.
--   * support_requests     — a user's own support tickets (subject/message/status).
--     Fully user-private: every op gated by user_id = auth.uid().
--   * Trigger functions log_task_created / log_task_changes / log_task_assigned
--     (SECURITY DEFINER, pinned search_path) feeding task_activity_logs.
--   * is_org_admin(_org_id) helper — true for the org OWNER or an admin of ANY
--     team in the org. Used to gate the admin RPCs.
--   * Admin RPCs (SECURITY DEFINER, STABLE where read-only): admin_org_overview,
--     admin_list_teams, admin_list_users, admin_list_projects. Each raises
--     'forbidden' unless is_org_admin(p_org_id).
--   * RLS enable + policies + grants for the two new public tables, and execute
--     grants for the new RPCs + is_org_admin.
--
-- Supabase adaptations carried over from Phases 1-7:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() via the column DEFAULT
--     (never cast explicitly in a function body).
--   * any FUNCTION BODY touching gen_random_uuid()/citext pins
--     `set search_path = public, extensions` so the UUID column default resolves
--     and public.* / extensions.* are deterministic. The activity-log trigger fns
--     INSERT a gen_random_uuid()-defaulted row, so they MUST pin that path.
--
-- Faithfulness notes vs. the legacy schema (cubes-backend/.../1_tables.sql):
--   * legacy task_activity_logs carried (attribute_type, log_type in
--     create|update|delete|assign|unassign, prev_string/next_string, team_id). The
--     Phase 8 brief narrows this to a single `action` text (created|renamed|
--     status_changed|priority_changed|assigned|completed) plus field/old_value/
--     new_value and drops team_id (project_id is sufficient; team is reachable via
--     the project). Per-field granular diffs beyond name/status/priority/assignee
--     are DEFERRED.
--   * support_requests is brand-new (legacy had no in-app support table; tickets
--     were handled externally). Kept lean: subject/message/status('open'|'closed').
--
-- Re-runnable where practical (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP TRIGGER IF EXISTS / DROP POLICY IF EXISTS). No lookup seed needed.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 task_activity_logs (legacy: task_activity_logs, narrowed). Append-only
--     audit of task changes. user_id is who initiated the change (nullable — a
--     trigger may run with no auth.uid(), e.g. a system / cron actor). Both
--     task_id and project_id CASCADE on parent delete so an audit row never
--     outlives its task/project. Writes happen ONLY via the AFTER triggers below
--     (which run as the table owner and so bypass RLS); clients only SELECT.
-- -----------------------------------------------------------------------------
create table if not exists public.task_activity_logs (
    id         uuid                     default gen_random_uuid() not null,
    task_id    uuid                                               not null,
    project_id uuid                                               not null,
    user_id    uuid,
    action     text                                               not null,
    field      text,
    old_value  text,
    new_value  text,
    created_at timestamp with time zone default current_timestamp not null,
    constraint task_activity_logs_pk primary key (id),
    constraint task_activity_logs_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_activity_logs_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint task_activity_logs_user_id_fk
        foreign key (user_id) references public.users (id) on delete set null,
    constraint task_activity_logs_action_check
        check (action in ('created', 'renamed', 'status_changed',
                          'priority_changed', 'assigned', 'completed'))
);

-- -----------------------------------------------------------------------------
-- 1.2 support_requests (new). A user's own support tickets. team_id is optional
--     context (which team the request relates to). status is open|closed. The
--     row is owned by user_id and is private to that user (RLS below). user_id
--     CASCADE on user delete; team_id SET NULL on team delete (keep the ticket).
-- -----------------------------------------------------------------------------
create table if not exists public.support_requests (
    id         uuid                     default gen_random_uuid() not null,
    user_id    uuid                                               not null,
    team_id    uuid,
    subject    text                                               not null,
    message    text                                               not null,
    status     text                     default 'open'            not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint support_requests_pk primary key (id),
    constraint support_requests_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint support_requests_team_id_fk
        foreign key (team_id) references public.teams (id) on delete set null,
    constraint support_requests_status_check check (status in ('open', 'closed')),
    constraint support_requests_subject_check check (char_length(subject) <= 200),
    constraint support_requests_message_check check (char_length(message) <= 5000)
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists task_activity_logs_task_id_index
    on public.task_activity_logs (task_id);
create index if not exists task_activity_logs_project_id_index
    on public.task_activity_logs (project_id);
create index if not exists task_activity_logs_created_at_index
    on public.task_activity_logs (created_at);

create index if not exists support_requests_user_id_index
    on public.support_requests (user_id);
create index if not exists support_requests_team_id_index
    on public.support_requests (team_id);


-- =============================================================================
-- SECTION 3: Activity-log trigger functions (SECURITY DEFINER, pinned path)
-- =============================================================================
-- All three pin search_path = public, extensions so the gen_random_uuid() column
-- DEFAULT on task_activity_logs resolves and public.* is deterministic. They are
-- SECURITY DEFINER so they run as the table owner and bypass RLS for the INSERT
-- (there is intentionally no INSERT policy on task_activity_logs). They never
-- raise on a missing lookup — a NULL old/new value is fine.

-- -----------------------------------------------------------------------------
-- 3.1 log_task_created() — AFTER INSERT on tasks. Writes one 'created' row.
--     The actor is the task's reporter_id (who created it). project_id comes from
--     the new task itself.
-- -----------------------------------------------------------------------------
create or replace function public.log_task_created()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    insert into public.task_activity_logs
        (task_id, project_id, user_id, action, field, old_value, new_value)
    values (new.id, new.project_id, new.reporter_id, 'created', null, null, new.name);
    return new;
end;
$$;

drop trigger if exists tasks_log_created on public.tasks;
create trigger tasks_log_created
    after insert on public.tasks
    for each row
    execute function public.log_task_created();

-- -----------------------------------------------------------------------------
-- 3.2 log_task_changes() — AFTER UPDATE on tasks. Emits one row per field that
--     changed:
--       * name      changed -> 'renamed'          (old/new = the names)
--       * status_id changed -> 'status_changed'   (old/new = the status NAMES
--                                                   resolved from task_statuses)
--       * priority_id changed -> 'priority_changed'(old/new = the priority NAMES)
--       * done false->true  -> 'completed'        (new = the task name)
--     user_id = auth.uid() (may be NULL in a trigger context — that is allowed).
--     NOTE: NEW.done is already the value computed by the BEFORE trigger
--     set_task_completed (which derives done from the status category), so the
--     'completed' detection here sees the final, consistent done flag.
-- -----------------------------------------------------------------------------
create or replace function public.log_task_changes()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _actor    uuid := auth.uid();
    _old_name text;
    _new_name text;
begin
    -- renamed
    if new.name is distinct from old.name then
        insert into public.task_activity_logs
            (task_id, project_id, user_id, action, field, old_value, new_value)
        values (new.id, new.project_id, _actor, 'renamed', 'name', old.name, new.name);
    end if;

    -- status_changed (resolve the status names; either side may be null)
    if new.status_id is distinct from old.status_id then
        select s.name into _old_name from public.task_statuses s where s.id = old.status_id;
        select s.name into _new_name from public.task_statuses s where s.id = new.status_id;
        insert into public.task_activity_logs
            (task_id, project_id, user_id, action, field, old_value, new_value)
        values (new.id, new.project_id, _actor, 'status_changed', 'status_id',
                _old_name, _new_name);
    end if;

    -- priority_changed (resolve the priority names; either side may be null)
    if new.priority_id is distinct from old.priority_id then
        select p.name into _old_name from public.task_priorities p where p.id = old.priority_id;
        select p.name into _new_name from public.task_priorities p where p.id = new.priority_id;
        insert into public.task_activity_logs
            (task_id, project_id, user_id, action, field, old_value, new_value)
        values (new.id, new.project_id, _actor, 'priority_changed', 'priority_id',
                _old_name, _new_name);
    end if;

    -- completed (done flipped false -> true)
    if new.done is true and old.done is not true then
        insert into public.task_activity_logs
            (task_id, project_id, user_id, action, field, old_value, new_value)
        values (new.id, new.project_id, _actor, 'completed', 'done', 'false', 'true');
    end if;

    return new;
end;
$$;

drop trigger if exists tasks_log_changes on public.tasks;
create trigger tasks_log_changes
    after update on public.tasks
    for each row
    execute function public.log_task_changes();

-- -----------------------------------------------------------------------------
-- 3.3 log_task_assigned() — AFTER INSERT on tasks_assignees. Writes one
--     'assigned' row for the task. The actor is NEW.assigned_by; new_value is the
--     assigned member's user NAME (resolved team_member -> user). project_id is
--     resolved from the task.
-- -----------------------------------------------------------------------------
create or replace function public.log_task_assigned()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _project_id   uuid;
    _member_name  text;
begin
    select t.project_id into _project_id from public.tasks t where t.id = new.task_id;
    if _project_id is null then
        return new;  -- task vanished (shouldn't happen — FK is CASCADE); skip log.
    end if;

    select u.name into _member_name
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    where tm.id = new.team_member_id;

    insert into public.task_activity_logs
        (task_id, project_id, user_id, action, field, old_value, new_value)
    values (new.task_id, _project_id, new.assigned_by, 'assigned', 'assignee',
            null, _member_name);
    return new;
end;
$$;

drop trigger if exists tasks_assignees_log_assigned on public.tasks_assignees;
create trigger tasks_assignees_log_assigned
    after insert on public.tasks_assignees
    for each row
    execute function public.log_task_assigned();


-- =============================================================================
-- SECTION 4: is_org_admin helper
-- =============================================================================
-- True if the current user is the org OWNER (organizations.user_id = auth.uid())
-- OR an admin (owner/admin_role) of ANY team belonging to that org. SECURITY
-- DEFINER (reuses is_team_admin under the hood without tripping team_members RLS)
-- and STABLE. Gates every admin RPC below.
create or replace function public.is_org_admin(_org_id uuid)
    returns boolean
    language plpgsql
    stable
    security definer
    set search_path = public
as
$$
declare
    _team record;
begin
    -- org owner?
    if exists (
        select 1 from public.organizations o
        where o.id = _org_id and o.user_id = auth.uid()
    ) then
        return true;
    end if;

    -- admin of any team in the org?
    for _team in
        select t.id from public.teams t where t.organization_id = _org_id
    loop
        if public.is_team_admin(_team.id) then
            return true;
        end if;
    end loop;

    return false;
end;
$$;


-- =============================================================================
-- SECTION 5: Admin RPCs (SECURITY DEFINER; STABLE; gated by is_org_admin)
-- =============================================================================
-- Each RPC first checks is_org_admin(p_org_id) and raises 'forbidden' otherwise.
-- They are STABLE (read-only) and pin search_path = public, extensions (no UUID
-- generation, but kept consistent + deterministic). They aggregate across the
-- org's teams / projects / tasks.

-- -----------------------------------------------------------------------------
-- 5.1 admin_org_overview(p_org_id) -> one row of headline counts.
--     total_members counts DISTINCT users across all the org's teams (active
--     memberships). completed_tasks counts tasks with done = true.
-- -----------------------------------------------------------------------------
create or replace function public.admin_org_overview(p_org_id uuid)
    returns table (
        org_name            text,
        subscription_status text,
        trial_in_progress   boolean,
        total_teams         bigint,
        total_members       bigint,
        total_projects      bigint,
        total_tasks         bigint,
        completed_tasks     bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_org_admin(p_org_id) then
        raise exception 'forbidden';
    end if;

    return query
    select
        o.organization_name,
        o.subscription_status,
        o.trial_in_progress,
        (select count(*) from public.teams t where t.organization_id = o.id),
        (select count(distinct tm.user_id)
            from public.team_members tm
            join public.teams t on t.id = tm.team_id
            where t.organization_id = o.id
              and tm.active is true
              and tm.user_id is not null),
        (select count(*)
            from public.projects p
            join public.teams t on t.id = p.team_id
            where t.organization_id = o.id),
        (select count(*)
            from public.tasks tk
            join public.projects p on p.id = tk.project_id
            join public.teams t on t.id = p.team_id
            where t.organization_id = o.id),
        (select count(*)
            from public.tasks tk
            join public.projects p on p.id = tk.project_id
            join public.teams t on t.id = p.team_id
            where t.organization_id = o.id and tk.done is true)
    from public.organizations o
    where o.id = p_org_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.2 admin_list_teams(p_org_id) -> setof team rows with member/project counts.
--     member_count counts active memberships; project_count counts projects on
--     the team.
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_teams(p_org_id uuid)
    returns table (
        team_id       uuid,
        team_name     text,
        member_count  bigint,
        project_count bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_org_admin(p_org_id) then
        raise exception 'forbidden';
    end if;

    return query
    select
        t.id,
        t.name,
        (select count(*) from public.team_members tm
            where tm.team_id = t.id and tm.active is true),
        (select count(*) from public.projects p where p.team_id = t.id)
    from public.teams t
    where t.organization_id = p_org_id
    order by t.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.3 admin_list_users(p_org_id) -> setof distinct users in the org with the
--     number of the org's teams each belongs to (active memberships).
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_users(p_org_id uuid)
    returns table (
        user_id    uuid,
        name       text,
        email      text,
        team_count bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_org_admin(p_org_id) then
        raise exception 'forbidden';
    end if;

    return query
    select
        u.id,
        u.name,
        u.email::text,
        count(distinct tm.team_id)
    from public.users u
    join public.team_members tm on tm.user_id = u.id
    join public.teams t on t.id = tm.team_id
    where t.organization_id = p_org_id
      and tm.active is true
    group by u.id, u.name, u.email
    order by u.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5.4 admin_list_projects(p_org_id) -> setof projects in the org with their
--     team name, task count, and owner name (project.owner_id -> users).
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_projects(p_org_id uuid)
    returns table (
        project_id   uuid,
        project_name text,
        team_name    text,
        task_count   bigint,
        owner_name   text
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
begin
    if not public.is_org_admin(p_org_id) then
        raise exception 'forbidden';
    end if;

    return query
    select
        p.id,
        p.name,
        t.name,
        (select count(*) from public.tasks tk where tk.project_id = p.id),
        ou.name
    from public.projects p
    join public.teams t on t.id = p.team_id
    left join public.users ou on ou.id = p.owner_id
    where t.organization_id = p_org_id
    order by p.created_at;
end;
$$;


-- =============================================================================
-- SECTION 6: Enable Row Level Security + policies
-- =============================================================================
alter table public.task_activity_logs enable row level security;
alter table public.support_requests   enable row level security;

-- Convention (matches Phases 1-7): drop-then-create so re-runnable; policies
-- target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 6.1 task_activity_logs — SELECT only, gated by is_task_member(task_id) (a
--     member of the task's project's team). There is intentionally NO
--     INSERT/UPDATE/DELETE policy: the table is append-only and is written
--     EXCLUSIVELY by the SECURITY DEFINER triggers (which run as the table owner
--     and bypass RLS). A client INSERT/UPDATE/DELETE therefore fails (no policy).
-- -------------------------------------------------------------------
drop policy if exists task_activity_logs_select on public.task_activity_logs;
create policy task_activity_logs_select on public.task_activity_logs
    for select to authenticated
    using (public.is_task_member(task_id));

-- -------------------------------------------------------------------
-- 6.2 support_requests — fully user-private. Every op gated by
--     user_id = auth.uid() (with WITH CHECK mirrors on insert/update).
-- -------------------------------------------------------------------
drop policy if exists support_requests_select on public.support_requests;
create policy support_requests_select on public.support_requests
    for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists support_requests_insert on public.support_requests;
create policy support_requests_insert on public.support_requests
    for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists support_requests_update on public.support_requests;
create policy support_requests_update on public.support_requests
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

drop policy if exists support_requests_delete on public.support_requests;
create policy support_requests_delete on public.support_requests
    for delete to authenticated
    using (user_id = (select auth.uid()));


-- =============================================================================
-- SECTION 7: Function execute grants
-- =============================================================================
grant execute on function public.is_org_admin(uuid)         to authenticated;
grant execute on function public.admin_org_overview(uuid)   to authenticated;
grant execute on function public.admin_list_teams(uuid)     to authenticated;
grant execute on function public.admin_list_users(uuid)     to authenticated;
grant execute on function public.admin_list_projects(uuid)  to authenticated;
-- The trigger functions are invoked by the triggers (which run as the table
-- owner), not called directly by clients — no execute grant is needed for them.


-- =============================================================================
-- SECTION 8: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
--
-- task_activity_logs: SELECT only for authenticated. We deliberately do NOT
-- grant INSERT/UPDATE/DELETE — clients can never write the audit log directly;
-- the SECURITY DEFINER triggers (running as owner) do the writes.
grant select on public.task_activity_logs to authenticated;
grant select, insert, update, delete on public.support_requests to authenticated;

grant all on public.task_activity_logs to service_role;
grant all on public.support_requests   to service_role;

-- =============================================================================
-- END Phase 8
-- =============================================================================
