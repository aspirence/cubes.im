-- Video Review — a revision can point at a Google Drive file.
--
-- WHY: a Drive video pasted as a link plays through Drive's /preview iframe,
-- which is cross-origin, so the page cannot read currentTime. That kills
-- timestamped comments and frame drawings on exactly the videos most clients
-- send. The fix is to stream the Drive file through our own server into our own
-- <video> element, which needs the file's id and the Google connection whose
-- token may read it (the `drive.file` scope grants access per picked file, so
-- the connection that opened the Picker is the only one that can read it).
--
-- Nothing here replaces `url` or `storage_path`: a Drive revision keeps the
-- original share link in `url` so it still plays (as an embed, without
-- timestamps) on any surface that has not learned about Drive sources yet, and
-- `storage_path` fills in later if the team imports a copy into Cubes storage.
--
-- Additive and re-runnable: every statement is guarded, so applying it twice —
-- or alongside another migration that adds the same columns — is a no-op.
--
-- RLS: these are columns on app_video_review_revisions, which already has row
-- level security enabled and a team-scoped policy
-- (app_video_review_revisions_all). New columns inherit it, so there is no new
-- surface to police; the migration re-asserts ENABLE ROW LEVEL SECURITY below
-- so a future `create table if not exists` cannot leave the table open.

alter table public.app_video_review_revisions
  add column if not exists drive_file_id text,
  add column if not exists drive_connection_id uuid,
  add column if not exists drive_name text,
  add column if not exists drive_mime_type text,
  add column if not exists drive_size_bytes bigint,
  add column if not exists drive_duration_ms integer,
  add column if not exists drive_thumbnail_url text,
  -- null = never asked for a copy. Otherwise queued / running / done / failed.
  add column if not exists drive_import_state text,
  add column if not exists drive_imported_at timestamptz,
  add column if not exists drive_import_error text;

comment on column public.app_video_review_revisions.drive_file_id is
  'Google Drive file id. Set when the revision streams through our server instead of an iframe, which is what makes timestamps possible.';
comment on column public.app_video_review_revisions.drive_connection_id is
  'The app_google_connections row whose token may read this file. drive.file grants access per picked file, so the wrong connection reads back a 404.';
comment on column public.app_video_review_revisions.drive_import_state is
  'null | queued | running | done | failed — the optional "import a copy into Cubes storage" for faster, link-independent playback.';

-- The connection is a pointer, not ownership: losing it must not delete review
-- history, it only means the stream stops until Google is reconnected.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_video_review_revisions_drive_connection_fk'
  ) then
    alter table public.app_video_review_revisions
      add constraint app_video_review_revisions_drive_connection_fk
      foreign key (drive_connection_id)
      references public.app_google_connections (id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_video_review_revisions_drive_import_state_check'
  ) then
    alter table public.app_video_review_revisions
      add constraint app_video_review_revisions_drive_import_state_check
      check (drive_import_state is null
             or drive_import_state in ('queued', 'running', 'done', 'failed'));
  end if;
end $$;

-- Partial, because Drive-backed revisions are the minority: the import worker
-- and the stream route both look a revision up by its Drive file id.
create index if not exists app_video_review_revisions_drive_file_idx
  on public.app_video_review_revisions (drive_file_id)
  where drive_file_id is not null;

alter table public.app_video_review_revisions enable row level security;
