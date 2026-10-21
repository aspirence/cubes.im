-- =============================================================================
-- Meta Ads (Facebook Ads Manager) connections, for workflows
-- =============================================================================
-- A workspace admin presses "Continue with Facebook" (Workflows → Integrations);
-- Facebook asks which business and ad accounts to share, and the callback
-- stores the token and the ad accounts it can read. The workflow step
-- "Meta Ads: get insights" (meta.get_insights) reads daily numbers from those
-- accounts at run time — nothing is synced into Cubes ahead of time.
--
-- Same shape and access model as app_google_connections / app_google_secrets:
--  - app_meta_connections: one row per Facebook identity per workspace; members
--    may read it (who is connected, health), only the service role writes.
--  - app_meta_secrets: the access token. Service role only — zero policies and
--    every grant revoked from authenticated/anon.
--  - app_meta_ad_accounts: the ad accounts a connection can read, each with an
--    `enabled` switch the admin controls. Members may read (the step picker).
--
-- Not an app in the App Center: it is a workflow integration, so there is no
-- installed_apps row and no app_key.
-- =============================================================================

create table if not exists public.app_meta_connections (
    id               uuid default gen_random_uuid() not null,
    team_id          uuid not null,
    -- The Facebook user — or, with a Login for Business configuration, the
    -- business integration system user — the token belongs to.
    meta_user_id     text not null,
    meta_user_name   text,
    -- 'system_user' tokens do not expire; 'user' tokens last about 60 days.
    token_kind       text not null default 'user',
    token_expires_at timestamptz,
    scopes           text not null default '',
    enabled          boolean not null default true,
    revoked_at       timestamptz,
    last_test_at     timestamptz,
    last_test_ok     boolean,
    last_test_error  text,
    connected_by     uuid,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint app_meta_connections_pk primary key (id),
    constraint app_meta_connections_identity_uniq unique (team_id, meta_user_id),
    constraint app_meta_connections_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_meta_connections_connected_by_fk
        foreign key (connected_by) references public.users (id) on delete set null,
    constraint app_meta_connections_user_check
        check (char_length(meta_user_id) between 1 and 100),
    constraint app_meta_connections_name_check
        check (meta_user_name is null or char_length(meta_user_name) <= 300),
    constraint app_meta_connections_kind_check
        check (token_kind in ('user', 'system_user')),
    constraint app_meta_connections_scopes_check
        check (char_length(scopes) <= 2000),
    constraint app_meta_connections_error_check
        check (last_test_error is null or char_length(last_test_error) <= 1000)
);

create index if not exists app_meta_connections_team_index
    on public.app_meta_connections (team_id);

alter table public.app_meta_connections enable row level security;

drop policy if exists app_meta_connections_select on public.app_meta_connections;
create policy app_meta_connections_select on public.app_meta_connections
    for select to authenticated
    using (public.is_team_member(team_id));

drop trigger if exists app_meta_connections_set_updated_at on public.app_meta_connections;
create trigger app_meta_connections_set_updated_at
    before update on public.app_meta_connections
    for each row
    execute function public.set_row_updated_at();

create table if not exists public.app_meta_secrets (
    connection_id uuid not null,
    access_token  text not null,
    updated_at    timestamptz not null default now(),
    constraint app_meta_secrets_pk primary key (connection_id),
    constraint app_meta_secrets_connection_fk
        foreign key (connection_id) references public.app_meta_connections (id)
        on delete cascade
);

-- RLS on with no policies: nothing but the service role can read a token.
alter table public.app_meta_secrets enable row level security;

create table if not exists public.app_meta_ad_accounts (
    id             uuid default gen_random_uuid() not null,
    team_id        uuid not null,
    connection_id  uuid not null,
    -- With the act_ prefix, as Graph names it.
    external_id    text not null,
    name           text not null,
    currency       text,
    timezone_name  text,
    account_status integer,
    business_name  text,
    enabled        boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    constraint app_meta_ad_accounts_pk primary key (id),
    constraint app_meta_ad_accounts_uniq unique (connection_id, external_id),
    constraint app_meta_ad_accounts_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_meta_ad_accounts_connection_fk
        foreign key (connection_id) references public.app_meta_connections (id)
        on delete cascade,
    constraint app_meta_ad_accounts_external_check
        check (external_id ~ '^act_[0-9]{1,30}$'),
    constraint app_meta_ad_accounts_name_check
        check (char_length(name) between 1 and 300)
);

create index if not exists app_meta_ad_accounts_team_index
    on public.app_meta_ad_accounts (team_id);

alter table public.app_meta_ad_accounts enable row level security;

drop policy if exists app_meta_ad_accounts_select on public.app_meta_ad_accounts;
create policy app_meta_ad_accounts_select on public.app_meta_ad_accounts
    for select to authenticated
    using (public.is_team_member(team_id));

drop trigger if exists app_meta_ad_accounts_set_updated_at on public.app_meta_ad_accounts;
create trigger app_meta_ad_accounts_set_updated_at
    before update on public.app_meta_ad_accounts
    for each row
    execute function public.set_row_updated_at();

grant select on public.app_meta_connections to authenticated;
grant select on public.app_meta_ad_accounts to authenticated;
grant all on public.app_meta_connections to service_role;
grant all on public.app_meta_secrets     to service_role;
grant all on public.app_meta_ad_accounts to service_role;
revoke all on public.app_meta_secrets     from authenticated, anon;
revoke all on public.app_meta_connections from anon;
revoke all on public.app_meta_ad_accounts from anon;
revoke insert, update, delete on public.app_meta_connections from authenticated;
revoke insert, update, delete on public.app_meta_ad_accounts from authenticated;
