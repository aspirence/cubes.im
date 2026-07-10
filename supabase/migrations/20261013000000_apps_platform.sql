-- =============================================================================
-- Apps platform — installable first-party feature apps (mini-applications).
-- =============================================================================
-- Distinct from the App Center connectors (app_connections, 20261011): those
-- reach EXTERNAL services (Slack/webhook). This is the INTERNAL app platform —
-- prebuilt feature apps (e.g. a video-review tool) a team installs, each of
-- which stores its own data in namespaced `app_<key>_*` tables that FK into the
-- core (projects/tasks/teams) and inherit the shared is_team_member /
-- is_team_admin RLS. See docs/APPS_PLATFORM.md for the app-authoring convention.
--
-- The catalog of available apps is code (src/lib/apps-platform/catalog.ts); this
-- table records which apps a team has installed.

create table if not exists public.installed_apps (
    id           uuid                     default gen_random_uuid() not null,
    team_id      uuid                                               not null,
    app_key      text                                               not null,
    enabled      boolean                  default true              not null,
    config       jsonb                    default '{}'::jsonb       not null,
    installed_by uuid,
    created_at   timestamp with time zone default current_timestamp not null,
    updated_at   timestamp with time zone default current_timestamp not null,
    constraint installed_apps_pk primary key (id),
    constraint installed_apps_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint installed_apps_installed_by_fk foreign key (installed_by)
        references public.users (id) on delete set null,
    -- app_key is validated against the code catalog at the app layer (a DB CHECK
    -- can't reference code); constrained only to a sane length here.
    constraint installed_apps_app_key_check check (char_length(app_key) <= 100),
    constraint installed_apps_config_check check (jsonb_typeof(config) = 'object'),
    constraint installed_apps_unique unique (team_id, app_key)
);
create index if not exists installed_apps_team_id_index
    on public.installed_apps (team_id);

-- Reuse the shared touch-updated_at trigger fn (defined in 20261012).
drop trigger if exists installed_apps_set_updated_at on public.installed_apps;
create trigger installed_apps_set_updated_at
    before update on public.installed_apps
    for each row execute function public.set_row_updated_at();

-- ---------------------------------------------------------------------- RLS --
alter table public.installed_apps enable row level security;

drop policy if exists installed_apps_select on public.installed_apps;
create policy installed_apps_select on public.installed_apps
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists installed_apps_write on public.installed_apps;
create policy installed_apps_write on public.installed_apps
    for all to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

-- ------------------------------------------------------------------- grants --
grant select, insert, update, delete on public.installed_apps to authenticated;
grant all on public.installed_apps to service_role;
revoke all on public.installed_apps from anon;
