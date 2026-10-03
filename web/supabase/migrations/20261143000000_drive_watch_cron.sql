-- =============================================================================
-- Sheets ↔ Google — push sync: the thing that keeps the channels alive
-- =============================================================================
-- 20261142000000 built the Drive push engine and 20261141000000 made every
-- sheet a Google Sheet, but nothing scheduled ever RAN the engine. Nine pg_cron
-- jobs existed and none of them touched it, so no channel was ever registered
-- and — this is the part that makes push dead on arrival rather than merely
-- late — no channel was ever RENEWED. Drive caps a FILES channel at 24 hours
-- and defaults it to one, so a feature that does not renew stops working on its
-- first day even if it starts perfectly.
--
-- Two things drive it now, deliberately:
--
--   1. /api/runner/tick, every five minutes, in the same pass as the Sheets
--      poller. That is the primary driver and needs no configuration beyond the
--      runner's own.
--   2. This job, every ten minutes, straight at /api/hooks/google/drive/renew.
--      It is the backstop for the tick route itself failing or being redeployed
--      mid-pass, and it is what makes that route — secret-gated, with no UI
--      control — a driven capability instead of an operator escape hatch.
--
-- Running both is safe by construction, not by luck: two passes racing to watch
-- one link are serialised by the partial unique index on (link_id) where
-- status = 'pending', and the loser finds nothing to do. The minutes are chosen
-- so the two rarely collide at all — the runner is on */5, this is on the 3s.
--
-- Re-runnable and purely additive: add column if not exists, create or replace,
-- and an unschedule that tolerates the job not being there yet. No existing row
-- is modified.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Where to POST
-- -----------------------------------------------------------------------------
-- app_runner_config (20261128000000) already holds the runner's URL and shared
-- secret, and the renew route takes the SAME secret — so this adds one nullable
-- column and nothing else. Leaving it null is the normal case: the URL is then
-- derived from tick_url, which every deployment already sets.
do $$
begin
    if to_regclass('public.app_runner_config') is not null then
        alter table public.app_runner_config add column if not exists drive_watch_url text;
        comment on column public.app_runner_config.drive_watch_url is
            'Absolute URL of POST /api/hooks/google/drive/renew. Null derives it from tick_url.';
    end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. app_drive_watch_dispatch — the cron entry point
-- -----------------------------------------------------------------------------
-- Shaped exactly like app_runner_tick_dispatch: read the config, return quietly
-- when there is nothing configured (a fresh database must not log an error every
-- ten minutes), and fire pg_net at the route with the shared secret.
create or replace function public.app_drive_watch_dispatch()
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _url    text;
    _tick   text;
    _secret text;
begin
    select nullif(drive_watch_url, ''), nullif(tick_url, ''), tick_secret
      into _url, _tick, _secret
      from public.app_runner_config
     limit 1;

    if _url is null then
        -- Derive it from the runner's own URL — same origin, the renew path.
        -- Only when tick_url really IS the runner tick, so an operator who has
        -- pointed tick_url somewhere bespoke never has it silently repurposed
        -- (and never has the secret POSTed at an endpoint they did not choose).
        if _tick ~ '/api/runner/tick/?$' then
            _url := regexp_replace(_tick, '/api/runner/tick/?$', '/api/hooks/google/drive/renew');
        end if;
    end if;

    if _url is null or _url = '' then
        return;
    end if;

    -- pg_net is fire-and-forget: the timeout only bounds how long it keeps the
    -- response around, not how long the route may run.
    perform net.http_post(
        url := _url,
        body := '{}'::jsonb,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-runner-secret', coalesce(_secret, '')),
        timeout_milliseconds := 120000);
end;
$$;

revoke all on function public.app_drive_watch_dispatch() from public, anon, authenticated;
grant execute on function public.app_drive_watch_dispatch() to service_role;


-- -----------------------------------------------------------------------------
-- 3. The schedule
-- -----------------------------------------------------------------------------
-- Same two-block shape as app-runner-tick (20261128000000): unschedule first so
-- a re-run replaces rather than duplicates, and swallow everything, because an
-- install without pg_cron must still apply this migration.
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('app-drive-watch-renew');
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        -- Every ten minutes, off the runner's */5 minutes on purpose: the two
        -- passes are safe to overlap but there is no reason to make them.
        perform cron.schedule(
            'app-drive-watch-renew',
            '3,13,23,33,43,53 * * * *',
            $cron$ select public.app_drive_watch_dispatch(); $cron$
        );
        raise notice 'Sheets push: scheduled pg_cron job "app-drive-watch-renew" (every 10 min).';
    else
        raise notice 'Sheets push: pg_cron unavailable — the runner tick still renews Drive channels.';
    end if;
exception
    when others then
        raise notice 'Sheets push: pg_cron setup skipped (% — %).', sqlstate, sqlerrm;
end $$;
