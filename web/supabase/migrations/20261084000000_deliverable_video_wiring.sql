-- =============================================================================
-- Deliverables, take 2: exactly TWO kinds, and Video Review actually drives
-- the task.
-- =============================================================================
--   * 'status' — completing the task's status IS the deliverable (nothing
--     extra to submit). Replaces the old 'text' kind (data migrated).
--   * 'video'  — the submission is a video (upload or URL) that goes through
--     the Video Review app; the review decision now SYNCS the linked task:
--       send for review   → task.submission_status = 'submitted'
--       approve           → task moves to its project's Done status (the
--                           set_task_completed trigger flips done/completed_at,
--                           which also fires the cubes award)
--       request changes   → task moves back to Doing, submission 'pending'
--   * create_task_with_template now COPIES the template's deliverable_type
--     onto the created task (it never did — the "Video task" template produced
--     plain tasks), and applies the new due_offset_days.

-- ------------------------------------------------- two-kind deliverables ----
-- Constraints FIRST (the old ones would reject 'status'), then the data.
alter table public.tasks drop constraint if exists tasks_deliverable_type_chk;
alter table public.task_templates drop constraint if exists task_templates_deliverable_type_chk;

update public.tasks          set deliverable_type = 'status' where deliverable_type = 'text';
update public.task_templates set deliverable_type = 'status' where deliverable_type = 'text';

alter table public.tasks add constraint tasks_deliverable_type_chk
    check (deliverable_type is null or deliverable_type in ('status', 'video'));
alter table public.task_templates add constraint task_templates_deliverable_type_chk
    check (deliverable_type is null or deliverable_type in ('status', 'video'));

-- ------------------------------------------------------- template due-in ----
alter table public.task_templates
    add column if not exists due_offset_days integer;
do $$
begin
    alter table public.task_templates
        add constraint task_templates_due_offset_check
        check (due_offset_days is null or (due_offset_days >= 0 and due_offset_days <= 365));
exception when duplicate_object then null;
end;
$$;

-- --------------------------------------------------------------- helper -----
-- The project's first status in the Done (or Doing) category — mirrors the
-- is_todo lookup create_task uses. Called from SECURITY DEFINER bodies only.
create or replace function public.project_category_status(_project_id uuid, _done boolean)
    returns uuid
    language sql stable security definer set search_path = public
as
$$
    select s.id
    from public.task_statuses s
    join public.sys_task_status_categories c on c.id = s.category_id
    where s.project_id = _project_id
      and ((_done and c.is_done is true) or ((not _done) and c.is_doing is true))
    order by s.sort_order
    limit 1;
$$;
revoke all on function public.project_category_status(uuid, boolean) from public;

-- --------------------------------------- create_task_with_template v2 -------
-- Body identical to 20261014 plus: copy the template's deliverable_type and
-- default due date (due_offset_days) onto the parent task.
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

-- ------------------------------------- send for review → task submitted -----
create or replace function public.video_review_send_for_review(p_video_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v public.app_video_review_videos;
    r record;
begin
    if not public.video_review_can_access(p_video_id) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into v from public.app_video_review_videos where id = p_video_id;
    if v.id is null then
        raise exception 'not found' using errcode = 'P0002';
    end if;
    -- Only the assigned editor (or a team admin) may send for review.
    if v.editor_id is not null
       and v.editor_id <> auth.uid()
       and not public.is_team_admin(v.team_id) then
        raise exception 'only the editor can send for review' using errcode = '42501';
    end if;

    update public.app_video_review_videos
       set stage = 'in_review', status = 'in_review', updated_at = now()
     where id = p_video_id;

    -- A video-deliverable task counts as SUBMITTED the moment its video goes
    -- out for review.
    if v.task_id is not null then
        update public.tasks
           set submission_status = 'submitted'
         where id = v.task_id;
    end if;

    for r in
        select rv.user_id
        from public.app_video_review_reviewers rv
        join public.team_members tm
          on tm.team_id = v.team_id and tm.user_id = rv.user_id
        where rv.video_id = p_video_id
          and coalesce(tm.active, true)
    loop
        if r.user_id <> auth.uid() then
            perform public.create_notification(
                r.user_id,
                'A video is ready for your review: ' || v.title,
                'assignment',
                '/apps/video-review/' || p_video_id::text,
                v.team_id, v.task_id, v.project_id);
        end if;
    end loop;
end;
$$;

-- --------------------------------------- decision → linked task status ------
create or replace function public.video_review_decide(p_video_id uuid, p_approved boolean)
    returns void
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v public.app_video_review_videos;
begin
    if not public.video_review_can_access(p_video_id) then
        raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into v from public.app_video_review_videos where id = p_video_id;
    if v.id is null then
        raise exception 'not found' using errcode = 'P0002';
    end if;
    -- Only an assigned reviewer (or a team admin) may decide — otherwise any
    -- team member could forge a client/manager sign-off.
    if not exists (
        select 1 from public.app_video_review_reviewers
        where video_id = p_video_id and user_id = auth.uid()
    ) and not public.is_team_admin(v.team_id) then
        raise exception 'only an assigned reviewer can decide' using errcode = '42501';
    end if;

    if p_approved then
        update public.app_video_review_videos
           set stage = 'approved', status = 'approved', updated_at = now()
         where id = p_video_id;
    else
        update public.app_video_review_videos
           set stage = 'editing', status = 'changes_requested', updated_at = now()
         where id = p_video_id;
    end if;

    -- Review decision drives the LINKED TASK: approve → the project's Done
    -- status (set_task_completed then flips done/completed_at, which in turn
    -- fires the cubes award); request-changes → back to Doing + pending.
    if v.task_id is not null then
        if p_approved then
            update public.tasks t
               set status_id = coalesce(
                       public.project_category_status(t.project_id, true), t.status_id),
                   submission_status = 'submitted'
             where t.id = v.task_id;
        else
            update public.tasks t
               set status_id = coalesce(
                       public.project_category_status(t.project_id, false), t.status_id),
                   submission_status = 'pending'
             where t.id = v.task_id;
        end if;
    end if;

    if v.editor_id is not null and v.editor_id <> auth.uid() then
        perform public.create_notification(
            v.editor_id,
            case when p_approved
                 then 'Your video was approved: ' || v.title
                 else 'Changes requested on: ' || v.title end,
            'assignment',
            '/apps/video-review/' || p_video_id::text,
            v.team_id, v.task_id, v.project_id);
    end if;
end;
$$;

-- =============================================================================
-- END deliverable video wiring
-- =============================================================================
