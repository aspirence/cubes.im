-- =============================================================================
-- Video Review — notify the team when a video / version is uploaded.
-- =============================================================================
-- Replaces the revision-notify trigger (20261098). It now covers BOTH events on
-- a single INSERT into app_video_review_revisions:
--
--   * revision 1  -> 'video_uploaded'  ("a new video is up for review")
--   * revision >1 -> 'video_version'   ("a new cut is up")
--
-- Recipients are the team's members + admins (member_type owner/admin/member;
-- limited members and guests excluded), narrowed to those who can see the
-- project (user_can_access_project, so private projects are respected), UNION
-- the video's own people (editor / reviewers / creator) so anyone directly
-- involved is covered too — minus whoever uploaded it. Both land in the Inbox's
-- Team tab, and route through create_notification so pop-up / per-category mute
-- and Web Push all still apply.

create or replace function public.app_video_review_revision_notify()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v public.app_video_review_videos;
    v_actor text;
    v_type  text;
    v_msg   text;
    r record;
begin
    select * into v from public.app_video_review_videos where id = new.video_id;
    if v.id is null then
        return new;
    end if;

    select name into v_actor from public.users where id = new.uploaded_by;
    v_actor := coalesce(v_actor, 'Someone');

    if new.revision <= 1 then
        v_type := 'video_uploaded';
        v_msg  := v_actor || ' uploaded a new video for review: ' || v.title;
    else
        v_type := 'video_version';
        v_msg  := v_actor || ' uploaded v' || new.revision || ' of ' || v.title;
    end if;

    for r in
        select uid
        from (
            -- Members + admins of the team who can see the project.
            select tm.user_id as uid
            from public.team_members tm
            where tm.team_id = v.team_id
              and coalesce(tm.active, true)
              and tm.user_id is not null
              and coalesce(tm.member_type, 'member') in ('owner', 'admin', 'member')
              and (v.project_id is null or public.user_can_access_project(tm.user_id, v.project_id))
            union
            -- The video's own people, even if they're limited members.
            select v.editor_id
            union
            select v.created_by
            union
            select rv.user_id
            from public.app_video_review_reviewers rv
            where rv.video_id = new.video_id
        ) s
        where s.uid is not null
          -- Never notify the uploader of their own upload.
          and s.uid <> coalesce(new.uploaded_by, '00000000-0000-0000-0000-000000000000'::uuid)
          -- Must be an active, non-guest member of the team.
          and exists (
              select 1 from public.team_members tm2
              where tm2.team_id = v.team_id
                and tm2.user_id = s.uid
                and coalesce(tm2.active, true)
                and coalesce(tm2.member_type, 'member') <> 'guest'
          )
    loop
        perform public.create_notification(
            r.uid,
            v_msg,
            v_type,
            '/apps/video-review/' || new.video_id::text,
            v.team_id, v.task_id, v.project_id);
    end loop;

    return new;
end;
$$;

-- Trigger binding is unchanged (create-or-replace keeps it bound), but recreate
-- defensively so a fresh apply is self-contained.
drop trigger if exists app_video_review_revision_notify_trg on public.app_video_review_revisions;
create trigger app_video_review_revision_notify_trg
    after insert on public.app_video_review_revisions
    for each row execute function public.app_video_review_revision_notify();
