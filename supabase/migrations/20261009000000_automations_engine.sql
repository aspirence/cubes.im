-- =============================================================================
-- Automations engine: project-scoped "when X then Y" rules on tasks
--
-- Model (v1): one trigger + one action per rule; users compose behavior with
-- multiple rules. Rules fire from AFTER triggers on tasks / tasks_assignees.
--
--   trigger_type            trigger_config
--   -------------           -----------------------------------------------
--   task_created            {}
--   status_changed          { "to_status_id": uuid? }      (absent = any)
--   priority_changed        { "to_priority_id": uuid? }    (absent = any)
--   task_completed          {}                             (done false -> true)
--   assignee_added          { "team_member_id": uuid? }    (absent = any)
--
--   action_type             action_config
--   -------------           -----------------------------------------------
--   set_status              { "status_id": uuid }
--   set_priority            { "priority_id": uuid }
--   assign_member           { "team_member_id": uuid }
--   add_label               { "label_id": uuid }
--   notify_member           { "user_id": uuid, "message": text? }
--   add_comment             { "content": text }
--
-- Recursion guard: automation actions mutate tasks/tasks_assignees, which
-- would re-fire the matcher triggers. A transaction-local GUC
-- (app.automations_depth) caps the chain at depth 1 — an action never
-- triggers further automations. Ordinary triggers (activity log, assignment
-- notifications, completed_at) still fire for automation-made changes, so
-- those changes stay visible/audited like human edits.
-- =============================================================================

-- ---------------------------------------------------------------- tables ----

create table if not exists public.automations (
    id             uuid                     default gen_random_uuid() not null,
    project_id     uuid                                               not null,
    name           text                                               not null,
    enabled        boolean                  default true              not null,
    trigger_type   text                                               not null,
    trigger_config jsonb                    default '{}'::jsonb       not null,
    action_type    text                                               not null,
    action_config  jsonb                    default '{}'::jsonb       not null,
    created_by     uuid,
    run_count      integer                  default 0                 not null,
    last_run_at    timestamp with time zone,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint automations_pk primary key (id),
    constraint automations_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint automations_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint automations_name_check check (char_length(name) <= 200),
    constraint automations_trigger_type_check
        check (trigger_type in ('task_created', 'status_changed', 'priority_changed',
                                'task_completed', 'assignee_added')),
    constraint automations_action_type_check
        check (action_type in ('set_status', 'set_priority', 'assign_member',
                               'add_label', 'notify_member', 'add_comment')),
    constraint automations_trigger_config_check check (jsonb_typeof(trigger_config) = 'object'),
    constraint automations_action_config_check check (jsonb_typeof(action_config) = 'object')
);

create index if not exists automations_project_id_index
    on public.automations (project_id);

-- Per-fire audit log. Kept lean: the UI surfaces run_count / last_run_at on
-- the rule; this table is the debugging trail (esp. status = 'error').
create table if not exists public.automation_runs (
    id            uuid                     default gen_random_uuid() not null,
    automation_id uuid                                               not null,
    task_id       uuid,
    status        text                     default 'success'         not null,
    detail        text,
    created_at    timestamp with time zone default current_timestamp not null,
    constraint automation_runs_pk primary key (id),
    constraint automation_runs_automation_id_fk
        foreign key (automation_id) references public.automations (id) on delete cascade,
    constraint automation_runs_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete set null,
    constraint automation_runs_status_check
        check (status in ('success', 'error', 'skipped'))
);

create index if not exists automation_runs_automation_id_index
    on public.automation_runs (automation_id, created_at desc);

-- Touch updated_at on rule edits — but not on the executor's run-counter
-- bumps, so updated_at keeps meaning "definition last changed".
create or replace function public.set_automation_updated_at()
    returns trigger
    language plpgsql
as
$$
begin
    if (to_jsonb(new) - 'run_count' - 'last_run_at' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'run_count' - 'last_run_at' - 'updated_at') then
        new.updated_at := current_timestamp;
    end if;
    return new;
end;
$$;

drop trigger if exists automations_set_updated_at on public.automations;
create trigger automations_set_updated_at
    before update on public.automations
    for each row
    execute function public.set_automation_updated_at();

-- ------------------------------------------------------------- executor ----

-- Runs a single matched rule against a task row. SECURITY DEFINER: actions
-- must succeed regardless of the acting user's granular RLS (the actor just
-- mutated the task, so they are already a project team member — the matcher
-- only loads rules for that same project).
create or replace function public.execute_task_automation(
    p_automation public.automations,
    p_task       public.tasks
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _cfg     jsonb := p_automation.action_config;
    _team_id uuid;
    _user_id uuid;
begin
    -- Depth guard ON for everything this action touches: nested task /
    -- assignee DML must not re-enter the matchers.
    perform set_config('app.automations_depth', '1', true);

    case p_automation.action_type
        when 'set_status' then
            update public.tasks
                set status_id = (_cfg ->> 'status_id')::uuid
                where id = p_task.id
                  and status_id is distinct from (_cfg ->> 'status_id')::uuid;

        when 'set_priority' then
            update public.tasks
                set priority_id = (_cfg ->> 'priority_id')::uuid
                where id = p_task.id
                  and priority_id is distinct from (_cfg ->> 'priority_id')::uuid;

        when 'assign_member' then
            insert into public.tasks_assignees (task_id, team_member_id, assigned_by)
            values (p_task.id, (_cfg ->> 'team_member_id')::uuid, auth.uid())
            on conflict (task_id, team_member_id) do nothing;

        when 'add_label' then
            insert into public.task_labels (task_id, label_id)
            values (p_task.id, (_cfg ->> 'label_id')::uuid)
            on conflict (task_id, label_id) do nothing;

        when 'notify_member' then
            select p.team_id into _team_id
            from public.projects p where p.id = p_task.project_id;
            _user_id := (_cfg ->> 'user_id')::uuid;
            perform public.create_notification(
                p_user_id    => _user_id,
                p_message    => coalesce(nullif(trim(_cfg ->> 'message'), ''),
                                         'Automation "' || p_automation.name || '" fired')
                                || ' — ' || coalesce(p_task.name, 'a task'),
                p_type       => 'info',
                p_url        => null,
                p_team_id    => _team_id,
                p_task_id    => p_task.id,
                p_project_id => p_task.project_id
            );

        when 'add_comment' then
            -- created_by null = system comment; the standard comment trigger
            -- still notifies task participants.
            insert into public.task_comments (task_id, content, created_by)
            values (p_task.id,
                    coalesce(nullif(trim(_cfg ->> 'content'), ''),
                             'Automation "' || p_automation.name || '" fired'),
                    null);
    end case;

    update public.automations
        set run_count = run_count + 1, last_run_at = now()
        where id = p_automation.id;

    insert into public.automation_runs (automation_id, task_id, status)
    values (p_automation.id, p_task.id, 'success');

    perform set_config('app.automations_depth', '', true);
exception
    when others then
        -- The implicit savepoint rolled the action back (and the GUC with it);
        -- record the failure without failing the user's original statement.
        insert into public.automation_runs (automation_id, task_id, status, detail)
        values (p_automation.id, p_task.id, 'error', sqlerrm);
end;
$$;

-- -------------------------------------------------------------- matchers ----

create or replace function public.automations_on_task_insert()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _a public.automations;
begin
    if coalesce(current_setting('app.automations_depth', true), '') = '1' then
        return new;
    end if;

    for _a in
        select * from public.automations a
        where a.project_id = new.project_id
          and a.enabled
          and a.trigger_type = 'task_created'
        order by a.created_at, a.id
    loop
        perform public.execute_task_automation(_a, new);
    end loop;

    return new;
end;
$$;

create or replace function public.automations_on_task_update()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _a public.automations;
begin
    if coalesce(current_setting('app.automations_depth', true), '') = '1' then
        return new;
    end if;

    for _a in
        select * from public.automations a
        where a.project_id = new.project_id
          and a.enabled
          and a.trigger_type in ('status_changed', 'priority_changed', 'task_completed')
        order by a.created_at, a.id
    loop
        if _a.trigger_type = 'status_changed'
           and new.status_id is distinct from old.status_id
           and ((_a.trigger_config ->> 'to_status_id') is null
                or (_a.trigger_config ->> 'to_status_id')::uuid = new.status_id)
        then
            perform public.execute_task_automation(_a, new);

        elsif _a.trigger_type = 'priority_changed'
              and new.priority_id is distinct from old.priority_id
              and ((_a.trigger_config ->> 'to_priority_id') is null
                   or (_a.trigger_config ->> 'to_priority_id')::uuid = new.priority_id)
        then
            perform public.execute_task_automation(_a, new);

        elsif _a.trigger_type = 'task_completed'
              and new.done is true and old.done is not true
        then
            perform public.execute_task_automation(_a, new);
        end if;
    end loop;

    return new;
end;
$$;

create or replace function public.automations_on_assignee_insert()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _a    public.automations;
    _task public.tasks;
begin
    if coalesce(current_setting('app.automations_depth', true), '') = '1' then
        return new;
    end if;

    select * into _task from public.tasks t where t.id = new.task_id;
    if _task.id is null then
        return new;
    end if;

    for _a in
        select * from public.automations a
        where a.project_id = _task.project_id
          and a.enabled
          and a.trigger_type = 'assignee_added'
          and ((a.trigger_config ->> 'team_member_id') is null
               or (a.trigger_config ->> 'team_member_id')::uuid = new.team_member_id)
        order by a.created_at, a.id
    loop
        perform public.execute_task_automation(_a, _task);
    end loop;

    return new;
end;
$$;

drop trigger if exists tasks_automations_on_insert on public.tasks;
create trigger tasks_automations_on_insert
    after insert on public.tasks
    for each row
    execute function public.automations_on_task_insert();

drop trigger if exists tasks_automations_on_update on public.tasks;
create trigger tasks_automations_on_update
    after update on public.tasks
    for each row
    execute function public.automations_on_task_update();

drop trigger if exists tasks_assignees_automations_on_insert on public.tasks_assignees;
create trigger tasks_assignees_automations_on_insert
    after insert on public.tasks_assignees
    for each row
    execute function public.automations_on_assignee_insert();

-- ------------------------------------------------------------------- RLS ----

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

drop policy if exists automations_select on public.automations;
create policy automations_select on public.automations
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists automations_insert on public.automations;
create policy automations_insert on public.automations
    for insert to authenticated
    with check (public.is_project_team_admin(project_id));

drop policy if exists automations_update on public.automations;
create policy automations_update on public.automations
    for update to authenticated
    using (public.is_project_team_admin(project_id))
    with check (public.is_project_team_admin(project_id));

drop policy if exists automations_delete on public.automations;
create policy automations_delete on public.automations
    for delete to authenticated
    using (public.is_project_team_admin(project_id));

-- Runs are read-only for members; rows are written only by the SECURITY
-- DEFINER executor (owner bypasses RLS).
drop policy if exists automation_runs_select on public.automation_runs;
create policy automation_runs_select on public.automation_runs
    for select to authenticated
    using (exists (
        select 1 from public.automations a
        where a.id = automation_runs.automation_id
          and public.is_project_team_member(a.project_id)
    ));

-- ---------------------------------------------------------------- grants ----

grant select, insert, update, delete on public.automations to authenticated;
grant select on public.automation_runs to authenticated;
grant all on public.automations to service_role;
grant all on public.automation_runs to service_role;
