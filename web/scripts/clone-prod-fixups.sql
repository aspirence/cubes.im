-- Data changes that dev's migrations made and production's data never got,
-- replayed on the rows scripts/clone-prod-to-dev.sh just copied in. Runs
-- inside the clone's load transaction (\i), before its checks.
--
-- Only the data parts are here: the schema they belong to is already in dev.
-- Backfills whose rows are already right in production (status_changed_at,
-- the duplicate-timer cleanup, recurring starts_on) are left out — the clone
-- checks those at plan time.

-- 20261116500000_content_studio_rename, section 9: Social Studio is Content
-- Studio. Fold a team that holds both keys, then rename the rest.
update public.installed_apps target
set    config     = source.config,
       enabled    = source.enabled or target.enabled,
       updated_at = now()
from   public.installed_apps source
where  target.app_key = 'content_studio'
  and  source.app_key = 'social_studio'
  and  source.team_id = target.team_id
  and  target.config = '{}'::jsonb
  and  source.config <> '{}'::jsonb;

delete from public.installed_apps source
where  source.app_key = 'social_studio'
  and  exists (select 1 from public.installed_apps target
               where target.team_id = source.team_id and target.app_key = 'content_studio');

update public.installed_apps set app_key = 'content_studio' where app_key = 'social_studio';

delete from public.project_views source
where  source.view_key = 'social-studio'
  and  exists (select 1 from public.project_views target
               where target.project_id = source.project_id and target.view_key = 'content-studio');

update public.project_views set view_key = 'content-studio' where view_key = 'social-studio';

-- 20261134000000_video_review_drive: every revision says where its video
-- lives. Production has no source_kind column, so all rows arrived as the
-- default 'link'.
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

update public.app_video_review_revisions
   set source_kind = 'drive'
 where drive_file_id is not null
   and storage_path is null
   and source_kind <> 'drive';

-- 20261128000000_app_runner_workflows: scheduled workflows get their first run time.
update public.workflows
   set next_run_at = public.workflow_schedule_next_run(trigger_config, now())
 where enabled and trigger_type = 'schedule' and next_run_at is null;
