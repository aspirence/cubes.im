-- =============================================================================
-- Google connection — per-workspace OAuth credentials
-- =============================================================================
-- The first step of Content Studio ↔ Google Sheets sync, and the first OAuth
-- flow in this product. Everything else in the repo that talks to a third party
-- holds a static key (Resend, Dodo); Google hands back a refresh token that must
-- be kept, rotated into short-lived access tokens, and revoked cleanly. This
-- migration is only the storage for that — no sync tables yet.
--
-- SCOPE: drive.file, not spreadsheets.
-- The app asks for `https://www.googleapis.com/auth/drive.file`, which grants
-- access only to files the user explicitly hands over through the Google Picker.
-- Google classes it non-sensitive, where the broader `spreadsheets` scope is
-- sensitive and drags the whole app into a security assessment. The scope is
-- recorded per connection rather than assumed, so a future connection asking for
-- something wider is visible in the row instead of buried in code.
--
-- SHAPE: metadata table + secrets table, exactly as app_resend_connections /
-- app_resend_secrets (20261071000000_email_engine.sql:71,111). The split is what
-- lets a member see "Connected as someone@example.com" without the tokens ever
-- being readable by anything but service_role.
--
-- TEAM-SCOPED, not org-scoped. The existing generic `app_connections`
-- (20261011000000) is org-scoped and its `provider` column is a CHECK
-- constraint, so putting Google there would mean altering a constraint and
-- straddling two scoping models. Content Studio is team-scoped; so is this.
--
-- Re-runnable: create table if not exists / drop policy if exists.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. app_google_connections — one Google account per workspace (team)
-- -----------------------------------------------------------------------------
-- A team may connect MORE THAN ONE Google account, which is why this is keyed on
-- its own id rather than on team_id. Sheets are bound per project, and there is
-- no reason two projects' sheets must live in the same person's Drive — a client
-- project's sheet often belongs to whoever owns that client relationship. The
-- sync row (added in a later migration) points at a specific connection, so each
-- project resolves to the account that can actually read its file.
--
-- Identity is google_sub, not the email address. `sub` is the stable subject
-- claim from the id_token; an email can be changed or reassigned inside a Google
-- Workspace, and keying on it would silently re-point a connection at a
-- different identity. The email is kept alongside purely to display.
create table if not exists public.app_google_connections (
    id                   uuid default gen_random_uuid() not null,
    team_id              uuid not null,
    google_sub           text not null,
    -- Which Google account consented. Shown in the UI so someone can tell whose
    -- Drive the sheets are being read from, and to make a stale connection
    -- obvious after someone leaves.
    google_account_email text,
    -- Space-separated, as Google returns it. Recorded rather than assumed so a
    -- connection made under an older, narrower scope set is self-describing.
    -- Expected today: "openid email https://www.googleapis.com/auth/drive.file".
    scopes               text not null,
    enabled              boolean not null default true,
    -- Mirrors "a refresh token is stored" so the UI can show Connected WITHOUT
    -- ever reading it. The tokens live in app_google_secrets.
    has_refresh_token    boolean not null default false,
    -- Set when Google stops honouring the refresh token (a 400 invalid_grant on
    -- refresh, which is what a user-side revoke looks like from here). Kept
    -- rather than deleting the row so the UI can say "reconnect" against the
    -- same account instead of forgetting the connection ever existed.
    revoked_at           timestamptz,
    last_test_at         timestamptz,
    last_test_ok         boolean,
    -- Sanitised outcome only — this column is workspace-member readable, so it
    -- must never carry raw Google error text, tokens, or any part of a URL that
    -- could contain one.
    last_test_error      text,
    connected_by         uuid,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    constraint app_google_connections_pk primary key (id),
    -- Reconnecting the same Google account updates the existing row rather than
    -- accumulating duplicates, each with its own refresh token competing for
    -- Google's per-client grant limit.
    constraint app_google_connections_account_uniq unique (team_id, google_sub),
    constraint app_google_connections_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_google_connections_connected_by_fk
        foreign key (connected_by) references public.users (id) on delete set null,
    constraint app_google_connections_sub_check
        check (char_length(google_sub) between 1 and 255),
    constraint app_google_connections_email_check
        check (google_account_email is null
               or char_length(google_account_email) between 3 and 320),
    constraint app_google_connections_scopes_check
        check (char_length(scopes) between 1 and 2000),
    constraint app_google_connections_error_check
        check (last_test_error is null or char_length(last_test_error) <= 1000)
);

create index if not exists app_google_connections_team_index
    on public.app_google_connections (team_id);

alter table public.app_google_connections enable row level security;

drop policy if exists app_google_connections_select on public.app_google_connections;
create policy app_google_connections_select on public.app_google_connections
    for select to authenticated
    using (public.is_team_member(team_id));

-- Deliberately SELECT-only for authenticated, which is where this departs from
-- app_resend_connections. That table has an admin write policy because it holds
-- fields an admin genuinely edits in the browser (from_email, reply_to). Every
-- column here is produced by the OAuth exchange instead, and connect/disconnect
-- both have to do more than touch a row — mint or revoke a token with Google and
-- clear app_google_secrets in the same breath. So writes go through the routes
-- as service_role, which authorize the caller on their cookie session with
-- authorizeTeam(teamId, "admin") exactly as the other connector routes do. An
-- admin write policy here would be dead code: the revoke at the bottom of this
-- migration withdraws the underlying grant it would need.

drop trigger if exists app_google_connections_set_updated_at on public.app_google_connections;
create trigger app_google_connections_set_updated_at
    before update on public.app_google_connections
    for each row
    execute function public.set_row_updated_at();


-- -----------------------------------------------------------------------------
-- 2. app_google_secrets — the tokens. service_role ONLY.
-- -----------------------------------------------------------------------------
-- The access token is cached here rather than re-minted on every call: Google
-- issues them with roughly an hour of life, and a sync that runs every few
-- minutes would otherwise spend a round trip on the token endpoint each time and
-- burn quota for nothing. expires_at is what decides; it is stored as an
-- absolute instant so a clock comparison is all that is ever needed.
create table if not exists public.app_google_secrets (
    connection_id            uuid not null,
    refresh_token            text not null,
    access_token             text,
    access_token_expires_at  timestamptz,
    updated_at               timestamptz not null default now(),
    constraint app_google_secrets_pk primary key (connection_id),
    constraint app_google_secrets_connection_fk
        foreign key (connection_id) references public.app_google_connections (id)
        on delete cascade
);

-- RLS on with ZERO policies = deny-all for authenticated/anon. Combined with the
-- withheld grant below, the tokens are reachable by service_role alone.
alter table public.app_google_secrets enable row level security;


-- -----------------------------------------------------------------------------
-- 3. Grants
-- -----------------------------------------------------------------------------
grant select on public.app_google_connections to authenticated;

grant all on public.app_google_connections to service_role;
grant all on public.app_google_secrets     to service_role;

-- These revokes are LOAD-BEARING, mirroring app_resend_secrets (20261071000000)
-- and app_connection_secrets (20261011000000). Supabase sets ALTER DEFAULT
-- PRIVILEGES on schema public granting ALL table privileges to anon +
-- authenticated, so every new public table is auto-granted to authenticated at
-- CREATE TABLE time. Without these, `authenticated` would hold a real SELECT
-- grant on the refresh token and only RLS-deny-all would stand between a member
-- and the credential.
revoke all on public.app_google_secrets     from authenticated, anon;
revoke all on public.app_google_connections from anon;

-- The connection row is written by the OAuth callback and cleared by the
-- disconnect route, both service_role. Members must never be able to forge a
-- connection, flip has_refresh_token by hand, or delete the row without the
-- paired Google-side revoke and secret wipe that the route performs.
revoke insert, update, delete on public.app_google_connections from authenticated;
