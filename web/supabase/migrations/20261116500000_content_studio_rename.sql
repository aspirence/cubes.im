-- =============================================================================
-- Social Studio becomes Content Studio
-- =============================================================================
-- The app outgrew its name. It was built as a social publishing workspace —
-- channels with handles and follower counts, posts with captions — but the work
-- people actually plan in it is content: a launch blog, the newsletter that goes
-- with it, the YouTube cut, and yes, the Instagram post. This migration renames
-- every database object and generalises the two tables whose shape encoded the
-- social-only assumption.
--
--   app_social_studio_channels      -> app_content_studio_destinations
--   app_social_studio_posts         -> app_content_studio_items
--   app_social_studio_post_channels -> app_content_studio_item_destinations
--   app_social_studio_post_assets   -> app_content_studio_item_assets
--   app_social_studio_campaigns     -> app_content_studio_campaigns
--
-- A destination is anywhere content lands (a social account, a blog, a
-- newsletter list, a video channel); an item is a piece of content with a
-- content_type. "Social post" becomes one type among several rather than the
-- only thing the schema can describe.
--
-- WHY THIS RUNS AT 20261116500000 AND NOT AFTER THE PENDING WORK
-- The remote database is at 20261116000000. Eight migrations sit unapplied in
-- this repo, and one of them — 20261119000000, the posting routines — creates
-- tables with a foreign key onto the campaigns table. That file has been edited
-- in place to use the content_studio names (it has never been applied anywhere,
-- so there is nothing to un-rename), which means its FK target must already be
-- renamed by the time it runs. A half-step version puts this migration after the
-- last applied one and before the routines, so a plain `supabase db push`
-- applies everything in the right order with no --include-all and no
-- out-of-order warning. 20261105500000_whiteboards.sql set this precedent.
--
-- WHY THE HELPER FUNCTIONS ARE REPLACED AND NOT JUST RENAMED
-- All four are LANGUAGE sql with a classic quoted body, so Postgres stores the
-- body as TEXT, not as a parse tree. Renaming a table does NOT rewrite the text
-- inside them. Renaming alone would leave every body pointing at a table that no
-- longer exists, and since two RLS policies call them, every read and write
-- against item_destinations and item_assets would fail at runtime. Each one is
-- therefore renamed (which preserves its OID, so the policies that reference it
-- stay intact) and then CREATE OR REPLACE'd with a corrected body. Their input
-- parameter names are deliberately left alone: CREATE OR REPLACE cannot rename a
-- parameter, and dropping the functions would require dropping the policies that
-- depend on them. Parameter names are invisible to positional callers.
--
-- Policies and indexes need no such care — policy expressions are stored as
-- parse trees and follow renames by OID, and ALTER TABLE ... RENAME CONSTRAINT
-- also renames the constraint's backing index, so only the 10 standalone indexes
-- are renamed explicitly.
--
-- THE DATA HAS TO MOVE IN THE SAME BREATH
-- Three teams have this app installed and four projects show it as a tab. Those
-- rows store the app key and the view key as data, and the application code in
-- this same change reads the new values. Renaming tables without updating them
-- would make the app read as "not installed" for those teams and drop the tab
-- from those projects. Section 8 moves them.
--
-- All five tables are empty, so the object renames carry no data risk.
--
-- Re-runnable: the mechanical renames are guarded on the pre-rename state, the
-- column work uses add/drop ... if exists, and the data updates are WHERE-scoped.
-- =============================================================================


-- =============================================================================
-- SECTION 1-5: Objects — tables, constraints, indexes, policies, triggers
-- -----------------------------------------------------------------------------
-- Guarded as one unit. If app_social_studio_posts is already gone the rename has
-- run before and the whole block is skipped, which keeps a manual re-run from
-- failing on constraint names that no longer exist.
-- =============================================================================

do $$
begin
    if to_regclass('public.app_social_studio_posts') is null then
        raise notice 'Content Studio: objects already renamed, skipping sections 1-5.';
        return;
    end if;

    -- -- Tables ------------------------------------------------------------
    alter table public.app_social_studio_campaigns     rename to app_content_studio_campaigns;
    alter table public.app_social_studio_channels      rename to app_content_studio_destinations;
    alter table public.app_social_studio_post_assets   rename to app_content_studio_item_assets;
    alter table public.app_social_studio_post_channels rename to app_content_studio_item_destinations;
    alter table public.app_social_studio_posts         rename to app_content_studio_items;

    -- -- Constraints (36) --------------------------------------------------
    alter table public.app_content_studio_campaigns rename constraint app_social_studio_campaigns_brief_check to app_content_studio_campaigns_brief_check;
    alter table public.app_content_studio_campaigns rename constraint app_social_studio_campaigns_created_by_fk to app_content_studio_campaigns_created_by_fk;
    alter table public.app_content_studio_campaigns rename constraint app_social_studio_campaigns_goal_check to app_content_studio_campaigns_goal_check;
    alter table public.app_content_studio_campaigns rename constraint app_social_studio_campaigns_name_check to app_content_studio_campaigns_name_check;
    alter table public.app_content_studio_campaigns rename constraint app_social_studio_campaigns_pk to app_content_studio_campaigns_pk;
    alter table public.app_content_studio_campaigns rename constraint app_social_studio_campaigns_project_fk to app_content_studio_campaigns_project_fk;
    alter table public.app_content_studio_campaigns rename constraint app_social_studio_campaigns_team_fk to app_content_studio_campaigns_team_fk;

    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_created_by_fk to app_content_studio_destinations_created_by_fk;
    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_followers_check to app_content_studio_destinations_audience_check;
    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_handle_check to app_content_studio_destinations_handle_check;
    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_name_check to app_content_studio_destinations_name_check;
    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_pk to app_content_studio_destinations_pk;
    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_platform_check to app_content_studio_destinations_platform_check;
    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_project_fk to app_content_studio_destinations_project_fk;
    alter table public.app_content_studio_destinations rename constraint app_social_studio_channels_team_fk to app_content_studio_destinations_team_fk;

    alter table public.app_content_studio_item_assets rename constraint app_social_studio_post_assets_file_fk to app_content_studio_item_assets_file_fk;
    alter table public.app_content_studio_item_assets rename constraint app_social_studio_post_assets_pk to app_content_studio_item_assets_pk;
    alter table public.app_content_studio_item_assets rename constraint app_social_studio_post_assets_post_fk to app_content_studio_item_assets_item_fk;
    alter table public.app_content_studio_item_assets rename constraint app_social_studio_post_assets_unique to app_content_studio_item_assets_unique;

    alter table public.app_content_studio_item_destinations rename constraint app_social_studio_post_channels_channel_fk to app_content_studio_item_destinations_destination_fk;
    alter table public.app_content_studio_item_destinations rename constraint app_social_studio_post_channels_pk to app_content_studio_item_destinations_pk;
    alter table public.app_content_studio_item_destinations rename constraint app_social_studio_post_channels_post_fk to app_content_studio_item_destinations_item_fk;
    alter table public.app_content_studio_item_destinations rename constraint app_social_studio_post_channels_unique to app_content_studio_item_destinations_unique;
    alter table public.app_content_studio_item_destinations rename constraint app_social_studio_post_channels_variant_caption_check to app_content_studio_item_destinations_variant_body_check;

    alter table public.app_content_studio_items rename constraint app_social_studio_posts_campaign_fk to app_content_studio_items_campaign_fk;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_caption_check to app_content_studio_items_body_check;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_clicks_check to app_content_studio_items_clicks_check;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_created_by_fk to app_content_studio_items_created_by_fk;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_engagements_check to app_content_studio_items_engagements_check;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_impressions_check to app_content_studio_items_impressions_check;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_pk to app_content_studio_items_pk;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_project_fk to app_content_studio_items_project_fk;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_status_check to app_content_studio_items_status_check;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_task_fk to app_content_studio_items_task_fk;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_team_fk to app_content_studio_items_team_fk;
    alter table public.app_content_studio_items rename constraint app_social_studio_posts_title_check to app_content_studio_items_title_check;

    -- -- Indexes (10 standalone; constraint-backed ones followed above) -----
    alter index public.app_social_studio_campaigns_team_index        rename to app_content_studio_campaigns_team_index;
    alter index public.app_social_studio_channels_team_index         rename to app_content_studio_destinations_team_index;
    alter index public.app_social_studio_channels_unique_handle      rename to app_content_studio_destinations_unique_handle;
    alter index public.app_social_studio_post_assets_post_index      rename to app_content_studio_item_assets_item_index;
    alter index public.app_social_studio_post_channels_channel_index rename to app_content_studio_item_destinations_destination_index;
    alter index public.app_social_studio_post_channels_post_index    rename to app_content_studio_item_destinations_item_index;
    alter index public.app_social_studio_posts_campaign_index        rename to app_content_studio_items_campaign_index;
    alter index public.app_social_studio_posts_scheduled_index       rename to app_content_studio_items_scheduled_index;
    alter index public.app_social_studio_posts_task_index            rename to app_content_studio_items_task_index;
    alter index public.app_social_studio_posts_team_index            rename to app_content_studio_items_team_index;

    -- -- Policies (5) ------------------------------------------------------
    alter policy app_social_studio_campaigns_all     on public.app_content_studio_campaigns         rename to app_content_studio_campaigns_all;
    alter policy app_social_studio_channels_all      on public.app_content_studio_destinations      rename to app_content_studio_destinations_all;
    alter policy app_social_studio_post_assets_all   on public.app_content_studio_item_assets       rename to app_content_studio_item_assets_all;
    alter policy app_social_studio_post_channels_all on public.app_content_studio_item_destinations rename to app_content_studio_item_destinations_all;
    alter policy app_social_studio_posts_all         on public.app_content_studio_items             rename to app_content_studio_items_all;

    -- -- Triggers (3) ------------------------------------------------------
    alter trigger app_social_studio_campaigns_set_updated_at on public.app_content_studio_campaigns    rename to app_content_studio_campaigns_set_updated_at;
    alter trigger app_social_studio_channels_set_updated_at  on public.app_content_studio_destinations rename to app_content_studio_destinations_set_updated_at;
    alter trigger app_social_studio_posts_set_updated_at     on public.app_content_studio_items        rename to app_content_studio_items_set_updated_at;

    raise notice 'Content Studio: renamed 5 tables, 36 constraints, 10 indexes, 5 policies, 3 triggers.';
end $$;


-- =============================================================================
-- SECTION 6: Columns — generalise the two social-shaped tables
-- -----------------------------------------------------------------------------
-- A caption is a social idea; a blog post and a newsletter both have a body.
-- A follower count only means something on a social account; every destination
-- has some notion of audience size. The foreign keys are renamed to match the
-- tables they now point at.
-- =============================================================================

do $$
begin
    if to_regclass('public.app_content_studio_items') is null then
        raise notice 'Content Studio: items table missing, skipping section 6.';
        return;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'app_content_studio_items'
                 and column_name = 'caption') then
        alter table public.app_content_studio_items rename column caption to body;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'app_content_studio_destinations'
                 and column_name = 'followers_count') then
        alter table public.app_content_studio_destinations rename column followers_count to audience_size;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'app_content_studio_item_destinations'
                 and column_name = 'post_id') then
        alter table public.app_content_studio_item_destinations rename column post_id to item_id;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'app_content_studio_item_destinations'
                 and column_name = 'channel_id') then
        alter table public.app_content_studio_item_destinations rename column channel_id to destination_id;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'app_content_studio_item_destinations'
                 and column_name = 'variant_caption') then
        alter table public.app_content_studio_item_destinations rename column variant_caption to variant_body;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'app_content_studio_item_assets'
                 and column_name = 'post_id') then
        alter table public.app_content_studio_item_assets rename column post_id to item_id;
    end if;
end $$;


-- =============================================================================
-- SECTION 7: The discriminators — what kind of content, and where it goes
-- -----------------------------------------------------------------------------
-- Defaults are the social values on purpose: every row that exists today (none,
-- as it happens) and every row written by a client that has not caught up yet
-- still means "social post going to a social account", so the broadening is
-- backwards compatible rather than a flag day.
--
-- The platform column is left as free text (a length check, since 20261038000000
-- dropped the nine-platform IN list) so it can hold 'wordpress' or 'substack'
-- alongside 'instagram' without another migration.
-- =============================================================================

alter table public.app_content_studio_items
    add column if not exists content_type text not null default 'social_post';

alter table public.app_content_studio_items
    drop constraint if exists app_content_studio_items_content_type_check;

alter table public.app_content_studio_items
    add constraint app_content_studio_items_content_type_check
    check (content_type in ('social_post', 'blog_post', 'newsletter', 'video', 'podcast', 'other'));

create index if not exists app_content_studio_items_type_index
    on public.app_content_studio_items (team_id, content_type, status);

alter table public.app_content_studio_destinations
    add column if not exists kind text not null default 'social_account';

alter table public.app_content_studio_destinations
    drop constraint if exists app_content_studio_destinations_kind_check;

alter table public.app_content_studio_destinations
    add constraint app_content_studio_destinations_kind_check
    check (kind in ('social_account', 'blog', 'newsletter', 'video_channel', 'podcast', 'other'));


-- =============================================================================
-- SECTION 8: RLS helper functions
-- -----------------------------------------------------------------------------
-- Rename first (preserves the OID, so the two policies that call these keep
-- working), then replace the body, which is stored as text and would otherwise
-- still name the old tables. Parameter names are intentionally unchanged — see
-- the header.
-- =============================================================================

do $$
begin
    if to_regclass('public.app_content_studio_items') is null then
        raise notice 'Content Studio: tables missing, skipping section 8.';
        return;
    end if;

    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'social_studio_can_access_post') then
        alter function public.social_studio_can_access_post(uuid)     rename to content_studio_can_access_item;
        alter function public.social_studio_can_access_channel(uuid)  rename to content_studio_can_access_destination;
        alter function public.social_studio_can_access_campaign(uuid) rename to content_studio_can_access_campaign;
        alter function public.social_studio_can_access_file(uuid)     rename to content_studio_can_access_file;
    end if;
end $$;

create or replace function public.content_studio_can_access_item(p_post_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path to 'public'
as $function$
    select exists (
        select 1
        from public.app_content_studio_items p
        where p.id = p_post_id
          and public.is_team_member(p.team_id)
          and (p.project_id is null or public.is_project_team_member(p.project_id))
    );
$function$;

create or replace function public.content_studio_can_access_destination(p_channel_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path to 'public'
as $function$
    select exists (
        select 1
        from public.app_content_studio_destinations c
        where c.id = p_channel_id
          and public.is_team_member(c.team_id)
          and (c.project_id is null or public.is_project_team_member(c.project_id))
    );
$function$;

create or replace function public.content_studio_can_access_campaign(p_campaign_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path to 'public'
as $function$
    select exists (
        select 1
        from public.app_content_studio_campaigns c
        where c.id = p_campaign_id
          and public.is_team_member(c.team_id)
          and (c.project_id is null or public.is_project_team_member(c.project_id))
    );
$function$;

-- Unchanged body (it reads the Files app table, which is not renamed here); it
-- is replaced only so the definition on disk matches the one in the database.
create or replace function public.content_studio_can_access_file(p_file_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path to 'public'
as $function$
    select exists (
        select 1
        from public.app_files_files f
        where f.id = p_file_id
          and public.is_team_member(f.team_id)
          and (f.project_id is null or public.is_project_team_member(f.project_id))
    );
$function$;


-- =============================================================================
-- SECTION 9: The rows that carry the old name as data
-- -----------------------------------------------------------------------------
-- installed_apps.app_key uses an underscore, project_views.view_key a hyphen —
-- that asymmetry is real and is preserved.
--
-- THE COLLISION THIS HAS TO SURVIVE
-- Both keys are unique: (team_id, app_key) and (project_id, view_key). A bare
-- UPDATE from the old key to the new one therefore fails the moment a row
-- already holds the NEW key — and that is not hypothetical. The application code
-- in this same change writes 'content_studio' when someone installs the app, so
-- anyone running the renamed build before this migration is applied mints
-- exactly such a row. It was observed in practice: a team acquired a
-- content_studio row hours before the push, which would have aborted the whole
-- migration on a duplicate-key violation.
--
-- So the duplicate is folded first. The OLD row is treated as authoritative
-- because it is the one that has been in use — its config carries the team's
-- real project scoping, while a freshly minted row starts at '{}'. Copying that
-- config forward before dropping it is what keeps a team from silently losing
-- "this app is scoped to these 3 projects" and reverting to all-projects.
--
-- The pricing benefit line is user-visible billing copy stored in a jsonb array.
-- 20261041000000 and 20261105000000 still seed the old wording and are left that
-- way on purpose: both are already applied remotely, so editing them would change
-- nothing on the live database while quietly diverging the repo from it. Both run
-- before this migration, so the UPDATE below is what corrects the row — on a live
-- push and on a fresh `db reset` alike. If you add another pricing migration
-- later, seed it with the new wording; do not copy the line out of those two.
-- =============================================================================

-- 9a. Fold any team that already holds BOTH keys, carrying the old row's config
--     forward when the new row has none of its own.
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
  and  exists (
      select 1
      from   public.installed_apps target
      where  target.team_id = source.team_id
        and  target.app_key = 'content_studio'
  );

update public.installed_apps
set    app_key = 'content_studio'
where  app_key = 'social_studio';

-- 9b. Same guard for project tabs. project_views carries no config, so the
--     duplicate is simply dropped rather than merged.
delete from public.project_views source
where  source.view_key = 'social-studio'
  and  exists (
      select 1
      from   public.project_views target
      where  target.project_id = source.project_id
        and  target.view_key = 'content-studio'
  );

update public.project_views
set    view_key = 'content-studio'
where  view_key = 'social-studio';

update public.platform_pricing
set    benefits = replace(benefits::text, 'video review & social studio', 'video review & content studio')::jsonb
where  benefits::text like '%video review & social studio%';
