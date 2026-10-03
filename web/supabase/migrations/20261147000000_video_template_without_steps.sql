-- ============================================================================
-- The seeded "Video task" template stops carrying subtask steps.
--
-- Picking that template in the create-task modal is the only way to give a
-- new task a video deliverable, so every video task arrived with four
-- subtasks nobody asked for: "Upload first draft", "Collect feedback in Video
-- Review", "Apply revisions", "Final export & deliver".
-- create_task_with_template built them with no status, and create_task's
-- fallback is the project's FIRST to-do column, so they piled up in Backlog
-- while the parent sat in the column the user chose. Production had 500 of
-- them, none ever touched.
--
-- 1. New teams get a "Video task" template that only sets the deliverable.
-- 2. Existing teams' copies lose the seeded steps, but only where the steps
--    are still exactly the seeded four: a team that edited its template
--    keeps its own steps.
-- 3. Steps from ANY template now land in the parent's status, not the first
--    column. Subtasks go where their task goes.
--
-- The subtasks already created are removed separately by
-- scripts/cleanup-video-template-subtasks.sql.
-- ============================================================================

-- 1. Seed without steps (task_templates.steps defaults to '[]').
create or replace function public.ensure_video_template(p_team_id uuid, p_owner uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if not exists (
        select 1 from public.task_templates
        where team_id = p_team_id and lower(name) = 'video task'
    ) then
        insert into public.task_templates
            (team_id, name, description, priority, deliverable_type, created_by)
        values (
            p_team_id,
            'Video task',
            'A video deliverable, reviewed in Video Review.',
            'medium',
            'video',
            p_owner
        );
    end if;
end;
$$;

-- 2. Strip the seeded steps from every untouched copy.
update public.task_templates
   set steps = '[]'::jsonb
 where lower(name) = 'video task'
   and steps = '[{"name":"Upload first draft"},
                 {"name":"Collect feedback in Video Review"},
                 {"name":"Apply revisions"},
                 {"name":"Final export & deliver"}]'::jsonb;

-- 3. Template steps follow the parent's status.
create or replace function public.create_task_with_template(
    p_project_id  uuid,
    p_name        text,
    p_template_id uuid    default null,
    p_description text    default null,
    p_priority_id uuid    default null,
    p_status_id   uuid    default null,
    p_assignees   uuid[]  default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _task_id   uuid;
    _status_id uuid;
    _tpl       public.task_templates;
    _team_id   uuid;
    _step      jsonb;
    _sname     text;
    _sprio     uuid;
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
            -- The template's blueprint properties land on the parent task.
            update public.tasks
               set deliverable_type = coalesce(
                       case when _tpl.deliverable_type = 'text' then 'status'
                            else _tpl.deliverable_type end,
                       deliverable_type),
                   end_date = case
                       when _tpl.due_offset_days is not null
                       then now() + make_interval(days => _tpl.due_offset_days)
                       else end_date
                   end
             where id = _task_id;

            -- The status the parent ENDED UP with (create_task may have
            -- fallen back from p_status_id). Steps sit next to their parent,
            -- not in the project's first column.
            select status_id into _status_id from public.tasks where id = _task_id;

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
                    _sname, p_project_id, _status_id, _sprio, _task_id, null);
            end loop;
        end if;
    end if;

    return _task_id;
end;
$$;
