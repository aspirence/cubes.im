-- =============================================================================
-- Stream user_notifications over Supabase Realtime.
-- =============================================================================
-- The client has subscribed to postgres_changes on user_notifications all
-- along (useNotificationsRealtime), but Postgres only streams tables that are
-- in the `supabase_realtime` publication — and only chat_messages ever was
-- (20261053). Without this, the websocket stays silent and notifications only
-- appear on refetch/refresh. RLS (self-only select) already scopes delivery:
-- each user receives exactly their own rows.

do $$
begin
    alter publication supabase_realtime add table public.user_notifications;
exception
    when duplicate_object then null; -- already in the publication
end;
$$;

-- =============================================================================
-- END notifications realtime
-- =============================================================================
