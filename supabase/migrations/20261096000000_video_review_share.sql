-- =============================================================================
-- Video Review — public client review links.
-- =============================================================================
-- An editor can PUBLISH a review video to an unguessable share URL so a client
-- reviews it without a Cubes account. The client identifies themselves by name
-- on opening the link (a "visit session"); every comment they leave carries
-- that name, and the team can see who reviewed and how many times they came
-- back.
--
-- Access model, mirroring the client portal:
--   * Reads/writes from the public page go through SECURITY DEFINER functions
--     granted to `anon`, each gated on the share token + `active` flag. The
--     underlying tables stay locked to team members via RLS.
--   * The video bytes live in a private bucket; the public page streams them
--     through an API route that signs a URL with the service role, so no
--     storage policy is opened to `anon`.

/* ---------------------------------------------------------------- tables */

create table if not exists public.app_video_review_shares (
    id             uuid                     default gen_random_uuid() not null,
    video_id       uuid                                               not null,
    token          uuid                     default gen_random_uuid() not null,
    active         boolean                  default true             not null,
    allow_download boolean                  default false            not null,
    require_name   boolean                  default true             not null,
    created_by     uuid,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint app_video_review_shares_pk primary key (id),
    -- One link per video: publishing is a get-or-create, toggled active/inactive.
    constraint app_video_review_shares_video_unique unique (video_id),
    constraint app_video_review_shares_token_unique unique (token),
    constraint app_video_review_shares_video_fk
        foreign key (video_id) references public.app_video_review_videos (id) on delete cascade,
    constraint app_video_review_shares_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null
);

-- A named client "session": one row per (share, browser). Revisiting the link
-- bumps visit_count and last_seen_at instead of adding a row.
create table if not exists public.app_video_review_share_sessions (
    id            uuid                     default gen_random_uuid() not null,
    share_id      uuid                                               not null,
    name          text                                               not null,
    visitor_key   text                                               not null,
    visit_count   integer                  default 1                not null,
    first_seen_at timestamp with time zone default current_timestamp not null,
    last_seen_at  timestamp with time zone default current_timestamp not null,
    constraint app_video_review_share_sessions_pk primary key (id),
    constraint app_video_review_share_sessions_share_fk
        foreign key (share_id) references public.app_video_review_shares (id) on delete cascade,
    constraint app_video_review_share_sessions_unique unique (share_id, visitor_key),
    constraint app_video_review_share_sessions_name_check check (char_length(name) between 1 and 80),
    constraint app_video_review_share_sessions_key_check check (char_length(visitor_key) between 8 and 100)
);
create index if not exists app_video_review_share_sessions_share_index
    on public.app_video_review_share_sessions (share_id);

-- Guest attribution on comments: a comment posted through a share link has no
-- author_id (that column FKs internal users) but carries the reviewer's name
-- and links back to their visit session.
alter table public.app_video_review_comments
    add column if not exists guest_name text;
alter table public.app_video_review_comments
    add column if not exists share_session_id uuid;
do $$
begin
    if not exists (
        select 1 from information_schema.table_constraints
        where constraint_name = 'app_video_review_comments_session_fk'
    ) then
        alter table public.app_video_review_comments
            add constraint app_video_review_comments_session_fk
            foreign key (share_session_id)
            references public.app_video_review_share_sessions (id) on delete set null;
    end if;
end $$;

/* ------------------------------------------------------------------ RLS */

alter table public.app_video_review_shares          enable row level security;
alter table public.app_video_review_share_sessions  enable row level security;

-- shares: team members who can access the parent video manage the link.
drop policy if exists app_video_review_shares_all on public.app_video_review_shares;
create policy app_video_review_shares_all on public.app_video_review_shares
    for all to authenticated
    using (public.video_review_can_access(video_id))
    with check (public.video_review_can_access(video_id));

-- sessions: read-only to the team (writes come through the DEFINER RPC as anon).
drop policy if exists app_video_review_share_sessions_select on public.app_video_review_share_sessions;
create policy app_video_review_share_sessions_select on public.app_video_review_share_sessions
    for select to authenticated
    using (
        exists (
            select 1 from public.app_video_review_shares s
            where s.id = share_id
              and public.video_review_can_access(s.video_id)
        )
    );

/* --------------------------------------------------------------- grants */

revoke all on public.app_video_review_shares         from public, anon;
revoke all on public.app_video_review_share_sessions from public, anon;
grant select, insert, update, delete on public.app_video_review_shares to authenticated;
grant select on public.app_video_review_share_sessions to authenticated;
grant all on public.app_video_review_shares         to service_role;
grant all on public.app_video_review_share_sessions to service_role;

/* ------------------------------------------------- public read (by token) */

-- Everything the public review page needs, or null when the token is unknown
-- or sharing is turned off. Storage paths are deliberately NOT returned — the
-- bytes stream through the token API route, so nothing signable leaks here.
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
            'require_name', v_share.require_name
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

/* ------------------------------------------------ public visit + comment */

-- Records (or refreshes) a named visit. Repeat visits from the same browser
-- (same visitor_key) bump the counter rather than piling up rows.
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
    v_session_id uuid;
    v_name text := nullif(btrim(p_name), '');
begin
    if v_name is null then
        raise exception 'A reviewer name is required';
    end if;
    v_name := left(v_name, 80);
    if char_length(coalesce(p_visitor_key, '')) < 8 then
        raise exception 'Invalid visitor key';
    end if;

    select id into v_share_id
    from public.app_video_review_shares
    where token = p_token and active = true;
    if v_share_id is null then
        raise exception 'This review link is not available';
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

-- Adds a timestamped comment on behalf of a named visitor. The reviewer's name
-- is taken from their session, so the client can't spoof someone else.
create or replace function public.add_video_review_guest_comment(
    p_token uuid,
    p_session_id uuid,
    p_revision integer,
    p_body text,
    p_time_ms integer
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_share_id uuid;
    v_video_id uuid;
    v_name text;
    v_body text := btrim(p_body);
    v_comment public.app_video_review_comments%rowtype;
begin
    if v_body is null or char_length(v_body) = 0 then
        raise exception 'Comment cannot be empty';
    end if;
    if char_length(v_body) > 2000 then
        v_body := left(v_body, 2000);
    end if;

    select s.id, s.video_id into v_share_id, v_video_id
    from public.app_video_review_shares s
    where s.token = p_token and s.active = true;
    if v_share_id is null then
        raise exception 'This review link is not available';
    end if;

    select name into v_name
    from public.app_video_review_share_sessions
    where id = p_session_id and share_id = v_share_id;
    if v_name is null then
        raise exception 'Unknown reviewer session';
    end if;

    insert into public.app_video_review_comments
        (video_id, revision, body, time_ms, author_id, guest_name, share_session_id)
    values
        (v_video_id, greatest(coalesce(p_revision, 1), 1), v_body,
         greatest(coalesce(p_time_ms, 0), 0), null, v_name, p_session_id)
    returning * into v_comment;

    update public.app_video_review_share_sessions
        set last_seen_at = current_timestamp
        where id = p_session_id;
    update public.app_video_review_videos
        set updated_at = current_timestamp
        where id = v_video_id;

    return jsonb_build_object(
        'id', v_comment.id,
        'revision', v_comment.revision,
        'time_ms', v_comment.time_ms,
        'body', v_comment.body,
        'resolved', v_comment.resolved,
        'created_at', v_comment.created_at,
        'author_name', v_name,
        'is_guest', true
    );
end;
$$;
revoke all on function public.add_video_review_guest_comment(uuid, uuid, integer, text, integer) from public;
grant execute on function public.add_video_review_guest_comment(uuid, uuid, integer, text, integer) to anon, authenticated;
