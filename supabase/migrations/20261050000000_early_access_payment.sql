-- =============================================================================
-- Early-access → paid device order.
--
-- Early access to the AT-Cubes v0.1 device is a paid $100 one-time order, so a
-- request is only "confirmed" after payment. We add payment tracking columns
-- and move creation SERVER-SIDE: the /api/early-access checkout route inserts
-- (service role) and returns a pay URL; the public can no longer insert
-- directly (prevents unpaid spam and payment bypass). Platform admins still
-- read every request (incl. payment status) — see 20261048.
-- =============================================================================

alter table public.early_access_requests
    add column if not exists payment_status      text        not null default 'pending',
    add column if not exists amount_cents         integer     not null default 10000,   -- $100.00
    add column if not exists provider             text,                                  -- 'dodo' | 'test'
    add column if not exists provider_payment_id  text,
    add column if not exists paid_at              timestamp with time zone;

do $$ begin
    alter table public.early_access_requests
        add constraint early_access_payment_status_check
        check (payment_status in ('pending', 'paid', 'failed'));
exception when duplicate_object then null; end $$;

-- Creation now flows through the server checkout route (service role), so the
-- public no longer inserts directly.
drop policy if exists early_access_insert on public.early_access_requests;
revoke insert on public.early_access_requests from anon;

create index if not exists early_access_requests_payment_idx
    on public.early_access_requests (payment_status, created_at desc);
