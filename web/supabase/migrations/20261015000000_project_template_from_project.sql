-- =============================================================================
-- Save a live project as a project template ("Save as template").
-- =============================================================================
-- Project templates (project_templates + create_project_from_template) already
-- let you author a blueprint by hand in Settings and spin up a project from it.
-- This adds the reverse: capture an EXISTING project's structure — phases,
-- statuses, and top-level tasks — into a new project_templates row whose
-- `template` JSONB matches the shape create_project_from_template consumes:
--   { phases:[{name,color}], statuses:[{name,category}], tasks:[{name,status,priority}] }
-- so the round-trip (project -> template -> new project) is lossless.

create or replace function public.create_project_template_from_project(
    p_project_id uuid,
    p_name       text
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team_id uuid;
    _doc     jsonb;
    _tpl_id  uuid;
begin
    if not public.is_project_team_member(p_project_id) then
        raise exception 'create_project_template_from_project: not authorized';
    end if;
    select team_id into _team_id from public.projects where id = p_project_id;
    if _team_id is null then
        raise exception 'create_project_template_from_project: project not found';
    end if;
    if nullif(trim(coalesce(p_name, '')), '') is null then
        raise exception 'create_project_template_from_project: template name required';
    end if;

    _doc := jsonb_build_object(
        'phases', coalesce((
            select jsonb_agg(
                jsonb_build_object('name', ph.name, 'color', ph.color_code)
                order by ph.sort_index)
            from public.project_phases ph
            where ph.project_id = p_project_id
        ), '[]'::jsonb),
        'statuses', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'name', s.name,
                    'category', case
                        when c.is_done then 'done'
                        when c.is_doing then 'doing'
                        else 'todo' end)
                order by s.sort_order)
            from public.task_statuses s
            join public.sys_task_status_categories c on c.id = s.category_id
            where s.project_id = p_project_id
        ), '[]'::jsonb),
        'tasks', coalesce((
            select jsonb_agg(x)
            from (
                select jsonb_build_object(
                    'name', t.name,
                    'status', ts.name,
                    'priority', pr.name) as x
                from public.tasks t
                left join public.task_statuses ts on ts.id = t.status_id
                left join public.task_priorities pr on pr.id = t.priority_id
                where t.project_id = p_project_id
                  and t.parent_task_id is null
                  and t.archived = false
                order by t.sort_order, t.created_at
                limit 300  -- keep templates lean; deep backlogs aren't blueprints
            ) sub
        ), '[]'::jsonb)
    );

    insert into public.project_templates (team_id, name, template, created_by)
    values (_team_id, left(trim(p_name), 200), _doc, auth.uid())
    returning id into _tpl_id;
    return _tpl_id;
end;
$$;

revoke all on function public.create_project_template_from_project(uuid, text)
    from public, anon;
grant execute on function public.create_project_template_from_project(uuid, text)
    to authenticated;
