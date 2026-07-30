-- =============================================================================
-- Pricing — switch from a flat base price to per-user ($1 / user / month).
-- =============================================================================
-- Adds a per-user rate to platform_pricing and moves the live config to:
--   * $1.00 per user / month (price_per_user_cents = 100)
--   * 100 GB storage included (base_storage_gb)
--   * extra storage purchasable at price_per_gb_cents
-- The flat base_price_cents becomes an OPTIONAL platform fee, defaulted to 0.
-- Effective monthly = base + members * per_user + max(0, gb - base_gb) * per_gb.

alter table public.platform_pricing
    add column if not exists price_per_user_cents bigint not null default 100;  -- $1.00 / user / month

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'platform_pricing_per_user_check'
    ) then
        alter table public.platform_pricing
            add constraint platform_pricing_per_user_check check (price_per_user_cents >= 0);
    end if;
end $$;

-- Move the singleton config to per-user pricing (the row is already seeded, so
-- an insert-on-conflict wouldn't touch it — update it explicitly).
update public.platform_pricing set
    base_price_cents     = 0,
    price_per_user_cents = 100,
    base_storage_gb      = 100,
    price_per_gb_cents   = case when price_per_gb_cents = 0 then 20 else price_per_gb_cents end,
    benefits = '[
        "$1 per user / month",
        "100 GB storage included",
        "Buy extra storage anytime",
        "Unlimited projects",
        "Docs, video review & social studio",
        "Client portals",
        "AI agents & automations",
        "Workload & reporting",
        "Priority support"
    ]'::jsonb,
    updated_at = current_timestamp
where id = true;

-- If somehow no row exists yet, seed it with the new model.
insert into public.platform_pricing
    (id, base_price_cents, price_per_user_cents, base_storage_gb, price_per_gb_cents, currency, benefits)
values (
    true, 0, 100, 100, 20, 'USD',
    '["$1 per user / month","100 GB storage included","Buy extra storage anytime","Unlimited projects","Docs, video review & social studio","Client portals","AI agents & automations","Workload & reporting","Priority support"]'::jsonb
)
on conflict (id) do nothing;
