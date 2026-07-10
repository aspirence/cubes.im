-- =============================================================================
-- Task templates v2 — single-task blueprints with subtask steps + per-project
-- default. Builds on the existing task_templates (20260701): today a template is
-- a flat list of tasks bulk-applied to a project (apply_task_template, kept as
-- is). This adds the "pick a template when creating ONE task" model:
--   * task_templates.description / .priority — prefill the new task's fields,
--   * task_templates.steps (jsonb array of {name, priority?}) — become subtasks,
--   * projects.default_task_template_id — the template preselected for that
--     project's Create-Task modal (per-list default).
-- =============================================================================

-- 1. Blueprint columns on task_templates -------------------------------------
alter table public.task_templates
    add column if not exists description text,
    add column if not exists priority    text,
    add column if not exists steps        jsonb default '[]'::jsonb not null;

alter table public.task_templates
    drop constraint if exists task_templates_steps_check;
alter table public.task_templates
    add constraint task_templates_steps_check check (jsonb_typeof(steps) = 'array');

-- 2. Per-project default template --------------------------------------------
alter table public.projects
    add column if not exists default_task_template_id uuid;
alter table public.projects
    drop constraint if exists projects_default_task_template_fk;
alter table public.projects
    add constraint projects_default_task_template_fk
    foreign key (default_task_template_id)
    references public.task_templates (id) on delete set null;

-- 3. create_task_with_template ------------------------------------------------
-- Creates a task and (if a template is given) its subtask steps, atomically.
-- Reuses create_task for both the parent and each step, so its
-- is_project_team_member(auth.uid()) gate + status defaulting apply throughout.
create or replace function public.create_task_with_template(
    p_project_id  uuid,
    p_name        text,
    p_template_id uuid   default null,
    p_description text   default null,
    p_priority_id uuid   default null,
    p_status_id   uuid   default null,
    p_assignees   uuid[] default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _task_id uuid;
    _tpl     public.task_templates;
    _team_id uuid;
    _step    jsonb;
    _sname   text;
    _sprio   uuid;
begin
    -- Parent task (create_task enforces membership, name, and status default).
    _task_id := public.create_task(
        p_name, p_project_id, p_status_id, p_priority_id, null, p_assignees);

    if p_description is not null and length(trim(p_description)) > 0 then
        update public.tasks
           set description = left(p_description, 500000)
         where id = _task_id;
    end if;

    if p_template_id is not null then
        select team_id into _team_id from public.projects where id = p_project_id;
        select * into _tpl from public.task_templates
         where id = p_template_id and team_id = _team_id;
        if found then
            for _step in
                select * from jsonb_array_elements(coalesce(_tpl.steps, '[]'::jsonb))
            loop
                _sname := left(trim(coalesce(_step ->> 'name', '')), 500);
                if _sname = '' then
                    continue;
                end if;
                _sprio := null;
                if nullif(trim(coalesce(_step ->> 'priority', '')), '') is not null then
                    select id into _sprio from public.task_priorities
                     where lower(name) = lower(_step ->> 'priority')
                     limit 1;
                end if;
                -- Each step becomes a subtask of the parent.
                perform public.create_task(
                    _sname, p_project_id, null, _sprio, _task_id, null);
            end loop;
        end if;
    end if;

    return _task_id;
end;
$$;

revoke all on function public.create_task_with_template(uuid, text, uuid, text, uuid, uuid, uuid[])
    from public, anon;
grant execute on function public.create_task_with_template(uuid, text, uuid, text, uuid, uuid, uuid[])
    to authenticated;
