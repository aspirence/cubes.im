-- =============================================================================
-- Platform pricing + super-admin.
--
--   * platform_admins        — super-admin users (manage global pricing).
--   * is_platform_admin()    — SECURITY DEFINER check for the caller.
--   * platform_pricing       — the single global pricing config: a monthly base
--                              price (unlimited team members) + a per-GB rate for
--                              storage above a base allotment, plus the benefits
--                              list shown on pricing surfaces. Super admins write;
--                              anyone may read (pricing is public).
--   * team_subscriptions     — each team's chosen storage (GB); the effective
--                              monthly price is base + max(0, gb - base) * per-gb.
-- =============================================================================

/* ---------------------------------------------------------- super admins */
create table if not exists public.platform_admins (
    user_id    uuid                     primary key references public.users (id) on delete cascade,
    created_at timestamp with time zone not null default current_timestamp
);
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as $$
    select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

drop policy if exists platform_admins_all on public.platform_admins;
create policy platform_admins_all on public.platform_admins
    for all to authenticated
    using (public.is_platform_admin())
    with check (public.is_platform_admin());
revoke all on public.platform_admins from public, anon;
grant select, insert, update, delete on public.platform_admins to authenticated;
grant all on public.platform_admins to service_role;

/* ---------------------------------------------------------- pricing config */
create table if not exists public.platform_pricing (
    id                 boolean                  primary key default true,
    base_price_cents   bigint                   not null default 1000,   -- $10.00 / month
    base_storage_gb    integer                  not null default 100,    -- included storage
    price_per_gb_cents bigint                   not null default 20,     -- $0.20 / extra GB
    currency           text                     not null default 'USD',
    benefits           jsonb                    not null default '[]'::jsonb,
    updated_at         timestamp with time zone not null default current_timestamp,
    updated_by         uuid references public.users (id) on delete set null,
    constraint platform_pricing_singleton check (id = true),
    constraint platform_pricing_base_price_check check (base_price_cents >= 0),
    constraint platform_pricing_gb_check check (price_per_gb_cents >= 0 and base_storage_gb >= 0)
);
alter table public.platform_pricing enable row level security;

drop policy if exists platform_pricing_select on public.platform_pricing;
create policy platform_pricing_select on public.platform_pricing
    for select to anon, authenticated using (true);

drop policy if exists platform_pricing_write on public.platform_pricing;
create policy platform_pricing_write on public.platform_pricing
    for all to authenticated
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

revoke all on public.platform_pricing from public, anon;
grant select on public.platform_pricing to anon, authenticated;
grant insert, update, delete on public.platform_pricing to authenticated;
grant all on public.platform_pricing to service_role;

insert into public.platform_pricing (id, base_price_cents, base_storage_gb, price_per_gb_cents, currency, benefits)
values (
    true, 1000, 100, 20, 'USD',
    '["Unlimited team members","100 GB storage included","Unlimited projects","Docs, video review & social studio","Client portals","AI agents & automations","Workload & reporting","Priority support"]'::jsonb
)
on conflict (id) do nothing;

/* ------------------------------------------------------ per-team storage */
create table if not exists public.team_subscriptions (
    team_id    uuid                     primary key references public.teams (id) on delete cascade,
    storage_gb integer                  not null default 100,
    status     text                     not null default 'active',
    updated_at timestamp with time zone not null default current_timestamp,
    constraint team_subscriptions_storage_check check (storage_gb >= 0),
    constraint team_subscriptions_status_check check (status in ('active', 'paused', 'canceled'))
);
alter table public.team_subscriptions enable row level security;

drop policy if exists team_subscriptions_select on public.team_subscriptions;
create policy team_subscriptions_select on public.team_subscriptions
    for select to authenticated using (public.is_team_member(team_id));

drop policy if exists team_subscriptions_write on public.team_subscriptions;
create policy team_subscriptions_write on public.team_subscriptions
    for all to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

revoke all on public.team_subscriptions from public, anon;
grant select, insert, update, delete on public.team_subscriptions to authenticated;
grant all on public.team_subscriptions to service_role;

/* ----------------------------------------------- seed initial super admins */
insert into public.platform_admins (user_id)
select id from public.users where email in ('demo@cubes.test', 'rahul@aspirence.com')
on conflict (user_id) do nothing;
