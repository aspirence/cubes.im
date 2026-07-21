-- =============================================================================
-- Notifications — team status changes + client review activity.
-- =============================================================================
-- Two new streams that feed the Inbox's Team / Client tabs:
--
--  * status_change — when a task moves to another status, notify the project's
--    full members + admins (member_type owner/admin/member; limited members and
--    guests excluded), minus whoever moved it.
--
--  * client_review — a client's comment on a public share link now fans out to
--    EVERYONE who can see the project (members, limited members, admins, owner —
--    via user_can_access_project) plus the video's editor/reviewers/creator,
--    and is typed 'client_review' so it lands in the Client tab. Teammate
--    comments keep their existing 'comment' stakeholder notification.
--
-- Delivery routes through create_notification, so each recipient's pop-up and
-- per-category mute settings still apply.

/* ----------------------------------------------------- task status change */

create or replace function public.tasks_status_change_notify()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_team   uuid;
    v_actor  text;
    v_status text;
    v_msg    text;
    r record;
begin
    -- Only a real status transition (not other column edits).
    if new.status_id is not distinct from old.status_id then
        return new;
    end if;

    v_team := public.team_id_of_project(new.project_id);
    if v_team is null then
        return new;
    end if;

    select name into v_actor from public.users where id = auth.uid();
    v_actor := coalesce(v_actor, 'Someone');
    select name into v_status from public.task_statuses where id = new.status_id;
    v_msg := v_actor || ' moved “' || new.name || '” to ' || coalesce(v_status, 'a new status');

    for r in
        select tm.user_id as uid
        from public.team_members tm
        where tm.team_id = v_team
          and coalesce(tm.active, true)
          and tm.user_id is not null
          and tm.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
          -- "member and admin": full members / admins / owner only.
          and coalesce(tm.member_type, 'member') in ('owner', 'admin', 'member')
          and public.user_can_access_project(tm.user_id, new.project_id)
    loop
        perform public.create_notification(
            r.uid,
            v_msg,
            'status_change',
            '/projects/' || new.project_id::text || '?task=' || new.id::text,
            v_team, new.id, new.project_id);
    end loop;

    return new;
end;
$$;

drop trigger if exists tasks_status_change_notify_trg on public.tasks;
create trigger tasks_status_change_notify_trg
    after update of status_id on public.tasks
    for each row execute function public.tasks_status_change_notify();

/* --------------------------------------------- video review comment (v2) */

create or replace function public.app_video_review_comment_notify()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v public.app_video_review_videos;
    v_actor_name text;
    v_msg  text;
    v_type text;
    v_url  text;
    v_guest boolean := (new.guest_name is not null);
    r record;
begin
    select * into v from public.app_video_review_videos where id = new.video_id;
    if v.id is null then
        return new;
    end if;
    v_url := '/apps/video-review/' || new.video_id::text;

    if v_guest then
        -- A client left a review on the public share link.
        v_actor_name := new.guest_name;
        v_type := 'client_review';
        v_msg := v_actor_name || ' (client) reviewed “' || v.title || '”';

        for r in
            select uid
            from (
                select v.editor_id as uid
                union
                select v.created_by
                union
                select rv.user_id
                from public.app_video_review_reviewers rv
                where rv.video_id = new.video_id
                union
                -- Everyone who can see the project: members, limited members,
                -- admins and the owner (guests excluded).
                select tm.user_id
                from public.team_members tm
                where tm.team_id = v.team_id
                  and coalesce(tm.active, true)
                  and tm.user_id is not null
                  and coalesce(tm.member_type, 'member') <> 'guest'
                  and (v.project_id is null or public.user_can_access_project(tm.user_id, v.project_id))
            ) s
            where s.uid is not null
              and exists (
                  select 1 from public.team_members tm2
                  where tm2.team_id = v.team_id and tm2.user_id = s.uid and coalesce(tm2.active, true)
              )
        loop
            perform public.create_notification(
                r.uid, v_msg, v_type, v_url, v.team_id, v.task_id, v.project_id);
        end loop;
    else
        -- A teammate commented — notify the review's own stakeholders.
        select name into v_actor_name from public.users where id = new.author_id;
        v_actor_name := coalesce(v_actor_name, 'A teammate');
        v_msg := v_actor_name || ' commented on ' || v.title;

        for r in
            select uid
            from (
                select v.editor_id as uid
                union
                select v.created_by
                union
                select rv.user_id
                from public.app_video_review_reviewers rv
                where rv.video_id = new.video_id
            ) s
            where s.uid is not null
              and (new.author_id is null or s.uid <> new.author_id)
              and exists (
                  select 1 from public.team_members tm
                  where tm.team_id = v.team_id and tm.user_id = s.uid and coalesce(tm.active, true)
              )
        loop
            perform public.create_notification(
                r.uid, v_msg, 'comment', v_url, v.team_id, v.task_id, v.project_id);
        end loop;
    end if;

    return new;
end;
$$;
