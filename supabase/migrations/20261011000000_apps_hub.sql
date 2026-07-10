-- =============================================================================
-- Apps hub (App Center) — Phase A of Workflows + Agents + Apps.
-- =============================================================================
-- Org-scoped external connectors (webhook, slack, email, whatsapp). Two tables:
--   * app_connections         — NON-secret metadata (name, provider, config,
--                               enabled, last-test health). Team members read;
--                               org admins write. Mirrors the automations engine
--                               RLS/trigger idiom (20261009000000).
--   * app_connection_secrets  — credentials (tokens, signing secrets, API keys).
--                               RLS enabled with NO authenticated policies and no
--                               table grant to authenticated: reachable ONLY by
--                               service_role via route handlers (the api/account/
--                               delete precedent). Never queried from the browser.
--
-- Health (last_test_*) is written by the /api/apps/[id]/test route (service_role)
-- so the App Center health dot reflects a real delivery attempt.

-- ------------------------------------------------------------------- tables --

create table if not exists public.app_connections (
    id               uuid                     default gen_random_uuid() not null,
    org_id           uuid                                               not null,
    provider         text                                               not null,
    name             text                                               not null,
    enabled          boolean                  default true              not null,
    config           jsonb                    default '{}'::jsonb       not null,
    last_test_status text,
    last_tested_at   timestamp with time zone,
    last_test_error  text,
    created_by       uuid,
    created_at       timestamp with time zone default current_timestamp not null,
    updated_at       timestamp with time zone default current_timestamp not null,
    constraint app_connections_pk primary key (id),
    constraint app_connections_org_id_fk
        foreign key (org_id) references public.organizations (id) on delete cascade,
    constraint app_connections_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_connections_provider_check
        check (provider in ('webhook', 'slack', 'email', 'whatsapp')),
    constraint app_connections_name_check check (char_length(name) <= 200),
    constraint app_connections_config_check check (jsonb_typeof(config) = 'object'),
    constraint app_connections_last_test_status_check
        check (last_test_status is null or last_test_status in ('ok', 'failed')),
    constraint app_connections_last_test_error_check
        check (last_test_error is null or char_length(last_test_error) <= 1000)
);

create index if not exists app_connections_org_id_index
    on public.app_connections (org_id);

-- Credentials live apart from metadata so authenticated table grants never touch
-- them. 1:1 with a connection; cascade on connection delete.
create table if not exists public.app_connection_secrets (
    connection_id uuid                                               not null,
    credentials   jsonb                    default '{}'::jsonb       not null,
    updated_at    timestamp with time zone default current_timestamp not null,
    constraint app_connection_secrets_pk primary key (connection_id),
    constraint app_connection_secrets_connection_id_fk
        foreign key (connection_id) references public.app_connections (id)
            on delete cascade,
    constraint app_connection_secrets_credentials_check
        check (jsonb_typeof(credentials) = 'object')
);

-- Touch updated_at on metadata edits only — not on the test route's health
-- bumps, so updated_at keeps meaning "connection definition last changed".
create or replace function public.set_app_connection_updated_at()
    returns trigger
    language plpgsql
as
$$
begin
    if (to_jsonb(new) - 'last_test_status' - 'last_tested_at' - 'last_test_error'
                      - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'last_test_status' - 'last_tested_at' - 'last_test_error'
                      - 'updated_at') then
        new.updated_at := current_timestamp;
    end if;
    return new;
end;
$$;

drop trigger if exists app_connections_set_updated_at on public.app_connections;
create trigger app_connections_set_updated_at
    before update on public.app_connections
    for each row
    execute function public.set_app_connection_updated_at();

-- ---------------------------------------------------------------------- RLS --

alter table public.app_connections        enable row level security;
alter table public.app_connection_secrets enable row level security;

-- app_connections: read = org member, write = org admin.
drop policy if exists app_connections_select on public.app_connections;
create policy app_connections_select on public.app_connections
    for select to authenticated
    using (public.is_org_member(org_id));

drop policy if exists app_connections_insert on public.app_connections;
create policy app_connections_insert on public.app_connections
    for insert to authenticated
    with check (public.is_org_admin(org_id));

drop policy if exists app_connections_update on public.app_connections;
create policy app_connections_update on public.app_connections
    for update to authenticated
    using (public.is_org_admin(org_id))
    with check (public.is_org_admin(org_id));

drop policy if exists app_connections_delete on public.app_connections;
create policy app_connections_delete on public.app_connections
    for delete to authenticated
    using (public.is_org_admin(org_id));

-- app_connection_secrets: NO authenticated policies on purpose. RLS is enabled
-- with zero policies, which denies all authenticated access; combined with the
-- withheld table grant below, the credentials are service_role-only.

-- ------------------------------------------------------------------- grants --

grant select, insert, update, delete on public.app_connections to authenticated;
grant all on public.app_connections        to service_role;
grant all on public.app_connection_secrets to service_role;

-- These revokes are LOAD-BEARING, not belt-and-suspenders. Supabase configures
-- ALTER DEFAULT PRIVILEGES on schema public (for the postgres + supabase_admin
-- roles) granting ALL table privileges to anon + authenticated, so EVERY newly
-- created public table — including these two — is auto-granted to authenticated
-- at CREATE TABLE time (verified via pg_default_acl + a probe table). Without
-- the revoke below, authenticated would hold a real SELECT grant on the secrets
-- table and only RLS-deny-all would stand between a member and the credentials.
-- Strip the auto-granted privileges so secrets are reachable by service_role
-- alone, and drop anon's grant on the metadata table it never needs.
revoke all on public.app_connection_secrets from authenticated, anon;
revoke all on public.app_connections from anon;
