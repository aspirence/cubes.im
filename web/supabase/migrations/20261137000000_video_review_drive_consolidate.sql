-- =============================================================================
-- Video review — one spelling for a Drive revision
-- =============================================================================
-- Two migrations landed the same facts under different names three minutes
-- apart (20261134000000 from the streaming work, 20261136000000 from the
-- picker UI), because both were written at the same time against the same
-- brief. Neither could safely drop the other's columns while code was still
-- being written against them, so both sets survived and every writer had to
-- fill both — which is exactly how a reader ends up looking at a null.
--
-- This retires the duplicates. The surviving set is the one the UI already
-- polls:
--   drive_file_id, drive_connection_id, drive_name, drive_mime,
--   drive_size_bytes, drive_thumbnail_url, duration_seconds,
--   import_status, import_error, imported_storage_path, imported_at
-- and these go:
--   drive_mime_type   -> drive_mime
--   drive_duration_ms -> duration_seconds (seconds, as every other surface reads)
--   drive_import_state-> import_status
--   drive_import_error-> import_error
--   drive_imported_at -> imported_at (added here; the surviving set had no timestamp)
--
-- Anything already written under a retired name is copied across first, so this
-- is safe even though the dev database happens to hold none today.
--
-- Re-runnable: the copies are no-ops once the columns are gone, and every drop
-- is `if exists`.
-- =============================================================================

alter table public.app_video_review_revisions
    add column if not exists imported_at timestamptz;

comment on column public.app_video_review_revisions.imported_at is
    'When the Drive file was copied into our storage (import_status = done).';

-- 1. Carry any existing values over to the surviving columns. Guarded with a
--    DO block so a re-run after the drops does not fail on a missing column.
do $$
begin
    if exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'app_video_review_revisions'
                  and column_name = 'drive_mime_type') then
        execute 'update public.app_video_review_revisions
                    set drive_mime = coalesce(drive_mime, drive_mime_type)
                  where drive_mime is null and drive_mime_type is not null';
    end if;

    if exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'app_video_review_revisions'
                  and column_name = 'drive_duration_ms') then
        execute 'update public.app_video_review_revisions
                    set duration_seconds = coalesce(duration_seconds, drive_duration_ms / 1000.0)
                  where duration_seconds is null and drive_duration_ms is not null';
    end if;

    if exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'app_video_review_revisions'
                  and column_name = 'drive_import_state') then
        -- The picker spelled the states running/done/failed/none; the survivor
        -- uses queued/running/done/error/none.
        execute $sql$
            update public.app_video_review_revisions
               set import_status = case drive_import_state
                                       when 'failed' then 'error'
                                       when 'done'   then 'done'
                                       when 'running' then 'running'
                                       else import_status
                                   end
             where drive_import_state is not null
               and coalesce(import_status, 'none') = 'none'
        $sql$;
    end if;

    if exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'app_video_review_revisions'
                  and column_name = 'drive_import_error') then
        execute 'update public.app_video_review_revisions
                    set import_error = coalesce(import_error, drive_import_error)
                  where import_error is null and drive_import_error is not null';
    end if;

    if exists (select 1 from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'app_video_review_revisions'
                  and column_name = 'drive_imported_at') then
        execute 'update public.app_video_review_revisions
                    set imported_at = coalesce(imported_at, drive_imported_at)
                  where imported_at is null and drive_imported_at is not null';
    end if;
end $$;

-- 2. Retire the duplicates.
alter table public.app_video_review_revisions
    drop column if exists drive_mime_type,
    drop column if exists drive_duration_ms,
    drop column if exists drive_import_state,
    drop column if exists drive_import_error,
    drop column if exists drive_imported_at;
