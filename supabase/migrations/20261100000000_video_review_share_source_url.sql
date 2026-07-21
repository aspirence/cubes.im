-- =============================================================================
-- Video Review share — expose a revision's external link to the public page.
-- =============================================================================
-- A URL-based revision (a pasted YouTube/Vimeo/Drive/Dropbox link) can't play
-- through the signed streaming route — a provider page isn't a media file. The
-- public review page needs the raw link so it can embed it (or use a direct
-- file URL) client-side, exactly like the internal page. Uploaded revisions
-- keep source_url null and continue to stream through /api/review/<token>/video.

create or replace function public.get_video_review_share(p_token uuid)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = public
as
$$
declare
    v_share   public.app_video_review_shares%rowtype;
    v_video   public.app_video_review_videos%rowtype;
    v_result  jsonb;
begin
    select * into v_share
    from public.app_video_review_shares
    where token = p_token and active = true;
    if not found then
        return null;
    end if;

    select * into v_video
    from public.app_video_review_videos
    where id = v_share.video_id and deleted = false;
    if not found then
        return null;
    end if;

    select jsonb_build_object(
        'share', jsonb_build_object(
            'allow_download', v_share.allow_download,
            'require_name', v_share.require_name,
            'reviewer_name', case when v_share.require_name then null else v_share.reviewer_name end
        ),
        'video', jsonb_build_object(
            'id', v_video.id,
            'title', v_video.title,
            'status', v_video.status,
            'latest_revision', v_video.latest_revision,
            'project_name', (
                select p.name from public.projects p where p.id = v_video.project_id
            )
        ),
        'revisions', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'revision', r.revision,
                    'summary', r.summary,
                    'has_source', (r.storage_path is not null or r.url is not null),
                    -- Only a pasted external link is surfaced; uploaded bytes stay
                    -- behind the signed streaming route (source_url = null).
                    'source_url', case when r.storage_path is not null then null else r.url end
                ) order by r.revision desc
            )
            from public.app_video_review_revisions r
            where r.video_id = v_video.id
        ), '[]'::jsonb),
        'comments', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', c.id,
                    'revision', c.revision,
                    'time_ms', c.time_ms,
                    'body', c.body,
                    'resolved', c.resolved,
                    'created_at', c.created_at,
                    'author_name', coalesce(c.guest_name, u.name, 'Someone'),
                    'is_guest', (c.guest_name is not null)
                ) order by c.revision, c.time_ms, c.created_at
            )
            from public.app_video_review_comments c
            left join public.users u on u.id = c.author_id
            where c.video_id = v_video.id
        ), '[]'::jsonb)
    )
    into v_result;

    return v_result;
end;
$$;
revoke all on function public.get_video_review_share(uuid) from public;
grant execute on function public.get_video_review_share(uuid) to anon, authenticated;
