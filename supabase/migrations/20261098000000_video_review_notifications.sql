-- =============================================================================
-- Video Review — notify stakeholders on review activity.
-- =============================================================================
-- send_for_review / decide already notify (see 20261022). This covers the two
-- everyday actions that didn't: a new COMMENT (from a teammate OR a client on a
-- public share link) and a new VERSION. Both are wired as AFTER INSERT triggers
-- so every write path is covered in one place — the direct team insert, the
-- guest-comment SECURITY DEFINER RPC, and the add-revision hook alike.
--
-- Recipients = the people "on" the review: the editor, the reviewers, and the
-- video's creator — minus whoever performed the action, and only if they're an
-- active member of the video's team. Delivery routes through create_notification
-- so each recipient's pop-up + per-category (comment/assignment) mute settings
-- are still honoured.

/* --------------------------------------------------------- new comment */

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
    v_msg text;
    r record;
begin
    select * into v from public.app_video_review_videos where id = new.video_id;
    if v.id is null then
        return new;
    end if;

    -- Who commented: a named client (guest_name) or a teammate (author_id).
    if new.guest_name is not null then
        v_actor_name := new.guest_name;
    else
        select name into v_actor_name from public.users where id = new.author_id;
        v_actor_name := coalesce(v_actor_name, 'A teammate');
    end if;
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
        where uid is not null
          -- Never notify the teammate who wrote the comment (guests are non-users).
          and (new.author_id is null or uid <> new.author_id)
          and exists (
              select 1 from public.team_members tm
              where tm.team_id = v.team_id and tm.user_id = s.uid
                and coalesce(tm.active, true)
          )
    loop
        perform public.create_notification(
            r.uid,
            v_msg,
            'comment',
            '/apps/video-review/' || new.video_id::text,
            v.team_id, v.task_id, v.project_id);
    end loop;

    return new;
end;
$$;

drop trigger if exists app_video_review_comment_notify_trg on public.app_video_review_comments;
create trigger app_video_review_comment_notify_trg
    after insert on public.app_video_review_comments
    for each row execute function public.app_video_review_comment_notify();

/* --------------------------------------------------------- new version */

create or replace function public.app_video_review_revision_notify()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v public.app_video_review_videos;
    v_actor_name text;
    v_msg text;
    r record;
begin
    -- The first cut is the video's creation, not a "new version".
    if new.revision <= 1 then
        return new;
    end if;

    select * into v from public.app_video_review_videos where id = new.video_id;
    if v.id is null then
        return new;
    end if;

    select name into v_actor_name from public.users where id = new.uploaded_by;
    v_actor_name := coalesce(v_actor_name, 'Someone');
    v_msg := v_actor_name || ' uploaded v' || new.revision || ' of ' || v.title;

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
        where uid is not null
          and (new.uploaded_by is null or uid <> new.uploaded_by)
          and exists (
              select 1 from public.team_members tm
              where tm.team_id = v.team_id and tm.user_id = s.uid
                and coalesce(tm.active, true)
          )
    loop
        perform public.create_notification(
            r.uid,
            v_msg,
            'assignment',
            '/apps/video-review/' || new.video_id::text,
            v.team_id, v.task_id, v.project_id);
    end loop;

    return new;
end;
$$;

drop trigger if exists app_video_review_revision_notify_trg on public.app_video_review_revisions;
create trigger app_video_review_revision_notify_trg
    after insert on public.app_video_review_revisions
    for each row execute function public.app_video_review_revision_notify();
