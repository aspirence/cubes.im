-- =============================================================================
-- Video Review share — team-preset reviewer name.
-- =============================================================================
-- When "ask for the reviewer's name" is OFF, the team can set the reviewer's
-- name themselves (e.g. sharing a cut with a known client). The public page
-- then skips the name gate and attributes every comment to that preset name —
-- resolved SERVER-SIDE so the client can't override it.

alter table public.app_video_review_shares
    add column if not exists reviewer_name text;

do $$
begin
    if not exists (
        select 1 from information_schema.table_constraints
        where constraint_name = 'app_video_review_shares_reviewer_name_check'
    ) then
        alter table public.app_video_review_shares
            add constraint app_video_review_shares_reviewer_name_check
            check (reviewer_name is null or char_length(reviewer_name) <= 80);
    end if;
end $$;

/* -------------------------------------------- get: surface the preset name */

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
            -- Only meaningful (and only revealed) when the client isn't asked.
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
                    'has_source', (r.storage_path is not null or r.url is not null)
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

/* ------------------------------- record visit: resolve the name on server */

create or replace function public.record_video_review_visit(
    p_token uuid,
    p_name text,
    p_visitor_key text
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_share_id uuid;
    v_require  boolean;
    v_preset   text;
    v_session_id uuid;
    v_name text;
begin
    if char_length(coalesce(p_visitor_key, '')) < 8 then
        raise exception 'Invalid visitor key';
    end if;

    select id, require_name, reviewer_name
      into v_share_id, v_require, v_preset
    from public.app_video_review_shares
    where token = p_token and active = true;
    if v_share_id is null then
        raise exception 'This review link is not available';
    end if;

    -- Name authority: a team-preset name (only when the client isn't asked)
    -- wins over anything the client sends; otherwise use their input, and fall
    -- back to "Guest" only when names aren't required.
    if (not v_require) and nullif(btrim(coalesce(v_preset, '')), '') is not null then
        v_name := left(btrim(v_preset), 80);
    else
        v_name := nullif(btrim(p_name), '');
        if v_name is null then
            if v_require then
                raise exception 'A reviewer name is required';
            else
                v_name := 'Guest';
            end if;
        else
            v_name := left(v_name, 80);
        end if;
    end if;

    insert into public.app_video_review_share_sessions (share_id, name, visitor_key)
    values (v_share_id, v_name, left(p_visitor_key, 100))
    on conflict (share_id, visitor_key)
        do update set
            visit_count = public.app_video_review_share_sessions.visit_count + 1,
            name = excluded.name,
            last_seen_at = current_timestamp
    returning id into v_session_id;

    return v_session_id;
end;
$$;
revoke all on function public.record_video_review_visit(uuid, text, text) from public;
grant execute on function public.record_video_review_visit(uuid, text, text) to anon, authenticated;
