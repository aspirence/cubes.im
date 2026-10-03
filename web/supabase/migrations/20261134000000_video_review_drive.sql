-- =============================================================================
-- Video Review — Google Drive as a first-class source (streamed, not embedded)
-- =============================================================================
-- WHY THIS EXISTS
-- A pasted Drive link resolves today to `https://drive.google.com/file/d/<id>/preview`
-- and plays inside an IFRAME (media-source.ts). That iframe is cross-origin, so
-- the reviewer page can never read `currentTime` from it — which means no
-- timestamped comments and no frame drawings on exactly the videos most clients
-- send us. The fix is to stop embedding Drive and start STREAMING it: the server
-- holds the workspace's Google token, forwards the browser's Range header to
-- Drive, and pipes the bytes back into our own `<video>` element. A real
-- `<video>` gives us currentTime, seeking and the drawing overlay for free.
--
-- Optionally the bytes can also be COPIED once into the existing `video-review`
-- bucket ("import"), for when the Drive file may be moved, unshared or renamed
-- mid-review. Streaming stays the default because a copy costs storage and the
-- team usually just wants to review what the editor already has in Drive.
--
-- WHERE THE COLUMNS LIVE, AND WHY NOT ON app_video_review_videos
-- The brief said "app_video_review_videos", but a video's SOURCE has never lived
-- there: `storage_path` and `url` are columns of app_video_review_revisions
-- (20261021000000), and every consumer — the share RPC, /api/review/<token>/video,
-- useRevisionUrl — resolves bytes per revision. v1 can be a Drive link and v2 an
-- upload; size, mime, duration and import state are properties of one cut, not of
-- the review thread. Putting them on the parent would make "which revision does
-- drive_file_id describe?" unanswerable. So they are added to the REVISIONS
-- table, which is the row that actually points at bytes.
--
-- Re-runnable and additive: `add column if not exists`, guarded constraint adds,
-- `create index if not exists`, `create or replace function`. No existing column,
-- policy, grant or trigger is dropped or altered.
--
-- OVERLAP WITH 20261136000000_video_review_drive_picker.sql
-- That migration was written in parallel, for the Picker UI, and adds its own
-- names for three of the same facts: drive_mime_type, drive_duration_ms and
-- drive_import_state/drive_imported_at/drive_import_error. Both sets now exist.
-- Nothing is dropped here — a migration that removes a column another branch is
-- mid-way through writing is how you lose data — so instead section 4 below
-- keeps the pairs in step, and the server code reads either name and writes
-- both. A follow-up migration should retire one set once both branches have
-- landed; until then, treat this file's names as canonical for import state and
-- the picker's `drive_name` as canonical for the file's display name.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Source columns on a revision
-- -----------------------------------------------------------------------------
alter table public.app_video_review_revisions
    -- Which of the three source shapes this revision is. It is derivable today
    -- (storage_path => upload, else link), but a Drive revision is NOT derivable
    -- — it keeps a `url` for "open in Drive" while its bytes come from the
    -- stream route — so the shape has to be stated rather than inferred.
    add column if not exists source_kind           text not null default 'link',
    -- Drive's file id. Kept apart from `url` because the id is the thing every
    -- API call needs, and re-deriving it from a link on each request would mean
    -- re-parsing a user-pasted string in a hot path (the stream route runs once
    -- per seek).
    add column if not exists drive_file_id         text,
    -- Which Google connection can read that file. drive.file grants access per
    -- file to the account that picked it, so the file is only readable through
    -- THIS connection; another account in the same workspace would get a 404.
    -- ON DELETE SET NULL, not CASCADE: disconnecting Google must not delete a
    -- revision (and with it the comments on it). The revision survives, the
    -- stream route reports that the source needs picking again.
    add column if not exists drive_connection_id   uuid,
    add column if not exists drive_mime            text,
    -- Needed before the first byte is fetched: Range arithmetic (and the 416
    -- "beyond EOF" answer) is done against the known total, and the import route
    -- refuses a file larger than the bucket allows without downloading it first.
    add column if not exists drive_size_bytes      bigint,
    add column if not exists drive_thumbnail_url   text,
    -- Seconds, fractional. Drive reports durationMillis for video files; having
    -- it lets the timeline and the comment list render before metadata loads.
    add column if not exists duration_seconds      numeric,
    -- Import = the optional one-time copy into the `video-review` bucket. 'none'
    -- is the normal, healthy state: streaming works without ever importing.
    add column if not exists import_status         text not null default 'none',
    -- Sanitised, member-readable failure text. Never raw Google error bodies,
    -- which can carry a signed URL or token fragment.
    add column if not exists import_error          text,
    -- Where the copy landed, in the same `<bucket>::<path>` or bare-path form
    -- storage_path uses. Deliberately a SEPARATE column: storage_path is written
    -- by the uploader and swapping it under a live review would rewrite history
    -- for anyone who bookmarked "v2 was the Drive cut".
    add column if not exists imported_storage_path text;

-- Constraints are added through a guard rather than inline, so re-running the
-- migration does not fail on "constraint already exists".
do $$
begin
    if not exists (select 1 from pg_constraint
                   where conname = 'app_video_review_revisions_source_kind_check') then
        alter table public.app_video_review_revisions
            add constraint app_video_review_revisions_source_kind_check
            check (source_kind in ('upload', 'link', 'drive'));
    end if;

    if not exists (select 1 from pg_constraint
                   where conname = 'app_video_review_revisions_import_status_check') then
        alter table public.app_video_review_revisions
            add constraint app_video_review_revisions_import_status_check
            check (import_status in ('none', 'queued', 'running', 'done', 'error'));
    end if;

    -- A 'drive' revision without a file id would be a source the stream route
    -- cannot resolve — a black player with no error to show. Rejected at write
    -- time instead.
    if not exists (select 1 from pg_constraint
                   where conname = 'app_video_review_revisions_drive_file_check') then
        alter table public.app_video_review_revisions
            add constraint app_video_review_revisions_drive_file_check
            check (source_kind <> 'drive' or drive_file_id is not null);
    end if;

    if not exists (select 1 from pg_constraint
                   where conname = 'app_video_review_revisions_drive_size_check') then
        alter table public.app_video_review_revisions
            add constraint app_video_review_revisions_drive_size_check
            check (drive_size_bytes is null or drive_size_bytes >= 0);
    end if;

    if not exists (select 1 from pg_constraint
                   where conname = 'app_video_review_revisions_duration_check') then
        alter table public.app_video_review_revisions
            add constraint app_video_review_revisions_duration_check
            check (duration_seconds is null or duration_seconds >= 0);
    end if;

    if not exists (select 1 from pg_constraint
                   where conname = 'app_video_review_revisions_import_error_check') then
        alter table public.app_video_review_revisions
            add constraint app_video_review_revisions_import_error_check
            check (import_error is null or char_length(import_error) <= 1000);
    end if;

    if not exists (select 1 from pg_constraint
                   where conname = 'app_video_review_revisions_drive_connection_fk') then
        alter table public.app_video_review_revisions
            add constraint app_video_review_revisions_drive_connection_fk
            foreign key (drive_connection_id)
            references public.app_google_connections (id) on delete set null;
    end if;
end
$$;

-- Backfill what the existing rows already are. The column default ('link') is
-- right for url revisions; uploads have to be corrected. Idempotent by
-- construction — it only ever moves a row to the value its own source implies.
update public.app_video_review_revisions
   set source_kind = 'upload'
 where storage_path is not null
   and source_kind <> 'upload';

update public.app_video_review_revisions
   set source_kind = 'link'
 where storage_path is null
   and url is not null
   and drive_file_id is null
   and source_kind not in ('link', 'drive');

-- A revision the Picker branch attached a Drive file to IS a Drive revision,
-- whichever branch wrote the row.
update public.app_video_review_revisions
   set source_kind = 'drive'
 where drive_file_id is not null
   and storage_path is null
   and source_kind <> 'drive';

-- "Is this Drive file already attached somewhere?" — asked by the picker (to
-- offer the existing review instead of making a duplicate) and by the import
-- worker. Partial, because all the pre-existing rows are NULL here.
create index if not exists app_video_review_revisions_drive_file_index
    on public.app_video_review_revisions (drive_file_id)
    where drive_file_id is not null;

create index if not exists app_video_review_revisions_drive_connection_index
    on public.app_video_review_revisions (drive_connection_id)
    where drive_connection_id is not null;


-- -----------------------------------------------------------------------------
-- 2. A revision may only borrow ITS OWN workspace's Google connection
-- -----------------------------------------------------------------------------
-- The revisions RLS policy lets any member of the video's team write any column,
-- and app_google_connections is only SELECT-visible to its own team — so a member
-- cannot READ another workspace's connection id, but nothing so far stops them
-- WRITING one they guessed into drive_connection_id and having our server spend
-- that workspace's token on their behalf. The routes check this too; this trigger
-- is the copy of the check that cannot be forgotten, since it also covers direct
-- PostgREST writes from the browser (which is how the app creates revisions).
create or replace function public.video_review_check_drive_connection()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_team uuid;
begin
    if new.drive_connection_id is null then
        return new;
    end if;

    select v.team_id into v_team
    from public.app_video_review_videos v
    where v.id = new.video_id;

    if not exists (
        select 1 from public.app_google_connections c
        where c.id = new.drive_connection_id
          and c.team_id = v_team
    ) then
        raise exception 'That Google connection does not belong to this workspace.'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;
revoke all on function public.video_review_check_drive_connection() from public, anon;

drop trigger if exists app_video_review_revisions_drive_connection_guard
    on public.app_video_review_revisions;
create trigger app_video_review_revisions_drive_connection_guard
    before insert or update of drive_connection_id, video_id
    on public.app_video_review_revisions
    for each row
    execute function public.video_review_check_drive_connection();


-- -----------------------------------------------------------------------------
-- 3b. Keep the picker migration's parallel columns in step
-- -----------------------------------------------------------------------------
-- 20261136000000 names three of these facts differently. Whichever branch wrote
-- first, both readers should see the same answer, so each pair is filled from
-- the other where one side is null. Dynamic SQL because on a FRESH database this
-- migration runs first (20261134 < 20261136) and those columns do not exist yet —
-- a plain statement mentioning them would fail to parse.
do $$
declare
    v_has_mime     boolean;
    v_has_duration boolean;
    v_has_state    boolean;
begin
    select count(*) filter (where column_name = 'drive_mime_type')   > 0,
           count(*) filter (where column_name = 'drive_duration_ms') > 0,
           count(*) filter (where column_name = 'drive_import_state')> 0
      into v_has_mime, v_has_duration, v_has_state
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'app_video_review_revisions';

    if v_has_mime then
        execute $q$
            update public.app_video_review_revisions
               set drive_mime = coalesce(drive_mime, drive_mime_type),
                   drive_mime_type = coalesce(drive_mime_type, drive_mime)
             where drive_mime is distinct from drive_mime_type
        $q$;
    end if;

    if v_has_duration then
        execute $q$
            update public.app_video_review_revisions
               set duration_seconds = coalesce(duration_seconds, drive_duration_ms / 1000.0),
                   drive_duration_ms = coalesce(drive_duration_ms, round(duration_seconds * 1000)::int)
             where duration_seconds is null or drive_duration_ms is null
        $q$;
    end if;

    -- The two vocabularies differ in their idle and failure words only:
    -- null <-> 'none' and 'failed' <-> 'error'.
    if v_has_state then
        execute $q$
            update public.app_video_review_revisions
               set import_status = case drive_import_state
                                       when 'failed' then 'error'
                                       else drive_import_state
                                   end
             where drive_import_state is not null
               and import_status = 'none'
        $q$;
    end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 4. The public share page has to know a Drive revision streams
-- -----------------------------------------------------------------------------
-- get_video_review_share (20261100000000) hands the client page `source_url` for
-- link revisions, and the page embeds it. If it kept doing that for a Drive
-- revision, the client would get the same un-timestampable iframe we are moving
-- away from. So a Drive revision now reports source_url = NULL — which sends the
-- page down its existing streaming branch, `/api/review/<token>/video?rev=N` —
-- and gains `source_kind` plus `duration_seconds` so the player can show the
-- timeline before metadata arrives. Every other field is unchanged; this is the
-- same function body with the revisions object extended.
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
                    'has_source', (r.storage_path is not null
                                   or r.url is not null
                                   or r.drive_file_id is not null),
                    -- Only a pasted external link is surfaced; uploaded bytes and
                    -- Drive bytes both stay behind the streaming route, so their
                    -- source_url is null.
                    -- Keyed on drive_file_id rather than source_kind: the Picker
                    -- branch attaches a file id while leaving source_kind alone,
                    -- and a revision we can stream must never fall back to the
                    -- iframe this whole change exists to remove.
                    'source_url', case
                        when r.storage_path is not null then null
                        when r.drive_file_id is not null then null
                        else r.url
                    end,
                    'source_kind', r.source_kind,
                    'duration_seconds', r.duration_seconds
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
