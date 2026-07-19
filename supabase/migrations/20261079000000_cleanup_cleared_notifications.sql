-- =============================================================================
-- Daily cleanup of CLEARED notifications — a scheduled job in Supabase's cloud.
-- =============================================================================
-- The Inbox's "Cleared" tab is an archive, not a landfill: a pg_cron job (runs
-- inside the hosted database every night at 03:00 UTC) deletes notifications
-- that are read AND not snoozed into the future AND older than 24 hours — so
-- the tab always keeps roughly the last day of cleared items and then empties
-- itself daily. Unread and snoozed rows are never touched.
--
-- pg_cron over an edge function on purpose: a pure-database sweep needs no
-- HTTP hop, no stored service key, and survives app deploys. Retention knob:
-- edit the interval below and re-push.

create extension if not exists pg_cron;

-- Re-runnable: drop any previous schedule of the same name first.
do $$
begin
    perform cron.unschedule('cleanup-cleared-notifications');
exception
    when others then null; -- not scheduled yet
end;
$$;

select cron.schedule(
    'cleanup-cleared-notifications',
    '0 3 * * *',
    $job$
        delete from public.user_notifications
        where read = true
          and (remind_at is null or remind_at <= now())
          and created_at < now() - interval '24 hours'
    $job$
);

-- =============================================================================
-- END cleanup cleared notifications
-- =============================================================================
