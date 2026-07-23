-- =============================================================================
-- Billing — auto-sync seats when membership changes.
-- =============================================================================
-- When a team with a live Dodo subscription gains or loses a billable member,
-- a trigger fires an async HTTP POST (pg_net) to /api/billing/sync, which recomputes
-- the seat quantity (+ storage addon) and updates the Dodo subscription with
-- proration. URL + shared secret live in a locked-down billing_config row, set
-- out-of-band so no secret is committed.

create extension if not exists pg_net;

create table if not exists public.billing_config (
    id          boolean primary key default true,
    sync_url    text,
    sync_secret text,
    constraint billing_config_singleton check (id)
);
alter table public.billing_config enable row level security;
revoke all on public.billing_config from public, anon, authenticated;
grant all on public.billing_config to service_role;

create or replace function public.team_members_billing_sync()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    v_team   uuid := coalesce(new.team_id, old.team_id);
    v_url    text;
    v_secret text;
    v_has_sub boolean;
begin
    if v_team is null then
        return coalesce(new, old);
    end if;

    -- Only teams that are actually subscribed need a re-sync.
    select (dodo_subscription_id is not null) into v_has_sub
    from public.team_subscriptions
    where team_id = v_team;
    if not coalesce(v_has_sub, false) then
        return coalesce(new, old);
    end if;

    select sync_url, sync_secret into v_url, v_secret from public.billing_config limit 1;
    if v_url is null or v_url = '' then
        return coalesce(new, old);
    end if;

    begin
        perform net.http_post(
            url := v_url,
            body := jsonb_build_object('teamId', v_team),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'x-billing-secret', coalesce(v_secret, '')
            )
        );
    exception when others then
        null;
    end;

    return coalesce(new, old);
end;
$$;

drop trigger if exists team_members_billing_sync_trg on public.team_members;
create trigger team_members_billing_sync_trg
    after insert or delete or update of active, member_type on public.team_members
    for each row execute function public.team_members_billing_sync();
