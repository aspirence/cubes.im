-- =============================================================================
-- Billing — subscription management state.
-- =============================================================================
-- Track whether a subscription is set to cancel at the end of the current
-- period, so the UI can show a "Canceling" state and offer Resume. Set by the
-- cancel/resume routes and the Dodo webhook.

alter table public.team_subscriptions
    add column if not exists cancel_at_period_end boolean not null default false;
