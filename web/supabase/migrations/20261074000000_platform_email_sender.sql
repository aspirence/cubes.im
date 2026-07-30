-- =============================================================================
-- Platform email sender — Cubes' OWN Resend identity, super-admin owned.
-- =============================================================================
-- The email engine (20261071) gave every WORKSPACE its own Resend sender, but
-- platform-side scenarios — a welcome email right after signup, before the new
-- user has any workspace sender — need Cubes itself to send. This adds:
--   * platform_email_sender  — a SINGLE global sender row (from address, name,
--     enabled, has_key mirror, last_test_* health). Super admins read/write.
--   * platform_email_secrets — the platform Resend API key. Service-role only
--     (zero policies + revoked grants, the app_resend_secrets pattern).
--   * email_log.team_id becomes NULLABLE: platform sends log with team_id NULL,
--     readable by platform admins only.
--   * Seeds the 'account.signup_welcome' trigger (enabled).
--
-- Send-time rule (enforced in the send-email edge function / engine): a
-- platform-scope dispatch may only go TO THE CALLER'S OWN address unless the
-- caller is a platform admin — so the welcome path can't be abused to spam
-- arbitrary recipients.
-- =============================================================================

-- ------------------------------------------------------------------- tables --

create table if not exists public.platform_email_sender (
    id              text                     default 'default'         not null,
    from_email      text                                               not null,
    from_name       text,
    reply_to        text,
    enabled         boolean                  default true              not null,
    -- Mirrors "a key is stored"; written ONLY by the platform secret route.
    has_key         boolean                  default false             not null,
    last_test_at    timestamp with time zone,
    last_test_ok    boolean,
    -- Sanitized outcome only — never raw provider text.
    last_test_error text,
    updated_by      uuid,
    created_at      timestamp with time zone default current_timestamp not null,
    updated_at      timestamp with time zone default current_timestamp not null,
    constraint platform_email_sender_pk primary key (id),
    constraint platform_email_sender_singleton check (id = 'default'),
    constraint platform_email_sender_updated_by_fk
        foreign key (updated_by) references public.users (id) on delete set null
);

create table if not exists public.platform_email_secrets (
    id         text                     default 'default'         not null,
    api_key    text                                               not null,
    updated_at timestamp with time zone default current_timestamp not null,
    constraint platform_email_secrets_pk primary key (id),
    constraint platform_email_secrets_singleton check (id = 'default')
);

-- ---------------------------------------------------------------------- RLS --

alter table public.platform_email_sender  enable row level security;
alter table public.platform_email_secrets enable row level security;

drop policy if exists platform_email_sender_select on public.platform_email_sender;
create policy platform_email_sender_select on public.platform_email_sender
    for select to authenticated
    using (public.is_platform_admin());

drop policy if exists platform_email_sender_write on public.platform_email_sender;
create policy platform_email_sender_write on public.platform_email_sender
    for all to authenticated
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

-- platform_email_secrets: NO authenticated policies on purpose — service_role
-- only, combined with the revokes below.

-- --------------------------------------------- email_log: platform sends ----

-- Platform-scope sends have no workspace; relax the NOT NULL and split the
-- read policy: NULL-team rows are platform-admin territory.
alter table public.email_log alter column team_id drop not null;

drop policy if exists email_log_select on public.email_log;
create policy email_log_select on public.email_log
    for select to authenticated
    using (
        case
            when team_id is null then public.is_platform_admin()
            else public.is_team_admin(team_id)
        end
    );

-- ------------------------------------------------------------ trigger seed --

insert into public.platform_email_triggers (event_key, label, description, category, enabled)
values
    ('account.signup_welcome', 'Welcome email',
     'Sent from the platform sender to a new user right after their account is created.',
     'account', true)
on conflict (event_key) do nothing;

-- ------------------------------------------------------------------- grants --

grant select, insert, update, delete on public.platform_email_sender to authenticated;
grant all on public.platform_email_sender  to service_role;
grant all on public.platform_email_secrets to service_role;

-- Load-bearing revokes (see 20261011000000): default privileges auto-grant ALL
-- on new public tables to authenticated + anon.
revoke all on public.platform_email_secrets from authenticated, anon;
revoke all on public.platform_email_sender  from anon;

-- =============================================================================
-- END platform email sender
-- =============================================================================
