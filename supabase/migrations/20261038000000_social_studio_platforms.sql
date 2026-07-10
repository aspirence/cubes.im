-- =============================================================================
-- Social Studio — open up the channel platform set.
--
-- The original CHECK hard-coded 9 platforms, so adding Pinterest/Telegram/
-- Discord/Mastodon/WhatsApp/etc. required a migration each time. Drop the CHECK
-- and validate the platform in the app (the SocialPlatform union) — a light
-- length guard keeps the column sane. Existing rows are unaffected.
-- =============================================================================

alter table public.app_social_studio_channels
    drop constraint if exists app_social_studio_channels_platform_check;

alter table public.app_social_studio_channels
    add constraint app_social_studio_channels_platform_check
    check (char_length(platform) between 1 and 40);
