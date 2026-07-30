-- =============================================================================
-- Dodo Payments — subscription billing wiring.
-- =============================================================================
-- Provider bookkeeping on team_subscriptions (Dodo customer + subscription ids,
-- billed seats, current period end), plus an idempotency ledger so a webhook
-- redelivery is processed at most once. All writes come from the webhook /
-- checkout routes with the service role; team members keep read access to their
-- own team's subscription state.

alter table public.team_subscriptions
    add column if not exists dodo_customer_id     text,
    add column if not exists dodo_subscription_id text,
    add column if not exists current_period_end   timestamp with time zone,
    add column if not exists seats                integer;

create index if not exists team_subscriptions_dodo_sub_idx
    on public.team_subscriptions (dodo_subscription_id);

-- Processed webhook ids (Standard-Webhooks `webhook-id`) — insert-on-conflict
-- makes redeliveries a no-op.
create table if not exists public.dodo_webhook_events (
    event_id    text primary key,
    type        text,
    received_at timestamp with time zone not null default current_timestamp
);
alter table public.dodo_webhook_events enable row level security;
revoke all on public.dodo_webhook_events from public, anon, authenticated;
grant all on public.dodo_webhook_events to service_role;
