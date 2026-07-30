-- =============================================================================
-- Web Push — OS-level notifications for the installed PWA.
-- =============================================================================
-- Each device/browser stores a push subscription. When a user_notifications row
-- is inserted, a trigger fires an async HTTP POST (pg_net) to the app's
-- /api/push/dispatch route, which signs the payload with our VAPID key and
-- delivers it to that user's devices — even when the app/tab is closed.
--
-- The dispatch URL + shared secret live in a locked-down push_config row (never
-- readable by clients; only the SECURITY DEFINER trigger and service_role see
-- it), and are set out-of-band so no secret is committed to git.

create extension if not exists pg_net;

/* --------------------------------------------------------- subscriptions */

create table if not exists public.push_subscriptions (
    id           uuid                     default gen_random_uuid() not null,
    user_id      uuid                                               not null,
    endpoint     text                                               not null,
    p256dh       text                                               not null,
    auth         text                                               not null,
    user_agent   text,
    created_at   timestamp with time zone default current_timestamp not null,
    last_seen_at timestamp with time zone default current_timestamp not null,
    constraint push_subscriptions_pk primary key (id),
    constraint push_subscriptions_endpoint_unique unique (endpoint),
    constraint push_subscriptions_user_fk
        foreign key (user_id) references public.users (id) on delete cascade
);
create index if not exists push_subscriptions_user_index
    on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

revoke all on public.push_subscriptions from public, anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

/* ------------------------------------------------------------- config */

-- Single-row config (dispatch URL + shared secret). Locked down: no RLS policy
-- means authenticated/anon can't read it; service_role bypasses RLS and the
-- trigger runs SECURITY DEFINER, so both can.
create table if not exists public.push_config (
    id              boolean primary key default true,
    dispatch_url    text,
    dispatch_secret text,
    constraint push_config_singleton check (id)
);
alter table public.push_config enable row level security;
revoke all on public.push_config from public, anon, authenticated;
grant all on public.push_config to service_role;

/* ---------------------------------------------------------- dispatch */

create or replace function public.user_notifications_push_dispatch()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_url    text;
    v_secret text;
begin
    select dispatch_url, dispatch_secret into v_url, v_secret
    from public.push_config
    limit 1;

    if v_url is null or v_url = '' then
        return new;
    end if;

    -- Fire-and-forget; a push hiccup must never block the notification write.
    begin
        perform net.http_post(
            url := v_url,
            body := jsonb_build_object('notification_id', new.id),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-push-secret', coalesce(v_secret, '')
            )
        );
    exception when others then
        null;
    end;

    return new;
end;
$$;

drop trigger if exists user_notifications_push_dispatch_trg on public.user_notifications;
create trigger user_notifications_push_dispatch_trg
    after insert on public.user_notifications
    for each row execute function public.user_notifications_push_dispatch();
