-- =============================================================================
-- Video Review — review workflow (editor → reviewers → approve / changes).
-- =============================================================================
-- Adds the workflow layer on top of the video-review app:
--   * a video has a STAGE (editing / in_review / approved) + an editor,
--   * REVIEWERS are the stakeholders (client / manager) who review,
--   * WORKFLOW TEMPLATES are reusable presets (default editor + reviewer set),
--   * transitions are SECURITY DEFINER RPCs so auto-assign can notify OTHER
--     users (user_notifications RLS only lets a user insert their own rows).
--
-- Flow: editor uploads a cut → send_for_review auto-notifies reviewers and
-- moves the video to in_review → a reviewer decides: approve (done) or request
-- changes (back to editing, editor re-notified).

/* -------------------------------------------------------- video columns */

alter table public.app_video_review_videos
    add column if not exists stage text default 'editing' not null;
alter table public.app_video_review_videos
    add column if not exists editor_id uuid;
alter table public.app_video_review_videos
    add column if not exists workflow_template_id uuid;

alter table public.app_video_review_videos
    drop constraint if exists app_video_review_videos_stage_check;
alter table public.app_video_review_videos
    add constraint app_video_review_videos_stage_check
    check (stage in ('editing', 'in_review', 'approved'));

alter table public.app_video_review_videos
    drop constraint if exists app_video_review_videos_editor_fk;
alter table public.app_video_review_videos
    add constraint app_video_review_videos_editor_fk
    foreign key (editor_id) references public.users (id) on delete set null;

/* -------------------------------------------------------------- tables */

create table if not exists public.app_video_review_reviewers (
    id         uuid                     default gen_random_uuid() not null,
    video_id   uuid                                               not null,
    user_id    uuid                                               not null,
    role       text                     default 'reviewer'       not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_video_review_reviewers_pk primary key (id),
    constraint app_video_review_reviewers_video_fk
        foreign key (video_id) references public.app_video_review_videos (id) on delete cascade,
    constraint app_video_review_reviewers_user_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint app_video_review_reviewers_unique unique (video_id, user_id)
);
create index if not exists app_video_review_reviewers_video_index
    on public.app_video_review_reviewers (video_id);

create table if not exists public.app_video_review_workflow_templates (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    name       text                                               not null,
    config     jsonb                    default '{}'::jsonb       not null,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_video_review_wf_templates_pk primary key (id),
    constraint app_video_review_wf_templates_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_video_review_wf_templates_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_video_review_wf_templates_name_check check (char_length(name) <= 120),
    constraint app_video_review_wf_templates_config_check
        check (jsonb_typeof(config) = 'object')
);
create index if not exists app_video_review_wf_templates_team_index
    on public.app_video_review_workflow_templates (team_id);

/* ------------------------------------------------------------------ RLS */

alter table public.app_video_review_reviewers enable row level security;
alter table public.app_video_review_workflow_templates enable row level security;

drop policy if exists app_video_review_reviewers_all on public.app_video_review_reviewers;
create policy app_video_review_reviewers_all on public.app_video_review_reviewers
    for all to authenticated
    using (public.video_review_can_access(video_id))
    -- The recipient must belong to the video's team: without this, any caller
    -- could add an arbitrary user as "reviewer" and use send_for_review to
    -- inject cross-tenant notifications.
    with check (
        public.video_review_can_access(video_id)
        and exists (
            select 1
            from public.app_video_review_videos v
            join public.team_members tm on tm.team_id = v.team_id
            where v.id = video_id
              and tm.user_id = app_video_review_reviewers.user_id
              and coalesce(tm.active, true)
        )
    );

-- Templates: team members read; team admins manage.
drop policy if exists app_video_review_wf_templates_select on public.app_video_review_workflow_templates;
create policy app_video_review_wf_templates_select on public.app_video_review_workflow_templates
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists app_video_review_wf_templates_write on public.app_video_review_workflow_templates;
create policy app_video_review_wf_templates_write on public.app_video_review_workflow_templates
    for all to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

revoke all on public.app_video_review_reviewers from public, anon;
revoke all on public.app_video_review_workflow_templates from public, anon;
grant select, insert, update, delete on public.app_video_review_reviewers to authenticated;
grant select, insert, update, delete on public.app_video_review_workflow_templates to authenticated;
grant all on public.app_video_review_reviewers to service_role;
grant all on public.app_video_review_workflow_templates to service_role;

/* -------------------------------------------------- transition RPCs */

-- Editor sends the current cut out for review: moves to in_review and notifies
-- every reviewer (except the actor). SECURITY DEFINER so it can write
-- notifications for other users; access is still gated to the caller.
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

    -- Notify reviewers who are members of the video's team (defense in depth on
    -- top of the reviewers RLS) via create_notification, which also honors the
    -- recipient's notification preferences.
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

-- A reviewer decides. Approve → approved (editor notified). Reject → back to
-- editing with changes_requested (editor re-notified to make edits).
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

revoke all on function public.video_review_send_for_review(uuid) from public, anon;
revoke all on function public.video_review_decide(uuid, boolean) from public, anon;
grant execute on function public.video_review_send_for_review(uuid) to authenticated;
grant execute on function public.video_review_decide(uuid, boolean) to authenticated;
