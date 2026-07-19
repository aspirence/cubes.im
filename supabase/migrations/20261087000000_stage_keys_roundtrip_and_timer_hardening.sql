-- =============================================================================
-- Review fixes for the 4-stage status model + timers (follows 20261085/86)
-- =============================================================================
-- 1) create_project_template_from_project still serialized categories with the
--    LEGACY 3-key case (done/doing/todo). Post-20261085 that breaks the
--    round-trip for two stages: a Closed status ("Completed", is_done) came
--    back as flagless Done (so finishing tasks there never set tasks.done),
--    and a Done-stage status ("In Review") came back as 'todo'. The CASE now
--    emits the four stage keys.
-- 2) task_timers had no per-user uniqueness, so two concurrent start_timer
--    calls on different tasks could leave TWO running timers (check-then-act
--    race). Dedupe (keep newest) and add a unique index; start_timer's loop
--    stays as the work-logging path.
-- =============================================================================

-- ----- 1. Save-as-template: emit stage keys ---------------------------------
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
                    -- The four stage keys create_project_from_template consumes
                    -- (flagless category = the Done stage).
                    'category', case
                        when c.is_done  then 'closed'
                        when c.is_doing then 'active'
                        when c.is_todo  then 'not_started'
                        else 'done' end)
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

-- Repair any templates saved through the legacy serializer AFTER 20261085's
-- one-time remap ran (same mapping: legacy 'done' always meant "counts as
-- complete" = Closed).
update public.project_templates pt
   set template = jsonb_set(pt.template, '{statuses}', (
        select jsonb_agg(
            jsonb_set(e, '{category}', to_jsonb(
                case e ->> 'category'
                    when 'todo'  then 'not_started'
                    when 'doing' then 'active'
                    when 'done'  then 'closed'
                    else coalesce(e ->> 'category', 'not_started')
                end))
            order by ord)
        from jsonb_array_elements(pt.template -> 'statuses') with ordinality as t(e, ord)
   ))
 where jsonb_typeof(pt.template -> 'statuses') = 'array'
   and exists (
        select 1 from jsonb_array_elements(pt.template -> 'statuses') x
        where x ->> 'category' in ('todo', 'doing')
   );

-- ----- 2. One running timer per user, enforced by the database --------------
-- Dedupe first (keep each user's newest timer), then the unique index.
delete from public.task_timers t
 using public.task_timers d
 where d.user_id = t.user_id
   and d.id <> t.id
   and (d.start_time > t.start_time
        or (d.start_time = t.start_time and d.id > t.id));

create unique index if not exists task_timers_one_per_user
    on public.task_timers (user_id);
