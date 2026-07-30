-- =============================================================================
-- Email engine — global (super-admin) triggers + a per-workspace Resend sender.
--
-- Two independent switches, deliberately AND-ed at send time:
--   1. platform_email_triggers — the SUPER-ADMIN decides, platform-wide, whether
--      a given scenario is allowed to send at all.
--   2. app_resend_connections  — each WORKSPACE admin supplies their own Resend
--      key + from-address and can disable sending for their team.
-- A mail goes out only when the global trigger is enabled AND the team has an
-- enabled, configured connector. Neither switch can override the other.
--
-- Postgres cannot send email, so nothing here dispatches: the app calls
-- /api/email/send after the originating write succeeds, and that route re-checks
-- both switches server-side. These tables are the configuration + the audit log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. platform_email_triggers — global, super-admin owned
-- -----------------------------------------------------------------------------
create table if not exists public.platform_email_triggers (
    event_key   text not null,
    label       text not null,
    description text not null default '',
    category    text not null default 'account',
    enabled     boolean not null default true,
    updated_by  uuid,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint platform_email_triggers_pk primary key (event_key),
    constraint platform_email_triggers_updated_by_fk
        foreign key (updated_by) references public.users (id) on delete set null
);

alter table public.platform_email_triggers enable row level security;

-- Readable by any signed-in user: the send path and the workspace's own app page
-- both need to know whether a scenario is globally allowed. Only the flag and
-- its copy live here — never recipients or content.
drop policy if exists platform_email_triggers_select on public.platform_email_triggers;
create policy platform_email_triggers_select on public.platform_email_triggers
    for select to authenticated
    using (true);

drop policy if exists platform_email_triggers_write on public.platform_email_triggers;
create policy platform_email_triggers_write on public.platform_email_triggers
    for all to authenticated
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

-- Seed the "Account & access" scenarios. `on conflict do nothing` keeps re-runs
-- and later edits to `enabled` intact.
insert into public.platform_email_triggers (event_key, label, description, category, enabled)
values
    ('account.employee_created', 'New employee account',
     'Sent to a new employee when their HR record is created with a work email.',
     'account', true),
    ('account.invitation_sent', 'Workspace invitation',
     'Sent when an admin invites someone to a workspace.',
     'account', true),
    ('account.member_joined', 'Member joined',
     'Sent to workspace admins when an invited person accepts and joins.',
     'account', false),
    ('account.role_changed', 'Role changed',
     'Sent to a member when their workspace role or access level changes.',
     'account', false)
on conflict (event_key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. app_resend_connections — one Resend sender per workspace (team)
-- -----------------------------------------------------------------------------
create table if not exists public.app_resend_connections (
    team_id         uuid not null,
    from_email      text not null,
    from_name       text,
    reply_to        text,
    enabled         boolean not null default true,
    -- Mirrors "a key is stored" so the UI can show Connected WITHOUT ever
    -- reading the key. The key itself lives in app_resend_secrets.
    has_key         boolean not null default false,
    last_test_at    timestamptz,
    last_test_ok    boolean,
    -- Sanitised outcome only — this column is workspace-member readable, so it
    -- must never carry raw SDK text, URLs, or any part of the key.
    last_test_error text,
    created_by      uuid,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint app_resend_connections_pk primary key (team_id),
    constraint app_resend_connections_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_resend_connections_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null
);

alter table public.app_resend_connections enable row level security;

drop policy if exists app_resend_connections_select on public.app_resend_connections;
create policy app_resend_connections_select on public.app_resend_connections
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists app_resend_connections_write on public.app_resend_connections;
create policy app_resend_connections_write on public.app_resend_connections
    for all to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

-- -----------------------------------------------------------------------------
-- 3. app_resend_secrets — the API key. service_role ONLY.
-- -----------------------------------------------------------------------------
create table if not exists public.app_resend_secrets (
    team_id    uuid not null,
    api_key    text not null,
    updated_at timestamptz not null default now(),
    constraint app_resend_secrets_pk primary key (team_id),
    constraint app_resend_secrets_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade
);

-- RLS on with ZERO policies = deny-all for authenticated/anon. Combined with the
-- withheld grant below, the key is reachable by service_role alone.
alter table public.app_resend_secrets enable row level security;

-- -----------------------------------------------------------------------------
-- 4. email_log — what actually went out (per workspace)
-- -----------------------------------------------------------------------------
create table if not exists public.email_log (
    id         uuid default gen_random_uuid() not null,
    team_id    uuid not null,
    event_key  text not null,
    to_email   text not null,
    subject    text not null,
    status     text not null,
    detail     text,
    created_by uuid,
    created_at timestamptz not null default now(),
    constraint email_log_pk primary key (id),
    constraint email_log_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint email_log_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint email_log_status_check check (status in ('sent', 'failed', 'skipped'))
);

create index if not exists email_log_team_created_idx
    on public.email_log (team_id, created_at desc);

alter table public.email_log enable row level security;

-- Recipients are PII, so the log is admin-only — not every workspace member.
drop policy if exists email_log_select on public.email_log;
create policy email_log_select on public.email_log
    for select to authenticated
    using (public.is_team_admin(team_id));

-- ------------------------------------------------------------------- grants --

grant select, insert, update, delete on public.platform_email_triggers to authenticated;
grant select, insert, update, delete on public.app_resend_connections  to authenticated;
grant select                          on public.email_log              to authenticated;

grant all on public.platform_email_triggers to service_role;
grant all on public.app_resend_connections  to service_role;
grant all on public.app_resend_secrets      to service_role;
grant all on public.email_log               to service_role;

-- These revokes are LOAD-BEARING, mirroring app_connection_secrets
-- (20261011000000). Supabase sets ALTER DEFAULT PRIVILEGES on schema public
-- granting ALL table privileges to anon + authenticated, so every new public
-- table is auto-granted to authenticated at CREATE TABLE time. Without these,
-- `authenticated` would hold a real SELECT grant on the API keys and only
-- RLS-deny-all would stand between a member and the credential.
revoke all on public.app_resend_secrets from authenticated, anon;
revoke all on public.email_log from anon;
revoke all on public.app_resend_connections from anon;
revoke all on public.platform_email_triggers from anon;
-- The log is written by the send route (service_role) only; members must never
-- be able to forge or edit delivery history.
revoke insert, update, delete on public.email_log from authenticated;
